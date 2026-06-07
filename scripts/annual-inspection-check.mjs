import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const now = new Date();
const dateStr = now.toLocaleDateString("en-US", {
  weekday: "long", month: "long", day: "numeric", year: "numeric",
});

// Fetch all Aerial Lifts tools
const snap = await db.collection("tools").get();
const lifts = snap.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((t) => t.category?.toLowerCase().includes("lift"));

if (lifts.length === 0) {
  console.log(`[${dateStr}] No lift tools found — no email sent.`);
  process.exit(0);
}

// Check which are in the 30-day warning window (28–34 days out, catches one Monday per year)
// or have no inspection date recorded
const MS_PER_DAY = 86400000;
const alertTools = lifts
  .map((t) => {
    if (!t.lastInspectionDate) {
      return { ...t, daysUntil: null, nextDue: null };
    }
    const last = new Date(t.lastInspectionDate + "T00:00:00");
    const nextDue = new Date(last);
    nextDue.setFullYear(nextDue.getFullYear() + 1);
    const daysUntil = Math.ceil((nextDue - now) / MS_PER_DAY);
    return { ...t, daysUntil, nextDue };
  })
  .filter((t) => t.daysUntil === null || (t.daysUntil >= 28 && t.daysUntil <= 34));

if (alertTools.length === 0) {
  console.log(`[${dateStr}] No lift inspections due within 30 days — no email sent.`);
  process.exit(0);
}

const list = alertTools
  .map((t) => {
    const name = t.name || t.toolId || t.id;
    if (t.daysUntil === null) {
      return `• ${name} — no inspection date recorded`;
    }
    if (t.daysUntil < 0) {
      return `• ${name} — OVERDUE by ${Math.abs(t.daysUntil)} day${Math.abs(t.daysUntil) !== 1 ? "s" : ""} (due ${t.nextDue.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})`;
    }
    return `• ${name} — due in ${t.daysUntil} day${t.daysUntil !== 1 ? "s" : ""} (${t.nextDue.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})`;
  })
  .join("\n");

console.log(`[${dateStr}] Sending annual inspection alert for ${alertTools.length} lift(s):\n${list}`);

import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);
const liftWord = alertTools.length === 1 ? "lift" : "lifts";

const { error } = await resend.emails.send({
  from: "RBT Hub <no-reply@rbtautomate.com>",
  to: process.env.ADMIN_EMAIL,
  subject: `Inspection Alert — ${alertTools.length} aerial ${liftWord} due`,
  html: `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 0;">
      <h2 style="color: #2980b9; margin: 0 0 8px;">Annual Lift Inspection Alert</h2>
      <p style="color: #444; margin: 0 0 20px;">${alertTools.length} aerial ${liftWord} require inspection as of ${dateStr}.</p>
      <pre style="background: #f8f8f8; border-radius: 8px; padding: 16px; font-size: 13px; white-space: pre-wrap;">${list}</pre>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #bbb; font-size: 12px; margin: 0;">RBT Hub &mdash; RBT Automate</p>
    </div>
  `,
});

if (error) {
  console.error("Failed to send email:", error);
  process.exit(1);
}

console.log("Email sent successfully.");
