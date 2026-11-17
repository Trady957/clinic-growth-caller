// Starts an outbound call through ElevenLabs' native Twilio integration.
// Caller ID: your own mobile (+971526855212), added in Twilio as a
// Verified Caller ID and imported into ElevenLabs (outbound only).
const API = "https://api.elevenlabs.io/v1/convai/twilio/outbound-call";

export async function startCall({ apiKey, agentId, phoneNumberId, to, vars }) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: agentId,
      agent_phone_number_id: phoneNumberId,
      to_number: to,
      conversation_initiation_client_data: { dynamic_variables: vars || {} },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${JSON.stringify(body)}`);
  return body; // { success, message, conversation_id, callSid }
}
