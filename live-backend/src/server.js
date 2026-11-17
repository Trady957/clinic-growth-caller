// Mizan AI Growth Caller backend. Plain Node 20+, no framework.
//
//   GET  /leads                         pipeline (JSON) · /leads.csv for a sheet
//   POST /leads/import                  CSV body: clinic,name,role,email,phone,country,tz,consent,registry_checked,source
//   POST /leads/:id/consent             mark that the lead replied or asked for a call
//   POST /calls/start  {leadId}         rule check, then ElevenLabs dials from your number
//   POST /calls/run-queue               dial every lead that passes the rules right now
//   POST /tools/free_slots              ElevenLabs webhook tool: free demo slots on your calendar
//   POST /tools/book_meeting            ElevenLabs webhook tool: books it and sends the invite
//   POST /tools/log_outcome             ElevenLabs webhook tool: stage + note (incl. opt-out)
//   POST /webhooks/post-call            ElevenLabs post-call webhook: logs the attempt
//
// Every /tools and /calls route needs header  x-api-key: $SERVER_KEY
import http from "node:http";
import { Crm } from "./crm.js";
import { checkCall } from "./gate.js";
import { market } from "./markets.js";
import { startCall } from "./elevenlabs.js";
import { Calendar } from "./calendar.js";

const env = process.env;
const crm = new Crm(env.CRM_FILE || "./data/crm.json");
const cal = env.GOOGLE_REFRESH_TOKEN ? new Calendar({
  clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, refreshToken: env.GOOGLE_REFRESH_TOKEN,
  calendarId: env.CALENDAR_ID || "maha.lasfar.2015@gmail.com",
}) : null;
const OWNER = { name: env.OWNER_NAME || "Maha", phone: env.OWNER_PHONE || "+971526855212", company: env.COMPANY || "Mizan AI" };

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}
async function readBody(req) { let s = ""; for await (const c of req) s += c; return s; }
const authed = (req) => !env.SERVER_KEY || req.headers["x-api-key"] === env.SERVER_KEY;

async function dial(lead) {
  const g = checkCall(lead);
  if (!g.ok) return { ok: false, lead: lead.id, reasons: g.reasons };
  const m = market(lead.country);
  const r = await startCall({
    apiKey: env.ELEVENLABS_API_KEY, agentId: env.ELEVENLABS_AGENT_ID, phoneNumberId: env.ELEVENLABS_PHONE_NUMBER_ID, to: lead.phone,
    vars: { lead_id: lead.id, contact_name: lead.name || "", clinic_name: lead.clinic || "", country: m.name, language: m.langs[0],
      owner_name: OWNER.name, owner_phone: OWNER.phone, company: OWNER.company, reason: lead.reason || "you asked us to call about the AI front desk" },
  });
  crm.setStage(lead.id, "called", `Call started ${r.conversation_id || ""}`.trim());
  return { ok: true, lead: lead.id, conversation: r.conversation_id };
}

const routes = {
  "GET /leads": async () => [200, crm.list()],
  "GET /leads.csv": async () => [200, crm.exportCsv(), "text/csv"],
  "POST /leads/import": async (req) => [200, { imported: crm.importCsv(await readBody(req)) }],
  "POST /calls/start": async (req) => { const { leadId } = JSON.parse(await readBody(req)); const l = crm.get(leadId); return l ? [200, await dial(l)] : [404, { error: "no lead" }]; },
  "POST /calls/run-queue": async () => {
    const out = [];
    for (const l of crm.list().filter((x) => ["replied", "call_booked"].includes(x.stage))) out.push(await dial(l));
    return [200, out];
  },
  "POST /tools/free_slots": async () => {
    if (!cal) return [503, { error: "Calendar not configured" }];
    const slots = await cal.freeSlots();
    return [200, { slots, note: "Times are ISO UTC. Offer two, in the lead's local time." }];
  },
  "POST /tools/book_meeting": async (req) => {
    if (!cal) return [503, { error: "Calendar not configured" }];
    const b = JSON.parse(await readBody(req));
    const lead = crm.get(b.lead_id) || {};
    const ev = await cal.book({ start: b.start, clinic: b.clinic_name || lead.clinic, attendeeName: b.attendee_name || lead.name, attendeeEmail: b.attendee_email || lead.email, attendeeTz: b.attendee_tz || lead.tz, phone: lead.phone, notes: b.notes });
    if (lead.id) { lead.meetingAt = b.start; crm.setStage(lead.id, "meeting_booked", `Demo booked ${b.start}`); }
    return [200, { booked: true, start: b.start, link: ev.hangoutLink || ev.htmlLink }];
  },
  "POST /tools/log_outcome": async (req) => {
    const b = JSON.parse(await readBody(req));
    const stage = { opt_out: "do_not_contact", not_interested: "lost", callback: "call_booked", interested: "replied", meeting: "meeting_booked" }[b.outcome] || "called";
    if (b.outcome === "not_interested") { const l = crm.get(b.lead_id); if (l) l.declined = true; }
    crm.setStage(b.lead_id, stage, b.summary || b.outcome);
    return [200, { ok: true, stage }];
  },
  "POST /webhooks/post-call": async (req) => {
    const b = JSON.parse(await readBody(req));
    const vars = b.data?.conversation_initiation_client_data?.dynamic_variables || {};
    const id = vars.lead_id; const answered = (b.data?.metadata?.call_duration_secs || 0) > 10;
    if (id && crm.get(id)) crm.logAttempt(id, answered, b.data?.analysis?.transcript_summary);
    return [200, { ok: true }];
  },
};

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    let key = `${req.method} ${url.pathname}`, m;
    if ((m = url.pathname.match(/^\/leads\/([^/]+)\/consent$/)) && req.method === "POST") {
      const l = crm.get(m[1]); if (!l) return send(res, 404, { error: "no lead" });
      const b = JSON.parse((await readBody(req)) || "{}");
      l.consent = true; if (b.registryChecked) l.registryChecked = true;
      return send(res, 200, crm.setStage(l.id, "replied", b.note || "Replied / asked for a call"));
    }
    const h = routes[key];
    if (!h) return send(res, 404, { error: "not found" });
    if ((key.startsWith("POST /tools") || key.startsWith("POST /calls") || key.startsWith("POST /leads")) && !authed(req)) return send(res, 401, { error: "bad key" });
    const [code, body, type] = await h(req);
    send(res, code, body, type);
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(env.PORT || 8787);
  server.listen(port, () => console.log(`Growth Caller backend on :${port}`));
}
