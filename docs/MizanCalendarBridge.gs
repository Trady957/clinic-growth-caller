/**
 * Mizan AI Agents – Calendar bridge (Google Apps Script)
 *
 * Lets the AI caller book confirmed meetings straight into YOUR Google Calendar.
 * It runs under your own Google account, so no Google Cloud project or API keys are needed.
 *
 * Setup (about 3 minutes, signed in as maha.lasfar.2015@gmail.com):
 *  1. Go to https://script.google.com → New project. Name it "Mizan Calendar Bridge".
 *  2. Delete what's there, paste this whole file, press Save.
 *  3. Run → choose "testBridge" → Run. Google asks for permission: Review permissions →
 *     your account → Advanced → Go to Mizan Calendar Bridge → Allow. A test event appears
 *     in your calendar for tomorrow and is deleted again; the log says "Bridge works".
 *  4. Deploy → New deployment → gear icon → Web app.
 *     Execute as: Me.  Who has access: Anyone.  → Deploy.
 *  5. Copy the Web app URL (ends in /exec) and send it to Claude.
 *
 * "Anyone" only means the URL can be called; every request must carry the secret KEY below,
 * and the script can only create, check or cancel events in your calendar.
 */

const KEY = "__PASTE_KEY__";          // shared secret, also saved in Supabase (settings row "gcal")
const CALENDAR_ID = "primary";        // your main calendar
// Times arrive as exact UTC instants; Google shows them in your own time zone.

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: "bad json" }); }
  if (!body || body.key !== KEY) return out({ ok: false, error: "bad key" });
  try {
    if (body.action === "create") return out(createMeeting(body));
    if (body.action === "busy") return out(busy(body));
    if (body.action === "cancel") return out(cancel(body));
    if (body.action === "ping") return out({ ok: true, calendar: CalendarApp.getDefaultCalendar().getId() });
    return out({ ok: false, error: "unknown action" });
  } catch (err) {
    return out({ ok: false, error: String(err).slice(0, 200) });
  }
}

function createMeeting(b) {
  const start = new Date(b.start), end = new Date(b.end || (start.getTime() + 30 * 60000));
  if (isNaN(start) || isNaN(end) || end <= start) return { ok: false, error: "bad time" };
  const cal = CALENDAR_ID === "primary" ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(CALENDAR_ID);
  const clash = cal.getEvents(start, end).filter(function (ev) { return !ev.isAllDayEvent(); });
  const guests = (b.guests || []).filter(function (g) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g); });

  // Advanced Calendar service gives a Google Meet link; fall back to a plain event if it's not enabled.
  if (b.meet !== false && typeof Calendar !== "undefined") {
    const ev = Calendar.Events.insert({
      summary: b.title, description: b.description || "", location: b.location || "",
      start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() },
      attendees: guests.map(function (g) { return { email: g }; }),
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }, { method: "email", minutes: 24 * 60 }] },
      conferenceData: { createRequest: { requestId: Utilities.getUuid(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
    }, CALENDAR_ID, { conferenceDataVersion: 1, sendUpdates: b.send_invites && guests.length ? "all" : "none" });
    return { ok: true, id: ev.id, link: ev.htmlLink, meet: ev.hangoutLink || null, conflict: clash.length > 0 };
  }
  const ev = cal.createEvent(b.title, start, end, {
    description: b.description || "", location: b.location || "",
    guests: guests.join(","), sendInvites: !!(b.send_invites && guests.length),
  });
  ev.addPopupReminder(30);
  return { ok: true, id: ev.getId(), link: "https://www.google.com/calendar/event?eid=" + Utilities.base64EncodeWebSafe(ev.getId().split("@")[0] + " " + cal.getId()).replace(/=+$/, ""), meet: null, conflict: clash.length > 0 };
}

function busy(b) {
  const cal = CalendarApp.getDefaultCalendar();
  return { ok: true, busy: cal.getEvents(new Date(b.from), new Date(b.to)).filter(function (e) { return !e.isAllDayEvent(); })
    .map(function (e) { return { start: e.getStartTime().toISOString(), end: e.getEndTime().toISOString() }; }) };
}

function cancel(b) {
  const ev = CalendarApp.getDefaultCalendar().getEventById(b.id);
  if (!ev) return { ok: false, error: "not found" };
  ev.deleteEvent();
  return { ok: true };
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** Run this once from the editor to grant permission and check it works. */
function testBridge() {
  const t = new Date(Date.now() + 24 * 3600000); t.setMinutes(0, 0, 0);
  const r = createMeeting({ title: "[TEST] Mizan bridge check", start: t.toISOString(), end: new Date(t.getTime() + 15 * 60000).toISOString(), guests: [], meet: false });
  Logger.log(JSON.stringify(r));
  if (r.ok) { CalendarApp.getDefaultCalendar().getEventById(r.id).deleteEvent(); Logger.log("Bridge works. Now deploy it as a web app (step 4)."); }
}
