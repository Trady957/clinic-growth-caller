// Calling rules per market, shared by start-call and batch-call (copied into each function as markets.ts).
// Keep in step with MARKETS in index.html. Times use real IANA time zones, so daylight saving is handled.

export type Market = {
  name: string; tz: string; start: number; end: number; weekend: number[];
  excluded?: boolean; consent?: boolean; nanp?: boolean; tzs?: [number, string][];
};

// Morning rule: outreach starts at 9:30 local time on working days, in each clinic's own time zone.
const GULF = { start: 9.5, end: 18, weekend: [5, 6] };
const WEST = { start: 9.5, end: 17, weekend: [0, 6] };

export const MARKETS: Record<string, Market> = {
  AE: { name: "United Arab Emirates", tz: "Asia/Dubai", start: 9.5, end: 18, weekend: [0, 6], excluded: true },
  SA: { name: "Saudi Arabia", tz: "Asia/Riyadh", ...GULF },
  QA: { name: "Qatar", tz: "Asia/Qatar", ...GULF },
  KW: { name: "Kuwait", tz: "Asia/Kuwait", ...GULF },
  BH: { name: "Bahrain", tz: "Asia/Bahrain", ...GULF },
  OM: { name: "Oman", tz: "Asia/Muscat", ...GULF },
  EG: { name: "Egypt", tz: "Africa/Cairo", ...GULF },
  JO: { name: "Jordan", tz: "Asia/Amman", ...GULF },
  MA: { name: "Morocco", tz: "Africa/Casablanca", start: 9.5, end: 18, weekend: [0, 6] },
  GB: { name: "United Kingdom", tz: "Europe/London", ...WEST, consent: true },
  IE: { name: "Ireland", tz: "Europe/Dublin", ...WEST, consent: true },
  FR: { name: "France", tz: "Europe/Paris", ...WEST, consent: true },
  BE: { name: "Belgium", tz: "Europe/Brussels", ...WEST, consent: true },
  DE: { name: "Germany", tz: "Europe/Berlin", ...WEST, consent: true },
  ES: { name: "Spain", tz: "Europe/Madrid", ...WEST, consent: true },
  IT: { name: "Italy", tz: "Europe/Rome", ...WEST, consent: true },
  NL: { name: "Netherlands", tz: "Europe/Amsterdam", ...WEST, consent: true },
  US: { name: "United States", tz: "America/New_York", ...WEST, nanp: true,
        tzs: [[-87, "America/New_York"], [-102, "America/Chicago"], [-115, "America/Denver"], [-180, "America/Los_Angeles"]] },
  CA: { name: "Canada", tz: "America/Toronto", ...WEST, nanp: true,
        tzs: [[-66, "America/Halifax"], [-90, "America/Toronto"], [-102, "America/Winnipeg"], [-120, "America/Edmonton"], [-180, "America/Vancouver"]] },
};

export const DAY = 86400000;
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The clinic's own time zone (US/Canada pick one by longitude). */
export function leadTz(lead: { market?: string; lon?: number | null }): string {
  const M = MARKETS[lead.market || ""];
  if (!M) return "UTC";
  if (M.tzs && typeof lead.lon === "number") for (const [minLon, tz] of M.tzs) if (lead.lon >= minLon) return tz;
  return M.tz;
}

/** Wall-clock parts in a time zone. */
export function local(ms: number, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, m: +p.minute, dow };
}

/** UTC offset of a time zone at an instant, in minutes. */
export function offsetMin(tz: string, ms: number) {
  const l = local(ms, tz);
  return Math.round((Date.UTC(l.y, l.mo - 1, l.d, l.h, l.m) - Math.floor(ms / 60000) * 60000) / 60000);
}

/** A local wall-clock time in tz as a UTC ms instant. */
export function zoned(y: number, mo: number, d: number, h: number, m: number, tz: string) {
  const guess = Date.UTC(y, mo - 1, d, h, m);
  return guess - offsetMin(tz, guess - offsetMin(tz, guess) * 60000) * 60000;
}

export function isoWithOffset(ms: number, tz: string) {
  const l = local(ms, tz), off = offsetMin(tz, ms), s = off < 0 ? "-" : "+", a = Math.abs(off);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${l.y}-${p(l.mo)}-${p(l.d)}T${p(l.h)}:${p(l.m)}:00${s}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

/** Four meeting options over the next working days in the clinic's time zone, with exact ISO times. */
export function slots(now: number, mk: string, tz: string) {
  const M = MARKETS[mk] ?? MARKETS.SA, times = [[10, 0], [11, 30], [13, 0], [16, 0]];
  const out: { label: string; iso: string }[] = [];
  for (let i = 1; out.length < 4 && i < 15; i++) {
    const t = local(now + i * DAY, tz);
    if (M.weekend.includes(t.dow)) continue;
    const [hh, mm] = times[(out.length + i) % times.length];
    const at = zoned(t.y, t.mo, t.d, hh, mm, tz), l = local(at, tz);
    const h12 = hh > 12 ? hh - 12 : hh, ap = hh >= 12 ? "pm" : "am";
    const month = new Date(Date.UTC(l.y, l.mo - 1, l.d)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
    out.push({ label: `${WD[l.dow]} ${l.d} ${month} at ${h12}${mm ? ":" + String(mm).padStart(2, "0") : ""}${ap}`, iso: isoWithOffset(at, tz) });
  }
  return out;
}

export function tzLabel(tz: string) {
  const off = offsetMin(tz, Date.now()) / 60;
  const city = tz.split("/").pop()!.replace(/_/g, " ");
  return `${city} time (UTC${off >= 0 ? "+" : ""}${off})`;
}

/** Rules that stop a real call. Empty list = cleared. `recent` = this lead's real calls in the last 7 days. */
export function callBlocks(lead: any, now: number, recent: any[]): string[] {
  const M = MARKETS[lead.market];
  const fails: string[] = [];
  if (!M) return ["Market not set up for calling"];
  if (M.excluded) fails.push(`${M.name} is excluded: not called`);
  if (M.consent && !lead.consent) fails.push(`Email first: AI calls in ${M.name} need the clinic's consent`);
  if (M.nanp && !lead.consent) {
    const a = lead.audit || {};
    if (a.lineType !== "landline") fails.push("Business landline not confirmed (mobiles can't get AI calls)");
    if (!a.dncCheckedAt || a.onDnc || now - a.dncCheckedAt >= 31 * DAY) fails.push("Do Not Call check missing, failed or older than 31 days");
  }
  if (lead.opted_out || lead.status === "dnc") fails.push("Asked not to be called");
  if (lead.dncr && !lead.consent) fails.push("On Do Not Call Register");
  if (lead.status === "booked") fails.push("Meeting already booked");
  if ((lead.declined || []).includes(lead.campaign)) fails.push("Declined this campaign");
  if (!/^\+\d{8,15}$/.test(String(lead.phone || ""))) fails.push("Number failed the format check");
  if (lead.quality?.phone_valid === false) fails.push("Number failed the format check");
  if (lead.quality?.stale || lead.quality?.closed_on_google) fails.push("No longer on the map, check it's open");
  const tz = leadTz(lead), t = local(now, tz), mins = t.h * 60 + t.m;
  if (M.weekend.includes(t.dow)) fails.push(`Weekend in ${M.name}`);
  if (mins < M.start * 60 || mins >= M.end * 60 - 15) fails.push(`Outside calling hours in ${M.name}`);
  const dayStart = now - mins * 60000;
  if (recent.some((c) => ["initiated", "in_progress"].includes(c.status) && Date.parse(c.created_at) > now - 15 * 60000)) fails.push("A call is already in progress");
  if (recent.some((c) => Date.parse(c.created_at) >= dayStart)) fails.push("Already called today");
  if (recent.filter((c) => c.answered === false).length >= 2) fails.push("Two unanswered calls this week");
  return [...new Set(fails)];
}

/** Dynamic variables every call gets. */
export function callVars(lead: any, P: Record<string, string>, now: number, positioning: string) {
  const M = MARKETS[lead.market] ?? MARKETS.SA, tz = leadTz(lead), s = slots(now, lead.market, tz);
  return {
    agent_name: P.agent_name || "Noor",
    freelancer_name: P.freelancer_name || "Maha",
    business_name: P.business_name || "Mizan AI Agents",
    freelancer_proof: P.freelancer_proof || "",
    freelancer_pricing: P.freelancer_pricing || "",
    freelancer_phone: P.freelancer_phone || "",
    freelancer_email: P.freelancer_email || "",
    meeting_slots: s.map((x) => x.label).join("; "),
    meeting_slots_iso: s.map((x) => `${x.label} = ${x.iso}`).join("; "),
    today_local: isoWithOffset(now, tz).slice(0, 10),
    time_of_day: local(now, tz).h < 12 ? "morning" : "afternoon",
    lead_name: lead.name && !/^(clinic manager|reception)$/i.test(lead.name) ? lead.name : "the clinic manager",
    lead_role: lead.role || "clinic manager",
    lead_company: lead.company,
    lead_industry: lead.industry || "clinic",
    lead_city: lead.city || "",
    lead_country: M.name,
    lead_timezone: tzLabel(tz),
    lead_tz: tz,
    lead_context: String(lead.context || "").slice(0, 600),
    lead_positioning: positioning.slice(0, 900),
  };
}
