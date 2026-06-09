import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getOutlookAccessToken } from "./utils/getOutlookToken.js";
import { getVacationCalendarId } from "./utils/getVacationCalendar.js";

// The legacy on-call calendar — vacations historically lived here too (sorted by subject)
const ONCALL_CAL_ID = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";

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

  let token, calId;
  try {
    token = await getOutlookAccessToken();
    calId = await getVacationCalendarId(token);
  } catch (e) {
    throw new HttpsError("failed-precondition", e.message);
  }
  if (!calId) throw new HttpsError("failed-precondition", "No Vacation calendar found.");

  if (action === "list") {
    const start = new Date().toISOString().slice(0, 10);
    const endD  = new Date(); endD.setMonth(endD.getMonth() + 14);
    const end   = endD.toISOString().slice(0, 10);

    async function fetchCal(cid, vacationOnly) {
      const out = [];
      let url = `/me/calendars/${cid}/calendarView?startDateTime=${start}T00:00:00&endDateTime=${end}T23:59:59&$top=250&$select=id,subject,start,end&$orderby=start/dateTime`;
      while (url) {
        const json = await graph(token, url, "GET");
        for (const e of json.value || []) {
          if (vacationOnly && !(e.subject || "").toLowerCase().includes("vacation")) continue;
          out.push({
            id: e.id,
            calId: cid,
            subject: e.subject || "",
            start: e.start?.date || e.start?.dateTime?.slice(0, 10) || "",
            end:   e.end?.date   || e.end?.dateTime?.slice(0, 10)   || "",
          });
        }
        url = json["@odata.nextLink"] ? json["@odata.nextLink"].replace("https://graph.microsoft.com/v1.0", "") : null;
      }
      return out;
    }

    // Vacation calendar (everything) + legacy vacation events still on the on-call calendar
    const vacEvents = await fetchCal(calId, false);
    let legacy = [];
    try { legacy = await fetchCal(ONCALL_CAL_ID, true); } catch {}
    return { events: vacEvents.concat(legacy) };
  }

  if (action === "add") {
    const { personName, startDate, endDate } = request.data;
    if (!personName || !startDate) throw new HttpsError("invalid-argument", "personName and startDate required.");
    const endD = new Date(endDate || startDate);
    endD.setDate(endD.getDate() + 1); // Graph all-day end is exclusive
    const endExclusive = endD.toISOString().slice(0, 10);
    const created = await graph(token, `/me/calendars/${calId}/events`, "POST", {
      subject: `${personName} Vacation`,
      start: { dateTime: `${startDate}T00:00:00`, timeZone: "America/Toronto" },
      end:   { dateTime: `${endExclusive}T00:00:00`, timeZone: "America/Toronto" },
      isAllDay: true,
    });
    return { id: created?.id || null };
  }

  if (action === "delete") {
    const { eventId, eventCalId } = request.data;
    if (!eventId) throw new HttpsError("invalid-argument", "eventId required.");
    // Delete from the calendar the event actually lives on (vacation cal or legacy on-call cal)
    const targetCal = eventCalId || calId;
    const r = await graph(token, `/me/calendars/${targetCal}/events/${eventId}`, "DELETE");
    if (!r.ok) {
      // Fallback: try the mailbox-wide endpoint
      await graph(token, `/me/events/${eventId}`, "DELETE").catch(() => {});
    }
    return { ok: true };
  }

  throw new HttpsError("invalid-argument", "Unknown action.");
});
