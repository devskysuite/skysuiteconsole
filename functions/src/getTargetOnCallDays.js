import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getOutlookAccessToken } from "./utils/getOutlookToken.js";

const CAL_ID = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";

// Returns future on-call days for a given person from the shared Outlook calendar.
// Any authenticated user can call this — the token never leaves the server.
export const getTargetOnCallDays = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

  const firstName = (request.data?.firstName || "").trim().toLowerCase();
  if (!firstName) throw new HttpsError("invalid-argument", "firstName required.");

  const token = await getOutlookAccessToken();
  if (!token || token === "disconnected") throw new HttpsError("unavailable", "Outlook not connected.");

  const today = new Date().toISOString().slice(0, 10);
  const endD  = new Date(); endD.setMonth(endD.getMonth() + 12);
  const end   = endD.toISOString().slice(0, 10);

  const results = [];
  let url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(CAL_ID)}/calendarView?startDateTime=${today}T00:00:00&endDateTime=${end}T00:00:00&$top=999&$select=id,subject,start`;

  while (url) {
    const r    = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await r.json();
    if (!r.ok) throw new HttpsError("internal", json.error?.message || "Graph API error");

    for (const e of (json.value || [])) {
      const s = (e.subject || "").toLowerCase();
      if (!(s.includes("on call") || s.includes("oncall")) || s.includes("vacation")) continue;
      // Extract the name from the subject (e.g. "Will On Call" → "will")
      const subjectName = s.replace(/(on\s*call|oncall)/gi, "").trim().split(/\s+/)[0];
      // Flexible match: "William" matches "will", "Will" matches "william", exact match
      const matches = subjectName === firstName
        || firstName.startsWith(subjectName)
        || subjectName.startsWith(firstName);
      if (!matches) continue;
      const date = e.start?.date || e.start?.dateTime?.slice(0, 10) || "";
      if (date) results.push({ date, eventId: e.id });
    }

    url = json["@odata.nextLink"] || null;
  }

  return { days: results };
});
