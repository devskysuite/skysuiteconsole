import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getOutlookAccessToken } from "./utils/getOutlookToken.js";
import { getVacationCalendarId } from "./utils/getVacationCalendar.js";
import { db } from "./utils/firestore.js";

async function graph(token, path, method, body) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === "DELETE") return res.ok;
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || "Graph API error");
  return json;
}

// Creates or removes an Outlook vacation event to match a request's status.
// Idempotent — safe to call repeatedly. Called from the approve/deny handlers.
export const syncVacationEvent = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

  const { requestId, remove } = request.data;
  if (!requestId) throw new HttpsError("invalid-argument", "requestId required.");

  const ref  = db.collection("timeOffRequests").doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Request not found.");
  const r = snap.data();

  let token, vacCalId;
  try {
    token = await getOutlookAccessToken();
    vacCalId = await getVacationCalendarId(token);
  } catch (e) {
    throw new HttpsError("failed-precondition", e.message);
  }

  // Forced removal (e.g. request is being deleted) → delete event regardless of status
  if (remove) {
    if (r.calendarEventId) {
      await graph(token, `/me/calendars/${vacCalId}/events/${r.calendarEventId}`, "DELETE").catch(() => {});
      await ref.update({ calendarEventId: null }).catch(() => {});
    }
    return { action: "removed" };
  }

  // APPROVED → ensure event exists on the Vacation calendar
  if (r.status === "APPROVED" && !r.calendarEventId && r.startDate) {
    const name = r.employeeName || "Employee";
    const endD = new Date(r.endDate || r.startDate);
    endD.setDate(endD.getDate() + 1); // Graph all-day end is exclusive
    const endDate = endD.toISOString().slice(0, 10);

    const created = await graph(token, `/me/calendars/${vacCalId}/events`, "POST", {
      subject: `${name} Vacation`,
      start: { dateTime: `${r.startDate}T00:00:00`, timeZone: "America/Toronto" },
      end:   { dateTime: `${endDate}T00:00:00`,     timeZone: "America/Toronto" },
      isAllDay: true,
    });
    if (created?.id) await ref.update({ calendarEventId: created.id });
    return { action: "created", eventId: created?.id || null };
  }

  // Not APPROVED → remove any existing event
  if (r.status !== "APPROVED" && r.calendarEventId) {
    await graph(token, `/me/calendars/${vacCalId}/events/${r.calendarEventId}`, "DELETE").catch(() => {});
    await ref.update({ calendarEventId: null });
    return { action: "deleted" };
  }

  return { action: "none" };
});
