// API for the console: Google Maps lookups and test calls to the owner's own phone.
// Every route requires a logged-in Supabase session from the console.
import { mapsLookup, sampleLookup } from './maps.mjs'

const SB_URL = 'https://ajwhjvoigyejcgrqjrto.supabase.co'
// Public anon key (already shipped in index.html); only used to validate the user's session token.
const SB_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqd2hqdm9pZ3llamNncnFqcnRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5MzYxNjEsImV4cCI6MjEwOTUxMjE2MX0.9Ub-kakWDI_y0uJ7EMpS9ZrXzSVz364xw-r-JZt3AiM'
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID || 'agent_3401m6p7pqnjepwv9rgy15kfq48c'

export const config = { path: '/api/*' }

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

async function requireUser(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token || token === SB_ANON) return null
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_ANON, authorization: `Bearer ${token}` } })
  if (!r.ok) return null
  const u = await r.json()
  return u && u.id ? u : null
}

const e164 = (s) => {
  const v = String(s || '').replace(/[^\d+]/g, '')
  return /^\+\d{8,15}$/.test(v) ? v : null
}

async function testCall(body) {
  const key = process.env.ELEVENLABS_API_KEY
  const phoneId = process.env.ELEVENLABS_PHONE_NUMBER_ID
  const to = e164(process.env.TEST_CALL_NUMBER)
  if (!key || !phoneId || !to) {
    // Sample mode until ELEVENLABS_API_KEY, ELEVENLABS_PHONE_NUMBER_ID and TEST_CALL_NUMBER are set: no call is placed.
    const missing = [!key && 'ELEVENLABS_API_KEY', !phoneId && 'ELEVENLABS_PHONE_NUMBER_ID', !to && 'TEST_CALL_NUMBER'].filter(Boolean)
    return json({ ok: true, simulated: true, missing, message: 'Sample mode: no phone call was placed.' })
  }
  const c = body.clinic || {}
  const vars = {
    clinic_name: String(c.company || ''), company: String(c.company || ''), contact_name: String(c.name || ''),
    city: String(c.city || ''), market: String(c.market || ''), lang: String(c.lang || 'en'),
    positioning: String(body.positioning || '').slice(0, 4000), test_call: 'true',
  }
  // Twilio numbers use the Twilio endpoint; Telnyx, Plivo, Vonage etc. are imported as SIP trunks and use the SIP endpoint.
  const info = await fetch(`https://api.elevenlabs.io/v1/convai/phone-numbers/${encodeURIComponent(phoneId)}`, { headers: { 'xi-api-key': key } })
    .then((x) => (x.ok ? x.json() : {})).catch(() => ({}))
  const route = info.provider === 'sip_trunk' ? 'sip-trunk' : 'twilio'
  const r = await fetch(`https://api.elevenlabs.io/v1/convai/${route}/outbound-call`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    // The destination is always the owner's own number; a clinic number is never accepted here.
    body: JSON.stringify({ agent_id: AGENT_ID, agent_phone_number_id: phoneId, to_number: to, conversation_initiation_client_data: { dynamic_variables: vars } }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || d.success === false) return json({ error: 'call_failed', message: d.message || d.detail?.message || (typeof d.detail === 'string' ? d.detail : `ElevenLabs returned ${r.status}`) }, 502)
  return json({ ok: true, conversation_id: d.conversation_id || null, call_sid: d.callSid || d.call_sid || null, to_last4: to.slice(-4) })
}

export default async (req) => {
  const path = new URL(req.url).pathname
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const user = await requireUser(req)
  if (!user) return json({ error: 'unauthorized', message: 'Log in to the console first.' }, 401)
  const body = await req.json().catch(() => ({}))
  try {
    if (path === '/api/test-call') return await testCall(body)
    if (path === '/api/maps-lookup') {
      const key = process.env.GOOGLE_MAPS_API_KEY
      const items = (Array.isArray(body.items) ? body.items : [body]).slice(0, 10)
      // Sample mode until GOOGLE_MAPS_API_KEY is set: placeholder results flagged sample:true, never saved by the console.
      if (!key) return json({ sample: true, missing: ['GOOGLE_MAPS_API_KEY'], results: items.map(sampleLookup) })
      return json({ results: await Promise.all(items.map((it) => mapsLookup(key, it))) })
    }
  } catch (e) {
    return json({ error: 'server_error', message: String(e.message || e) }, 500)
  }
  return json({ error: 'not_found' }, 404)
}
