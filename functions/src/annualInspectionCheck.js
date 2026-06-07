import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { db } from "./utils/firestore.js";
import { sendEmail } from "./utils/emailjs.js";

const emailjsServiceId = defineSecret("EMAILJS_SERVICE_ID");
const emailjsTemplateId = defineSecret("EMAILJS_TEMPLATE_ID");
const emailjsPublicKey = defineSecret("EMAILJS_PUBLIC_KEY");
const emailjsPrivateKey = defineSecret("EMAILJS_PRIVATE_KEY");
const adminEmail = defineSecret("ADMIN_EMAIL");

export const annualInspectionCheck = onSchedule(
  {
    schedule: "every monday 07:35",
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

    const snap = await db.collection("tools").get();
    const lifts = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => t.category?.toLowerCase().includes("lift"));

    if (lifts.length === 0) {
      console.log(`[${dateStr}] No lift tools found — no email sent.`);
      return;
    }

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
      return;
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

    await sendEmail({
      serviceId: emailjsServiceId.value(),
      templateId: emailjsTemplateId.value(),
      publicKey: emailjsPublicKey.value(),
      privateKey: emailjsPrivateKey.value(),
      templateParams: {
        to_email: adminEmail.value(),
        overdue_count: String(alertTools.length),
        tool_word: alertTools.length === 1 ? "lift" : "lifts",
        overdue_list: list,
        date: dateStr,
      },
    });

    console.log("Email sent successfully.");
  }
);
