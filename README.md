# clinic-growth-caller

Private console for calling GCC dental and clinic leads with the ElevenLabs AI agent and booking qualified meetings.

- `index.html` is the whole app (static; talks to Supabase project `ajwhjvoigyejcgrqjrto`).
- `netlify.toml` / `vercel.json` set noindex and security headers for either host.
- Backend: Supabase tables + Edge Functions `start-call`, `call-webhook`, `scan-clinic`.
