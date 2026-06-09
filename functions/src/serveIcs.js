import { onRequest } from "firebase-functions/v2/https";
import { getOutlookAccessToken } from "./utils/getOutlookToken.js";
import { db } from "./utils/firestore.js";

const CAL_ID = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";

function escapeIcs(str) {
  return (str || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export const serveIcs = onRequest({ cors: false, invoker: "public" }, async (req, res) => {
  const personName = req.query.name;
  if (!personName) { res.status(400).send("Missing ?name= parameter"); return; }

  // ?subscribe=1 → serve an HTML page that redirects to webcal://
  // This makes the SMS link tappable (https) but still triggers calendar subscription
  if (req.query.subscribe === "1") {
    const webcalUrl = `webcal://skysuite.ca/api/ics?name=${encodeURIComponent(personName)}`;
    res.setHeader("Content-Type", "text/html");
    res.status(200).send(`<!DOCTYPE html><html><head>
<meta http-equiv="refresh" content="0;url=${webcalUrl}">
<title>Adding calendar…</title></head><body>
<p>Opening calendar subscription…</p>
<p>If it doesn't open automatically, <a href="${webcalUrl}">tap here</a>.</p>
</body></html>`);
    return;
  }

  try {
    const accessToken = await getOutlookAccessToken();
    const start = new Date().toISOString().slice(0, 10);
    const endD  = new Date(); endD.setMonth(endD.getMonth() + 13);
    const end   = endD.toISOString().slice(0, 10);

    let events = [];
    let url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(CAL_ID)}/calendarView?startDateTime=${start}T00:00:00&endDateTime=${end}T23:59:59&$top=200&$select=subject,start,end,isAllDay`;
    while (url) {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error?.message || "Graph API error");
      events = events.concat(json.value || []);
      url = json["@odata.nextLink"] || null;
    }

    const firstName = personName.split(" ")[0].toLowerCase();
    const myEvents = events.filter(e => {
      const s = (e.subject || "").toLowerCase();
      return (s.includes("on call") || s.includes("oncall")) && !s.includes("vacation") && s.includes(firstName);
    });

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SkySuite//On-Call Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${escapeIcs(personName)} On-Call`,
      "X-WR-TIMEZONE:America/Toronto",
      "REFRESH-INTERVAL;VALUE=DURATION:P1D",
      "X-PUBLISHED-TTL:P1D",
    ];
    for (const ev of myEvents) {
      const uid = `${ev.id || Math.random().toString(36).slice(2)}@skysuite`;
      const s = ev.start?.date || ev.start?.dateTime?.slice(0, 10) || "";
      const e2 = ev.end?.date   || ev.end?.dateTime?.slice(0, 10)   || "";
      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTART;VALUE=DATE:${s.replace(/-/g,"")}`,
        `DTEND;VALUE=DATE:${e2.replace(/-/g,"")}`,
        `SUMMARY:${escapeIcs(ev.subject)}`,
        "END:VEVENT"
      );
    }

    // Merge approved vacation from Firestore
    const vSnap = await db.collection("timeOffRequests").where("status", "==", "APPROVED").get();
    const vacations = vSnap.docs.map(d => d.data()).filter(r => {
      const en = (r.employeeName || "").toLowerCase();
      return en === personName.toLowerCase() || en.split(" ")[0] === firstName;
    });
    vacations.forEach((r, i) => {
      const s = (r.startDate || "").replace(/-/g, "");
      if (!s) return;
      const enD = new Date(r.endDate || r.startDate); enD.setDate(enD.getDate() + 1);
      const en = enD.toISOString().slice(0, 10).replace(/-/g, "");
      lines.push(
        "BEGIN:VEVENT",
        `UID:vacation-${firstName}-${s}-${i}@skysuite.ca`,
        `DTSTART;VALUE=DATE:${s}`,
        `DTEND;VALUE=DATE:${en}`,
        `SUMMARY:${escapeIcs(personName)} Vacation`,
        "END:VEVENT"
      );
    });

    lines.push("END:VCALENDAR");

    const slug = personName.toLowerCase().replace(/\s+/g, "-");
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${slug}-oncall.ics"`);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.status(200).send(lines.join("\r\n"));
  } catch (e) {
    res.status(500).send(`Error: ${e.message}`);
  }
});
