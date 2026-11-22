// Finds new private clinics on Google Maps in every target country, a slice per run, within a daily search budget.
// Each search: "<kind> in <city>, <country>" (up to 3 pages x 20 results). A cursor in settings row "maps_cursor"
// walks the full list of (country, city, kind) so every run continues where the last one stopped.
// New clinics go into the list with phone checked for their country; ones without a callable number are kept for email.
// Auth: scheduler x-cron-key, or the owner's sign-in (body.searches to run a custom-sized batch, body.preview to just count).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { normPhone } from "./phone.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GKEY = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";

const COUNTRY: Record<string, { name: string; lang: string; cities: string[]; kinds?: string[] }> = {
  // Email-only (no AI calls) but the biggest list of clinics to email:
  AE: { name: "United Arab Emirates", lang: "en", cities: ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Al Ain", "Ras Al Khaimah", "Fujairah", "Umm Al Quwain"],
        kinds: ["dental clinic", "cosmetic dentist", "aesthetic clinic", "dermatology clinic", "medical clinic", "medical center", "polyclinic", "عيادة أسنان"] },
  SA: { name: "Saudi Arabia", lang: "ar", cities: ["Riyadh", "Jeddah", "Dammam", "Al Khobar", "Makkah", "Madinah", "Taif", "Abha", "Buraidah", "Tabuk", "Al Ahsa", "Jubail"] },
  QA: { name: "Qatar", lang: "en", cities: ["Doha", "Al Rayyan", "Al Wakrah", "Lusail"] },
  KW: { name: "Kuwait", lang: "ar", cities: ["Kuwait City", "Hawalli", "Salmiya", "Farwaniya", "Jahra", "Ahmadi"] },
  BH: { name: "Bahrain", lang: "en", cities: ["Manama", "Muharraq", "Riffa", "Isa Town"] },
  OM: { name: "Oman", lang: "ar", cities: ["Muscat", "Seeb", "Sohar", "Salalah", "Nizwa", "Sur"] },
  EG: { name: "Egypt", lang: "ar", cities: ["Cairo", "New Cairo", "Giza", "Sheikh Zayed", "6th of October City", "Alexandria", "Heliopolis", "Maadi", "Nasr City", "Mansoura", "Tanta", "Hurghada"] },
  JO: { name: "Jordan", lang: "ar", cities: ["Amman", "Abdoun Amman", "Irbid", "Zarqa", "Aqaba"] },
  MA: { name: "Morocco", lang: "fr", cities: ["Casablanca", "Rabat", "Marrakech", "Tangier", "Fes", "Agadir", "Kenitra", "Oujda"] },
  GB: { name: "United Kingdom", lang: "en", cities: ["London", "Manchester", "Birmingham", "Leeds", "Glasgow", "Edinburgh", "Liverpool", "Bristol", "Sheffield", "Leicester", "Nottingham", "Cardiff", "Newcastle upon Tyne", "Reading", "Brighton"] },
  IE: { name: "Ireland", lang: "en", cities: ["Dublin", "Cork", "Galway", "Limerick"] },
  FR: { name: "France", lang: "fr", cities: ["Paris", "Lyon", "Marseille", "Toulouse", "Nice", "Nantes", "Bordeaux", "Lille", "Strasbourg", "Montpellier"] },
  BE: { name: "Belgium", lang: "fr", cities: ["Brussels", "Antwerp", "Liège", "Ghent", "Charleroi"] },
  ES: { name: "Spain", lang: "en", cities: ["Madrid", "Barcelona", "Valencia", "Seville", "Malaga", "Marbella"] },
  IT: { name: "Italy", lang: "en", cities: ["Milan", "Rome", "Turin", "Florence", "Naples", "Bologna"] },
  NL: { name: "Netherlands", lang: "en", cities: ["Amsterdam", "Rotterdam", "The Hague", "Utrecht", "Eindhoven"] },
  DE: { name: "Germany", lang: "en", cities: ["Berlin", "Munich", "Hamburg", "Frankfurt", "Düsseldorf", "Cologne"] },
  US: { name: "United States", lang: "en", cities: ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego", "Dallas", "Austin", "Miami", "Atlanta", "Boston", "Seattle", "Denver", "Las Vegas", "Orlando", "Tampa", "Charlotte", "Nashville", "Scottsdale", "Beverly Hills", "Newport Beach", "Plano"] },
  CA: { name: "Canada", lang: "en", cities: ["Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa", "Edmonton", "Mississauga", "Winnipeg"] },
};
const KINDS: Record<string, string[]> = {
  en: ["dental clinic", "cosmetic dentist", "aesthetic clinic", "dermatology clinic"],
  ar: ["dental clinic", "عيادة أسنان", "aesthetic clinic", "عيادة جلدية وتجميل"],
  fr: ["cabinet dentaire", "centre dentaire", "clinique esthétique", "dermatologue esthétique"],
};
const EXCLUDE = /hospital|مستشفى|hôpital|pharmac|صيدلي|veterin|بيطري|\bvet\b|laborator|\blab\b|مختبر|x-?ray|radiology|primary health|ministry|وزارة|military|school|university|optic|spa\b|salon|صالون|gym|nhs trust/i;
const DENTAL = /dental|dentist|dent\b|orthodon|smile|implant|أسنان|اسنان|dentaire|dentiste/i;
const AESTH = /aesthetic|cosmetic|derma|skin|laser|beauty|plastic|botox|تجميل|جلدية|ليزر|esthétique|dermato/i;

function plan(onlyMk?: string) {
  const out: { mk: string; city: string; kind: string }[] = [];
  // Interleave countries so each run touches many markets (calls-first markets lead the order).
  const order = ["SA", "EG", "JO", "MA", "KW", "QA", "OM", "BH", "AE", "GB", "IE", "FR", "BE", "US", "CA", "ES", "IT", "NL"]; // Germany left out: cold calls and cold emails both need prior consent there
  const perMk = order.filter((mk) => !onlyMk || mk === onlyMk).map((mk) => COUNTRY[mk].cities.flatMap((city) => (COUNTRY[mk].kinds || KINDS[COUNTRY[mk].lang]).map((kind) => ({ mk, city, kind }))));
  const max = Math.max(...perMk.map((x) => x.length));
  for (let i = 0; i < max; i++) for (const list of perMk) if (list[i]) out.push(list[i]);
  return out;
}

async function search(q: string, mk: string, pageToken?: string) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GKEY, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.nationalPhoneNumber,places.websiteUri,places.businessStatus,places.rating,places.userRatingCount,places.types,places.location,places.addressComponents,places.googleMapsUri,nextPageToken" },
    body: JSON.stringify({ textQuery: q, pageSize: 20, regionCode: mk, ...(pageToken ? { pageToken } : {}) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google Maps ${r.status} ${j?.error?.status || ""} ${String(j?.error?.message || "").slice(0, 120)}`);
  return j as { places?: any[]; nextPageToken?: string };
}

async function knownKeys() {
  const phones = new Set<string>(), places = new Set<string>();
  for (let from = 0; from < 300000; from += 1000) {
    const { data } = await admin.from("leads").select("phone, osm_id").order("id").range(from, from + 999);
    if (!data) break;
    for (const l of data) { if (l.phone) phones.add(l.phone); if (l.osm_id) places.add(l.osm_id); }
    if (data.length < 1000) break;
  }
  return { phones, places };
}

async function harvest(budget: number, target = 0, onlyMk?: string) {
  const P = plan(onlyMk), CUR = onlyMk ? `maps_cursor_${onlyMk}` : "maps_cursor";
  const { data: cur } = await admin.from("settings").select("data").eq("id", CUR).maybeSingle();
  let pos = Number(cur?.data?.pos || 0) % P.length, used = 0;
  const known = await knownKeys();
  const stats: Record<string, { searches: number; found: number; added: number }> = {};
  const errors: string[] = [];
  const now = new Date().toISOString();
  let addedTotal = 0;
  while (used < budget && (!target || addedTotal < target)) {
    const job = P[pos]; pos = (pos + 1) % P.length;
    const C = COUNTRY[job.mk], s = (stats[job.mk] ||= { searches: 0, found: 0, added: 0 });
    let token: string | undefined, rows: any[] = [];
    for (let page = 0; page < 3 && used < budget; page++) {
      let res;
      try { res = await search(`${job.kind} in ${job.city}, ${C.name}`, job.mk, token); } catch (e) { errors.push(String(e).slice(0, 160)); if (/40[03]/.test(String(e))) return { stopped: String(e), used, stats, errors, pos }; break; }
      used++; s.searches++;
      for (const p of res.places || []) {
        s.found++;
        const name = String(p.displayName?.text || "").trim();
        if (!name || EXCLUDE.test(name) || (p.types || []).some((t: string) => /hospital|pharmacy|drugstore|veterinary/.test(t))) continue;
        if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;
        if (known.places.has("g:" + p.id)) continue;
        const ph = normPhone(p.internationalPhoneNumber || p.nationalPhoneNumber || "", job.mk);
        const phone = ph.phone || `nophone:g:${p.id}`;
        if (known.phones.has(phone)) continue;
        known.phones.add(phone); known.places.add("g:" + p.id);
        const t = `${name} ${(p.types || []).join(" ")} ${job.kind}`;
        const campaign = DENTAL.test(t) ? "dental" : AESTH.test(t) ? "aesthetic" : "medical";
        const city = (p.addressComponents || []).find((c: any) => (c.types || []).includes("locality"))?.longText || job.city;
        const issues: string[] = [];
        if (!ph.phone) issues.push("No callable phone number: email only");
        if (ph.type === "hotline") issues.push("Hotline or call-centre number");
        if (!p.websiteUri) issues.push("No website listed");
        rows.push({
          company: name.slice(0, 160), phone, market: job.mk, lang: C.lang, campaign,
          industry: campaign === "dental" ? "Dental clinic" : campaign === "aesthetic" ? "Aesthetic clinic" : "Medical centre",
          city: String(city).slice(0, 80), website: p.websiteUri || null, osm_id: "g:" + p.id,
          lat: p.location?.latitude ?? null, lon: p.location?.longitude ?? null, source: "Google Maps", list: "queue", status: "new", verified: !!ph.phone,
          context: [p.formattedAddress, p.rating != null ? `Google: ${p.rating}★ from ${p.userRatingCount || 0} reviews.` : "", p.googleMapsUri ? `Map: ${p.googleMapsUri}` : ""].filter(Boolean).join(" ").slice(0, 600),
          quality: { phone_valid: !!ph.phone, phone_type: ph.type || null, has_website: !!p.websiteUri, open_on_google: true, g_rating: p.rating ?? null, g_reviews: p.userRatingCount ?? null, issues, confidence: issues.length <= 1 ? "high" : issues.length === 2 ? "medium" : "low", checked_at: now, source: "Google Maps" },
          last_seen_at: now,
        });
      }
      token = res.nextPageToken; if (!token) break;
    }
    for (let i = 0; i < rows.length; i += 200) {
      const { data, error } = await admin.from("leads").upsert(rows.slice(i, i + 200), { onConflict: "phone", ignoreDuplicates: true }).select("id");
      if (error) errors.push(`${job.mk} insert: ${error.message.slice(0, 120)}`); else { s.added += data?.length || 0; addedTotal += data?.length || 0; }
    }
    // Save progress after every search so a run cut off by the time limit resumes in the right place.
    await admin.from("settings").upsert({ id: CUR, data: { pos, total: P.length, last_run: now }, updated_at: new Date().toISOString() });
    if (pos === 0) break; // went round the whole plan: stop for today
  }
  await admin.from("settings").upsert({ id: CUR, data: { pos, total: P.length, last_run: now }, updated_at: now });
  return { used, stats, errors: errors.slice(0, 5), pos, total: P.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const cronKey = req.headers.get("x-cron-key");
  let ok = false;
  if (cronKey) { const { data } = await admin.from("settings").select("data").eq("id", "cron").maybeSingle(); ok = !!data?.data?.key && data.data.key === cronKey; }
  else {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(jwt); const email = u?.user?.email?.toLowerCase();
    if (email) { const { data: o } = await admin.from("app_owners").select("email").ilike("email", email).maybeSingle(); ok = !!o; }
  }
  if (!ok) return json({ error: "not_allowed" }, 403);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  if (body.preview || !GKEY) {
    const P = plan(); const { data: cur } = await admin.from("settings").select("data").eq("id", "maps_cursor").maybeSingle();
    return json({ ok: !!GKEY, key_saved: !!GKEY, searches_in_full_round: P.length, position: cur?.data?.pos || 0, last_run: cur?.data?.last_run || null, countries: Object.keys(COUNTRY).length, message: GKEY ? null : "Add GOOGLE_PLACES_API_KEY in Supabase → Edge Functions → Secrets." });
  }
  const { data: o } = await admin.from("settings").select("data").eq("id", "outreach").maybeSingle();
  const budget = Math.max(1, Math.min(Number(body.searches) || Number(o?.data?.maps_searches_per_day) || 150, 400));
  // Daily target of NEW clinics (default 200): count what today's earlier runs already added and only fill the gap.
  const dayTarget = Math.max(0, Number(body.target_new ?? o?.data?.maps_new_per_day ?? 200));
  let target = 0;
  if (dayTarget && !body.searches) {
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const { count } = await admin.from("leads").select("id", { count: "exact", head: true }).eq("source", "Google Maps").gte("created_at", since.toISOString());
    target = dayTarget - (count || 0);
    if (target <= 0) return json({ ok: true, skipped: `today's target of ${dayTarget} new clinics is already reached (${count})` });
  }
  // Runs in the background so a big batch isn't cut off.
  const onlyMk = typeof body.market === "string" && COUNTRY[body.market.toUpperCase()] ? body.market.toUpperCase() : undefined;
  const { data: run } = await admin.from("sync_runs").insert({ kind: onlyMk ? `maps:${onlyMk}` : "maps" }).select("id").single();
  const job = harvest(budget, target, onlyMk).then(async (r) => {
    const found = Object.values(r.stats).reduce((a: number, x: any) => a + x.found, 0), added = Object.values(r.stats).reduce((a: number, x: any) => a + x.added, 0);
    await admin.from("sync_runs").update({ status: "done", finished_at: new Date().toISOString(), found, added, by_market: r.stats, note: [r.stopped, ...(r.errors || [])].filter(Boolean).join(" | ").slice(0, 500) || null }).eq("id", run?.id);
  }).catch(async (e) => { await admin.from("sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), note: String(e).slice(0, 300) }).eq("id", run?.id); });
  // @ts-ignore provided by Supabase
  EdgeRuntime.waitUntil(job);
  return json({ ok: true, run_id: run?.id, searches: budget });
});
