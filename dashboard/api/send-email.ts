import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Resend } from "resend";

function initFirebase() {
  if (!getApps().length) {
    initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)) });
  }
}

const FROM = "RBT Hub <no-reply@rbtautomate.com>";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "dev@rbtautomate.com";
const APP_URL = process.env.APP_URL ?? "https://rbt-hub.vercel.app";

type TimeOffPayload = {
  employee_name: string;
  employee_email: string;
  start_date: string;
  end_date: string;
  reason: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { idToken, type, payload } = req.body as {
    idToken: string;
    type: "time-off";
    payload: TimeOffPayload;
  };

  if (!idToken) return res.status(401).json({ error: "Unauthorized" });

  initFirebase();

  try {
    await getAuth().verifyIdToken(idToken);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  if (type === "time-off") {
    const { employee_name, employee_email, start_date, end_date, reason } = payload;
    await resend.emails.send({
      from: FROM,
      to: ADMIN_EMAIL,
      subject: `Time Off Request — ${employee_name}`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 0;">
          <img src="${APP_URL}/rbt_logo.png" alt="RBT Hub" style="height: 48px; margin-bottom: 24px;" />
          <h2 style="color: #1e7d3a; margin: 0 0 16px;">New Time Off Request</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 15px;">
            <tr>
              <td style="padding: 8px 0; color: #666; width: 140px; vertical-align: top;">Employee</td>
              <td style="padding: 8px 0; font-weight: 600;">${employee_name}<br/><span style="font-weight: 400; color: #888; font-size: 13px;">${employee_email}</span></td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;">Start Date</td>
              <td style="padding: 8px 0;">${start_date}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;">End Date</td>
              <td style="padding: 8px 0;">${end_date}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666; vertical-align: top;">Reason</td>
              <td style="padding: 8px 0;">${reason || "No reason provided"}</td>
            </tr>
          </table>
          <div style="margin-top: 28px;">
            <a href="${APP_URL}/time-off/approvals" style="display: inline-block; background: #1e7d3a; color: #fff; padding: 10px 22px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px;">Review in RBT Hub →</a>
          </div>
          <hr style="border: none; border-top: 1px solid #eee; margin: 28px 0;" />
          <p style="color: #bbb; font-size: 12px; margin: 0;">RBT Hub &mdash; RBT Automate</p>
        </div>
      `,
    });
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: "Unknown email type" });
}
