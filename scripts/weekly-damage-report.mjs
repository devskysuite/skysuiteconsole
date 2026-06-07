import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const now = new Date();
const dateStr = now.toLocaleDateString("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

// Query all damaged tools
const [toolsSnap, vehiclesSnap] = await Promise.all([
  db.collection("tools").where("status", "==", "DAMAGED").get(),
  db.collection("vehicles").where("status", "==", "DAMAGED").get(),
]);
const damaged = [
  ...toolsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  ...vehiclesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
];

if (damaged.length === 0) {
  console.log(`[${dateStr}] No damaged tools — no email sent.`);
  process.exit(0);
}

// Build list string for the email body
const list = damaged
  .map((t) => {
    const reportedOn =
      t.damagedReportedAt?.toDate?.()?.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) ?? "Unknown date";

    const lines = [
      `• ${t.name || "Unknown Tool"} (${t.toolId || t.id})`,
      `  Reported by: ${t.damagedReportedBy || "—"}`,
      `  Date: ${reportedOn}`,
      `  Issue: ${t.damagedNote || "—"}`,
    ];
    if (t.damagedPhotoUrl) {
      lines.push(`  Photo: ${t.damagedPhotoUrl}`);
    }
    return lines.join("\n");
  })
  .join("\n\n");

console.log(`[${dateStr}] Sending damage report for ${damaged.length} tool(s):\n${list}`);

import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);
const toolWord = damaged.length === 1 ? "tool" : "tools";

const { error } = await resend.emails.send({
  from: "RBT Hub <no-reply@rbtautomate.com>",
  to: process.env.ADMIN_EMAIL,
  subject: `Weekly Damage Report — ${damaged.length} ${toolWord} damaged`,
  html: `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 0;">
      <h2 style="color: #e67e22; margin: 0 0 8px;">Weekly Damage Report</h2>
      <p style="color: #444; margin: 0 0 20px;">${damaged.length} ${toolWord} currently marked as damaged as of ${dateStr}.</p>
      <pre style="background: #f8f8f8; border-radius: 8px; padding: 16px; font-size: 13px; white-space: pre-wrap;">${list}</pre>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #bbb; font-size: 12px; margin: 0;">RBT Hub &mdash; RBT Automate</p>
    </div>
  `,
});

if (error) {
  console.error("Failed to send damage report email:", error);
  process.exit(1);
}

console.log("Damage report email sent successfully.");
