import { db } from "./firestore.js";

// Sends an SMS using the Twilio credentials stored in settings/secrets.
export async function sendSms(to, body) {
  const s = (await db.collection("settings").doc("secrets").get()).data() || {};
  if (!s.twilioAccountSid || !s.twilioAuthToken || !s.twilioFrom) {
    throw new Error("Twilio not configured (settings/secrets).");
  }
  const digits = (to || "").replace(/\D/g, "");
  if (!digits) throw new Error("No phone number.");
  const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${s.twilioAccountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${s.twilioAccountSid}:${s.twilioAuthToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: e164, From: s.twilioFrom, Body: body }).toString(),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.message || "Twilio error");
  return j.sid;
}
