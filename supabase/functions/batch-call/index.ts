// Sends the next cleared clinics to ElevenLabs batch calling, up to the daily cap (default 299).
// Only clinics that pass every calling rule right now are included (see markets.ts): UAE excluded, UK/EU consent only,
// US/Canada confirmed landline + fresh DNC check, inside the clinic's own calling hours, not a weekend, not opted out,
// not called today, fewer than 2 unanswered calls this week.
// Called from the console ("Start batch now") or hourly by the scheduler when auto-dial is on.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callBlocks, callVars, DAY } from "./markets.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function positioning(l: any) {
  const r = l.report;
  if (r && r.summary) {
    const ins = r.review_insights || {};
    return `Report: ${r.summary} Propose first: ${(r.propose || []).slice(0, 3).join("; ")}.${(ins.complaints || []).length ? ` Their Google reviews mention: ${ins.complaints.slice(0, 2).join(", ")}.` : ""} Suggested opener: ${r.opener || ""} Mention gaps gently, as observations.`;
  }
  return "Not scanned yet: ask how patients book today and what happens to after-hours calls.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const cronKey = req.headers.get("x-cron-key");
  let fromCron = false;
  if (cronKey) {
    const { data } = await admin.from("settings").select("data").eq("id", "cron").maybeSingle();
    if (!data?.data?.key || data.data.key !== cronKey) return json({ error: "not_allowed" }, 403);
    fromCron = true;
  } else {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(jwt);
    const email = u?.user?.email?.toLowerCase();
    const { data: owner } = email ? await admin.from("app_owners").select("email").ilike("email", email).maybeSingle() : { data: null };
    if (!owner) { const { data: tm } = await admin.from("settings").select("data").eq("id", "test_mode").maybeSingle(); if (tm?.data?.enabled !== true) return json({ error: "not_allowed" }, 403); }
  }
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const dryRun = !!body.preview;

  const { data: cs } = await admin.from("settings").select("data").eq("id", "calling").maybeSingle();
  const C = { daily_cap: 299, auto: false, per_run: 50, concurrency: 5, ...(cs?.data || {}) };
  if (fromCron && !C.auto) return json({ ok: true, skipped: "auto-dial is off" });

  const now = Date.now(), dayStart = new Date(Math.floor((now + 4 * 3600000) / DAY) * DAY - 4 * 3600000);
  const { count: today } = await admin.from("calls").select("id", { count: "exact", head: true }).eq("test", false).gte("created_at", dayStart.toISOString());
  const remaining = Math.max(0, Number(C.daily_cap) - (today || 0));

  let leads: any[] = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data } = await admin.from("leads").select("id, company, name, role, industry, city, market, phone, status, opted_out, dncr, consent, declined, campaign, quality, audit, context, report, list, lon").eq("list", "queue").neq("market", "AE").order("id").range(from, from + 999);
    if (!data) break; leads = leads.concat(data); if (data.length < 1000) break;
  }
  const { data: recent } = await admin.from("calls").select("lead_id, created_at, answered, status").eq("test", false).gte("created_at", new Date(now - 7 * DAY).toISOString());
  const byLead = new Map<string, any[]>(); for (const c of recent || []) byLead.set(c.lead_id, [...(byLead.get(c.lead_id) || []), c]);
  const PRI: Record<string, number> = { callback: 0, hot: 1, referral: 2, warm: 3, new: 4 };
  const eligible = leads.filter((l) => l.status !== "cold" && callBlocks(l, now, byLead.get(l.id) || []).length === 0)
    .sort((a, b) => (PRI[a.status] ?? 5) - (PRI[b.status] ?? 5) || (b.report ? 1 : 0) - (a.report ? 1 : 0) || (a.quality?.confidence === "high" ? -1 : 0) - (b.quality?.confidence === "high" ? -1 : 0));

  const want = Math.min(Number(body.count) || Number(C.per_run) || 50, remaining, eligible.length);
  const pick = eligible.slice(0, want);
  const byMarket: Record<string, number> = {}; for (const l of eligible) byMarket[l.market] = (byMarket[l.market] || 0) + 1;
  const summary = { calls_today: today || 0, daily_cap: Number(C.daily_cap), remaining_today: remaining, eligible_now: eligible.length, eligible_by_market: byMarket, would_call: pick.length };
  if (dryRun || !pick.length) return json({ ok: true, preview: true, ...summary, reason: !pick.length ? (remaining === 0 ? "Daily cap reached" : "No clinics are cleared to call right now (hours, weekends or rules)") : null });

  const apiKey = Deno.env.get("ELEVENLABS_API_KEY"), phoneId = Deno.env.get("ELEVENLABS_PHONE_NUMBER_ID");
  const agentId = Deno.env.get("ELEVENLABS_AGENT_ID") || "agent_3401m6p7pqnjepwv9rgy15kfq48c";
  if (!apiKey || !phoneId) return json({ error: "not_configured", message: "Connect ElevenLabs first: add ELEVENLABS_API_KEY and ELEVENLABS_PHONE_NUMBER_ID in Supabase secrets.", ...summary }, 503);

  const { data: prof } = await admin.from("settings").select("data").eq("id", "profile").maybeSingle();
  const P = (prof?.data ?? {}) as Record<string, string>;
  const { data: rows, error: insErr } = await admin.from("calls").insert(pick.map((l) => ({ lead_id: l.id, status: "initiated", test: false, to_number: l.phone }))).select("id, lead_id");
  if (insErr) return json({ error: "db_error", message: insErr.message }, 500);
  const rowFor = new Map((rows || []).map((r: any) => [r.lead_id, r.id]));
  const recipients = pick.map((l) => ({
    id: rowFor.get(l.id), phone_number: l.phone,
    conversation_initiation_client_data: { dynamic_variables: { ...callVars(l, P, now, positioning(l)), call_row_id: rowFor.get(l.id), lead_id: l.id } },
  }));
  const res = await fetch("https://api.elevenlabs.io/v1/convai/batch-calling/submit", {
    method: "POST", headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ call_name: `Clinic Growth ${new Date(now + 4 * 3600000).toISOString().slice(0, 16).replace("T", " ")} (${pick.length})`, agent_id: agentId, agent_phone_number_id: phoneId, recipients, target_concurrency_limit: Number(C.concurrency) || 5 }),
  });
  const out = await res.json().catch(() => ({}));
  const ids = (rows || []).map((r: any) => r.id);
  if (!res.ok || !out.id) {
    await admin.from("calls").update({ status: "failed", detail: String(out?.detail?.[0]?.msg || out?.detail || out?.message || `HTTP ${res.status}`).slice(0, 300) }).in("id", ids);
    return json({ error: "elevenlabs_error", message: out?.detail?.[0]?.msg || out?.message || `HTTP ${res.status}`, ...summary }, 502);
  }
  await admin.from("calls").update({ status: "in_progress", batch_id: out.id }).in("id", ids);
  return json({ ok: true, batch_id: out.id, submitted: pick.length, ...summary, remaining_today: remaining - pick.length });
});
