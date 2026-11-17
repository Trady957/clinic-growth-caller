// Cold email: the second outreach channel, sent through Instantly.
//
// Who gets an email (one 3-step sequence per clinic, ever):
//   uae            UAE clinics (no AI calls there)
//   consent_market UK / EU clinics without call consent (email first, ask for a call)
//   us_ca          US / Canada clinics without a confirmed landline + fresh Do Not Call check
//   no_phone       no callable number
//   unreachable    2+ unanswered calls
// Never: opted out, do-not-call, booked, not interested, on the suppression list, excluded markets (Germany by default).
//
// Modes (POST body.mode):
//   status   numbers for the console (today's reach vs plan, who's eligible, Instantly connection)
//   plan     preview today's batch without sending
//   push     send today's batch to Instantly (up to the ramp-up limit); scheduler runs it when email_auto is on
//   sync     read replies, bounces and unsubscribes back from Instantly (scheduler, every 15 minutes)
//   setup    create the Instantly campaigns now (normally done on the first push)
// Auth: the owner's sign-in, or the scheduler's x-cron-key.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callBlocks, DAY, MARKETS, leadTz, offsetMin } from "./markets.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const IN = "https://api.instantly.ai/api/v2";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const KEY = Deno.env.get("INSTANTLY_API_KEY") || "";

async function inst(path: string, init: RequestInit = {}) {
  const r = await fetch(IN + path, { ...init, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

// ---------- regions, languages, copy ----------
// Morning rule: every country (and each US/Canada time zone) gets its own Instantly schedule that starts at
// 9:30 in the clinic's local time, on that country's working days, and stops before closing time.
const zoneKey = (l: any) => `${leadTz(l).replace(/\//g, "-")}~${l.market}`;
function zoneOf(key: string) {
  const [tzk, mk] = key.split("~"); const tz = tzk.replace(/-/g, "/"); const M = MARKETS[mk] || MARKETS.SA;
  const endH = M.end - 1; // last send 30 min before closing
  return { tz, mk, name: M.name + (M.tzs ? ` (${tz.split("/").pop()!.replace("_", " ")})` : ""), days: [0, 1, 2, 3, 4, 5, 6].filter((d) => !M.weekend.includes(d)), from: "09:30", to: `${String(endH).padStart(2, "0")}:30` };
}
const langOf = (l: any) => {
  if (["ar", "fr", "en"].includes(l.lang) && !(l.lang === "ar" && !["SA", "KW", "OM", "EG", "JO", "QA", "BH", "AE"].includes(l.market))) return l.lang;
  return ["SA", "KW", "OM", "EG", "JO"].includes(l.market) ? "ar" : ["MA", "FR", "BE"].includes(l.market) ? "fr" : "en";
};

type Step = { subject: string; body: string; delay: number };
function copy(lang: string, S: { name: string; company: string; address: string }): Step[] {
  const sig = { en: `Best regards,\n${S.name}\n${S.company}`, ar: `مع خالص التحية،\n${S.name}\n${S.company}`, fr: `Bien cordialement,\n${S.name}\n${S.company}` }[lang as "en"];
  const foot = {
    en: `\n\n${S.address}\nNot relevant for you? Reply "no" and I won't write again.`,
    ar: `\n\n${S.address}\nإذا لم يكن هذا مناسباً لكم، يكفي الرد بكلمة "لا" ولن أراسلكم مجدداً.`,
    fr: `\n\n${S.address}\nCe n'est pas pour vous ? Répondez « non » et je ne vous écrirai plus.`,
  }[lang as "en"];
  if (lang === "ar") return [
    { delay: 3, subject: "{{companyName}}: الرد على كل مكالمة مريض", body: `السلام عليكم فريق {{companyName}}،\n\n{{personalization}}\n\nنقدّم للعيادات موظف استقبال يعمل بالذكاء الاصطناعي: يرد على كل مكالمة ورسالة واتساب بالعربية والإنجليزية على مدار الساعة، ويحجز المواعيد مباشرة في التقويم ويرسل التذكيرات، فلا يضيع مريض بسبب مكالمة فائتة. كما نقدّم خدمات التسويق للعيادات التي تريد مرضى جدداً.\n\nهل يناسبكم عرض مدته 15 دقيقة الأسبوع القادم؟ يمكنكم سماعه وهو يرد على مكالمة باسم عيادتكم.\n\n${sig}${foot}` },
    { delay: 4, subject: "", body: `مرحباً مجدداً،\n\nكثير من العيادات التي نتحدث معها تفوتها مكالمات في أوقات الذروة وبعد الإغلاق. يمكنني إرسال تسجيل قصير (دقيقتان) لموظف الاستقبال الذكي وهو يحجز موعداً، هل أرسله لكم؟\n\n${sig}${foot}` },
    { delay: 0, subject: "", body: `رسالة أخيرة مني: إذا لم يكن تحسين الحجوزات أولوية الآن فلا بأس. وإن كان كذلك، أرسلوا لي وقتاً مناسباً وسأرتب عرضاً قصيراً.\n\n${sig}${foot}` },
  ];
  if (lang === "fr") return [
    { delay: 3, subject: "{{companyName}} : répondre à chaque appel patient", body: `Bonjour l'équipe {{companyName}},\n\n{{personalization}}\n\nNous mettons en place des réceptionnistes IA pour les cliniques : ils répondent à chaque appel et message WhatsApp, 24h/24, en français, arabe et anglais, prennent les rendez-vous directement dans votre agenda et envoient les rappels. Moins de patients perdus pour un appel manqué ou un rendez-vous oublié. Nous gérons aussi le marketing des cliniques qui veulent plus de nouveaux patients.\n\nUne démo de 15 minutes la semaine prochaine vous serait-elle utile ? Vous l'entendrez répondre au nom de votre clinique.\n\n${sig}${foot}` },
    { delay: 4, subject: "", body: `Bonjour,\n\nBeaucoup de cliniques avec qui nous parlons manquent des appels aux heures de pointe et après la fermeture. Je peux vous envoyer un enregistrement de 2 minutes de notre réceptionniste IA qui prend un rendez-vous. Je vous l'envoie ?\n\n${sig}${foot}` },
    { delay: 0, subject: "", body: `Dernier message de ma part : si améliorer vos prises de rendez-vous n'est pas une priorité en ce moment, aucun souci. Sinon, répondez avec un créneau qui vous convient et j'organise une courte démo.\n\n${sig}${foot}` },
  ];
  return [
    { delay: 3, subject: "{{companyName}}: answering every patient call", body: `Hi {{companyName}} team,\n\n{{personalization}}\n\nWe set up AI receptionists for clinics: it answers every call and WhatsApp message, 24/7, in your patients' languages, books appointments straight into your calendar and sends reminders, so fewer patients are lost to missed calls or no-shows. We also run marketing for clinics that want more new patients.\n\nWould a 15-minute demo next week be useful? You can hear it answer a call as your clinic.\n\n${sig}${foot}` },
    { delay: 4, subject: "", body: `Hi again,\n\nMany clinics we speak to miss calls in busy hours and after closing. I can send you a 2-minute recording of our AI receptionist booking an appointment. Shall I?\n\n${sig}${foot}` },
    { delay: 0, subject: "", body: `A last note from me: if improving bookings isn't a priority right now, no problem. If it is, reply with a time that suits you and I'll set up a short demo.\n\n${sig}${foot}` },
  ];
}

/** One opening line per clinic, from what we know about it. Facts only. */
function opener(l: any, lang: string) {
  const c = l.company, a = l.audit || {}, q = l.quality || {}, rating = a.gRating ?? q.g_rating;
  // Only name the city when it's written in the email's own script (no Arabic city names in English emails).
  const city = (l.city && (lang === "ar" ? true : !/[\u0600-\u06FF]/.test(l.city))) ? l.city : "";
  const L = {
    en: { phone: `I noticed patients can only book with ${c} by phone.`, wa: `I couldn't see a WhatsApp booking option on ${c}'s website.`, rev: `${c} has strong Google reviews (${rating}★), so every missed call is a patient who already wanted to come to you.`, dflt: `I'm writing to private clinics${city ? " in " + city : ""} about answering every patient call, day and night.` },
    ar: { phone: `لاحظت أن حجز المواعيد في ${c} يتم عبر الهاتف فقط.`, wa: `لم أجد خيار الحجز عبر واتساب في موقع ${c}.`, rev: `تقييمات ${c} على جوجل ممتازة (${rating}★)، لذلك كل مكالمة فائتة هي مريض كان يريد القدوم إليكم.`, dflt: `أتواصل مع العيادات الخاصة${city ? " في " + city : ""} بخصوص الرد على كل مكالمات المرضى ليلاً ونهاراً.` },
    fr: { phone: `J'ai remarqué que la prise de rendez-vous chez ${c} se fait uniquement par téléphone.`, wa: `Je n'ai pas vu d'option de réservation WhatsApp sur le site de ${c}.`, rev: `${c} a d'excellents avis Google (${rating}★) : chaque appel manqué est un patient qui voulait déjà venir chez vous.`, dflt: `J'écris aux cliniques privées${city ? " de " + city : ""} au sujet de la réponse à chaque appel patient, jour et nuit.` },
  }[lang as "en"];
  if (lang === "en" && l.report?.opener) return String(l.report.opener).slice(0, 300);
  if (a.booking === "phone_only" && a.website) return L.phone;
  if (a.website && a.whatsapp === false) return L.wa;
  if (rating && Number(rating) >= 4.5) return L.rev;
  return L.dflt;
}

// ---------- helpers ----------
const dubaiMidnight = () => new Date(Math.floor((Date.now() + 4 * 3600000) / DAY) * DAY - 4 * 3600000);
const okEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e || "") && !/\.(png|jpe?g|gif|webp|svg)$/i.test(e) && !/(example|sentry|wixpress|domain)\./i.test(e);

async function settings() {
  const { data } = await admin.from("settings").select("id, data").in("id", ["outreach", "calling", "profile"]);
  const by = Object.fromEntries((data || []).map((r: any) => [r.id, r.data || {}]));
  return { O: by.outreach || {}, C: { daily_cap: 299, ...(by.calling || {}) }, P: by.profile || {} };
}
function rampToday(O: any) {
  const start = Date.parse((O.start_date || new Date().toISOString().slice(0, 10)) + "T00:00:00+04:00");
  const week = Math.max(1, Math.floor((Date.now() - start) / (7 * DAY)) + 1);
  const rows = [...(O.ramp || [])].sort((a: any, b: any) => a.week - b.week);
  const row = rows.filter((r: any) => r.week <= week).pop() || rows[0] || { calls: 100, emails: 50 };
  return { week, calls: Number(row.calls), emails: Number(row.emails) };
}

async function allLeads(cols: string) {
  let out: any[] = [];
  for (let from = 0; from < 200000; from += 1000) {
    const { data } = await admin.from("leads").select(cols).order("id").range(from, from + 999);
    if (!data) break; out = out.concat(data); if (data.length < 1000) break;
  }
  return out;
}

async function eligible(O: any) {
  const leads = await allLeads("id, company, city, market, lang, phone, email, website, status, opted_out, dncr, consent, declined, campaign, quality, audit, verify, report, email_status, lon");
  const { data: sup } = await admin.from("email_suppressions").select("email");
  const suppressed = new Set((sup || []).map((s: any) => s.email.toLowerCase()));
  const { data: calls } = await admin.from("calls").select("lead_id, answered, status, created_at").eq("test", false).gte("created_at", new Date(Date.now() - 30 * DAY).toISOString());
  const byLead = new Map<string, any[]>(); for (const c of calls || []) byLead.set(c.lead_id, [...(byLead.get(c.lead_id) || []), c]);
  const excluded = new Set((O.email_excluded_markets || ["DE"]).map(String));
  const out: any[] = [], skipped: Record<string, number> = {};
  const skip = (k: string) => { skipped[k] = (skipped[k] || 0) + 1; };
  for (const l of leads) {
    const email = String(l.email || "").trim().toLowerCase();
    if (l.email_status) { skip("already_emailed"); continue; }
    if (!okEmail(email)) { skip("no_email"); continue; }
    if (["invalid", "no_mail_server", "disposable"].includes(l.verify?.email?.status)) { skip("email_invalid"); continue; }
    if (suppressed.has(email)) { skip("suppressed"); continue; }
    if (l.opted_out || ["dnc", "booked", "cold"].includes(l.status)) { skip("not_contactable"); continue; }
    if (!MARKETS[l.market]) { skip("unknown_market"); continue; }
    if (excluded.has(l.market)) { skip("market_excluded"); continue; }
    const M = MARKETS[l.market], recent = byLead.get(l.id) || [];
    const unanswered = recent.filter((c) => c.answered === false).length;
    let reason = "";
    if (M.excluded) reason = "uae";
    else if (M.consent && !l.consent) reason = "consent_market";
    else if (M.nanp && !l.consent && (l.audit?.lineType !== "landline" || !l.audit?.dncCheckedAt || l.audit?.onDnc)) reason = "us_ca";
    else if (unanswered >= 2) reason = "unreachable";
    else if (callBlocks(l, Date.now(), []).some((f) => /format/.test(f))) reason = "no_phone";
    if (!reason) { skip("call_first"); continue; }
    out.push({ ...l, email, reason });
  }
  const PRI: Record<string, number> = { unreachable: 0, uae: 1, consent_market: 2, us_ca: 3, no_phone: 4 };
  const fit = (l: any) => (l.campaign === "dental" || l.campaign === "aesthetic" ? 0 : 1); // dental + aesthetic first (core ICP)
  out.sort((a, b) => fit(a) - fit(b) || PRI[a.reason] - PRI[b.reason] || (b.audit?.website ? 1 : 0) - (a.audit?.website ? 1 : 0) || (a.quality?.confidence === "high" ? -1 : 0) - (b.quality?.confidence === "high" ? -1 : 0));
  return { list: out, skipped };
}

async function counts(O: any) {
  const since = dubaiMidnight().toISOString();
  const [{ count: emailsToday }, { count: callsToday }] = await Promise.all([
    admin.from("leads").select("id", { count: "exact", head: true }).gte("email_pushed_at", since),
    admin.from("calls").select("id", { count: "exact", head: true }).eq("test", false).gte("created_at", since),
  ]);
  return { emailsToday: emailsToday || 0, callsToday: callsToday || 0 };
}

// ---------- Instantly campaigns ----------
async function ensureCampaign(key: string, O: any, P: any, accounts: string[], ramp: number) {
  const ids = O.campaigns || {};
  if (ids[key]) return { id: ids[key] as string };
  const [regionKey, lang] = [key.slice(0, key.lastIndexOf("_")), key.slice(key.lastIndexOf("_") + 1)];
  const R = zoneOf(regionKey);
  const S = { name: O.sender_name || P.freelancer_name || "Maha", company: O.sender_company || P.business_name || "Mizan AI Agents", address: String(O.sender_address || "") };
  const steps = copy(lang, S).map((s) => ({ type: "email", delay: s.delay, delay_unit: "days", variants: [{ subject: s.subject, body: s.body }] }));
  const days: Record<string, boolean> = {}; for (let d = 0; d < 7; d++) days[String(d)] = R.days.includes(d);
  const body: any = {
    name: `Mizan AI · ${R.name} · ${lang.toUpperCase()}`,
    campaign_schedule: { schedules: [{ name: "Morning rule: 9:30 local", timing: { from: R.from, to: R.to }, days, timezone: R.tz }] },
    sequences: [{ steps }],
    daily_limit: Math.max(30, Math.ceil(ramp * 2)),
    stop_on_reply: true, stop_on_auto_reply: false, link_tracking: false, open_tracking: false, text_only: true,
    insert_unsubscribe_header: true,
  };
  if (accounts.length) body.email_list = accounts;
  let r = await inst("/campaigns", { method: "POST", body: JSON.stringify(body) });
  if (!r.ok && /timezone/i.test(JSON.stringify(r.j))) {
    // Fallback if Instantly doesn't list this zone name: the fixed offset it has right now (Etc/GMT signs are inverted).
    const off = Math.round(offsetMin(R.tz, Date.now()) / 60);
    for (const tz of [off === 0 ? "Etc/GMT" : `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`]) {
      body.campaign_schedule.schedules[0].timezone = tz;
      r = await inst("/campaigns", { method: "POST", body: JSON.stringify(body) });
      if (r.ok) break;
    }
  }
  if (!r.ok || !r.j?.id) return { error: `Instantly campaign ${key}: ${String(r.j?.message || r.j?.error || JSON.stringify(r.j)).slice(0, 200)}` };
  const { data: cur } = await admin.from("settings").select("data").eq("id", "outreach").single();
  const next = { ...(cur?.data || {}), campaigns: { ...((cur?.data || {}).campaigns || {}), [key]: r.j.id } };
  await admin.from("settings").update({ data: next, updated_at: new Date().toISOString() }).eq("id", "outreach");
  O.campaigns = next.campaigns;
  return { id: r.j.id as string, created: true };
}

async function accountsList() {
  const r = await inst("/accounts?limit=100");
  const items = r.j?.items || [];
  return { ok: r.ok, status: r.status, emails: items.map((a: any) => a.email).filter(Boolean), warmup: items.filter((a: any) => a.warmup_status === 1).length, error: r.ok ? null : (r.j?.message || `HTTP ${r.status}`) };
}

async function push(O: any, P: any, limit: number) {
  if (!KEY) return { error: "not_configured", message: "Add INSTANTLY_API_KEY in Supabase → Edge Functions → Secrets." };
  if (!String(O.sender_address || "").trim()) return { error: "sender_address_missing", message: "Add your business postal address in the console (Emails → Settings). Cold-email laws require it in every email." };
  const acc = await accountsList();
  if (!acc.ok) return { error: "instantly_error", message: `Instantly: ${acc.error}` };
  const { list } = await eligible(O);
  const pick = list.slice(0, limit);
  if (!pick.length) return { ok: true, pushed: 0, reason: "No clinics need an email right now." };
  const groups = new Map<string, any[]>();
  for (const l of pick) { const k = `${zoneKey(l)}_${langOf(l)}`; groups.set(k, [...(groups.get(k) || []), l]); }
  const res: any[] = []; let pushed = 0;
  for (const [key, ls] of groups) {
    const c = await ensureCampaign(key, O, P, acc.emails, limit);
    if (!c.id) { res.push({ campaign: key, error: c.error }); continue; }
    for (let i = 0; i < ls.length; i += 500) {
      const chunk = ls.slice(i, i + 500);
      const r = await inst("/leads/add", { method: "POST", body: JSON.stringify({
        campaign_id: c.id, skip_if_in_workspace: true, verify_leads_on_import: false,
        idempotency_key: `mizan-${key}-${Date.now()}-${i}`,
        leads: chunk.map((l) => ({ email: l.email, company_name: l.company, website: l.website || null, phone: /^\+\d/.test(l.phone || "") ? l.phone : null, personalization: opener(l, langOf(l)), custom_variables: { city: l.city || "", country: MARKETS[l.market]?.name || l.market, clinic_type: l.campaign || "clinic" } })),
      }) });
      if (!r.ok) { res.push({ campaign: key, error: String(r.j?.message || r.status).slice(0, 200) }); continue; }
      const created = new Map<number, string>((r.j.created_leads || []).map((x: any) => [x.index, x.id]));
      const now = new Date().toISOString();
      for (let k = 0; k < chunk.length; k++) {
        const l = chunk[k], id = created.get(k);
        await admin.from("leads").update({ email_status: id ? "queued" : "skipped", email_campaign: key, email_reason: l.reason, email_pushed_at: now, instantly_lead_id: id || null }).eq("id", l.id);
        await admin.from("email_events").insert({ lead_id: l.id, email: l.email, type: id ? "pushed" : "skipped", detail: { campaign: key, reason: l.reason } });
        if (id) pushed++;
      }
      res.push({ campaign: key, sent_to_instantly: chunk.length, created: created.size, duplicates: r.j.duplicated_leads || 0, blocklisted: r.j.in_blocklist || 0, invalid: r.j.invalid_email_count || 0 });
    }
    if (acc.emails.length) await inst(`/campaigns/${c.id}/activate`, { method: "POST", body: "{}" });
  }
  return { ok: true, pushed, groups: res, sending_accounts: acc.emails.length, note: acc.emails.length ? null : "No sending inboxes in Instantly yet: campaigns are created but stay paused until you add and warm up inboxes." };
}

// ---------- sync back from Instantly ----------
const INTEREST: Record<string, string> = { "1": "interested", "2": "interested", "3": "interested", "4": "interested", "-1": "not_interested", "-2": "not_interested", "-3": "not_interested" };
async function applyEvent(l: any, type: string, detail: any) {
  const upd: any = { email_last_event_at: new Date().toISOString() };
  const rank = ["queued", "skipped", "sent", "replied", "not_interested", "interested", "bounced", "unsubscribed"];
  if (l.email_status === type) return false;
  if (rank.indexOf(type) > rank.indexOf(l.email_status || "queued") || type === "bounced" || type === "unsubscribed") upd.email_status = type;
  else return false; // never step backwards (e.g. "sent" after "replied")
  if (type === "replied") { upd.email_replies = (l.email_replies || 0) + 1; if (!["booked", "hot"].includes(l.status)) { upd.status = "hot"; upd.next = "Replied to your email: read it in Instantly (Unibox) and answer today"; } }
  if (type === "interested") { upd.status = l.status === "booked" ? "booked" : "hot"; upd.next = "Interested by email: book the demo"; }
  if (type === "not_interested") { if (l.status !== "booked") upd.status = "cold"; }
  if (type === "unsubscribed") { upd.opted_out = true; upd.next = "Unsubscribed from email: do not contact"; }
  await admin.from("leads").update(upd).eq("id", l.id);
  await admin.from("email_events").insert({ lead_id: l.id, email: l.email, type, detail });
  if (type === "bounced" || type === "unsubscribed") await admin.from("email_suppressions").upsert({ email: String(l.email).toLowerCase(), reason: type });
  return true;
}
async function sync(O: any) {
  if (!KEY) return { error: "not_configured" };
  const ids = Object.values(O.campaigns || {}) as string[];
  const { data: ours } = await admin.from("leads").select("id, email, status, email_status, email_replies").not("email_status", "is", null);
  const byEmail = new Map((ours || []).map((l: any) => [String(l.email).toLowerCase(), l]));
  let changed = 0, seen = 0;
  for (const id of ids) {
    let after: string | undefined;
    for (let page = 0; page < 50; page++) {
      const r = await inst("/leads/list", { method: "POST", body: JSON.stringify({ campaign: id, limit: 100, ...(after ? { starting_after: after } : {}) }) });
      if (!r.ok) break;
      for (const x of r.j.items || []) {
        seen++;
        const l = byEmail.get(String(x.email || "").toLowerCase()); if (!l) continue;
        let type = "";
        if (x.status === -2) type = "unsubscribed";
        else if (x.status === -1) type = "bounced";
        else if (x.lt_interest_status != null && INTEREST[String(x.lt_interest_status)]) type = INTEREST[String(x.lt_interest_status)];
        else if ((x.email_reply_count || 0) > 0) type = "replied";
        else if (x.status_summary?.lastStep || x.timestamp_last_contact || x.status === 3) type = "sent";
        if (type && await applyEvent(l, type, { instantly_status: x.status, interest: x.lt_interest_status ?? null, replies: x.email_reply_count || 0 })) { changed++; l.email_status = type; }
      }
      after = r.j.next_starting_after; if (!after) break;
    }
  }
  return { ok: true, campaigns: ids.length, checked: seen, changed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
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
    if (!owner) return json({ error: "not_allowed" }, 403);
  }
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const mode = String(body.mode || "status");
  const { O, C, P } = await settings();
  const ramp = rampToday(O);
  const { emailsToday, callsToday } = await counts(O);
  const emailLeft = Math.max(0, ramp.emails - emailsToday);
  const callCap = Math.min(Number(C.daily_cap) || 299, ramp.calls);

  if (mode === "status" || mode === "plan") {
    const { list, skipped } = await eligible(O);
    const byReason: Record<string, number> = {}, byMarket: Record<string, number> = {};
    for (const l of list) { byReason[l.reason] = (byReason[l.reason] || 0) + 1; byMarket[l.market] = (byMarket[l.market] || 0) + 1; }
    const { data: st } = await admin.from("leads").select("email_status").not("email_status", "is", null);
    const totals: Record<string, number> = {}; for (const r of st || []) totals[r.email_status] = (totals[r.email_status] || 0) + 1;
    const acc = KEY ? await accountsList() : null;
    return json({
      ok: true, week: ramp.week, target_per_day: Number(O.target_per_day || 1000),
      today: { calls: callsToday, call_cap: callCap, emails: emailsToday, email_cap: ramp.emails, email_left: emailLeft },
      eligible: list.length, eligible_by_reason: byReason, eligible_by_market: byMarket, not_eligible: skipped, totals,
      instantly: { key_saved: !!KEY, ok: acc?.ok ?? false, sending_accounts: acc?.emails.length ?? 0, warmed: acc?.warmup ?? 0, error: acc?.error ?? null, campaigns: O.campaigns || {} },
      auto: !!O.email_auto, sender_address_set: !!String(O.sender_address || "").trim(), excluded_markets: O.email_excluded_markets || ["DE"],
      preview: mode === "plan" ? list.slice(0, Math.min(emailLeft, 25)).map((l) => ({ company: l.company, market: l.market, email: l.email, reason: l.reason, campaign: `${zoneKey(l)}_${langOf(l)}`, opener: opener(l, langOf(l)) })) : undefined,
    });
  }
  if (mode === "push") {
    if (fromCron && !O.email_auto) return json({ ok: true, skipped: "automatic emailing is off" });
    const n = Math.min(emailLeft, Number(body.count) || emailLeft);
    if (!n) return json({ ok: true, pushed: 0, reason: `Today's email limit is reached (${ramp.emails} in week ${ramp.week} of the ramp-up).` });
    return json(await push(O, P, n));
  }
  if (mode === "sync") return json(await sync(O));
  if (mode === "setup") {
    if (!KEY) return json({ error: "not_configured", message: "Add INSTANTLY_API_KEY in Supabase secrets." }, 503);
    const acc = await accountsList();
    const keys = (body.campaigns as string[]) || ["Asia-Riyadh~SA_en", "Asia-Riyadh~SA_ar"];
    const out: any = {}; for (const k of keys) out[k] = await ensureCampaign(k, O, P, acc.emails, ramp.emails);
    return json({ ok: true, campaigns: out, sending_accounts: acc.emails.length });
  }
  return json({ error: "unknown_mode" }, 400);
});
