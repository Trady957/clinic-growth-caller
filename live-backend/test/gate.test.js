import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCall } from "../src/gate.js";
import { slotsBetween } from "../src/calendar.js";
import { Crm } from "../src/crm.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = { phone: "+966501234567", country: "SA", consent: true, registryChecked: true, attempts: [] };
// Tue 18 Nov 2026, 10:00 in Riyadh (07:00 UTC)
const riyadhTue10 = new Date("2026-11-18T07:00:00Z");

test("UAE is always blocked", () => {
  const r = checkCall({ ...base, country: "AE", phone: "+971501234567" }, riyadhTue10);
  assert.equal(r.ok, false); assert.match(r.reasons[0], /UAE is excluded/);
});
test("consented Saudi lead in business hours passes", () => {
  assert.deepEqual(checkCall(base, riyadhTue10), { ok: true, reasons: [] });
});
test("no consent blocks the call", () => {
  const r = checkCall({ ...base, consent: false }, riyadhTue10);
  assert.equal(r.ok, false); assert.ok(r.reasons.some((x) => /No consent/.test(x)));
});
test("Friday in Riyadh is outside hours", () => {
  const fri = new Date("2026-11-20T07:00:00Z");
  assert.ok(checkCall(base, fri).reasons.some((x) => /Outside business hours/.test(x)));
});
test("UK needs a TPS check first", () => {
  const r = checkCall({ ...base, country: "GB", phone: "+447700900123", registryChecked: false }, new Date("2026-11-18T10:00:00Z"));
  assert.ok(r.reasons.some((x) => /TPS/.test(x)));
});
test("US lead needs its own time zone", () => {
  const r = checkCall({ ...base, country: "US", phone: "+12125550100" }, new Date("2026-11-18T15:00:00Z"));
  assert.ok(r.reasons.some((x) => /time zone/.test(x)));
  assert.equal(checkCall({ ...base, country: "US", phone: "+12125550100", tz: "America/New_York" }, new Date("2026-11-18T15:00:00Z")).ok, true);
});
test("one unanswered try today blocks a second", () => {
  const r = checkCall({ ...base, attempts: [{ at: "2026-11-18T06:30:00Z", answered: false }] }, riyadhTue10);
  assert.ok(r.reasons.includes("Already tried today"));
});
test("opt-out always blocks", () => {
  assert.ok(checkCall({ ...base, optedOut: true }, riyadhTue10).reasons.includes("Asked not to be called"));
});
test("calendar slots skip busy time and the weekend", () => {
  const from = new Date("2026-11-20T05:00:00Z"); // Fri 09:00 Dubai
  const to = new Date("2026-11-23T14:00:00Z");   // Mon 18:00 Dubai
  const busy = [[new Date("2026-11-23T06:00:00Z"), new Date("2026-11-23T07:00:00Z")]]; // Mon 10-11 Dubai
  const s = slotsBetween(from, to, busy, { minutes: 30, startHour: 10, endHour: 18, tz: "Asia/Dubai" });
  assert.ok(s.length > 0);
  assert.ok(!s.some((x) => x.startsWith("2026-11-21") || x.startsWith("2026-11-22")), "no Sat/Sun");
  assert.ok(!s.includes("2026-11-23T06:00:00.000Z") && !s.includes("2026-11-23T06:30:00.000Z"), "busy skipped");
  assert.ok(s.includes("2026-11-23T07:00:00.000Z"));
});
test("CSV import normalises phones and consent", () => {
  const crm = new Crm(join(tmpdir(), `crm-${Date.now()}.json`));
  const n = crm.importCsv('clinic,name,email,phone,country,consent\n"Smile, Riyadh",Dr Ali,a@x.com,00966 50 123 4567,sa,yes\n');
  assert.equal(n, 1);
  const l = crm.list()[0];
  assert.equal(l.phone, "+966501234567"); assert.equal(l.country, "SA"); assert.equal(l.consent, true); assert.equal(l.clinic, "Smile, Riyadh");
});
