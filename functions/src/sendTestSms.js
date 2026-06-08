import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "./utils/firestore.js";

export const sendTestSms = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

    const { to, name } = request.data;
    if (!to) throw new HttpsError("invalid-argument", "Phone number required.");

    // Read Twilio credentials from Firestore settings
    const secretSnap = await db.collection("settings").doc("secrets").get();
    const secrets = secretSnap.data() || {};
    const sid   = secrets.twilioAccountSid;
    const token = secrets.twilioAuthToken;
    const from  = secrets.twilioFrom;
    if (!sid || !token || !from) throw new HttpsError("failed-precondition", "Twilio credentials not configured.");

    // Normalize to E.164
    const digits = to.replace(/\D/g, "");
    const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`;

    const body = `Hi ${name || "there"}, this is a test message from SkySuite. If you received this, your contact info is set up correctly! 🎉`;

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: e164, From: from, Body: body }).toString(),
      }
    );

    const json = await res.json();
    if (!res.ok) {
      throw new HttpsError("internal", json.message || "Twilio error");
    }

    return { sid: json.sid, status: json.status };
  }
);
