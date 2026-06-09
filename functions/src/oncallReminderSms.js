import { onSchedule } from "firebase-functions/v2/scheduler";
import { getOutlookAccessToken } from "./utils/getOutlookToken.js";
import { SHARED_CAL_ID } from "./utils/getVacationCalendar.js";
import { sendSms } from "./utils/twilio.js";
import { db } from "./utils/firestore.js";

function firstNameFromSubject(subject) {
  return (subject || "").replace(/on ?call/ig, "").replace(/vacation/ig, "").replace(/[-–]/g, " ").trim().split(/\s+/)[0] || "";
}

// Texts the person who is on call today, every morning.
export const oncallReminderSms = onSchedule(
  { schedule: "every day 07:00", timeZone: "America/Toronto", timeoutSeconds: 120 },
  async () => {
    const token = await getOutlookAccessToken();
    const today = new Date().toISOString().slice(0, 10);
    const tmrw  = new Date(); tmrw.setDate(tmrw.getDate() + 1);
    const end   = tmrw.toISOString().slice(0, 10);

    const res = await fetch(`https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(SHARED_CAL_ID)}/calendarView?startDateTime=${today}T00:00:00&endDateTime=${end}T00:00:00&$top=50&$select=subject,start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    const onCall = (json.value || []).filter(e => {
      const s = (e.subject || "").toLowerCase();
      return (s.includes("on call") || s.includes("oncall")) && !s.includes("vacation");
    });
    if (!onCall.length) { console.log("[oncallReminder] No on-call today."); return; }

    // Load users to match phone numbers
    const usersSnap = await db.collection("users").get();
    const users = usersSnap.docs.map(d => d.data());

    for (const ev of onCall) {
      const fn = firstNameFromSubject(ev.subject).toLowerCase();
      const user = users.find(u => (u.displayName || "").split(" ")[0].toLowerCase() === fn && u.phone);
      if (!user) { console.log(`[oncallReminder] No phone for ${fn}.`); continue; }
      try {
        await sendSms(user.phone, `Reminder: you're on call today (${today}). – SkySuite`);
        console.log(`[oncallReminder] Sent to ${user.displayName}.`);
      } catch (e) { console.error(`[oncallReminder] ${fn}:`, e.message); }
    }
  }
);
