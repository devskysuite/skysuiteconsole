import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "./utils/firestore.js";

const TENANT_ID = "1c1d62e8-f392-4caa-a8a6-0ce98e0913d9";
const CLIENT_ID = "9a1a21f1-40a3-4872-a4d6-888bd51d116d";
const CAL_ID    = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";

async function getAccessToken() {
  const snap = await db.collection("settings").doc("outlookOnCall").get();
  const data = snap.data() || {};
  const refreshToken = data.refreshToken;
  if (!refreshToken) throw new HttpsError("failed-precondition", "No Outlook connection. Connect Outlook first.");

  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
        scope: "Calendars.ReadWrite offline_access",
      }).toString(),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new HttpsError("internal", json.error_description || "Token refresh failed");
  return json.access_token;
}

function escapeIcs(str) {
  return (str || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function toIcsDate(iso) {
  // iso is "YYYY-MM-DD" (all-day)
  return iso.replace(/-/g, "");
}

export const exportUserIcs = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

    const { personName } = request.data;
    if (!personName) throw new HttpsError("invalid-argument", "personName required.");

    const token = await getAccessToken();

    // Fetch 12 months of events
    const start = new Date().toISOString().slice(0, 10);
    const endD  = new Date(); endD.setMonth(endD.getMonth() + 12);
    const end   = endD.toISOString().slice(0, 10);

    let events = [];
    let url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(CAL_ID)}/calendarView?startDateTime=${start}T00:00:00&endDateTime=${end}T23:59:59&$top=200&$select=subject,start,end,isAllDay`;

    while (url) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new HttpsError("internal", json.error?.message || "Graph API error");
      events = events.concat(json.value || []);
      url = json["@odata.nextLink"] || null;
    }

    // Filter to this person's on-call events
    const firstName = personName.split(" ")[0].toLowerCase();
    const myEvents = events.filter(e => {
      const s = (e.subject || "").toLowerCase();
      return (s.includes("on call") || s.includes("oncall")) &&
             !s.includes("vacation") &&
             s.includes(firstName);
    });

    // Build ICS
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SkySuite//On-Call Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${escapeIcs(personName)} On-Call`,
      "X-WR-TIMEZONE:America/Toronto",
    ];

    for (const ev of myEvents) {
      const uid = `${ev.id || Math.random().toString(36).slice(2)}@skysuite`;
      const dtstart = ev.isAllDay
        ? `DTSTART;VALUE=DATE:${toIcsDate(ev.start.date || ev.start.dateTime?.slice(0,10))}`
        : `DTSTART:${(ev.start.dateTime || "").replace(/[-:]/g,"").replace(".000","").replace(/\.\d+/,"")}`;
      const dtend = ev.isAllDay
        ? `DTEND;VALUE=DATE:${toIcsDate(ev.end.date || ev.end.dateTime?.slice(0,10))}`
        : `DTEND:${(ev.end.dateTime || "").replace(/[-:]/g,"").replace(".000","").replace(/\.\d+/,"")}`;

      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        dtstart,
        dtend,
        `SUMMARY:${escapeIcs(ev.subject)}`,
        "END:VEVENT"
      );
    }

    lines.push("END:VCALENDAR");
    return { ics: lines.join("\r\n"), count: myEvents.length };
  }
);
