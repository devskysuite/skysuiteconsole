import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getOutlookAccessToken } from "./utils/getOutlookToken.js";
import { db } from "./utils/firestore.js";

const CAL_ID = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";

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

// Auto-create / remove an Outlook vacation event when a time-off request
// transitions to (or away from) APPROVED.
export const onVacationApproved = onDocumentWritten("timeOffRequests/{id}", async (event) => {
  const before = event.data?.before?.data();
  const after  = event.data?.after?.data();

  const wasApproved = before?.status === "APPROVED";
  const isApproved  = after?.status === "APPROVED";

  // No relevant change
  if (wasApproved === isApproved && before?.calendarEventId === after?.calendarEventId) return;

  let token;
  try {
    token = await getOutlookAccessToken();
  } catch (e) {
    console.error("Vacation sync: no Outlook token —", e.message);
    return;
  }

  // APPROVED → create event (if not already created)
  if (isApproved && !before?.calendarEventId && after?.startDate) {
    const name = after.employeeName || "Employee";
    const startDate = after.startDate;
    const endD = new Date(after.endDate || after.startDate);
    endD.setDate(endD.getDate() + 1); // Graph all-day end is exclusive
    const endDate = endD.toISOString().slice(0, 10);

    try {
      const created = await graph(token, `/me/calendars/${CAL_ID}/events`, "POST", {
        subject: `${name} Vacation`,
        start: { dateTime: `${startDate}T00:00:00`, timeZone: "America/Toronto" },
        end:   { dateTime: `${endDate}T00:00:00`,   timeZone: "America/Toronto" },
        isAllDay: true,
      });
      if (created?.id) {
        await db.collection("timeOffRequests").doc(event.params.id).update({ calendarEventId: created.id });
      }
    } catch (e) {
      console.error("Vacation sync: create failed —", e.message);
    }
    return;
  }

  // No longer APPROVED (denied/deleted/reverted) → remove the event
  const existingId = before?.calendarEventId || after?.calendarEventId;
  if (!isApproved && existingId) {
    try {
      await graph(token, `/me/calendars/${CAL_ID}/events/${existingId}`, "DELETE");
    } catch (e) {
      console.error("Vacation sync: delete failed —", e.message);
    }
    // Clear the stored id if the doc still exists
    if (after) {
      await db.collection("timeOffRequests").doc(event.params.id)
        .update({ calendarEventId: null }).catch(() => {});
    }
  }
});
