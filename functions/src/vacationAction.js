import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getOutlookAccessToken } from "./utils/getOutlookToken.js";
import { SHARED_CAL_ID } from "./utils/getVacationCalendar.js";

async function graph(token, path, method, body) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === "DELETE") return { ok: res.ok };
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || "Graph API error");
  return json;
}

// One callable to manage vacation events on the dedicated Vacation calendar.
// action: "list" | "add" | "delete"
export const vacationAction = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");
  const { action } = request.data;

  let token;
  try {
    token = await getOutlookAccessToken();
  } catch (e) {
    throw new HttpsError("failed-precondition", e.message);
  }
  const calId = SHARED_CAL_ID;

  if (action === "list") {
    const start = new Date().toISOString().slice(0, 10);
    const endD  = new Date(); endD.setMonth(endD.getMonth() + 14);
    const end   = endD.toISOString().slice(0, 10);

    const events = [];
    let url = `/me/calendars/${calId}/calendarView?startDateTime=${start}T00:00:00&endDateTime=${end}T23:59:59&$top=250&$select=id,subject,start,end&$orderby=start/dateTime`;
    while (url) {
      const json = await graph(token, url, "GET");
      for (const e of json.value || []) {
        // Vacation events only (subject contains "vacation")
        if (!(e.subject || "").toLowerCase().includes("vacation")) continue;
        events.push({
          id: e.id,
          subject: e.subject || "",
          start: e.start?.date || e.start?.dateTime?.slice(0, 10) || "",
          end:   e.end?.date   || e.end?.dateTime?.slice(0, 10)   || "",
        });
      }
      url = json["@odata.nextLink"] ? json["@odata.nextLink"].replace("https://graph.microsoft.com/v1.0", "") : null;
    }
    return { events };
  }

  if (action === "add") {
    const { personName, startDate, endDate } = request.data;
    if (!personName || !startDate) throw new HttpsError("invalid-argument", "personName and startDate required.");
    const endD = new Date(endDate || startDate);
    endD.setDate(endD.getDate() + 1); // Graph all-day end is exclusive
    const endExclusive = endD.toISOString().slice(0, 10);
    const created = await graph(token, `/me/calendars/${calId}/events`, "POST", {
      subject: `Vacation - ${personName}`,
      start: { dateTime: `${startDate}T00:00:00`, timeZone: "America/Toronto" },
      end:   { dateTime: `${endExclusive}T00:00:00`, timeZone: "America/Toronto" },
      isAllDay: true,
    });
    return { id: created?.id || null };
  }

  if (action === "edit") {
    const { eventId, startDate, endDate } = request.data;
    if (!eventId || !startDate) throw new HttpsError("invalid-argument", "eventId and startDate required.");
    const endD = new Date(endDate || startDate);
    endD.setDate(endD.getDate() + 1); // Graph all-day end is exclusive
    const endExclusive = endD.toISOString().slice(0, 10);
    await graph(token, `/me/calendars/${calId}/events/${eventId}`, "PATCH", {
      start: { dateTime: `${startDate}T00:00:00`, timeZone: "America/Toronto" },
      end:   { dateTime: `${endExclusive}T00:00:00`, timeZone: "America/Toronto" },
      isAllDay: true,
    });
    return { ok: true };
  }

  if (action === "delete") {
    const { eventId } = request.data;
    if (!eventId) throw new HttpsError("invalid-argument", "eventId required.");
    const r = await graph(token, `/me/calendars/${calId}/events/${eventId}`, "DELETE");
    if (!r.ok) await graph(token, `/me/events/${eventId}`, "DELETE").catch(() => {});
    return { ok: true };
  }

  throw new HttpsError("invalid-argument", "Unknown action.");
});
