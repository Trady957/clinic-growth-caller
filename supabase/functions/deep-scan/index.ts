// Full scan of one clinic and a short sales report:
//  website & SEO health, tracking/ads tags, social profiles, keywords, mobile speed (PageSpeed),
//  Google Maps rating + latest reviews (Places API), then a written summary by ChatGPT (OpenAI API).
// Optional secrets: GOOGLE_PLACES_API_KEY (Maps + reviews), OPENAI_API_KEY (+ OPENAI_MODEL), PAGESPEED_API_KEY.
// Without them it still scans the website and writes a rule-based report.
//
// Two ways in:
//  - the console (owner sign-in), one clinic: { lead_id } — full scan including Google reviews.
//  - the scheduler (x-cron-key), { batch: n } — reports for clinics that don't have one yet, best first.
//    Batch mode reuses the Google rating already in the list instead of a new (paid) Maps lookup.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const COUNTRY: Record<string, string> = {
  AE: "United Arab Emirates", SA: "Saudi Arabia", QA: "Qatar", KW: "Kuwait", BH: "Bahrain", OM: "Oman", EG: "Egypt", JO: "Jordan", MA: "Morocco",
  GB: "United Kingdom", IE: "Ireland", FR: "France", BE: "Belgium", DE: "Germany", ES: "Spain", IT: "Italy", NL: "Netherlands", US: "United States", CA: "Canada",
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function get(url: string, ms = 12000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms); const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": UA, "Accept-Language": "en,ar;q=0.8" } });
    const ct = r.headers.get("content-type") || "";
    const text = /html|text|xml|json/i.test(ct) ? new TextDecoder().decode((await r.arrayBuffer()).slice(0, 1_500_000)) : "";
    return { ok: r.ok, status: r.status, text, url: r.url, ms: Date.now() - t0, ct };
  } catch (e) { return { ok: false, status: 0, text: "", url, ms: Date.now() - t0, ct: "", error: String(e).slice(0, 80) }; }
  finally { clearTimeout(t); }
}
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;|&#\d+;/g, " ").replace(/\s+/g, " ").toLowerCase();
const first = (re: RegExp, s: string) => (s.match(re)?.[1] || "").trim();

function socialLinks(H: string) {
  const find = (re: RegExp) => { const m = H.match(re); return m ? m[0].replace(/["'<>\s].*$/, "") : null; };
  return {
    instagram: find(/https?:\/\/(www\.)?instagram\.com\/(?!p\/|reel\/|explore\/)[A-Za-z0-9_.]{2,}/i),
    facebook: find(/https?:\/\/(www\.|m\.)?facebook\.com\/(?!sharer|plugins|tr\b|dialog)[A-Za-z0-9_.\-/]{2,}/i),
    tiktok: find(/https?:\/\/(www\.)?tiktok\.com\/@[A-Za-z0-9_.]{2,}/i),
    snapchat: find(/https?:\/\/(www\.)?snapchat\.com\/(add|@)\/?[A-Za-z0-9_.\-]{2,}/i),
    youtube: find(/https?:\/\/(www\.)?youtube\.com\/(@|channel\/|c\/|user\/)[A-Za-z0-9_.\-]{2,}/i),
    linkedin: find(/https?:\/\/(www\.)?linkedin\.com\/(company|in)\/[A-Za-z0-9_.\-]{2,}/i),
    x: find(/https?:\/\/(www\.)?(twitter|x)\.com\/(?!intent|share)[A-Za-z0-9_]{2,}/i),
    whatsapp: find(/https?:\/\/(wa\.me|api\.whatsapp\.com\/send)[^"'<>\s]*/i),
  };
}

function keywordSet(campaign: string, city: string, industry: string) {
  const c = city || "";
  if (campaign === "dental") return [
    ["dentist " + c, "dentist"], ["dental clinic " + c, "dental clinic"], ["dental implants " + c, "implant"], ["teeth whitening " + c, "whitening"],
    ["invisalign " + c, "invisalign|aligner"], ["veneers " + c, "veneer"], ["root canal " + c, "root canal"], ["orthodontist " + c, "orthodont|braces"],
    ["طبيب اسنان " + c, "اسنان|أسنان"], ["تبييض الاسنان " + c, "تبييض"],
  ];
  if (campaign === "aesthetic") return [
    ["aesthetic clinic " + c, "aesthetic"], ["botox " + c, "botox"], ["fillers " + c, "filler"], ["laser hair removal " + c, "laser hair|hair removal"],
    ["dermatologist " + c, "dermatolog|skin"], ["hydrafacial " + c, "hydrafacial|facial"], ["skin clinic " + c, "skin"],
    ["عيادة تجميل " + c, "تجميل"], ["ليزر ازالة الشعر " + c, "ليزر"], ["بوتوكس " + c, "بوتوكس"],
  ];
  const t = (industry || "clinic").toLowerCase();
  return [
    ["clinic " + c, "clinic"], [t + " " + c, t.split(" ")[0]], ["general practitioner " + c, "general practi|gp\\b|family medicine"], ["pediatrician " + c, "pediatric|paediatric"],
    ["dermatologist " + c, "dermatolog"], ["physiotherapy " + c, "physio"], ["health check up " + c, "check.?up|checkup"],
    ["عيادة " + c, "عيادة"], ["مركز طبي " + c, "مركز طبي"], ["طبيب " + c, "طبيب"],
  ];
}

async function pageSpeed(url: string) {
  const key = Deno.env.get("PAGESPEED_API_KEY") || Deno.env.get("GOOGLE_PLACES_API_KEY") || "";
  const q = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&category=seo&category=accessibility${key ? `&key=${key}` : ""}`;
  const r = await get(q, 55000);
  if (!r.ok) return { error: r.status ? `PageSpeed HTTP ${r.status}` : "PageSpeed timed out" };
  try {
    const j = JSON.parse(r.text); const c = j.lighthouseResult?.categories || {}; const a = j.lighthouseResult?.audits || {};
    return { performance: Math.round((c.performance?.score ?? 0) * 100), seo: Math.round((c.seo?.score ?? 0) * 100), accessibility: Math.round((c.accessibility?.score ?? 0) * 100),
      lcp: a["largest-contentful-paint"]?.displayValue || null, cls: a["cumulative-layout-shift"]?.displayValue || null };
  } catch { return { error: "PageSpeed unreadable" }; }
}

async function googleMaps(lead: any, cheap: boolean) {
  const q = lead.quality || {};
  if (cheap && q.g_rating != null) return { rating: q.g_rating, count: q.g_reviews ?? 0, photos: null, reviews: [], status: "OPERATIONAL", from_list: true };
  const key = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!key) return { skipped: "Add GOOGLE_PLACES_API_KEY to read Google Maps rating and reviews." };
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.rating,places.userRatingCount,places.reviews,places.googleMapsUri,places.businessStatus,places.regularOpeningHours.weekdayDescriptions,places.internationalPhoneNumber,places.websiteUri,places.photos" },
    body: JSON.stringify({ textQuery: `${lead.company} ${lead.city || ""} ${COUNTRY[lead.market] || ""}`, pageSize: 5, regionCode: lead.market }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { error: `Google Maps ${r.status} ${j?.error?.status || ""}`.trim() };
  const digits = (s: string) => String(s || "").replace(/\D/g, "").slice(-8);
  const list = j.places || [];
  const p = list.find((x: any) => digits(x.internationalPhoneNumber) && digits(x.internationalPhoneNumber) === digits(lead.phone)) || list[0];
  if (!p) return { error: "Not found on Google Maps" };
  return {
    name: p.displayName?.text, rating: p.rating ?? null, count: p.userRatingCount ?? 0, url: p.googleMapsUri, status: p.businessStatus,
    phoneMatches: digits(p.internationalPhoneNumber) === digits(lead.phone), photos: (p.photos || []).length,
    hours: p.regularOpeningHours?.weekdayDescriptions || [],
    reviews: (p.reviews || []).map((v: any) => ({ rating: v.rating, text: (v.text?.text || v.originalText?.text || "").slice(0, 600), when: v.relativePublishTimeDescription || "", at: v.publishTime || null, author: v.authorAttribution?.displayName || "Google user", lang: v.text?.languageCode || null })),
  };
}

const COMPLAINT = [
  ["Phone not answered / hard to reach", /(no one|nobody|never) (answer|pick)|not answer|didn'?t answer|can'?t reach|couldn'?t reach|hard to reach|no response|لا يرد|ما يردون|لا احد يرد/i],
  ["Long waiting time", /wait(ed|ing)? (for )?(over |more than )?\d+|long wait|waiting time|انتظار/i],
  ["Booking or appointment problems", /appointment (was )?(cancel|chang|mess)|booking (issue|problem)|couldn'?t book|no appointment|موعد/i],
  ["Price / billing complaints", /expensive|overpriced|overcharg|hidden (fee|cost)|price|غالي|الأسعار|سعر/i],
  ["Rude or unhelpful staff", /rude|unprofessional|unhelpful|bad attitude|staff (were|was) (rude|bad)|سيء|سيئ/i],
  ["Pain or treatment quality", /pain(ful)?|hurt|botched|bad result|not satisfied|worse|ألم/i],
];
const PRAISE = [
  ["Friendly staff", /friendly|kind|welcoming|caring|polite|لطيف|ودود/i],
  ["Skilled doctor", /professional|skilled|expert|best (doctor|dentist)|excellent doctor|ممتاز|محترف/i],
  ["Painless / gentle", /painless|gentle|didn'?t feel|no pain|بدون ألم/i],
  ["Clean clinic", /clean|hygien|نظيف/i],
  ["Quick service", /on time|no wait|quick|fast|سريع/i],
];
function reviewThemes(reviews: any[]) {
  const complaints: Record<string, number> = {}, praise: Record<string, number> = {};
  for (const r of reviews) {
    const t = r.text || "";
    if ((r.rating ?? 5) <= 3) for (const [k, re] of COMPLAINT) if ((re as RegExp).test(t)) complaints[k as string] = (complaints[k as string] || 0) + 1;
    if ((r.rating ?? 0) >= 4) for (const [k, re] of PRAISE) if ((re as RegExp).test(t)) praise[k as string] = (praise[k as string] || 0) + 1;
    if (/(hard|difficult) to (reach|get through)|didn'?t answer/i.test(t)) complaints["Phone not answered / hard to reach"] = (complaints["Phone not answered / hard to reach"] || 0) + (r.rating <= 3 ? 0 : 1);
  }
  const top = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { complaints: top(complaints), praise: top(praise) };
}

function ruleReport(lead: any, R: any) {
  const w = R.website, s = R.social, tr = R.tracking, m = R.maps, ps = R.pagespeed;
  const have: string[] = [], propose: string[] = [], enhance: string[] = [];
  const dental = lead.campaign === "dental", aes = lead.campaign === "aesthetic";
  const blocked = !!w.url && !w.loaded;
  if (w.loaded) have.push("Website" + (w.https ? " (HTTPS)" : ""));
  if (w.booking === "online") have.push("Online booking"); else if (w.booking === "form") have.push("Appointment request form");
  if (s.whatsapp) have.push("WhatsApp button");
  if (w.chat) have.push("Website chat");
  for (const k of ["instagram", "facebook", "tiktok", "snapchat", "youtube", "linkedin"]) if (s[k]) have.push(k[0].toUpperCase() + k.slice(1));
  if (tr.googleAds) have.push("Google Ads tag (likely advertising)");
  if (tr.metaPixel) have.push("Meta pixel (Facebook/Instagram ads)");
  if (tr.ga4 || tr.gtm) have.push("Google Analytics / Tag Manager");
  if (tr.searchConsole) have.push("Google Search Console verified");
  if (m && m.rating != null) have.push(`Google Maps ${m.rating}★ (${m.count} reviews)`);
  if (!w.url) propose.push("New website with online booking, in Arabic and English");
  if (w.loaded && w.booking !== "online") propose.push("Online booking page connected to the clinic calendar");
  propose.push(w.booking === "online" ? "AI voice receptionist for overflow and after-hours calls" : "AI voice receptionist that answers every call 24/7 and books");
  if (!s.whatsapp && !blocked) propose.push("WhatsApp Business + WhatsApp AI booking agent"); else propose.push("WhatsApp AI agent to reply and book instantly");
  if (!tr.googleAds) propose.push(`Google Search Ads for high-intent searches (${(R.keywords || []).slice(0, 2).map((k: any) => `"${k.keyword}"`).join(", ")})`);
  if (!blocked && (!s.instagram || (aes && !s.tiktok))) propose.push(aes ? "Instagram & TikTok content with before/after ads" : "Instagram content & local ads");
  if (["SA", "KW", "QA"].includes(lead.market) && !s.snapchat) propose.push("Snapchat ads");
  if (dental) propose.push("AI recall calls for 6-month check-ups and unfinished treatment");
  if (m && (m.rating == null || m.rating < 4.6 || m.count < 150)) propose.push("AI review-request agent to grow Google reviews");
  if (w.loaded) {
    if (!w.https) enhance.push("Move the website to HTTPS (browsers warn patients)");
    if (ps && !ps.error && ps.performance < 50) enhance.push(`Mobile speed is slow (${ps.performance}/100, LCP ${ps.lcp}); speed up for ads and SEO`);
    if (!w.metaDescription) enhance.push("Add meta descriptions so Google shows a proper snippet");
    if (!w.titleOk) enhance.push(`Rewrite the page title to include treatment + city (now: "${(w.title || "none").slice(0, 60)}")`);
    if (!w.h1) enhance.push("Add a clear H1 headline with the main treatment and city");
    if (!w.schema.length) enhance.push("Add MedicalClinic/Dentist schema so Google understands the clinic");
    if (!w.sitemap) enhance.push("Publish a sitemap.xml and submit it in Search Console");
    if (!tr.searchConsole) enhance.push("Set up Google Search Console to track rankings and indexing");
    if (!w.arabic && ["AE", "SA", "QA", "KW", "BH", "OM", "EG", "JO"].includes(lead.market)) enhance.push("Add Arabic pages for Arabic-speaking patients");
    if (!tr.ga4 && !tr.gtm) enhance.push("Install Google Analytics 4 / Tag Manager to measure bookings");
    if (tr.googleAds && !tr.ga4) enhance.push("Google Ads running without GA4: conversions likely not tracked");
    if (s.instagram && !tr.metaPixel) enhance.push("Instagram present but no Meta pixel: ads can't retarget site visitors");
    const missingKw = (R.keywords || []).filter((k: any) => !k.onSite).slice(0, 3).map((k: any) => k.keyword);
    if (missingKw.length) enhance.push(`Create pages for searches they don't cover: ${missingKw.join(", ")}`);
  }
  if (blocked) enhance.push(`Website returned ${w.error} to our check; open it manually before the call`);
  if (m && m.rating != null) {
    if (m.rating < 4.5) enhance.push(`Raise Google rating (${m.rating}★): reply to reviews and fix the top complaint`);
    if (m.count < 100) enhance.push(`Only ${m.count} Google reviews; competitors in ${lead.city || "the city"} often have hundreds`);
    if (typeof m.photos === "number" && m.photos < 10) enhance.push("Add more photos to the Google Maps profile");
  }
  const themes = R.reviewThemes || { complaints: [], praise: [] };
  if (themes.complaints.includes("Phone not answered / hard to reach")) propose.unshift("AI receptionist: reviews say patients can't get through on the phone");
  const lead1 = propose[0] || "AI receptionist";
  return {
    summary: `${lead.company} ${w.loaded ? "has a website" : blocked ? `has a website that blocked our automatic check (${w.error})` : "has no website listed"}${m?.rating != null ? `, ${m.rating}★ from ${m.count} Google reviews` : ""}${tr.googleAds ? ", and appears to run Google Ads" : ""}. Biggest opportunity: ${lead1.toLowerCase()}.`,
    have, propose: [...new Set(propose)].slice(0, 7), enhance: [...new Set(enhance)].slice(0, 8),
    opener: themes.complaints.includes("Phone not answered / hard to reach") ? "Some of your Google reviews mention patients struggling to get through on the phone; we fix exactly that." : `We help clinics in ${lead.city || COUNTRY[lead.market]} get more booked patients from ${w.loaded ? "the website and Google" : "Google and WhatsApp"}.`,
  };
}

async function chatgpt(lead: any, R: any, base: any) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  const model = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
  const facts = {
    clinic: { name: lead.company, type: lead.industry, city: lead.city, country: COUNTRY[lead.market] },
    website: R.website, tracking: R.tracking, social: R.social, pagespeed: R.pagespeed, keywords: R.keywords,
    google_maps: R.maps ? { rating: R.maps.rating, count: R.maps.count, photos: R.maps.photos, reviews: (R.maps.reviews || []).map((r: any) => ({ rating: r.rating, text: r.text.slice(0, 300) })) } : null,
    our_services: "Marketing: Google Search Ads, local SEO, Google Business Profile, social media content & ads (Instagram, TikTok, Snapchat), websites with online booking, Arabic landing pages, reporting. AI agents: AI voice receptionist 24/7 (Arabic/English), WhatsApp AI booking agent, website chat, recall & reactivation calls, aftercare calls, appointment reminders, review-request agent, ad lead follow-up.",
    draft: base,
  };
  const sys = "You are a sales analyst for a freelancer selling marketing services and AI agents to clinics. Use ONLY the facts given; never invent numbers, followers or ad spend. Return strict JSON with keys: summary (2-3 sentences), have (array of short strings), propose (array, max 6, most valuable first, each 'Service: why for this clinic'), enhance (array, max 7, concrete fixes to what they already have), review_insights ({praise: array, complaints: array} from the review texts, empty if none), keyword_ideas (array of 8 search phrases in English and Arabic for their city), opener (one sentence the caller can say, referencing a real finding).";
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, response_format: { type: "json_object" }, temperature: 0.3, messages: [{ role: "system", content: sys }, { role: "user", content: JSON.stringify(facts) }] }),
    });
    const j = await r.json();
    if (!r.ok) return { error: `ChatGPT ${r.status}: ${String(j?.error?.message || "").slice(0, 120)}` };
    return { ...JSON.parse(j.choices?.[0]?.message?.content || "{}"), model };
  } catch (e) { return { error: "ChatGPT: " + String(e).slice(0, 80) }; } finally { clearTimeout(t); }
}

async function scanLead(admin: any, lead: any, cheap: boolean) {
  const R: any = { scanned_at: new Date().toISOString() };
  const site = String(lead.website || "");
  const socialOnly = /instagram\.com|facebook\.com|tiktok\.com/i.test(site);
  const url = site && !socialOnly ? (/^https?:/i.test(site) ? site : "https://" + site) : "";
  const mapsP = googleMaps(lead, cheap).catch((e) => ({ error: String(e).slice(0, 80) }));
  let psP: Promise<any> = Promise.resolve(null);

  R.website = { loaded: false, url: url || null, schema: [] as string[] };
  R.tracking = {}; R.social = {};
  if (url) {
    const home = await get(url);
    if (home.ok && home.text) {
      psP = pageSpeed(home.url).catch(() => ({ error: "PageSpeed failed" }));
      const H = home.text, text = strip(H), origin = new URL(home.url).origin;
      const [robots, sm] = await Promise.all([get(origin + "/robots.txt", 6000), get(origin + "/sitemap.xml", 6000)]);
      const title = first(/<title[^>]*>([^<]{0,200})/i, H);
      const desc = first(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i, H) || first(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i, H);
      const h1 = first(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i, H).replace(/<[^>]+>/g, "").trim();
      const schema = [...H.matchAll(/"@type"\s*:\s*"([A-Za-z]+)"/g)].map((m) => m[1]);
      const cityL = (lead.city || "").toLowerCase();
      let booking = "phone_only";
      if (/calendly\.com|okadoc|vezeeta|practo|cliniko|setmore|simplybook|zocdoc|doctoruna|meddy|nabady|doctolib|dentally|book online|online booking|book now|book an appointment online|réserver|prendre rendez-vous|احجز (الآن|موعدك)|حجز موعد/i.test(H)) booking = "online";
      else if (/(book|request|make) (an )?appointment|appointment (form|request)|rendez-vous|احجز|موعد/i.test(H)) booking = "form";
      R.website = {
        loaded: true, url: home.url, https: home.url.startsWith("https://"), load_ms: home.ms,
        title, titleOk: !!title && title.length >= 15 && title.length <= 70 && (!cityL || title.toLowerCase().includes(cityL.split(" ")[0])),
        metaDescription: desc ? desc.slice(0, 200) : null, h1: h1 || null, viewport: /<meta[^>]+name=["']viewport/i.test(H),
        lang: first(/<html[^>]+lang=["']([^"']+)/i, H) || null, arabic: /hreflang=["']ar|lang=["']ar|\/ar\/|العربية/.test(H) || /[؀-ۿ]{4,}/.test(text),
        schema: [...new Set(schema)].slice(0, 8), canonical: /<link[^>]+rel=["']canonical/i.test(H), ogTags: /property=["']og:title/i.test(H),
        noindex: /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(H),
        robots: robots.ok && /user-agent/i.test(robots.text), sitemap: (sm.ok && /<urlset|<sitemapindex/i.test(sm.text)) || /sitemap:/i.test(robots.text),
        booking, chat: /tawk\.to|intercom|crisp\.chat|tidio|livechatinc|zopim|zdassets|hs-scripts|wati\.io|freshchat|drift\.com|chatbot|live chat/i.test(H),
        blog: /\/blog|\bblog\b|articles|مقالات|مدونة/i.test(H), words: text.split(" ").length,
      };
      R.tracking = {
        googleAds: /AW-\d{6,}|googleadservices\.com|google_conversion_id/i.test(H), ga4: /G-[A-Z0-9]{6,}/.test(H) && /gtag|googletagmanager/i.test(H),
        gtm: /GTM-[A-Z0-9]{4,}/.test(H), metaPixel: /fbevents\.js|fbq\(\s*['"]init/i.test(H), tiktokPixel: /analytics\.tiktok\.com/i.test(H),
        snapPixel: /sc-static\.net\/scevent|snaptr\(/i.test(H), linkedinInsight: /snap\.licdn\.com/i.test(H), hotjar: /hotjar/i.test(H),
        searchConsole: /<meta[^>]+name=["']google-site-verification/i.test(H),
      };
      R.social = socialLinks(H);
      R.keywords = keywordSet(lead.campaign, lead.city || "", lead.industry || "").map(([kw, pat]) => ({
        keyword: kw.trim(), onSite: new RegExp(pat as string, "i").test(text + " " + (title || "").toLowerCase()),
      }));
    } else {
      R.website = { loaded: false, url, error: home.status ? `HTTP ${home.status}` : "Did not load", schema: [] };
    }
  }
  if (socialOnly) { R.social = { ...(R.social || {}), [/instagram/i.test(site) ? "instagram" : /tiktok/i.test(site) ? "tiktok" : "facebook"]: site }; }
  if (!R.keywords) R.keywords = keywordSet(lead.campaign, lead.city || "", lead.industry || "").map(([kw]) => ({ keyword: String(kw).trim(), onSite: false }));
  const host = R.website.url ? new URL(R.website.url).hostname.replace(/^www\./, "") : "";
  R.links = {
    google_ads_transparency: host ? `https://adstransparency.google.com/?region=${lead.market}&domain=${host}` : `https://adstransparency.google.com/?region=${lead.market}`,
    meta_ad_library: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${lead.market}&q=${encodeURIComponent(lead.company)}`,
    google_search: `https://www.google.com/search?q=${encodeURIComponent(lead.company + " " + (lead.city || ""))}`,
  };
  const [maps, ps] = await Promise.all([mapsP, psP]);
  R.maps = maps; R.pagespeed = ps;
  R.reviewThemes = reviewThemes((maps as any)?.reviews || []);

  const base = ruleReport(lead, R);
  const ai = await chatgpt(lead, R, base);
  const useAi = ai && !ai.error && Array.isArray(ai.propose);
  const report = {
    ...R, generated_by: useAi ? `ChatGPT (${ai.model})` : "Rules", ai_error: ai?.error || null,
    summary: useAi ? ai.summary : base.summary, have: useAi && ai.have?.length ? ai.have : base.have,
    propose: useAi ? ai.propose : base.propose, enhance: useAi && ai.enhance?.length ? ai.enhance : base.enhance,
    opener: useAi && ai.opener ? ai.opener : base.opener,
    review_insights: useAi && ai.review_insights ? ai.review_insights : R.reviewThemes,
    keyword_ideas: useAi && ai.keyword_ideas?.length ? ai.keyword_ideas : R.keywords.map((k: any) => k.keyword),
  };

  const audit: Record<string, unknown> = { ...(lead.audit || {}) };
  const w = R.website, s = R.social, tr = R.tracking;
  audit.website = w.loaded ? true : (url ? null : false);
  if (w.loaded) Object.assign(audit, { booking: w.booking, chat: w.chat, arabic: w.arabic, blog: w.blog, googleAds: tr.googleAds ? true : null, analytics: !!(tr.ga4 || tr.gtm), metaPixel: !!tr.metaPixel });
  for (const k of ["instagram", "tiktok", "snapchat", "facebook", "whatsapp"]) if (w.loaded || s[k]) audit[k] = !!s[k];
  if ((maps as any)?.rating != null) { audit.gRating = (maps as any).rating; audit.gReviews = (maps as any).count; }
  audit.checkedAt = Date.now(); audit.source = "auto";
  const quality = { ...(lead.quality || {}), website_ok: !!w.loaded };
  if ((maps as any)?.status && (maps as any).status !== "OPERATIONAL") { quality.closed_on_google = true; quality.issues = [...new Set([...(quality.issues || []), "Google Maps says not operational"])]; }

  await admin.from("leads").update({ report, report_at: new Date().toISOString(), audit, quality }).eq("id", lead.id);
  return report;
}

// Reports for clinics that don't have one yet. WhatsApp-first countries and dental/aesthetic clinics first.
async function batch(admin: any, n: number) {
  const order = ["SA", "QA", "KW", "BH", "OM", "EG", "JO", "MA", "AE", "GB", "IE", "FR", "BE", "ES", "IT", "NL", "US", "CA", "DE"];
  const { data } = await admin.from("leads").select("*").is("report", null).not("status", "in", "(dnc,booked)").not("opted_out", "is", true).limit(400);
  const pick = (data || []).sort((a: any, b: any) =>
    (["dental", "aesthetic"].includes(b.campaign) ? 1 : 0) - (["dental", "aesthetic"].includes(a.campaign) ? 1 : 0) ||
    order.indexOf(a.market) - order.indexOf(b.market) || (b.website ? 1 : 0) - (a.website ? 1 : 0)).slice(0, n);
  let done = 0;
  for (let i = 0; i < pick.length; i += 4) {
    const res = await Promise.all(pick.slice(i, i + 4).map((l: any) => scanLead(admin, l, true).then(() => 1).catch(() => 0)));
    done += res.reduce((a: number, b: number) => a + b, 0);
  }
  const { count } = await admin.from("leads").select("id", { count: "exact", head: true }).is("report", null);
  return { scanned: done, remaining: count || 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: { lead_id?: string; batch?: number } = {}; try { body = await req.json(); } catch { /* */ }
  const cronKey = req.headers.get("x-cron-key");
  if (cronKey) {
    const { data } = await admin.from("settings").select("data").eq("id", "cron").maybeSingle();
    if (!data?.data?.key || data.data.key !== cronKey) return json({ error: "not_allowed" }, 403);
    const n = Math.max(1, Math.min(Number(body.batch) || 8, 16));
    const job = batch(admin, n).then(async (r) => { await admin.from("sync_runs").insert({ kind: "reports", status: "done", finished_at: new Date().toISOString(), scanned: r.scanned, note: `${r.remaining} clinics still without a report` }); });
    // @ts-ignore provided by Supabase
    EdgeRuntime.waitUntil(job);
    return json({ ok: true, batch: n });
  }
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(jwt);
  const email = u?.user?.email?.toLowerCase();
  const { data: owner } = email ? await admin.from("app_owners").select("email").ilike("email", email).maybeSingle() : { data: null };
  if (!owner) {
    const { data: tm } = await admin.from("settings").select("data").eq("id", "test_mode").maybeSingle();
    if (tm?.data?.enabled !== true) return json({ error: "not_allowed" }, 403);
  }
  const { data: lead } = await admin.from("leads").select("*").eq("id", body.lead_id ?? "").maybeSingle();
  if (!lead) return json({ error: "not_found" }, 404);
  const report = await scanLead(admin, lead, false);
  const { data: fresh } = await admin.from("leads").select("audit").eq("id", lead.id).single();
  return json({ ok: true, report, audit: fresh?.audit });
});
