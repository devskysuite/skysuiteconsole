import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { db } from "./utils/firestore.js";
import { sendEmail } from "./utils/emailjs.js";

const emailjsServiceId = defineSecret("EMAILJS_SERVICE_ID");
const emailjsTemplateId = defineSecret("EMAILJS_TEMPLATE_ID");
const emailjsPublicKey = defineSecret("EMAILJS_PUBLIC_KEY");
const emailjsPrivateKey = defineSecret("EMAILJS_PRIVATE_KEY");
const adminEmail = defineSecret("ADMIN_EMAIL");

export const checkOverdue = onSchedule(
  {
    schedule: "every day 07:30",
    timeZone: "America/Toronto",
    secrets: [emailjsServiceId, emailjsTemplateId, emailjsPublicKey, emailjsPrivateKey, adminEmail],
  },
  async () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    const snap = await db.collection("tools").where("status", "==", "CHECKED_OUT").get();

    const overdue = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => t.dueBackAt?.toDate?.() < now);

    if (overdue.length === 0) {
      console.log(`[${dateStr}] No overdue tools — no email sent.`);
      return;
    }

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

    await sendEmail({
      serviceId: emailjsServiceId.value(),
      templateId: emailjsTemplateId.value(),
      publicKey: emailjsPublicKey.value(),
      privateKey: emailjsPrivateKey.value(),
      templateParams: {
        to_email: adminEmail.value(),
        overdue_count: String(overdue.length),
        tool_word: overdue.length === 1 ? "tool" : "tools",
        overdue_list: list,
        date: dateStr,
      },
    });

    console.log("Email sent successfully.");
  }
);
