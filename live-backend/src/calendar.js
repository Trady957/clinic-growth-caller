// Books demo meetings on Maha's Google Calendar with the Calendar REST API.
// Auth: an OAuth refresh token for maha.lasfar.2015@gmail.com (see README).
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL = "https://www.googleapis.com/calendar/v3";

export class Calendar {
  constructor({ clientId, clientSecret, refreshToken, calendarId, ownerTz = "Asia/Dubai" }) {
    Object.assign(this, { clientId, clientSecret, refreshToken, calendarId, ownerTz });
    this.token = null; this.exp = 0;
  }
  async auth() {
    if (this.token && Date.now() < this.exp - 60e3) return this.token;
    const res = await fetch(TOKEN_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, refresh_token: this.refreshToken, grant_type: "refresh_token" }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error("Google auth failed: " + JSON.stringify(j));
    this.token = j.access_token; this.exp = Date.now() + j.expires_in * 1000;
    return this.token;
  }
  async call(path, init = {}) {
    const res = await fetch(CAL + path, { ...init, headers: { Authorization: "Bearer " + (await this.auth()), "Content-Type": "application/json", ...(init.headers || {}) } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Calendar ${res.status}: ${JSON.stringify(j)}`);
    return j;
  }
  // Free 30-minute slots in Maha's working hours (Dubai time), next `days` days.
  async freeSlots({ days = 5, minutes = 30, startHour = 10, endHour = 18 } = {}) {
    const from = new Date(), to = new Date(Date.now() + days * 864e5);
    const fb = await this.call("/freeBusy", { method: "POST", body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: this.calendarId }] }) });
    const busy = (fb.calendars?.[this.calendarId]?.busy || []).map((b) => [new Date(b.start), new Date(b.end)]);
    return slotsBetween(from, to, busy, { minutes, startHour, endHour, tz: this.ownerTz }).slice(0, 6);
  }
  async book({ start, minutes = 30, clinic, attendeeName, attendeeEmail, attendeeTz, phone, notes }) {
    const s = new Date(start), e = new Date(s.getTime() + minutes * 60e3);
    const ev = {
      summary: `Mizan AI demo · ${clinic}`,
      description: [`Attendee: ${attendeeName}${attendeeEmail ? " <" + attendeeEmail + ">" : ""}`, phone ? `Phone: ${phone}` : "", attendeeTz ? `Their time zone: ${attendeeTz}` : "", "Booked by the Mizan AI caller (AI assistant).", notes || ""].filter(Boolean).join("\n"),
      start: { dateTime: s.toISOString() }, end: { dateTime: e.toISOString() },
      attendees: attendeeEmail ? [{ email: attendeeEmail, displayName: attendeeName }] : [],
      conferenceData: { createRequest: { requestId: "mz-" + s.getTime(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
      reminders: { useDefault: true },
    };
    return this.call(`/calendars/${encodeURIComponent(this.calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`, { method: "POST", body: JSON.stringify(ev) });
  }
}

// Exported for tests: step through the window in `minutes` steps, skipping busy blocks,
// Saturdays and Sundays (the UAE weekend) in the owner's time zone, and hours outside startHour..endHour.
export function slotsBetween(from, to, busy, { minutes, startHour, endHour, tz }) {
  const out = []; const step = minutes * 60e3;
  let t = Math.ceil(from.getTime() / step) * step;
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
  for (; t + step <= to.getTime(); t += step) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const h = Number(p.hour) + Number(p.minute) / 60;
    if (p.weekday === "Sat" || p.weekday === "Sun") continue;
    if (h < startHour || h + minutes / 60 > endHour) continue;
    const s = t, e = t + step;
    if (busy.some(([b0, b1]) => s < b1.getTime() && e > b0.getTime())) continue;
    out.push(new Date(t).toISOString());
  }
  return out;
}
