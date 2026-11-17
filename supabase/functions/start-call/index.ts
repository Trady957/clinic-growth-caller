// Starts one real outbound call through ElevenLabs (Twilio or SIP-trunk number), after checking the calling rules server-side.
// UAE is excluded; UK/EU need consent; US/Canada need a confirmed business landline and a fresh Do Not Call check.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callBlocks, callVars, DAY } from "./markets.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Owner sign-in, or test mode (settings row "test_mode" = {enabled:true}) while testing without sign-in.
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(jwt);
  const email = u?.user?.email?.toLowerCase();
  const { data: owner } = email ? await admin.from("app_owners").select("email").ilike("email", email).maybeSingle() : { data: null };
  if (!owner) {
    const { data: tm } = await admin.from("settings").select("data").eq("id", "test_mode").maybeSingle();
    if (tm?.data?.enabled !== true) return json({ error: email ? "not_allowed" : "not_signed_in" }, email ? 403 : 401);
  }

  const apiKey = Deno.env.get("ELEVENLABS_API_KEY"), phoneId = Deno.env.get("ELEVENLABS_PHONE_NUMBER_ID");
  const agentId = Deno.env.get("ELEVENLABS_AGENT_ID") || "agent_3401m6p7pqnjepwv9rgy15kfq48c";
  if (!apiKey || !phoneId) return json({ error: "not_configured", message: "Add ELEVENLABS_API_KEY and ELEVENLABS_PHONE_NUMBER_ID in Supabase → Edge Functions → Secrets." }, 503);

  let body: { lead_id?: string; positioning?: string; test_to_number?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (!body.lead_id) return json({ error: "bad_request", message: "lead_id is required" }, 400);

  const { data: lead } = await admin.from("leads").select("*").eq("id", body.lead_id).maybeSingle();
  if (!lead) return json({ error: "not_found" }, 404);
  const { data: prof } = await admin.from("settings").select("data").eq("id", "profile").maybeSingle();
  const P = (prof?.data ?? {}) as Record<string, string>;

  // A test call only ever goes to your own number (settings.profile.test_phone), never to a clinic.
  const isTest = !!body.test_to_number;
  const own = String(P.test_phone || "").replace(/[^\d+]/g, "");
  const toNumber = isTest ? String(body.test_to_number).replace(/[^\d+]/g, "") : lead.phone;
  if (!/^\+\d{8,15}$/.test(toNumber)) return json({ error: "bad_number" }, 400);
  if (isTest && own && toNumber !== own) return json({ error: "test_number_mismatch", message: "Test calls go only to the test phone in your profile." }, 400);

  const now = Date.now();
  if (!isTest) {
    const { data: recent } = await admin.from("calls").select("created_at, answered, status").eq("lead_id", lead.id).eq("test", false).gte("created_at", new Date(now - 7 * DAY).toISOString());
    const fails = callBlocks(lead, now, recent || []);
    if (fails.length) return json({ error: "blocked_by_rules", reasons: fails }, 409);
  }

  const vars = callVars(lead, P, now, String(body.positioning || "Not scanned yet: ask how patients book today and what happens to after-hours calls."));
  const { data: callRow, error: insErr } = await admin.from("calls").insert({ lead_id: lead.id, status: "initiated", test: isTest, to_number: toNumber }).select("id").single();
  if (insErr) return json({ error: "db_error", message: insErr.message }, 500);

  // Twilio numbers and SIP-trunk numbers use different call endpoints.
  let provider = (Deno.env.get("ELEVENLABS_PHONE_PROVIDER") || "").toLowerCase();
  if (!provider) {
    const pr = await fetch(`https://api.elevenlabs.io/v1/convai/phone-numbers/${phoneId}`, { headers: { "xi-api-key": apiKey } });
    const pj = await pr.json().catch(() => ({}));
    provider = String(pj?.provider || "twilio").toLowerCase();
  }
  const endpoint = provider.includes("sip") ? "sip-trunk" : "twilio";
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/${endpoint}/outbound-call`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: agentId,
      agent_phone_number_id: phoneId,
      to_number: toNumber,
      conversation_initiation_client_data: { dynamic_variables: { ...vars, call_row_id: callRow.id, lead_id: lead.id } },
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.success === false) {
    await admin.from("calls").update({ status: "failed", detail: String(out?.message || out?.detail?.[0]?.msg || res.status).slice(0, 300) }).eq("id", callRow.id);
    return json({ error: "elevenlabs_error", message: out?.message || out?.detail || `HTTP ${res.status}` }, 502);
  }
  await admin.from("calls").update({ status: "in_progress", conversation_id: out.conversation_id ?? null, call_sid: out.callSid ?? out.sip_call_id ?? null }).eq("id", callRow.id);
  return json({ ok: true, call_id: callRow.id, conversation_id: out.conversation_id ?? null });
});
