# Supabase edge functions (project ajwhjvoigyejcgrqjrto)

- `start-call`, `batch-call`: place calls after the server-side rules in `_shared/markets.ts`
  (copy `_shared/markets.ts` into each function as `markets.ts` when deploying).
- `call-webhook`: saves call results and books confirmed meetings into Google Calendar through the
  Apps Script bridge (`docs/MizanCalendarBridge.gs`; URL + key live in `settings` row `gcal`, hidden from the browser).
  Runs from the ElevenLabs post-call webhook and from the `sync-call-results` scheduler every 5 minutes,
  so results arrive even without the webhook.
