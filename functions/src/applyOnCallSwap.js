import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getOutlookAccessToken } from "./utils/getOutlookToken.js";

const CAL_ID = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";

function nameMatches(subjectName, firstName) {
  const a = subjectName.toLowerCase();
  const b = firstName.toLowerCase();
  return a === b || a.startsWith(b) || b.startsWith(a);
}

async function findEventId(token, date, firstName) {
  const next = new Date(date + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString().slice(0, 10);
  const url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(CAL_ID)}/calendarView?startDateTime=${date}T00:00:00&endDateTime=${end}T00:00:00&$top=50&$select=id,subject,start`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await r.json();
  for (const e of (json.value || [])) {
    const s = (e.subject || "").toLowerCase();
    if (!(s.includes("on call") || s.includes("oncall")) || s.includes("vacation")) continue;
    const subjectName = s.replace(/(on\s*call|oncall)/gi, "").trim().split(/\s+/)[0];
    if (nameMatches(subjectName, firstName)) return e.id;
  }
  return null;
}

// Patches both Outlook on-call events when an admin performs a direct swap.
// Requires admin role — checked via Firestore custom claims.
export const applyOnCallSwap = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

  const { myDate, myName, theirDate, theirName } = request.data || {};
  if (!myDate || !myName) throw new HttpsError("invalid-argument", "myDate and myName required.");

  const token = await getOutlookAccessToken();
  if (!token || token === "disconnected") throw new HttpsError("unavailable", "Outlook not connected.");

  // Look up event IDs for both days
  const myEventId    = await findEventId(token, myDate,   myName);
  const theirEventId = theirDate && theirName ? await findEventId(token, theirDate, theirName) : null;

  const patch = (id, newSubject) =>
    fetch(`https://graph.microsoft.com/v1.0/me/events/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ subject: newSubject }),
    });

  const results = {};

  if (myEventId) {
    const r = await patch(myEventId, `${theirName.split(" ")[0]} On Call`);
    results.myEvent = r.ok ? "updated" : `failed (${r.status})`;
  } else {
    results.myEvent = "not found in Outlook";
  }

  if (theirDate && theirName) {
    if (theirEventId) {
      const r = await patch(theirEventId, `${myName.split(" ")[0]} On Call`);
      results.theirEvent = r.ok ? "updated" : `failed (${r.status})`;
    } else {
      results.theirEvent = "not found in Outlook";
    }
  }

  return { ok: true, results };
});
