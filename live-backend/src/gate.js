// The rule check every dial goes through. Returns { ok, reasons }.
// A lead: { name, phone, country, tz?, consent, registryChecked, onRegistry,
//           optedOut, declined, attempts: [{ at: ISO, answered: bool }] }
import { market } from "./markets.js";

function localParts(date, tz) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { dow, hour: Number(p.hour), day: `${p.year}-${p.month}-${p.day}` };
}

export function checkCall(lead, now = new Date()) {
  const reasons = [];
  const m = market(lead.country);
  if (!m) {
    reasons.push(String(lead.country).toUpperCase() === "AE" ? "UAE is excluded" : "Country not in the market list");
    return { ok: false, reasons };
  }
  if (lead.optedOut) reasons.push("Asked not to be called");
  if (lead.declined) reasons.push("Declined earlier");
  if (!lead.consent) reasons.push("No consent yet: send the email first, call only after a reply or request");
  if (m.registry && !lead.registryChecked) reasons.push(`Not yet checked against ${m.registry}`);
  if (lead.onRegistry && !lead.consent) reasons.push(`On ${m.registry || "do-not-call register"}`);
  if (!/^\+\d{8,15}$/.test(String(lead.phone || ""))) reasons.push("Phone must be in +country format");

  const tz = lead.tz || m.tz;
  if (!tz) {
    reasons.push("Lead needs a time zone for this country");
  } else {
    const { dow, hour, day } = localParts(now, tz);
    if (!m.days.includes(dow) || hour < m.hours[0] || hour >= m.hours[1]) {
      reasons.push(`Outside business hours in ${m.name} (${m.hours[0]}:00-${m.hours[1]}:00 local)`);
    }
    const missed = (lead.attempts || []).filter((a) => !a.answered);
    if (missed.some((a) => localParts(new Date(a.at), tz).day === day)) reasons.push("Already tried today");
    const weekAgo = now.getTime() - 7 * 864e5;
    if (missed.filter((a) => new Date(a.at).getTime() > weekAgo).length >= 2) reasons.push("2 unanswered tries this week");
  }
  return { ok: reasons.length === 0, reasons };
}
