// Markets the Growth Caller may work. The UAE is excluded on purpose.
//
// Policy that applies everywhere (stricter than some local laws, on purpose):
//   - First contact is email or LinkedIn, never an AI cold call.
//   - The AI voice only calls a lead who replied, asked for a call, or booked
//     a demo ("consent"). In the US and Canada AI-generated voice calls need
//     prior express consent under the TCPA (FCC ruling, Feb 2024).
//   - Calls only inside the lead's local business hours, on weekdays of that
//     country, at most 1 attempt a day and 2 a week if unanswered.
//   - The caller says it is an AI, that the call is recorded, and asks
//     whether it's a good time before anything else.
//   - Registry checks: where a national do-not-call register exists, the lead
//     must carry registryChecked=true before dialling.
//
// This table is a starting point, not legal advice. Confirm each country with
// a local adviser before scaling.

const SUN_THU = [0, 1, 2, 3, 4];   // Sunday..Thursday
const MON_FRI = [1, 2, 3, 4, 5];   // Monday..Friday

export const EXCLUDED = new Set(["AE"]);

export const MARKETS = {
  // Gulf (not UAE)
  SA: { name: "Saudi Arabia", tz: "Asia/Riyadh", days: SUN_THU, hours: [9, 17], langs: ["ar", "en"], registry: null },
  QA: { name: "Qatar", tz: "Asia/Qatar", days: SUN_THU, hours: [9, 17], langs: ["ar", "en"], registry: null },
  KW: { name: "Kuwait", tz: "Asia/Kuwait", days: SUN_THU, hours: [9, 17], langs: ["ar", "en"], registry: null },
  BH: { name: "Bahrain", tz: "Asia/Bahrain", days: SUN_THU, hours: [9, 17], langs: ["ar", "en"], registry: null },
  OM: { name: "Oman", tz: "Asia/Muscat", days: SUN_THU, hours: [9, 17], langs: ["ar", "en"], registry: null },
  // Arabic and French speaking
  EG: { name: "Egypt", tz: "Africa/Cairo", days: SUN_THU, hours: [10, 17], langs: ["ar", "en"], registry: null },
  JO: { name: "Jordan", tz: "Asia/Amman", days: SUN_THU, hours: [9, 17], langs: ["ar", "en"], registry: null },
  MA: { name: "Morocco", tz: "Africa/Casablanca", days: MON_FRI, hours: [9, 17], langs: ["fr", "ar"], registry: null },
  // UK and Europe
  GB: { name: "United Kingdom", tz: "Europe/London", days: MON_FRI, hours: [9, 17], langs: ["en"], registry: "TPS/CTPS" },
  IE: { name: "Ireland", tz: "Europe/Dublin", days: MON_FRI, hours: [9, 17], langs: ["en"], registry: "NDD" },
  FR: { name: "France", tz: "Europe/Paris", days: MON_FRI, hours: [10, 17], langs: ["fr"], registry: "Bloctel" },
  DE: { name: "Germany", tz: "Europe/Berlin", days: MON_FRI, hours: [9, 17], langs: ["de", "en"], registry: null, note: "Cold B2B calls need presumed consent; email first." },
  ES: { name: "Spain", tz: "Europe/Madrid", days: MON_FRI, hours: [9, 17], langs: ["es", "en"], registry: "Lista Robinson" },
  IT: { name: "Italy", tz: "Europe/Rome", days: MON_FRI, hours: [9, 17], langs: ["it", "en"], registry: "RPO" },
  NL: { name: "Netherlands", tz: "Europe/Amsterdam", days: MON_FRI, hours: [9, 17], langs: ["nl", "en"], registry: null },
  BE: { name: "Belgium", tz: "Europe/Brussels", days: MON_FRI, hours: [9, 17], langs: ["fr", "nl", "en"], registry: "Do Not Call Me" },
  // North America
  US: { name: "United States", tz: null, days: MON_FRI, hours: [9, 17], langs: ["en", "es"], registry: "National DNC", consentRequired: "prior express consent (TCPA, AI voice)" },
  CA: { name: "Canada", tz: null, days: MON_FRI, hours: [9, 17], langs: ["en", "fr"], registry: "National DNCL", consentRequired: "prior express consent" },
};

export function market(code) {
  const c = String(code || "").toUpperCase();
  if (EXCLUDED.has(c)) return null;
  return MARKETS[c] || null;
}
