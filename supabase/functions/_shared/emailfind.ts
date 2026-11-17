// Finds a clinic's contact email in its web pages.
// ---------- email finding ----------
export const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(example|sentry|wixpress|sentry-next|domain|email|yourdomain|yoursite|yourcompany|company|mysite|website|site|footer|header|test|sample|godaddy|wordpress)\.(com|net|org)$|@(example|sentry|wixpress|sentry-next|yourdomain|godaddy|wordpress)\.|^(noreply|no-reply|donotreply|webmaster|postmaster|abuse|privacy|gdpr|dpo|jobs|careers|hr|recruitment|billing|accounts?)@/i;
export function emailsIn(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) out.add(decodeURIComponent(m[1]).toLowerCase());
  for (const m of html.replace(/&#64;|\[at\]|\(at\)/gi, "@").matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi)) out.add(m[0].toLowerCase());
  return [...out].map((e) => e.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")).filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !BAD_EMAIL.test(e));
}
export function bestEmail(list: string[], site: string): string | null {
  if (!list.length) return null;
  let host = ""; try { host = new URL(site).hostname.replace(/^www\./, ""); } catch { /* */ }
  const score = (e: string) => {
    const [user, dom] = e.split("@");
    let s = 0;
    if (host && (dom === host || host.endsWith("." + dom) || dom.endsWith("." + host))) s += 10;
    if (/^(info|contact|hello|reception|appointments?|booking|admin|clinic|enquir(y|ies)|office|manager|frontdesk|bonjour|contacto|rdv)/.test(user)) s += 5;
    if (/gmail|hotmail|outlook|yahoo|icloud/.test(dom)) s += 1;
    return s;
  };
  return [...list].sort((a, b) => score(b) - score(a))[0];
}
export function contactLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const h = m[1];
    if (!/contact|kontakt|nous-contacter|contactez|اتصل|تواصل|about|location|book|appointment|rendez/i.test(h)) continue;
    try { const u = new URL(h, base); if (u.hostname === new URL(base).hostname) out.add(u.toString()); } catch { /* */ }
    if (out.size >= 2) break;
  }
  return [...out];
}

