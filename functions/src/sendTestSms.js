import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

const twilioSid   = defineSecret("TWILIO_ACCOUNT_SID");
const twilioToken = defineSecret("TWILIO_AUTH_TOKEN");
const twilioFrom  = defineSecret("TWILIO_FROM");

export const sendTestSms = onCall(
  { secrets: [twilioSid, twilioToken, twilioFrom], cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

    const { to, name } = request.data;
    if (!to) throw new HttpsError("invalid-argument", "Phone number required.");

    // Normalize to E.164
    const digits = to.replace(/\D/g, "");
    const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`;

    const body = `Hi ${name || "there"}, this is a test message from SkySuite. If you received this, your contact info is set up correctly! 🎉`;

    const sid   = twilioSid.value();
    const token = twilioToken.value();
    const from  = twilioFrom.value();

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
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
