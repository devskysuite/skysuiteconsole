import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { db } from "./utils/firestore.js";

export const sendPasswordResetEmail = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

    const { email, displayName } = request.data;
    if (!email) throw new HttpsError("invalid-argument", "Email required.");

    // Read Resend API key from Firestore settings
    const secretSnap = await db.collection("settings").doc("secrets").get();
    const resendKey = secretSnap.data()?.resendApiKey;
    if (!resendKey) throw new HttpsError("failed-precondition", "Resend API key not configured.");

    // Generate Firebase password reset link
    const link = await getAuth().generatePasswordResetLink(email).catch(() => null);
    if (!link) throw new HttpsError("not-found", "No account found for that email.");

    const name = displayName || email.split("@")[0];

    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
        <img src="https://sky-suite-d14ff.web.app/skysuite_logo.png" width="120" style="margin-bottom:24px"/>
        <h2 style="color:#0d2e5e;margin:0 0 8px">Set your SkySuite password</h2>
        <p style="color:#444;margin:0 0 24px">Hi ${name}, your SkySuite Console account has been created. Click the button below to set your password and get started.</p>
        <a href="${link}" style="display:inline-block;background:#1565c0;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:15px">Set Password</a>
        <p style="color:#999;font-size:12px;margin-top:32px">This link expires in 1 hour. If you didn't expect this email, ignore it.</p>
        <p style="color:#bbb;font-size:11px">SkySuite by RBT Electrical &amp; Automation</p>
      </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "SkySuite <no-reply@skysuite.ca>",
        to: [email],
        subject: "Set your SkySuite password",
        html,
      }),
    });

    const json = await res.json();
    if (!res.ok) throw new HttpsError("internal", json.message || "Email send failed");

    return { id: json.id };
  }
);
