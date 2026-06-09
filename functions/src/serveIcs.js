import { onRequest } from "firebase-functions/v2/https";
import { db } from "./utils/firestore.js";

const TENANT_ID = "1c1d62e8-f392-4caa-a8a6-0ce98e0913d9";
const CLIENT_ID = "9a1a21f1-40a3-4872-a4d6-888bd51d116d";
const CAL_ID    = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";

async function getAccessToken() {
  const snap = await db.collection("settings").doc("outlookOnCall").get();
  const refreshToken = snap.data()?.refreshToken;
  if (!refreshToken) throw new Error("No Outlook connection.");
  const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: refreshToken, scope: "Calendars.ReadWrite offline_access" }).toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || "Token refresh failed");
  return json.access_token;
}

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
    const accessToken = await getAccessToken();
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
