// Finds US/Canada clinics that (1) rate below a threshold on Google and (2) show a WhatsApp chat link on their own website.
// The WhatsApp number is taken from that link (wa.me / api.whatsapp.com), so it is the number they really use on WhatsApp.
// Body: { queries: [{ q: "dentista in Miami, FL", mk: "US" }], maxRating?: 3.9 }. Auth: x-cron-key.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GKEY = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const EXCLUDE = /hospital|pharmac|veterin|\bvet\b|laborator|\blab\b|radiology|school|university|college of|optic|salon|gym|supply|academy/i;
const DENTAL = /dental|dentist|dentista|dentaire|orthodon|smile|implant|odont/i;
const WA = /(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=|web\.whatsapp\.com\/send\/?\?phone=|whatsapp:\/\/send\/?\?phone=|wa\.link\/)(\+?[\d\-\s()%2B]{8,22})/i;
const BOOK = /book (an |your )?appointment online|book online|online booking|request an appointment|schedule online|zocdoc|nexhealth|localmed|flexbook|yapi|lighthouse|weave|jane\.app|janeapp|calendly|setmore|square ?appointments|vagaro|boulevard|mindbody/i;

function e164(raw: string): string | null {
  const d = decodeURIComponent(raw).replace(/[^\d]/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  if (d.length >= 9 && d.length <= 15) return "+" + d; // foreign WhatsApp number (e.g. a Latin American line)
  return null;
}

async function search(q: string, mk: string, pageToken?: string) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GKEY, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.websiteUri,places.businessStatus,places.rating,places.userRatingCount,places.types,places.location,places.addressComponents,places.googleMapsUri,nextPageToken" },
    body: JSON.stringify({ textQuery: q, pageSize: 20, regionCode: mk, ...(pageToken ? { pageToken } : {}) }),
  });
  if (!r.ok) throw new Error(`places ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return await r.json();
}

async function scanSite(url: string) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 7000);
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36" } });
    clearTimeout(t);
    const html = (await r.text()).slice(0, 600000);
    const m = html.match(WA);
    return { ok: r.ok, wa: m ? e164(m[1]) : null, waMention: /whatsapp/i.test(html), booking: BOOK.test(html), ssl: url.startsWith("https") || r.url.startsWith("https") };
  } catch (_) { return { ok: false, wa: null, waMention: false, booking: false, ssl: false }; }
}

Deno.serve(async (req) => {
  const key = req.headers.get("x-cron-key");
  const { data: c } = await admin.from("settings").select("data").eq("id", "cron").maybeSingle();
  if (!key || key !== c?.data?.key) return json({ error: "not_allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  const queries: { q: string; mk: string }[] = (body.queries || []).slice(0, 6);
  const maxRating = Number(body.maxRating) || 3.9;
  const { data: known } = await admin.from("leads").select("phone,osm_id").in("market", ["US", "CA"]);
  const phones = new Set((known || []).map((k: any) => k.phone)), places = new Set((known || []).map((k: any) => k.osm_id));
  const now = new Date().toISOString(), out: any[] = [], stats = { searched: 0, low: 0, withWa: 0, added: 0, errors: [] as string[] };
  for (const { q, mk } of queries) {
    let token: string | undefined;
    for (let page = 0; page < 3; page++) {
      let res; try { res = await search(q, mk, token); } catch (e) { stats.errors.push(String(e).slice(0, 140)); break; }
      stats.searched++;
      const cands = (res.places || []).filter((p: any) => {
        const name = String(p.displayName?.text || "");
        return name && !EXCLUDE.test(name) && p.rating != null && p.rating < maxRating && p.websiteUri && (!p.businessStatus || p.businessStatus === "OPERATIONAL") && !places.has("g:" + p.id);
      });
      stats.low += cands.length;
      const scans = await Promise.all(cands.map((p: any) => scanSite(p.websiteUri)));
      cands.forEach((p: any, i: number) => {
        const s = scans[i]; places.add("g:" + p.id);
        const office = e164(p.internationalPhoneNumber || "") || null;
        const phone = s.wa || office; if (!phone || phones.has(phone)) return;
        phones.add(phone); if (s.wa) stats.withWa++;
        const name = String(p.displayName.text).trim(), campaign = DENTAL.test(name + " " + q) ? "dental" : "aesthetic";
        const city = (p.addressComponents || []).find((x: any) => (x.types || []).includes("locality"))?.longText || "";
        const issues: string[] = [`Low Google rating: ${p.rating}★ (${p.userRatingCount || 0} reviews)`];
        if (!s.booking) issues.push("No online booking found on the website");
        if (!s.ok) issues.push("Website did not load"); else if (!s.ssl) issues.push("Website not secure (no https)");
        out.push({
          company: name.slice(0, 160), phone, market: mk, lang: "en", campaign,
          industry: campaign === "dental" ? "Dental clinic" : "Aesthetic clinic", city: city.slice(0, 80), website: p.websiteUri, osm_id: "g:" + p.id,
          lat: p.location?.latitude ?? null, lon: p.location?.longitude ?? null, source: "Google Maps + website WhatsApp scan", list: "queue", status: "new", verified: true,
          context: [p.formattedAddress, `Google: ${p.rating}★ from ${p.userRatingCount || 0} reviews.`, office && office !== phone ? `Office line: ${office}.` : "", s.wa ? "WhatsApp number taken from the WhatsApp button on their website." : "", p.googleMapsUri ? `Map: ${p.googleMapsUri}` : ""].filter(Boolean).join(" ").slice(0, 600),
          quality: { phone_valid: true, phone_type: s.wa ? "whatsapp" : "landline_or_mobile", office_phone: office, wa_number: s.wa, wa_source: s.wa ? "website_link" : null, wa_mention: s.waMention, has_website: true, website_ok: s.ok, online_booking: s.booking, g_rating: p.rating, g_reviews: p.userRatingCount ?? 0, open_on_google: true, issues, confidence: "high", checked_at: now, source: "wa-hunt", hunt_query: q },
          last_seen_at: now,
        });
      });
      token = res.nextPageToken; if (!token) break;
    }
  }
  if (out.length) {
    const { data, error } = await admin.from("leads").upsert(out, { onConflict: "phone", ignoreDuplicates: true }).select("id");
    if (error) stats.errors.push("insert: " + error.message.slice(0, 160)); else stats.added = data?.length || 0;
  }
  await admin.from("sync_runs").insert({ kind: "wa-hunt", status: "done", finished_at: new Date().toISOString(), found: stats.low, added: stats.added, scanned: stats.withWa, note: `${queries.map((x) => x.q).join(" | ").slice(0, 300)}${stats.errors.length ? " · errors: " + stats.errors.join("; ").slice(0, 200) : ""}` });
  return json(stats);
});
