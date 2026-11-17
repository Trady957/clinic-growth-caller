// A small file-backed CRM: leads, pipeline stage, call log. Swap for HubSpot
// or a Google Sheet later; the server only uses these functions.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const STAGES = ["new", "emailed", "replied", "call_booked", "called", "meeting_booked", "proposal", "won", "lost", "do_not_contact"];

export class Crm {
  constructor(file) {
    this.file = file;
    this.data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { leads: [] };
  }
  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
  list(filter = {}) {
    return this.data.leads.filter((l) => Object.entries(filter).every(([k, v]) => v === undefined || l[k] === v));
  }
  get(id) { return this.data.leads.find((l) => l.id === id); }
  findByPhone(phone) { return this.data.leads.find((l) => l.phone === phone); }
  upsert(lead) {
    const existing = (lead.id && this.get(lead.id)) || (lead.phone && this.findByPhone(lead.phone));
    if (existing) { Object.assign(existing, lead, { id: existing.id }); this.save(); return existing; }
    const l = { id: randomUUID(), stage: "new", consent: false, registryChecked: false, attempts: [], notes: [], createdAt: new Date().toISOString(), ...lead };
    this.data.leads.push(l); this.save(); return l;
  }
  setStage(id, stage, note) {
    if (!STAGES.includes(stage)) throw new Error("Unknown stage " + stage);
    const l = this.get(id); if (!l) throw new Error("No lead " + id);
    l.stage = stage;
    if (stage === "do_not_contact") l.optedOut = true;
    if (note) l.notes.push({ at: new Date().toISOString(), text: note });
    this.save(); return l;
  }
  logAttempt(id, answered, summary) {
    const l = this.get(id); if (!l) throw new Error("No lead " + id);
    l.attempts.push({ at: new Date().toISOString(), answered: !!answered, summary: summary || "" });
    this.save(); return l;
  }
  importCsv(text) {
    const [head, ...rows] = parseCsv(text);
    const keys = head.map((h) => h.trim().toLowerCase());
    let n = 0;
    for (const r of rows) {
      if (!r.some((c) => c.trim())) continue;
      const o = Object.fromEntries(keys.map((k, i) => [k, (r[i] || "").trim()]));
      if ((o.country || "").toUpperCase() === "AE") continue; // UAE excluded
      this.upsert({
        clinic: o.clinic || o.company || "", name: o.name || o.contact || "", role: o.role || o.title || "",
        email: o.email || "", phone: normPhone(o.phone), country: (o.country || "").toUpperCase(),
        tz: o.tz || undefined, source: o.source || "import",
        consent: /^(yes|true|1)$/i.test(o.consent || ""), registryChecked: /^(yes|true|1)$/i.test(o.registry_checked || ""),
      });
      n++;
    }
    return n;
  }
  exportCsv() {
    const cols = ["id", "clinic", "name", "role", "email", "phone", "country", "stage", "consent", "meetingAt"];
    return [cols.join(","), ...this.data.leads.map((l) => cols.map((c) => csvCell(l[c])).join(","))].join("\n");
  }
}

export function normPhone(p) {
  const s = String(p || "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("00")) return "+" + s.slice(2);
  return s; // leave as-is; the gate rejects numbers without a country code
}
function csvCell(v) { const s = v === undefined || v === null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
