// Keeps the clinic list fresh and accurate.
//  mode "pull":  pulls dental, aesthetic and medical clinics for the six GCC markets from OpenStreetMap (free),
//                validates every phone number for its country, filters out hospitals, pharmacies, closed and
//                government centres, de-duplicates, and adds or refreshes leads. Then re-checks every lead's number
//                (all countries). Google Maps searching for every country lives in the maps-harvest function.
//  mode "scan":  checks not-yet-scanned clinic websites (loads, booking, WhatsApp, ads tags...) and finds the
//                clinic's email address on the home page or contact page.
// Runs from the scheduler (x-cron-key) or from the console (owner).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { normPhone } from "./phone.ts";
import { bestEmail, contactLinks, emailsIn } from "./emailfind.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

type Mk = "AE" | "SA" | "QA" | "KW" | "BH" | "OM";
const MARKETS: Mk[] = ["AE", "SA", "QA", "KW", "BH", "OM"];
const LANG: Record<Mk, string> = { AE: "en", SA: "ar", QA: "en", KW: "ar", BH: "en", OM: "ar" };

const EXCLUDE_NAME = /hospital|مستشفى|pharmac|صيدلي|veterin|بيطري|\bvet\b|laborator|\blab\b|مختبر|x-?ray|radiology|primary health|\bphc\b|health cent(er|re)s? \(gov|ministry|وزارة|military|عسكري|police|شرطة|school|مدرسة|university|جامعة|optic|نظارات|spa\b|salon|صالون|gym/i;
const EXCLUDE_OPERATOR = /ministry|وزارة|\bmoh\b|\bdha\b|seha|\bphcc\b|hamad medical|government|حكومي|military|police/i;
const DENTAL = /dental|dentist|dent\b|orthodon|smile|implant|أسنان|اسنان/i;
const AESTHETIC = /aesthetic|cosmetic|derma|skin|laser|beauty|plastic|hair|تجميل|جلدية|ليزر|بشرة/i;

function categorise(t: Record<string, string>, name: string): { campaign: string; industry: string } {
  const spec = `${t["healthcare:speciality"] || ""} ${t["healthcare"] || ""} ${t["amenity"] || ""}`;
  if (/dentist|dental|orthodont/i.test(spec) || DENTAL.test(name)) return { campaign: "dental", industry: "Dental clinic" };
  if (/dermatolog|plastic|cosmetic|aesthetic/i.test(spec) || AESTHETIC.test(name)) return { campaign: "aesthetic", industry: "Aesthetic clinic" };
  return { campaign: "medical", industry: "Medical centre" };
}
const cleanUrl = (u?: string) => {
  if (!u) return null; let s = u.trim().split(/[;\s]/)[0];
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try { const x = new URL(s); return /\./.test(x.hostname) ? x.toString() : null; } catch { return null; }
};
const cleanEmail = (e?: string) => { const s = (e || "").trim().split(/[;,\s]/)[0].toLowerCase(); return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s) ? s : null; };

const MIRRORS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
async function overpass(mk: Mk) {
  const parts: string[] = [];
  for (const [k, v] of [["amenity", "dentist"], ["amenity", "clinic"], ["amenity", "doctors"], ["healthcare", "dentist"], ["healthcare", "clinic"], ["healthcare", "doctor"]])
    for (const p of ["phone", "contact:phone", "contact:mobile"]) parts.push(`nwr["${k}"="${v}"]["${p}"](area.a);`);
  const q = `[out:json][timeout:50];area["ISO3166-1"="${mk}"][admin_level=2]->.a;(${parts.join("")});out center tags;`;
  let last = "";
  for (const url of MIRRORS) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await fetch(url, { method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "ClinicGrowthCaller/1.0 (lead list refresh)" }, body: "data=" + encodeURIComponent(q) });
      if (!r.ok) { last += ` ${new URL(url).host} HTTP ${r.status};`; continue; }
      const j = await r.json();
      return (j.elements || []) as any[];
    } catch (e) { last += ` ${new URL(url).host} ${String(e).slice(0, 60)};`; } finally { clearTimeout(t); }
  }
  throw new Error("overpass_unavailable: " + last);
}

function analyse(H: string) {
  const has = (re: RegExp) => re.test(H);
  let booking = "phone_only";
  if (has(/calendly\.com|okadoc|vezeeta|practo|cliniko|setmore|simplybook|zocdoc|doctoruna|meddy|nabady|doctolib|dentally|book online|online booking|book now|réserver|prendre rendez-vous|احجز (الآن|موعدك)|حجز موعد/i)) booking = "online";
  else if (has(/(book|request|make) (an )?appointment|appointment (form|request)|rendez-vous|احجز|موعد/i)) booking = "form";
  const adsTag = has(/AW-\d{6,}|googleadservices\.com|google_conversion_id/i);
  return {
    website: true, booking, googleAds: adsTag ? true : null, googleAdsTag: adsTag,
    whatsapp: has(/wa\.me\/|api\.whatsapp\.com|web\.whatsapp\.com|whatsapp:\/\/|واتساب/i),
    chat: has(/tawk\.to|intercom|crisp\.chat|tidio|livechatinc|zopim|zdassets|hs-scripts|wati\.io|freshchat|drift\.com|chatbot|live chat/i),
    instagram: has(/instagram\.com\/[A-Za-z0-9_.]+/i), tiktok: has(/tiktok\.com\/@/i), snapchat: has(/snapchat\.com\/(add|@)/i), facebook: has(/facebook\.com\/[A-Za-z0-9_.-]+/i),
    arabic: has(/hreflang=["']ar|lang=["']ar|\/ar\/|العربية/), blog: has(/\/blog|\bblog\b|articles|مقالات|مدونة/i),
    metaPixel: has(/fbevents\.js|fbq\(\s*['"]init/i), analytics: has(/googletagmanager\.com|google-analytics\.com|gtag\(/i),
  };
}

async function getHtml(url: string, ms = 10000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; ClinicScan/1.0)", "Accept-Language": "en,ar,fr" } });
    const ct = r.headers.get("content-type") || "";
    if (!r.ok || !/html|text/i.test(ct)) return { ok: false, status: r.status, html: "", url: r.url };
    return { ok: true, status: r.status, html: new TextDecoder().decode((await r.arrayBuffer()).slice(0, 1_500_000)), url: r.url };
  } catch { return { ok: false, status: 0, html: "", url }; } finally { clearTimeout(t); }
}
async function allRows(admin: any, cols: string) {
  let out: any[] = [];
  for (let from = 0; from < 300000; from += 1000) {
    const { data, error } = await admin.from("leads").select(cols).order("id").range(from, from + 999);
    if (error || !data) break; out = out.concat(data); if (data.length < 1000) break;
  }
  return out;
}

async function pull(admin: any, runId: number, step: string, queue: string[], round: number, selfCall: (body: unknown) => Promise<void>) {
  const only = step as Mk;
  const now = new Date().toISOString();
  const { data: prev } = await admin.from("sync_runs").select("found, added, updated, rejected, by_market, reasons, note").eq("id", runId).single();
  const existing = await allRows(admin, "id, phone, osm_id, website, email, city, quality");
  const byPhone = new Map<string, any>(existing.map((l: any) => [l.phone, l]));
  const seenIds: string[] = [];
  const reasons: Record<string, number> = { ...(prev?.reasons || {}) }; const byMarket: Record<string, any> = { ...(prev?.by_market || {}) };
  let found = prev?.found || 0, added = prev?.added || 0, updated = prev?.updated || 0, rejected = prev?.rejected || 0;
  const notes: string[] = prev?.note ? String(prev.note).split(" | ") : [];
  const bump = (k: string) => { reasons[k] = (reasons[k] || 0) + 1; rejected++; };

  const tag = only;
  for (const mk of [only]) {
    let els: any[] = [];
    try { els = await overpass(mk); } catch (e) { notes.push(`${tag}: ${String(e).slice(0, 160)}`); byMarket[tag] = { error: true }; continue; }
    for (let i = notes.length - 1; i >= 0; i--) if (notes[i].startsWith(tag + ":")) notes.splice(i, 1);
    found += els.length;
    const phoneCount = new Map<string, number>();
    const cands: any[] = [];
    for (const el of els) {
      const t = el.tags || {};
      const name = (t.name || t["name:en"] || t["name:ar"] || "").trim();
      if (!name || name.length < 3 || /^(clinic|dentist|dental clinic|عيادة|مستوصف)$/i.test(name)) { bump("no_real_name"); continue; }
      if (EXCLUDE_NAME.test(name) || EXCLUDE_NAME.test(t["name:en"] || "")) { bump("not_a_private_clinic"); continue; }
      if (EXCLUDE_OPERATOR.test(`${t.operator || ""} ${t["operator:type"] || ""}`) || /government|public/i.test(t["operator:type"] || "")) { bump("government_operated"); continue; }
      if (t.disused || t["disused:amenity"] || /closed|permanently/i.test(t.opening_hours || "")) { bump("closed"); continue; }
      const raws = String(t.phone || t["contact:phone"] || t["contact:mobile"] || t.mobile || "").split(/[;,/]/).map((x) => x.trim()).filter(Boolean);
      let ph: { phone?: string; type?: string; issue?: string } = { issue: "no_phone" };
      for (const r of raws) { const n = normPhone(r, mk); if (n.phone) { ph = n; break; } ph = n; }
      if (!ph.phone) { bump(ph.issue || "invalid_number"); continue; }
      phoneCount.set(ph.phone, (phoneCount.get(ph.phone) || 0) + 1);
      const cat = categorise(t, `${name} ${t["name:en"] || ""}`);
      cands.push({
        osm_id: `${el.type}/${el.id}`, company: name.slice(0, 160), name_ar: t["name:ar"] && t["name:ar"] !== name ? t["name:ar"] : null,
        phone: ph.phone, phone_type: ph.type, market: mk, lang: LANG[mk], campaign: cat.campaign, industry: cat.industry,
        city: (t["addr:city"] || t["addr:city:en"] || t["is_in:city"] || t["addr:district"] || "").slice(0, 80) || null,
        website: cleanUrl(t.website || t["contact:website"] || t.url), email: cleanEmail(t.email || t["contact:email"]),
        lat: el.lat ?? el.center?.lat ?? null, lon: el.lon ?? el.center?.lon ?? null, ig: t["contact:instagram"] || null,
      });
    }
    let mAdded = 0, mUpdated = 0; const seen = new Set<string>(); const inserts: any[] = [];
    for (const c of cands) {
      if (seen.has(c.phone)) { bump("duplicate"); continue; } seen.add(c.phone);
      const shared = (phoneCount.get(c.phone) || 1) > 1;
      const issues: string[] = [];
      if (c.phone_type === "hotline") issues.push("Hotline or call-centre number");
      if (shared) issues.push("Number shared by several branches");
      if (!c.city) issues.push("City missing");
      if (!c.website) issues.push("No website listed");
      const quality: any = { phone_valid: true, phone_type: c.phone_type, phone_shared: shared, has_website: !!c.website, has_email: !!c.email, has_city: !!c.city, issues, confidence: issues.length <= 1 ? "high" : issues.length <= 2 ? "medium" : "low", checked_at: now, source: "OpenStreetMap" };
      const ex = byPhone.get(c.phone);
      if (ex) {
        const upd: any = {}; const oldQ = ex.quality || {};
        if (oldQ.source !== "Google Maps" && (oldQ.confidence !== quality.confidence || JSON.stringify(oldQ.issues || []) !== JSON.stringify(issues) || oldQ.phone_valid !== true || oldQ.stale)) { upd.quality = { ...oldQ, ...quality, stale: false }; upd.verified = true; }
        if (!ex.osm_id) upd.osm_id = c.osm_id;
        if (!ex.website && c.website) upd.website = c.website;
        if (!ex.email && c.email) upd.email = c.email;
        if (!ex.city && c.city) upd.city = c.city;
        if (Object.keys(upd).length) {
          upd.last_seen_at = now;
          const { error } = await admin.from("leads").update(upd).eq("id", ex.id);
          if (!error) { updated++; mUpdated++; }
        } else seenIds.push(ex.id);
        continue;
      }
      inserts.push({
        osm_id: c.osm_id, company: c.company, name_ar: c.name_ar, phone: c.phone, market: c.market, lang: c.lang, campaign: c.campaign,
        industry: c.industry, city: c.city, website: c.website, email: c.email, lat: c.lat, lon: c.lon, source: "OpenStreetMap",
        context: [c.ig ? `Instagram: ${c.ig}` : "", "Found on OpenStreetMap; check their Google reviews and Instagram before calling."].filter(Boolean).join(" "),
        quality, verified: true, last_seen_at: now, status: "new",
      });
    }
    for (let i = 0; i < inserts.length; i += 200) {
      const chunk = inserts.slice(i, i + 200);
      const { data, error } = await admin.from("leads").upsert(chunk, { onConflict: "phone", ignoreDuplicates: true }).select("id");
      if (error) notes.push(`${mk} insert: ${error.message.slice(0, 120)}`); else { added += data?.length || 0; mAdded += data?.length || 0; }
    }
    for (let i = 0; i < seenIds.length; i += 300) await admin.from("leads").update({ last_seen_at: now }).in("id", seenIds.slice(i, i + 300));
    byMarket[tag] = { found: els.length, valid: cands.length, added: mAdded, updated: mUpdated, unchanged: seenIds.length };
  }
  await admin.from("sync_runs").update({ found, added, updated, rejected, by_market: byMarket, reasons, note: notes.join(" | ") || null }).eq("id", runId);
  if (queue.length) { await selfCall({ mode: "pull", run_id: runId, step: queue[0], queue: queue.slice(1), round }); return; }
  const failed = Object.entries(byMarket).filter(([, v]: any) => v?.error).map(([k]) => k);
  if (failed.length && round < 3) {
    await new Promise((r) => setTimeout(r, 20000));
    await selfCall({ mode: "pull", run_id: runId, step: failed[0], queue: failed.slice(1), round: round + 1 }); return;
  }

  // Re-check every lead's number for its own country, and flag map-sourced ones gone from OpenStreetMap.
  const all = await allRows(admin, "id, phone, market, quality, source, last_seen_at, osm_id");
  const staleBefore = Date.now() - 10 * 86400000;
  for (const l of all) {
    if (String(l.phone || "").startsWith("nophone:") || String(l.phone || "").startsWith("pending:")) continue;
    const n = normPhone(l.phone, l.market || "AE");
    const q = { ...(l.quality || {}) };
    let changed = false;
    if (q.phone_valid !== !!n.phone) { q.phone_valid = !!n.phone; changed = true; }
    if (n.type && q.phone_type !== n.type) { q.phone_type = n.type; changed = true; }
    if (!n.phone && !(q.issues || []).includes("Phone number fails the country's format")) { q.issues = [...(q.issues || []), "Phone number fails the country's format"]; q.confidence = "low"; changed = true; }
    const stale = !!l.osm_id && !String(l.osm_id).startsWith("g:") && l.last_seen_at && Date.parse(l.last_seen_at) < staleBefore;
    if (!!q.stale !== !!stale) { q.stale = !!stale; changed = true; }
    if (!q.checked_at) { q.checked_at = now; changed = true; }
    if (changed) await admin.from("leads").update({ quality: q, verified: !!n.phone && !stale }).eq("id", l.id);
  }

  const allFailed = Object.values(byMarket).every((v: any) => v?.error);
  await admin.from("sync_runs").update({ status: allFailed ? "failed" : "done", finished_at: new Date().toISOString() }).eq("id", runId);
}

async function scanOne(admin: any, l: any) {
  const site = String(l.website);
  const audit: Record<string, unknown> = { ...(l.audit || {}), emailsFound: [] };
  let email: string | null = null;
  if (/instagram\.com|facebook\.com|linktr\.ee/i.test(site)) { audit.website = false; audit.instagram = /instagram/i.test(site); }
  else {
    const home = await getHtml(site, 12000);
    if (home.ok) {
      Object.assign(audit, analyse(home.html));
      let found = emailsIn(home.html);
      if (!found.length) for (const u of contactLinks(home.html, home.url || site)) { const p = await getHtml(u, 8000); if (p.ok) { found = found.concat(emailsIn(p.html)); if (found.length) break; } }
      email = bestEmail(found, home.url || site);
      audit.emailsFound = found.slice(0, 5);
    } else { audit.website = null; audit.note = home.status ? `Website didn't load (${home.status})` : "Website didn't load (timeout)"; }
  }
  audit.checkedAt = Date.now(); audit.source = "auto";
  const { data: cur } = await admin.from("leads").select("quality, email").eq("id", l.id).single();
  if (cur?.quality?.g_rating != null) { audit.gRating = cur.quality.g_rating; audit.gReviews = cur.quality.g_reviews; }
  const q = { ...(cur?.quality || {}), website_ok: audit.website === true, ...(email ? { has_email: true, email_source: "website" } : {}) };
  const upd: any = { audit, quality: q };
  if (email && !cur?.email) upd.email = email;
  await admin.from("leads").update(upd).eq("id", l.id);
  return !!(email && !cur?.email);
}

async function scan(admin: any, runId: number) {
  // Up to 60 sites per run, 8 at a time. Clinics in markets we can email or call are all worth it.
  // New sites first, then older ones checked before email-finding existed (website, no email, never searched for one).
  const { data: fresh } = await admin.from("leads").select("id, website, audit").is("audit", null).not("website", "is", null).order("created_at", { ascending: true }).limit(60);
  let list = fresh || [];
  if (list.length < 60) {
    const { data: older } = await admin.from("leads").select("id, website, audit").not("website", "is", null).is("email", null).not("audit", "is", null).is("audit->emailsFound", null).order("created_at", { ascending: true }).limit(60 - list.length);
    list = list.concat(older || []);
  }
  let scanned = 0, emails = 0;
  const items = list;
  for (let i = 0; i < items.length; i += 8) {
    const res = await Promise.all(items.slice(i, i + 8).map((l: any) => scanOne(admin, l).catch(() => false)));
    scanned += res.length; emails += res.filter(Boolean).length;
  }
  await admin.from("leads").update({ audit: { website: false, checkedAt: Date.now(), source: "auto" } }).is("audit", null).is("website", null);
  await admin.from("sync_runs").update({ status: "done", finished_at: new Date().toISOString(), scanned, note: emails ? `${emails} new email addresses found` : null }).eq("id", runId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let ok = false;
  const cronKey = req.headers.get("x-cron-key");
  if (cronKey) {
    const { data } = await admin.from("settings").select("data").eq("id", "cron").maybeSingle();
    ok = !!data?.data?.key && data.data.key === cronKey;
  } else {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(jwt);
    const email = u?.user?.email?.toLowerCase();
    if (email) { const { data: o } = await admin.from("app_owners").select("email").ilike("email", email).maybeSingle(); ok = !!o; }
    if (!ok) { const { data: tm } = await admin.from("settings").select("data").eq("id", "test_mode").maybeSingle(); ok = tm?.data?.enabled === true; }
  }
  if (!ok) return json({ error: "not_allowed" }, 403);

  let body: { mode?: string; run_id?: number; step?: string; queue?: string[]; round?: number } = {}; try { body = await req.json(); } catch { /* default */ }
  const mode = body.mode === "scan" ? "scan" : "pull";
  const { data: cron } = await admin.from("settings").select("data").eq("id", "cron").maybeSingle();
  const selfCall = async (b: unknown) => {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/pull-leads`, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-key": cron?.data?.key || "" }, body: JSON.stringify(b) }).catch(() => {});
  };
  if (mode === "pull" && body.run_id && cronKey && body.step) {
    const job = pull(admin, body.run_id, body.step, body.queue || [], body.round || 1, selfCall).catch(async (e) => {
      await admin.from("sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), note: String(e).slice(0, 300) }).eq("id", body.run_id);
    });
    // @ts-ignore EdgeRuntime is provided by Supabase
    EdgeRuntime.waitUntil(job);
    return json({ ok: true, run_id: body.run_id, step: body.step });
  }
  const { data: running } = await admin.from("sync_runs").select("id, started_at").eq("kind", mode).eq("status", "running").gte("started_at", new Date(Date.now() - 15 * 60000).toISOString()).maybeSingle();
  if (running) return json({ ok: true, already_running: running.id });
  const { data: run } = await admin.from("sync_runs").insert({ kind: mode }).select("id").single();
  const job = (mode === "scan" ? scan(admin, run!.id) : pull(admin, run!.id, "AE", MARKETS.slice(1), 1, selfCall)).catch(async (e) => {
    await admin.from("sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), note: String(e).slice(0, 300) }).eq("id", run!.id);
  });
  // @ts-ignore EdgeRuntime is provided by Supabase
  EdgeRuntime.waitUntil(job);
  return json({ ok: true, run_id: run!.id, mode });
});
