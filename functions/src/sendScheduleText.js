import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "./utils/firestore.js";

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

function fmtDate(iso) {
  const [y, m, d] = iso.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m)-1]} ${parseInt(d)}`;
}

export const sendScheduleText = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

  const { personName, phone } = request.data;
  if (!personName || !phone) throw new HttpsError("invalid-argument", "personName and phone required.");

  // Get Twilio creds
  const secretSnap = await db.collection("settings").doc("secrets").get();
  const secrets = secretSnap.data() || {};
  const sid   = secrets.twilioAccountSid;
  const token = secrets.twilioAuthToken;
  const from  = secrets.twilioFrom;
  if (!sid || !token || !from) throw new HttpsError("failed-precondition", "Twilio credentials not configured.");

  // Fetch on-call events from Outlook
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
  const myDates = events
    .filter(e => {
      const s = (e.subject || "").toLowerCase();
      return (s.includes("on call") || s.includes("oncall")) && !s.includes("vacation") && s.includes(firstName);
    })
    .map(e => e.start?.date || e.start?.dateTime?.slice(0, 10) || "")
    .filter(Boolean)
    .sort()
    .slice(0, 20);

  if (!myDates.length) throw new HttpsError("not-found", `No upcoming on-call dates found for ${personName}.`);

  // Group by month
  const byMonth = {};
  for (const d of myDates) {
    const [y, m] = d.split("-");
    const key = `${y}-${m}`;
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(fmtDate(d));
  }
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const lines = Object.entries(byMonth).map(([key, days]) => {
    const [y, m] = key.split("-");
    return `${months[parseInt(m)-1]} ${y}: ${days.join(", ")}`;
  });

  const body = `Hi ${personName.split(" ")[0]}, your upcoming SkySuite on-call schedule:\n\n${lines.join("\n")}\n\n– SkySuite`;

  const digits = phone.replace(/\D/g, "");
  const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`;

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

  return { sid: smsJson.sid, count: myDates.length };
});
