import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Resend } from "resend";

function initFirebase() {
  if (!getApps().length) {
    initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)) });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, type = "reset" } = req.body as { email: string; type?: "reset" | "setup" };
  if (!email) return res.status(400).json({ error: "Missing email" });

  initFirebase();

  let resetLink: string;
  try {
    resetLink = await getAuth().generatePasswordResetLink(email);
  } catch {
    // Don't reveal whether the email exists
    return res.status(200).json({ success: true });
  }

  const isSetup = type === "setup";
  const subject = isSetup ? "Set up your RBT Hub account" : "Reset your RBT Hub password";
  const heading = isSetup ? "Welcome to RBT Hub" : "Reset your password";
  const body = isSetup
    ? "An account has been created for you. Click the button below to set your password and get started."
    : "Click the button below to reset your RBT Hub password. This link expires in 1 hour.";
  const btnLabel = isSetup ? "Set Up Account" : "Reset Password";
  const footer = isSetup
    ? "If you weren't expecting this email, please contact your administrator."
    : "If you didn't request this, you can safely ignore this email.";

  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: "RBT Hub <no-reply@rbtautomate.com>",
    to: email,
    subject,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 0;">
        <img src="https://rbt-hub.vercel.app/rbt_logo.png" alt="RBT Hub" style="height: 48px; margin-bottom: 24px;" />
        <h2 style="color: #1e7d3a; margin: 0 0 12px;">${heading}</h2>
        <p style="color: #444; font-size: 15px; margin: 0 0 24px;">${body}</p>
        <a href="${resetLink}" style="display: inline-block; background: #1e7d3a; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px;">${btnLabel}</a>
        <p style="color: #999; font-size: 13px; margin-top: 32px;">${footer}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #bbb; font-size: 12px; margin: 0;">RBT Hub &mdash; RBT Automate</p>
      </div>
    `,
  });

  return res.status(200).json({ success: true });
}
