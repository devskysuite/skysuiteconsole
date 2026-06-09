import { onSchedule } from "firebase-functions/v2/scheduler";
import { getOutlookAccessToken } from "./utils/getOutlookToken.js";
import { SHARED_CAL_ID } from "./utils/getVacationCalendar.js";
import { sendSms } from "./utils/twilio.js";
import { firstNameFromSubject, findUserByFirstName } from "./utils/names.js";
import { db } from "./utils/firestore.js";

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const TZ = "America/Toronto";

// Every morning: reminds today's on-call person (unless they're on vacation
// today — that's a conflict handled separately), and tells the admin alert
// number who is on call today.
export const oncallReminderSms = onSchedule(
  { schedule: "every day 07:00", timeZone: TZ, timeoutSeconds: 120 },
  async () => {
    const token = await getOutlookAccessToken();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD in ET
    const tmrwD = new Date(); tmrwD.setDate(tmrwD.getDate() + 1);
    const end   = tmrwD.toLocaleDateString("en-CA", { timeZone: TZ });

    // calendarView returns any event overlapping today; Prefer header makes the
    // unzoned window (and returned times) ET, not UTC — otherwise yesterday's
    // all-day events bleed in. Follow pagination so busy days aren't truncated.
    const headers = { Authorization: `Bearer ${token}`, Prefer: `outlook.timezone="${TZ}"` };
    const evs = [];
    let url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(SHARED_CAL_ID)}/calendarView?startDateTime=${today}T00:00:00&endDateTime=${end}T00:00:00&$top=100&$select=subject,start,end`;
    while (url) {
      const res = await fetch(url, { headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Graph API error");
      evs.push(...(json.value || []));
      url = json["@odata.nextLink"] || null;
    }

    const onCallNames = new Set();
    const vacationNames = new Set();
    for (const e of evs) {
      const s = (e.subject || "").toLowerCase();
      const name = firstNameFromSubject(e.subject);
      if (!name) continue;
      if (s.includes("vacation")) vacationNames.add(name);
      else if (s.includes("on call") || s.includes("oncall")) onCallNames.add(name);
    }

    const usersSnap = await db.collection("users").get();
    const users = usersSnap.docs.map(d => d.data());

    // 1. Remind each on-call person — skip anyone on vacation today (conflict job handles them)
    for (const fn of onCallNames) {
      if (vacationNames.has(fn)) { console.log(`[oncallReminder] ${fn} on vacation today — skipping reminder (conflict).`); continue; }
      try {
        const user = findUserByFirstName(users, fn);
        if (!user?.phone) { console.log(`[oncallReminder] No phone for ${fn}.`); continue; }
        await sendSms(user.phone, `Reminder: you're on call today (${today}). - SkySuite`);
        console.log(`[oncallReminder] Sent to ${user.displayName}.`);
      } catch (e) { console.error(`[oncallReminder] ${fn}:`, e.message); }
    }

    // 2. Tell the admin alert number who is on call today (flagging any conflicts)
    const cfg = (await db.collection("settings").doc("onCallConfig").get()).data() || {};
    const alertPhone = cfg.alertPhone;
    if (alertPhone) {
      const labels = [...onCallNames].map(fn => {
        const u = findUserByFirstName(users, fn);
        const display = u?.displayName || cap(fn);
        return vacationNames.has(fn) ? `${display} (CONFLICT - on vacation)` : display;
      });
      const body = labels.length
        ? `Today's on-call (${today}): ${labels.join(", ")}`
        : `No one is scheduled on call today (${today}).`;
      await sendSms(alertPhone, `${body}\n- SkySuite`).catch(e => console.error("[oncallReminder] admin:", e.message));
    }
  }
);
