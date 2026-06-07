import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Init Firebase Admin using service account from GitHub secret
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

// Query all checked-out tools
const snap = await db.collection("tools").where("status", "==", "CHECKED_OUT").get();

const overdue = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => t.dueBackAt?.toDate?.() < now);

if (overdue.length === 0) {
    console.log(`[${dateStr}] No overdue tools — no email sent.`);
    process.exit(0);
}

// Build the list string
const list = overdue
    .map((t) => {
        const due =
            t.dueBackAt?.toDate?.()?.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
            }) ?? "unknown";
        return `• ${t.name || "Unknown Tool"} (${t.toolId || t.id}) — ${t.checkedOutToEmployeeName || "—"}, ${t.checkedOutToJobName || "—"}, due ${due}`;
    })
    .join("\n");

console.log(`[${dateStr}] Sending overdue alert for ${overdue.length} tool(s):\n${list}`);

import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);
const toolWord = overdue.length === 1 ? "tool" : "tools";

const { error } = await resend.emails.send({
    from: "RBT Hub <no-reply@rbtautomate.com>",
    to: process.env.ADMIN_EMAIL,
    subject: `Overdue Alert — ${overdue.length} ${toolWord} overdue`,
    html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 0;">
            <h2 style="color: #c0392b; margin: 0 0 8px;">Overdue Tool Alert</h2>
            <p style="color: #444; margin: 0 0 20px;">${overdue.length} ${toolWord} overdue as of ${dateStr}.</p>
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
