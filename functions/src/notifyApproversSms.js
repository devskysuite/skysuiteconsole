import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "./utils/firestore.js";

const APPROVER_ROLES = ["owner", "admin", "manager"];

export const notifyApproversSms = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

  const { employeeName, startDate, endDate } = request.data;
  if (!employeeName || !startDate) throw new HttpsError("invalid-argument", "employeeName and startDate required.");

  // Twilio creds
  const secretSnap = await db.collection("settings").doc("secrets").get();
  const secrets = secretSnap.data() || {};
  const sid   = secrets.twilioAccountSid;
  const token = secrets.twilioAuthToken;
  const from  = secrets.twilioFrom;
  if (!sid || !token || !from) throw new HttpsError("failed-precondition", "Twilio not configured.");

  // Find approvers with a phone number
  const usersSnap = await db.collection("users").get();
  const approvers = usersSnap.docs
    .map(d => d.data())
    .filter(u => APPROVER_ROLES.includes(u.role) && u.phone);

  const range = endDate && endDate !== startDate ? `${startDate} → ${endDate}` : startDate;
  const body  = `📅 New vacation request from ${employeeName} (${range}). Review & approve in SkySuite.`;

  let sent = 0;
  for (const u of approvers) {
    const digits = (u.phone || "").replace(/\D/g, "");
    if (!digits) continue;
    const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: e164, From: from, Body: body }).toString(),
    }).catch(() => null);
    if (res && res.ok) sent++;
  }

  return { sent, approvers: approvers.length };
});
