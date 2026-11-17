// Phone number checks for every market. Gulf countries keep the hand-tuned patterns that were already
// working; every other country uses Google's libphonenumber metadata.
import { getCountryCallingCode, parsePhoneNumberFromString } from "npm:libphonenumber-js@1.12.10/max";

const GULF_CC: Record<string, string> = { AE: "971", SA: "966", QA: "974", KW: "965", BH: "973", OM: "968" };
const TRUNK0: Record<string, boolean> = { AE: true, SA: true, QA: false, KW: false, BH: false, OM: false };
const NSN: Record<string, { ok: RegExp; mobile: RegExp; toll?: RegExp }> = {
  AE: { ok: /^(5[024568]\d{7}|[234679]\d{7}|800\d{2,9}|600\d{6})$/, mobile: /^5/, toll: /^(800|600)/ },
  SA: { ok: /^(5\d{8}|1[1-7]\d{7}|920\d{6}|800\d{7})$/, mobile: /^5/, toll: /^(920|800)/ },
  QA: { ok: /^([3567]\d{7}|4\d{7}|800\d{4})$/, mobile: /^[3567]/, toll: /^800/ },
  KW: { ok: /^([569]\d{7}|2\d{7}|18\d{5,6})$/, mobile: /^[569]/, toll: /^18/ },
  BH: { ok: /^([367]\d{7}|1[367]\d{6}|8000\d{4})$/, mobile: /^[36]/, toll: /^8000/ },
  OM: { ok: /^([79]\d{7}|2[2-6]\d{6}|800\d{5})$/, mobile: /^[79]/, toll: /^800/ },
};

export type Phone = { phone?: string; type?: string; issue?: string };

/** E.164 number and its type: mobile | landline | hotline | landline_or_mobile (US/Canada can't be told apart). */
export function normPhone(raw: string, mk: string): Phone {
  let s = String(raw || "").trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
  if (!s) return { issue: "no_phone" };
  s = s.replace(/[^\d+]/g, ""); if (s.startsWith("00")) s = "+" + s.slice(2);
  if (GULF_CC[mk]) {
    const cc = GULF_CC[mk]; let nsn = "";
    if (s.startsWith("+")) { if (!s.startsWith("+" + cc)) return { issue: "foreign_number" }; nsn = s.slice(1 + cc.length); }
    else if (s.startsWith(cc) && s.length > cc.length + 6) nsn = s.slice(cc.length);
    else if (TRUNK0[mk] && s.startsWith("0")) nsn = s.slice(1); else nsn = s;
    if (nsn.startsWith("0")) nsn = nsn.slice(1);
    const P = NSN[mk]; if (!P.ok.test(nsn)) return { issue: "invalid_number" };
    return { phone: "+" + cc + nsn, type: P.toll?.test(nsn) ? "hotline" : P.mobile.test(nsn) ? "mobile" : "landline" };
  }
  let p;
  try { p = parsePhoneNumberFromString(s, mk as any); } catch { p = undefined; }
  if (!p || !p.isValid()) return { issue: "invalid_number" };
  let cc = ""; try { cc = getCountryCallingCode(mk as any); } catch { /* unknown market */ }
  if (cc && p.countryCallingCode !== cc) return { issue: "foreign_number" };
  const t = p.getType();
  const type = ["TOLL_FREE", "SHARED_COST", "PREMIUM_RATE", "UAN", "VOIP"].includes(String(t)) ? "hotline"
    : t === "MOBILE" ? "mobile" : t === "FIXED_LINE_OR_MOBILE" ? "landline_or_mobile" : "landline";
  return { phone: p.number, type };
}
