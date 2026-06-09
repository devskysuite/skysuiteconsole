import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getOutlookAccessToken } from "./utils/getOutlookToken.js";

const CAL_ID = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";

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

    const token = await getOutlookAccessToken().catch(e => { throw new HttpsError("failed-precondition", e.message); });

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
      const startDate = ev.start?.date || ev.start?.dateTime?.slice(0, 10) || "";
      const endDate   = ev.end?.date   || ev.end?.dateTime?.slice(0, 10)   || startDate;
      if (!startDate) continue; // skip malformed events rather than crashing

      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTART;VALUE=DATE:${toIcsDate(startDate)}`,
        `DTEND;VALUE=DATE:${toIcsDate(endDate)}`,
        `SUMMARY:${escapeIcs(ev.subject)}`,
        "END:VEVENT"
      );
    }

    lines.push("END:VCALENDAR");
    return { ics: lines.join("\r\n"), count: myEvents.length };
  }
);
