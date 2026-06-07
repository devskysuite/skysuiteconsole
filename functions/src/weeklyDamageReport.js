import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { db } from "./utils/firestore.js";
import { sendEmail } from "./utils/emailjs.js";

const emailjsServiceId = defineSecret("EMAILJS_SERVICE_ID");
const emailjsTemplateIdDamage = defineSecret("EMAILJS_TEMPLATE_ID_DAMAGE");
const emailjsPublicKey = defineSecret("EMAILJS_PUBLIC_KEY");
const emailjsPrivateKey = defineSecret("EMAILJS_PRIVATE_KEY");
const adminEmail = defineSecret("ADMIN_EMAIL");

export const weeklyDamageReport = onSchedule(
  {
    schedule: "every monday 07:30",
    timeZone: "America/Toronto",
    secrets: [emailjsServiceId, emailjsTemplateIdDamage, emailjsPublicKey, emailjsPrivateKey, adminEmail],
  },
  async () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });

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
      return;
    }

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

    await sendEmail({
      serviceId: emailjsServiceId.value(),
      templateId: emailjsTemplateIdDamage.value(),
      publicKey: emailjsPublicKey.value(),
      privateKey: emailjsPrivateKey.value(),
      templateParams: {
        to_email: adminEmail.value(),
        damaged_count: String(damaged.length),
        tool_word: damaged.length === 1 ? "tool" : "tools",
        damaged_list: list,
        date: dateStr,
      },
    });

    console.log("Damage report email sent successfully.");
  }
);
