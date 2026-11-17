// Data & calling operations for the console:
//  status      which connections are set up (ElevenLabs, phone number, Google Maps, Instantly, ChatGPT) + today's calls
//  duplicates  find accounts that are the same clinic (same name+city, website, email or phone)
//  merge       keep one account, move its calls/meetings, fill blanks, delete the rest
//  verify      check phone type (mobile/landline/hotline), email (format + mail server) and Google Maps match
//  search      find clinics that aren't in the list yet (Google Maps if a key is set, otherwise OpenStreetMap)
//  save        add chosen search results to the list (call queue or "future records")
// Every target country is supported (phone checks in phone.ts).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { normPhone } from "./phone.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
type Mk = string;
const COUNTRY: Record<string, string> = {
  AE: "United Arab Emirates", SA: "Saudi Arabia", QA: "Qatar", KW: "Kuwait", BH: "Bahrain", OM: "Oman", EG: "Egypt", JO: "Jordan", MA: "Morocco",
  GB: "United Kingdom", IE: "Ireland", FR: "France", BE: "Belgium", DE: "Germany", ES: "Spain", IT: "Italy", NL: "Netherlands", US: "United States", CA: "Canada",
};
const langFor = (mk: string) => ["SA", "KW", "OM", "EG", "JO"].includes(mk) ? "ar" : ["MA", "FR", "BE"].includes(mk) ? "fr" : "en";
const NAME_NOISE = /\b(clinic|clinics|center|centre|medical|dental|dentist|polyclinic|poly|specialist|specialized|llc|l\.l\.c|fz|fze|co|the|and|&|branch|dr|drs|ltd|limited|inc|pllc|sarl|cabinet|clinique)\b|مركز|عيادة|عيادات|طبي|للأسنان|لطب|الأسنان|الاسنان/gi;
const normName = (s: string) => String(s || "").toLowerCase().replace(NAME_NOISE, " ").replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();
const domainOf = (u: string) => { try { return new URL(/^https?:/i.test(u) ? u : "https://" + u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const DISPOSABLE = /mailinator|tempmail|10minutemail|guerrillamail|yopmail|trashmail|sharklasers/i;
const realPhone = (p: string) => !/^(nophone|pending):/.test(String(p || ""));

async function allLeads(admin: any, cols: string) {
  let out: any[] = [];
  for (let from = 0; from < 300000; from += 1000) {
    const { data, error } = await admin.from("leads").select(cols).order("id").range(from, from + 999);
    if (error || !data) break; out = out.concat(data); if (data.length < 1000) break;
  }
  return out;
}

async function mx(domain: string): Promise<boolean | null> {
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, { headers: { Accept: "application/dns-json" } });
    const j = await r.json();
    if (j.Status === 3) return false;
    if (Array.isArray(j.Answer) && j.Answer.some((a: any) => a.type === 15)) return true;
    const a = await (await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`)).json();
    return Array.isArray(a.Answer) && a.Answer.length > 0 ? true : false;
  } catch { return null; }
}

async function placesSearch(key: string, textQuery: string, region: string, size = 20) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.types,places.googleMapsUri,places.addressComponents" },
    body: JSON.stringify({ textQuery, pageSize: size, regionCode: region }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google Maps ${r.status} ${j?.error?.status || ""}`);
  return j.places || [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(jwt);
  const email = u?.user?.email?.toLowerCase();
  const { data: owner } = email ? await admin.from("app_owners").select("email").ilike("email", email).maybeSingle() : { data: null };
  if (!owner) { const { data: tm } = await admin.from("settings").select("data").eq("id", "test_mode").maybeSingle(); if (tm?.data?.enabled !== true) return json({ error: "not_allowed" }, 403); }

  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const action = String(body.action || "status");
  const gKey = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";

  if (action === "status") {
    const elKey = Deno.env.get("ELEVENLABS_API_KEY"), phoneId = Deno.env.get("ELEVENLABS_PHONE_NUMBER_ID");
    const agentId = Deno.env.get("ELEVENLABS_AGENT_ID") || "agent_3401m6p7pqnjepwv9rgy15kfq48c";
    const el: any = { api_key: !!elKey, phone_number_id: !!phoneId, webhook_secret: !!Deno.env.get("ELEVENLABS_WEBHOOK_SECRET"), agent_id: agentId };
    if (elKey) {
      try {
        const a = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, { headers: { "xi-api-key": elKey } });
        el.key_works = a.ok; el.agent_found = a.ok; if (!a.ok) el.error = `Agent check HTTP ${a.status}`;
        const pn = await fetch("https://api.elevenlabs.io/v1/convai/phone-numbers", { headers: { "xi-api-key": elKey } });
        const list = pn.ok ? await pn.json() : [];
        el.numbers = (Array.isArray(list) ? list : []).map((n: any) => ({ id: n.phone_number_id, number: n.phone_number, provider: n.provider, label: n.label, agent: n.assigned_agent?.agent_id || null }));
        el.phone_ok = !!phoneId && el.numbers.some((n: any) => n.id === phoneId);
      } catch (e) { el.error = String(e).slice(0, 80); }
    }
    const DAY = 86400000, dayStart = new Date(Math.floor((Date.now() + 4 * 3600000) / DAY) * DAY - 4 * 3600000);
    const { count: callsToday } = await admin.from("calls").select("id", { count: "exact", head: true }).eq("test", false).gte("created_at", dayStart.toISOString());
    const { data: cs } = await admin.from("settings").select("data").eq("id", "calling").maybeSingle();
    return json({ elevenlabs: el, google_maps: !!gKey, instantly: !!Deno.env.get("INSTANTLY_API_KEY"), chatgpt: !!Deno.env.get("OPENAI_API_KEY"), calling: cs?.data || {}, calls_today: callsToday || 0 });
  }

  if (action === "duplicates") {
    const L = await allLeads(admin, "id, company, city, market, phone, email, website, status, created_at");
    const keyGroups = new Map<string, any[]>();
    const add = (k: string, l: any, why: string) => { if (!k) return; const g = keyGroups.get(k) || []; if (!g.some((x) => x.id === l.id)) g.push({ ...l, why }); keyGroups.set(k, g); };
    for (const l of L) {
      const n = normName(l.company); if (n.length >= 3) add(`name:${l.market}:${(l.city || "").toLowerCase()}:${n}`, l, "Same name and city");
      const d = domainOf(l.website || ""); if (d && !/instagram|facebook|tiktok|linktr/.test(d)) add(`web:${d}:${(l.city || "").toLowerCase()}`, l, "Same website and city");
      if (l.email) add(`mail:${String(l.email).toLowerCase()}:${(l.city || "").toLowerCase()}`, l, "Same email and city");
      if (realPhone(l.phone)) { const last8 = String(l.phone || "").replace(/\D/g, "").slice(-8); if (last8.length === 8) add(`ph:${last8}`, l, "Same phone number"); }
    }
    const parent = new Map<string, string>(); const find = (x: string): string => { while (parent.get(x) && parent.get(x) !== x) x = parent.get(x)!; return x; };
    const reasons = new Map<string, Set<string>>();
    for (const g of keyGroups.values()) if (g.length > 1) { for (const x of g) { if (!parent.has(x.id)) parent.set(x.id, x.id); reasons.set(x.id, (reasons.get(x.id) || new Set()).add(x.why)); } for (const x of g.slice(1)) parent.set(find(x.id), find(g[0].id)); }
    const clusters = new Map<string, any[]>();
    for (const l of L) if (parent.has(l.id)) { const r = find(l.id); clusters.set(r, [...(clusters.get(r) || []), { ...l, why: [...(reasons.get(l.id) || [])] }]); }
    const groups = [...clusters.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => (a.status === "new" ? 1 : 0) - (b.status === "new" ? 1 : 0) || Date.parse(a.created_at) - Date.parse(b.created_at)));
    return json({ groups, total_accounts: L.length });
  }

  if (action === "merge") {
    const keep = String(body.keep_id || ""), remove: string[] = (body.remove_ids || []).map(String).filter((x: string) => x && x !== keep);
    if (!keep || !remove.length) return json({ error: "bad_request" }, 400);
    const { data: rows } = await admin.from("leads").select("*").in("id", [keep, ...remove]);
    const k = (rows || []).find((r: any) => r.id === keep); if (!k) return json({ error: "not_found" }, 404);
    const fill: any = {};
    for (const r of (rows || []).filter((x: any) => x.id !== keep)) for (const f of ["email", "website", "city", "name_ar", "role", "context", "audit", "report", "next"]) if (!k[f] && r[f] && !fill[f]) fill[f] = r[f];
    if (Object.keys(fill).length) await admin.from("leads").update(fill).eq("id", keep);
    await admin.from("calls").update({ lead_id: keep }).in("lead_id", remove);
    await admin.from("meetings").update({ lead_id: keep }).in("lead_id", remove);
    await admin.from("email_events").update({ lead_id: keep }).in("lead_id", remove);
    const { error } = await admin.from("leads").delete().in("id", remove);
    return json({ ok: !error, merged: remove.length, error: error?.message });
  }

  if (action === "verify") {
    const limit = Math.min(Number(body.limit) || 40, 60);
    const onlyIds: string[] | null = Array.isArray(body.ids) && body.ids.length ? body.ids : null;
    let q = admin.from("leads").select("id, company, city, market, phone, email, website, quality, verify").order("updated_at", { ascending: true }).limit(limit);
    if (onlyIds) q = admin.from("leads").select("id, company, city, market, phone, email, website, quality, verify").in("id", onlyIds);
    else if (!body.all) q = q.is("verify", null);
    const { data: list } = await q;
    const mxCache = new Map<string, boolean | null>(); let done = 0; const now = new Date().toISOString();
    for (const l of list || []) {
      const v: any = { checked_at: now };
      const p = realPhone(l.phone) ? normPhone(l.phone, l.market || "AE") : { issue: "no_phone" };
      v.phone = { valid: !!p.phone, type: p.type || null, issue: p.issue || null, e164: p.phone || null };
      if (l.email) {
        const e = String(l.email).trim().toLowerCase(), fmt = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e), dom = e.split("@")[1] || "";
        let hasMx: boolean | null = null; if (fmt && dom) { if (!mxCache.has(dom)) mxCache.set(dom, await mx(dom)); hasMx = mxCache.get(dom)!; }
        v.email = { address: e, status: !fmt ? "invalid" : DISPOSABLE.test(dom) ? "disposable" : hasMx === false ? "no_mail_server" : hasMx ? "valid" : "unknown", matches_website: !!l.website && domainOf(l.website).endsWith(dom.replace(/^mail\./, "")) };
      } else v.email = { status: "none" };
      if (gKey && !l.quality?.open_on_google) {
        try {
          const places = await placesSearch(gKey, `${l.company} ${l.city || ""} ${COUNTRY[l.market] || ""}`, l.market, 5);
          const last8 = String(l.phone).replace(/\D/g, "").slice(-8);
          const m = places.find((x: any) => String(x.internationalPhoneNumber || x.nationalPhoneNumber || "").replace(/\D/g, "").slice(-8) === last8) || places[0];
          if (m) {
            const gp = String(m.internationalPhoneNumber || "").replace(/\D/g, "");
            v.maps = { found: true, name: m.displayName?.text, phone_matches: !!gp && gp.slice(-8) === last8, google_phone: m.internationalPhoneNumber || null, status: m.businessStatus || null, rating: m.rating ?? null, reviews: m.userRatingCount ?? null, url: m.googleMapsUri || null, website: m.websiteUri || null };
          } else v.maps = { found: false };
        } catch (e) { v.maps = { error: String(e).slice(0, 80) }; }
      } else v.maps = { skipped: true };
      const issues: string[] = [];
      if (!v.phone.valid) issues.push(realPhone(l.phone) ? "Phone number fails the country's format" : "No phone number: email only");
      if (v.phone.type === "hotline") issues.push("Hotline / call-centre number");
      if (v.email.status && !["valid", "none"].includes(v.email.status)) issues.push(`Email ${v.email.status.replace(/_/g, " ")}`);
      if (v.maps?.found && !v.maps.phone_matches) issues.push("Phone differs from Google Maps");
      if (v.maps?.status && v.maps.status !== "OPERATIONAL") issues.push(`Google Maps: ${String(v.maps.status).toLowerCase().replace(/_/g, " ")}`);
      v.issues = issues; v.ok = issues.length === 0;
      const upd: any = { verify: v, quality: { ...(l.quality || {}), phone_valid: v.phone.valid, phone_type: v.phone.type, closed_on_google: v.maps?.status === "CLOSED_PERMANENTLY" || undefined } };
      if (v.maps?.found && v.maps.website && !l.website) upd.website = v.maps.website;
      await admin.from("leads").update(upd).eq("id", l.id); done++;
    }
    const { count: remaining } = await admin.from("leads").select("id", { count: "exact", head: true }).is("verify", null);
    return json({ ok: true, verified: done, remaining: remaining || 0, google_maps: !!gKey });
  }

  if (action === "search") {
    const query = String(body.query || "").trim().slice(0, 120), mk = (body.market || "SA") as Mk;
    if (!COUNTRY[mk]) return json({ error: "bad_request", message: "Unknown country." }, 400);
    if (query.length < 3) return json({ error: "bad_request", message: "Type what to search for, e.g. dental clinic Olaya Riyadh." }, 400);
    const L = await allLeads(admin, "id, company, phone, city");
    const known = new Set(L.filter((l: any) => realPhone(l.phone)).map((l: any) => String(l.phone).replace(/\D/g, "").slice(-8)));
    const knownNames = new Set(L.map((l: any) => normName(l.company) + "|" + String(l.city || "").toLowerCase()));
    let results: any[] = [], source = "";
    const dbg: string[] = [];
    if (gKey) {
      source = "Google Maps";
      const places = await placesSearch(gKey, `${query} ${COUNTRY[mk]}`, mk, 20);
      results = places.map((p: any) => {
        const n = normPhone(p.internationalPhoneNumber || p.nationalPhoneNumber || "", mk);
        const city = (p.addressComponents || []).find((c: any) => (c.types || []).includes("locality"))?.longText || "";
        return { ref: p.id, name: p.displayName?.text || "", address: p.formattedAddress || "", city, phone: n.phone || null, phone_type: n.type || null, website: p.websiteUri || null, rating: p.rating ?? null, reviews: p.userRatingCount ?? null, status: p.businessStatus || null, maps_url: p.googleMapsUri || null, types: p.types || [] };
      });
    } else {
      source = "OpenStreetMap";
      const UA = { "User-Agent": "ClinicGrowthCaller/1.0 (clinic list search)", "Accept-Language": "en" };
      const KIND = /\b(dental|dentist|dentists|clinic|clinics|medical|centre|center|aesthetic|derma\w*|skin|cosmetic|doctor|doctors|polyclinic|in|near)\b/gi;
      const wantDental = /dent/i.test(query), wantAes = /aesthetic|derma|skin|cosmetic|laser/i.test(query);
      const place = query.replace(KIND, " ").replace(/\s+/g, " ").trim() || COUNTRY[mk];
      const g = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=${mk.toLowerCase()}&q=${encodeURIComponent(place)}`, { headers: UA });
      let loc: any = g.ok ? (await g.json().catch(() => []))[0] : null;
      dbg.push(`area "${place}" (Nominatim): ${g.status}${loc ? " found" : " not found"}`);
      if (!loc) {
        try {
          const ph = await fetch(`https://photon.komoot.io/api/?limit=5&q=${encodeURIComponent(place + " " + COUNTRY[mk])}`, { headers: UA, signal: AbortSignal.timeout(10000) });
          const f = ph.ok ? ((await ph.json()).features || []).find((x: any) => String(x.properties?.countrycode || "").toUpperCase() === mk) : null;
          if (f) {
            const [lon, lat] = f.geometry.coordinates, ex = f.properties.extent;
            loc = { name: f.properties.name, boundingbox: ex ? [ex[3], ex[1], ex[0], ex[2]] : [lat - 0.02, lat + 0.02, lon - 0.02, lon + 0.02] };
          }
          dbg.push(`area (Photon): ${ph.status}${loc ? " found" : " not found"}`);
        } catch (e) { dbg.push(`area (Photon): ${(e as Error).name}`); }
      }
      if (loc) {
        let [s1, n1, w1, e1] = loc.boundingbox.map(Number);
        const pad = 0.01; if (n1 - s1 < 0.02) { s1 -= pad; n1 += pad; w1 -= pad; e1 += pad; }
        if (n1 - s1 > 0.6) { const cy = (s1 + n1) / 2, cx = (w1 + e1) / 2; s1 = cy - 0.15; n1 = cy + 0.15; w1 = cx - 0.15; e1 = cx + 0.15; }
        const bb = `${s1},${w1},${n1},${e1}`;
        const sel = wantDental ? ['["amenity"="dentist"]', '["healthcare"="dentist"]'] : wantAes ? ['["amenity"="clinic"]["healthcare:speciality"~"derm|plastic|cosmetic|aesthetic"]', '["shop"="beauty"]["beauty"~"laser|aesthetic"]', '["amenity"~"clinic|doctors"]["name"~"aesthetic|derma|skin|laser|cosmetic",i]'] : ['["amenity"~"^(dentist|clinic|doctors)$"]', '["healthcare"~"^(dentist|clinic|doctor)$"]'];
        const q = `[out:json][timeout:18];(${sel.map((x) => `nwr${x}(${bb});`).join("")});out center tags 60;`;
        for (const url of ["https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
          try {
            const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA["User-Agent"] }, body: "data=" + encodeURIComponent(q), signal: AbortSignal.timeout(20000) });
            if (!r.ok) { dbg.push(`${new URL(url).host}: HTTP ${r.status}`); continue; }
            const dat = await r.json().catch(() => null);
            if (!dat) { dbg.push(`${new URL(url).host}: bad reply`); continue; }
            const els = dat.elements || [];
            dbg.push(`${new URL(url).host}: ${els.length} places${dat.remark ? " (" + String(dat.remark).slice(0, 60) + ")" : ""}`);
            if (!els.length && dat.remark) continue;
            results = els.filter((e: any) => e.tags?.name).map((e: any) => {
              const t = e.tags, n = normPhone(t.phone || t["contact:phone"] || t["contact:mobile"] || "", mk);
              return { ref: `${e.type}/${e.id}`, name: t.name, address: [t["addr:street"], t["addr:suburb"] || t["addr:district"], t["addr:city"] || place].filter(Boolean).join(", "), city: t["addr:city"] || loc.name || place, phone: n.phone || null, phone_type: n.type || null, website: t.website || t["contact:website"] || null, rating: null, reviews: null, status: null, maps_url: `https://www.openstreetmap.org/${e.type}/${e.id}`, types: [t.amenity || t.healthcare || "clinic"] };
            }).sort((a: any, b: any) => (b.phone ? 1 : 0) - (a.phone ? 1 : 0));
            break;
          } catch (e) { dbg.push(`${new URL(url).host}: ${(e as Error).name}`); }
        }
      }
    }
    for (const x of results) x.in_list = (x.phone && known.has(String(x.phone).replace(/\D/g, "").slice(-8))) || knownNames.has(normName(x.name) + "|" + String(x.city || "").toLowerCase());
    return json({ source, results, debug: dbg, note: gKey ? null : "Free OpenStreetMap search: many clinics have no phone there. Add a Google Maps key for complete results." });
  }

  if (action === "save") {
    const mk = (body.market || "SA") as Mk, list = body.list === "queue" ? "queue" : "future";
    if (!COUNTRY[mk]) return json({ error: "bad_request", message: "Unknown country." }, 400);
    const items = (body.items || []).slice(0, 50);
    const rows = items.filter((x: any) => x.name).map((x: any) => {
      const t = `${x.name} ${(x.types || []).join(" ")}`;
      const campaign = /dent|orthodon|أسنان|اسنان/i.test(t) ? "dental" : /derma|aesthetic|cosmetic|skin|laser|beauty|plastic|تجميل|esthétique/i.test(t) ? "aesthetic" : "medical";
      return {
        company: String(x.name).slice(0, 160), city: x.city || null, phone: x.phone || `pending:${x.ref}`, website: x.website || null, market: mk,
        lang: langFor(mk), campaign, industry: campaign === "dental" ? "Dental clinic" : campaign === "aesthetic" ? "Aesthetic clinic" : "Medical centre",
        source: `Search (${body.source || "manual"})`, list, status: "new", verified: !!x.phone,
        context: [x.address, x.rating != null ? `Google: ${x.rating}★ from ${x.reviews || 0} reviews.` : "", x.maps_url ? `Map: ${x.maps_url}` : ""].filter(Boolean).join(" ").slice(0, 600),
        quality: { phone_valid: !!x.phone, phone_type: x.phone_type, confidence: x.phone ? "medium" : "low", issues: x.phone ? [] : ["No phone number found yet"], source: body.source || "Search" },
        audit: x.rating != null ? { gRating: x.rating, gReviews: x.reviews } : null,
      };
    });
    const { data, error } = await admin.from("leads").upsert(rows, { onConflict: "phone", ignoreDuplicates: true }).select("id");
    return json({ ok: !error, added: data?.length || 0, skipped: rows.length - (data?.length || 0), error: error?.message });
  }

  return json({ error: "unknown_action" }, 400);
});
