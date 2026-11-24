// Saves every finished call: outcome, transcript, lead status, and any confirmed meeting.
// A confirmed meeting is written to the meetings table AND booked straight into Maha's Google Calendar
// (through her Google Apps Script web app, saved in settings row "gcal"), with the clinic invited.
//
// Three ways in, all ending in the same save:
//  1. ElevenLabs post-call webhook, signed (ELEVENLABS_WEBHOOK_SECRET set): payload is trusted.
//  2. Any POST with a conversation_id but no valid signature: the conversation is re-read from the
//     ElevenLabs API with our own key, so nothing in the request body is trusted.
//  3. The scheduler (x-cron-key), every few minutes: finds calls still "in progress" and pulls their
//     results from ElevenLabs. This works even if no webhook is set up in ElevenLabs.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const EL = "https://api.elevenlabs.io/v1/convai";
const enc = new TextEncoder();
async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEq(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

const STATUS_MAP: Record<string, { status?: string; outcome: string }> = {
  meeting_confirmed: { status: "booked", outcome: "booked" },
  hot: { status: "hot", outcome: "hot" },
  warm: { status: "warm", outcome: "info_sent" },
  not_interested: { status: "cold", outcome: "declined" },
  callback_requested: { status: "callback", outcome: "callback" },
  gatekeeper_referral: { status: "referral", outcome: "referral" },
  do_not_call: { status: "dnc", outcome: "opt_out" },
  voicemail: { outcome: "voicemail" },
  no_answer: { outcome: "no_answer" },
};

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const apiKey = Deno.env.get("ELEVENLABS_API_KEY") || "";

async function elGet(path: string) {
  if (!apiKey) return null;
  const r = await fetch(`${EL}${path}`, { headers: { "xi-api-key": apiKey } });
  return r.ok ? await r.json().catch(() => null) : null;
}

/** Exact meeting start: the agent's ISO answer, else the offered slot whose label matches what was agreed. */
export function meetingStart(iso: unknown, label: unknown, slotsIso: string): number | null {
  const now = Date.now(), ok = (ms: number) => Number.isFinite(ms) && ms > now - 3600000 && ms < now + 90 * 86400000;
  if (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) && /([+-]\d{2}:?\d{2}|Z)$/.test(iso.trim())) {
    const ms = Date.parse(iso.trim()); if (ok(ms)) return ms;
  }
  const L = String(label || "").toLowerCase().replace(/\s+/g, " ");
  if (L) for (const pair of String(slotsIso || "").split(";")) {
    const [lab, when] = pair.split(" = ").map((s) => s?.trim());
    if (!lab || !when) continue;
    // "Wednesday 18 November at 11:30am" vs what was agreed, e.g. "Wed 18 Nov, 11:30 Riyadh time"
    const m = lab.toLowerCase().match(/ (\d{1,2}) ([a-z]{3})[a-z]* at (\d{1,2})(?::(\d{2}))?(am|pm)/);
    if (!m) continue;
    const [, dd, mon, hh, mm = "00", ap] = m, h24 = (+hh % 12) + (ap === "pm" ? 12 : 0);
    const dayHit = new RegExp(`\\b${dd}(st|nd|rd|th)?\\b`).test(L) && L.includes(mon);
    const times = [`${h24}:${mm}`, `${hh}:${mm}`, mm === "00" ? `${hh}${ap}` : `${hh}:${mm}${ap}`, mm === "00" ? `${hh} ${ap}` : `${hh}:${mm} ${ap}`];
    if (dayHit && times.some((t) => L.includes(t))) {
      const ms = Date.parse(when); if (ok(ms)) return ms;
    }
  }
  return null;
}

/** Book the meeting in Google Calendar through the Apps Script web app. Never throws. */
async function bookCalendar(ev: { title: string; start: number; minutes: number; description: string; guests: string[]; location: string }) {
  const { data } = await admin.from("settings").select("data").eq("id", "gcal").maybeSingle();
  const g = data?.data || {};
  if (!g.url || !g.key) return { ok: false, error: "Google Calendar not connected yet" };
  try {
    const r = await fetch(g.url, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow",
      body: JSON.stringify({
        key: g.key, action: "create", title: ev.title, start: new Date(ev.start).toISOString(),
        end: new Date(ev.start + ev.minutes * 60000).toISOString(), description: ev.description, location: ev.location,
        guests: g.send_invites === false ? [] : ev.guests, send_invites: g.send_invites !== false, meet: g.meet !== false,
      }),
    });
    const out = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    return out?.ok ? out : { ok: false, error: String(out?.error || `HTTP ${r.status}`).slice(0, 200) };
  } catch (e) { return { ok: false, error: String(e).slice(0, 200) }; }
}

/** Save one finished conversation. `d` has the shape of the post-call webhook's data / GET conversation. */
async function saveConversation(d: any, failed?: string) {
  const convId: string | undefined = d.conversation_id;
  const dyn = d?.conversation_initiation_client_data?.dynamic_variables || {};
  const callRowId: string | undefined = dyn.call_row_id;
  let q = admin.from("calls").select("id, lead_id, test, status");
  q = callRowId ? q.eq("id", callRowId) : q.eq("conversation_id", convId ?? "__none__");
  const { data: call } = await q.maybeSingle();
  if (!call) return "unknown call";

  if (failed) {
    await admin.from("calls").update({ status: "done", outcome: "no_answer", answered: false, detail: failed.slice(0, 200), conversation_id: convId ?? null, ended_at: new Date().toISOString() }).eq("id", call.id).neq("status", "done");
    return "failed saved";
  }

  const dc = d?.analysis?.data_collection_results || {};
  const val = (k: string) => { const v = dc?.[k]; return v && typeof v === "object" && "value" in v ? v.value : v ?? null; };
  const leadStatus = String(val("lead_status") || "");
  const map = STATUS_MAP[leadStatus] || { outcome: "ended" };
  const transcript = (d.transcript || []).filter((x: any) => x?.message).map((x: any) => ({ who: x.role === "agent" ? "Agent" : "Clinic", text: String(x.message) }));
  const duration = Number(d?.metadata?.call_duration_secs) || null;
  const answered = leadStatus !== "no_answer" && leadStatus !== "voicemail" && transcript.some((x: any) => x.who === "Clinic");
  const meetingBooked = val("meeting_booked") === true || val("meeting_booked") === "true";
  const nextStep = val("next_step");

  // Claim the call (first writer wins, so webhook + scheduler never double-book).
  const { data: claimed } = await admin.from("calls").update({
    status: "done", outcome: meetingBooked ? "booked" : map.outcome, answered, duration_s: duration, conversation_id: convId ?? null,
    detail: String(val("meeting_time") || val("decision_maker_name") || val("callback_time") || d?.analysis?.transcript_summary || "").slice(0, 300),
    transcript, analysis: { data: Object.fromEntries(Object.keys(dc).map((k) => [k, val(k)])), summary: d?.analysis?.transcript_summary || null, evaluation: d?.analysis?.evaluation_criteria_results || null, call_successful: d?.analysis?.call_successful || null },
    ended_at: new Date().toISOString(),
  }).eq("id", call.id).neq("status", "done").select("id");
  if (!claimed?.length) return "already saved";

  const { data: lead } = call.lead_id ? await admin.from("leads").select("company, market, city, phone, declined, campaign").eq("id", call.lead_id).maybeSingle() : { data: null };
  const clinic = lead?.company || "Clinic";
  const startMs = meetingBooked ? meetingStart(val("meeting_start_iso"), val("meeting_time"), dyn.meeting_slots_iso) : null;
  const inPerson = val("meeting_format") === "in_person";
  const email = String(val("invite_email") || "").trim();
  const guests = !call.test && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? [email] : [];
  const desc = [
    `Booked by the AI caller on ${new Date().toISOString().slice(0, 10)}.`,
    `Clinic: ${clinic}${lead?.city ? ", " + lead.city : ""}${lead?.phone ? " · " + lead.phone : ""}`,
    val("attendee_name") ? `Attending: ${val("attendee_name")}` : "",
    val("preferred_contact") ? `WhatsApp/contact: ${val("preferred_contact")}` : "",
    val("interest_area") ? `Interest: ${val("interest_area")}` : "",
    val("pain_point") ? `Pain point: ${val("pain_point")}` : "",
    val("clinic_size") ? `Size: ${val("clinic_size")}` : "",
    val("objections") ? `Objections: ${val("objections")}` : "",
    d?.analysis?.transcript_summary ? `\nCall summary: ${d.analysis.transcript_summary}` : "",
  ].filter(Boolean).join("\n");

  // Test calls to your own phone: book a [TEST] event (no guests) so you can see it work, never touch a clinic record.
  if (call.test || !call.lead_id) {
    if (meetingBooked && startMs) {
      const cal = await bookCalendar({ title: `[TEST] Claimly AI demo – ${clinic}`, start: startMs, minutes: 30, description: desc, guests: [], location: "" });
      await admin.from("calls").update({ analysis: { data: Object.fromEntries(Object.keys(dc).map((k) => [k, val(k)])), summary: d?.analysis?.transcript_summary || null, calendar: cal } }).eq("id", call.id);
    }
    return "test saved";
  }

  const upd: Record<string, unknown> = {};
  if (meetingBooked) upd.status = "booked"; else if (map.status) upd.status = map.status;
  if (map.status === "dnc") upd.opted_out = true;
  if (nextStep) upd.next = String(nextStep).slice(0, 300);
  if (leadStatus === "gatekeeper_referral" && val("decision_maker_name")) upd.next = `Call ${val("decision_maker_name")}${val("preferred_contact") ? " on " + val("preferred_contact") : ""}`;
  if (leadStatus === "not_interested" && lead && !(lead.declined || []).includes(lead.campaign)) upd.declined = [...(lead.declined || []), lead.campaign];
  if (Object.keys(upd).length) await admin.from("leads").update(upd).eq("id", call.lead_id);

  if (meetingBooked) {
    const cal = startMs
      ? await bookCalendar({ title: `Claimly AI × ${clinic}${inPerson ? " (visit)" : " (online demo)"}`, start: startMs, minutes: 30, description: desc, guests, location: inPerson ? [clinic, lead?.city].filter(Boolean).join(", ") : "" })
      : { ok: false, error: "No exact meeting time from the call: confirm the time, then add it to the calendar" };
    await admin.from("meetings").insert({
      lead_id: call.lead_id, clinic, market: lead?.market || null,
      at: startMs ? new Date(startMs).toISOString() : null,
      label: String(val("meeting_time") || "Time to confirm"), attendee: val("attendee_name") || null,
      email: email || null, whatsapp: val("preferred_contact") || null,
      format: inPerson ? "in_person" : "online", status: "confirmed", source: "call", call_id: call.id,
      gcal_event_id: cal.ok ? cal.id || null : null, gcal_link: cal.ok ? cal.link || null : null,
      gcal_meet: cal.ok ? cal.meet || null : null, gcal_error: cal.ok ? (cal.conflict ? "Clashes with another event in your calendar" : null) : cal.error,
    });
  }
  return "saved";
}

/** Scheduler: pull results for calls that are still open (covers missing or failed webhooks). */
async function sync() {
  const now = Date.now();
  const { data: open } = await admin.from("calls").select("id, conversation_id, batch_id, created_at").in("status", ["initiated", "in_progress"])
    .lt("created_at", new Date(now - 3 * 60000).toISOString()).gt("created_at", new Date(now - 3 * 86400000).toISOString()).limit(60);
  let saved = 0;
  // Batch calls: map each recipient (our call row id) to its conversation.
  const batches = [...new Set((open || []).filter((c) => !c.conversation_id && c.batch_id).map((c) => c.batch_id))];
  const convFor = new Map<string, { conv?: string; status?: string }>();
  for (const b of batches) {
    const bj = await elGet(`/batch-calling/${b}`);
    for (const r of bj?.recipients || []) convFor.set(String(r.id), { conv: r.conversation_id || undefined, status: r.status });
  }
  for (const c of open || []) {
    const m = convFor.get(c.id);
    const conv = c.conversation_id || m?.conv;
    if (!conv) {
      if (m && ["failed", "cancelled", "no_response", "voicemail"].includes(String(m.status))) { await saveConversation({ conversation_initiation_client_data: { dynamic_variables: { call_row_id: c.id } } }, `Batch: ${m.status}`); saved++; }
      else if (Date.parse(c.created_at) < now - 6 * 3600000) { await admin.from("calls").update({ status: "done", outcome: "no_answer", answered: false, detail: "No result from ElevenLabs", ended_at: new Date().toISOString() }).eq("id", c.id).neq("status", "done"); saved++; }
      continue;
    }
    const d = await elGet(`/conversations/${conv}`);
    if (!d) continue;
    if (d.status === "done" || d.status === "failed") {
      if (!d.conversation_initiation_client_data?.dynamic_variables?.call_row_id) d.conversation_initiation_client_data = { ...(d.conversation_initiation_client_data || {}), dynamic_variables: { ...(d.conversation_initiation_client_data?.dynamic_variables || {}), call_row_id: c.id } };
      await saveConversation(d, d.status === "failed" && !(d.transcript || []).length ? "Call failed" : undefined); saved++;
    }
  }
  return { open: open?.length || 0, saved };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const cronKey = req.headers.get("x-cron-key");
  if (cronKey) {
    const { data } = await admin.from("settings").select("data").eq("id", "cron").maybeSingle();
    if (!data?.data?.key || data.data.key !== cronKey) return new Response("not allowed", { status: 403 });
    const b = await req.json().catch(() => ({}));
    if (b?.check) { // health check: is the ElevenLabs key saved and accepted? (never returns the key)
      const agentId = Deno.env.get("ELEVENLABS_AGENT_ID") || "agent_3401m6p7pqnjepwv9rgy15kfq48c";
      const r = apiKey ? await fetch(`${EL}/agents/${agentId}`, { headers: { "xi-api-key": apiKey } }) : null;
      return Response.json({ key_saved: !!apiKey, key_works: !!r?.ok, http: r?.status ?? null, phone_number_id_saved: !!Deno.env.get("ELEVENLABS_PHONE_NUMBER_ID") });
    }
    return Response.json(await sync());
  }

  const raw = await req.text();
  let evt: any; try { evt = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  // Signed webhook?
  const secret = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET");
  let trusted = false;
  const sigHeader = req.headers.get("elevenlabs-signature") || "";
  if (secret && sigHeader) {
    const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=").map((s) => s.trim())));
    const t = Number(parts.t), v0 = parts.v0 || "";
    trusted = !!t && !!v0 && Math.abs(Date.now() / 1000 - t) <= 30 * 60 && safeEq(await hmacHex(secret, `${t}.${raw}`), v0);
    if (!trusted) return new Response("bad signature", { status: 401 });
  }

  const d = evt?.data || {};
  if (trusted) {
    if (evt.type === "call_initiation_failure") return new Response(await saveConversation(d, String(d.failure_reason || d.reason || "failed")));
    if (evt.type !== "post_call_transcription") return new Response("ok (ignored)");
    return new Response(await saveConversation(d));
  }

  // Unsigned: use only the conversation id, and read the real result from ElevenLabs ourselves.
  const convId = String(d.conversation_id || evt.conversation_id || "");
  if (!/^[\w-]{6,80}$/.test(convId)) return new Response("ok (no conversation id)");
  const real = await elGet(`/conversations/${convId}`);
  if (!real) return new Response("ok (not found)");
  if (real.status !== "done" && real.status !== "failed") return new Response("ok (still running)");
  return new Response(await saveConversation(real, real.status === "failed" && !(real.transcript || []).length ? "Call failed" : undefined));
});
