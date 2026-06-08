import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "./utils/firestore.js";
import { getStorage } from "firebase-admin/storage";

const TENANT_ID = "1c1d62e8-f392-4caa-a8a6-0ce98e0913d9";
const CLIENT_ID = "9a1a21f1-40a3-4872-a4d6-888bd51d116d";
const CAL_ID    = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";

async function getAccessToken() {
  const snap = await db.collection("settings").doc("outlookOnCall").get();
  const refreshToken = snap.data()?.refreshToken;
  if (!refreshToken) throw new HttpsError("failed-precondition", "No Outlook connection. Connect Outlook first.");
  const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: refreshToken, scope: "Calendars.ReadWrite offline_access" }).toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new HttpsError("internal", json.error_description || "Token refresh failed");
  return json.access_token;
}

function escapeIcs(str) {
  return (str || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function toIcsDate(iso) {
  return (iso || "").replace(/-/g, "");
}

export const sendIcsLink = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

  const { personName, phone } = request.data;
  if (!personName || !phone) throw new HttpsError("invalid-argument", "personName and phone required.");

  // Get Twilio creds
  const secretSnap = await db.collection("settings").doc("secrets").get();
  const secrets = secretSnap.data() || {};
  const sid   = secrets.twilioAccountSid;
  const token = secrets.twilioAuthToken;
  const from  = secrets.twilioFrom;
  if (!sid || !token || !from) throw new HttpsError("failed-precondition", "Twilio credentials not configured. Go to Admin → Twilio SMS.");

  // Fetch events from Outlook
  const accessToken = await getAccessToken();
  const start = new Date().toISOString().slice(0, 10);
  const endD  = new Date(); endD.setMonth(endD.getMonth() + 13);
  const end   = endD.toISOString().slice(0, 10);

  let events = [];
  let url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(CAL_ID)}/calendarView?startDateTime=${start}T00:00:00&endDateTime=${end}T23:59:59&$top=200&$select=subject,start,end,isAllDay`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await res.json();
    if (!res.ok) throw new HttpsError("internal", json.error?.message || "Graph API error");
    events = events.concat(json.value || []);
    url = json["@odata.nextLink"] || null;
  }

  const firstName = personName.split(" ")[0].toLowerCase();
  const myEvents = events.filter(e => {
    const s = (e.subject || "").toLowerCase();
    return (s.includes("on call") || s.includes("oncall")) && !s.includes("vacation") && s.includes(firstName);
  });

  if (!myEvents.length) throw new HttpsError("not-found", `No upcoming on-call events found for ${personName}.`);

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
    const endDate   = ev.end?.date   || ev.end?.dateTime?.slice(0, 10)   || "";
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
  const icsContent = lines.join("\r\n");

  // Upload to Firebase Storage
  const slug = personName.toLowerCase().replace(/\s+/g, "-");
  const fileName = `ics-exports/${slug}-oncall.ics`;
  const bucket = getStorage().bucket();
  const file = bucket.file(fileName);
  await file.save(icsContent, {
    metadata: { contentType: "text/calendar; charset=utf-8" },
  });
  await file.makePublic();
  const bucketName = bucket.name;
  const publicUrl = `https://storage.googleapis.com/${bucketName}/${encodeURIComponent(fileName)}`;

  // Send SMS
  const digits = phone.replace(/\D/g, "");
  const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  const body = `Hi ${personName.split(" ")[0]}, your SkySuite on-call calendar (${myEvents.length} events):\n${publicUrl}\n\nTap to add to your calendar app. – SkySuite`;

  const smsRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: e164, From: from, Body: body }).toString(),
  });

  const smsJson = await smsRes.json();
  if (!smsRes.ok) throw new HttpsError("internal", smsJson.message || "Twilio error");

  return { sid: smsJson.sid, count: myEvents.length, url: publicUrl };
});
