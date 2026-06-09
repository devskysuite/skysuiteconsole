import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "./utils/firestore.js";

const ICS_BASE_URL = "https://skysuite.ca/api/ics";

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

  const subscribeUrl = `${ICS_BASE_URL}?name=${encodeURIComponent(personName)}&subscribe=1`;

  const digits = phone.replace(/\D/g, "");
  const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  const body = `Hi ${personName.split(" ")[0]}, tap the link below to subscribe to your SkySuite on-call calendar. It will update automatically:\n${subscribeUrl}\n– SkySuite`;

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

  return { sid: smsJson.sid, url: subscribeUrl };
});
