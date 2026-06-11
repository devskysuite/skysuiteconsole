import { onSchedule } from "firebase-functions/v2/scheduler";
import { getOutlookAccessToken } from "./utils/getOutlookToken.js";
import { SHARED_CAL_ID } from "./utils/getVacationCalendar.js";
import { sendSms } from "./utils/twilio.js";
import { firstNameFromSubject, findUserByFirstName } from "./utils/names.js";
import { db } from "./utils/firestore.js";

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const TZ = "America/Toronto";

// Compute who should be on call today based on the rotation formula stored in Firestore.
async function getRotationOnCallName(today) {
  const cfgSnap = await db.collection("settings").doc("onCallConfig").get();
  const roster = cfgSnap.data()?.employees || [];
  if (!roster.length) return null;

  const ordSnap = await db.collection("settings").doc("rotationOrders").get();
  const savedOrders = ordSnap.data() || {};

  const year = parseInt(today.slice(0, 4));
  const ord = (savedOrders[String(year)] || []).length ? savedOrders[String(year)] : roster;

  const jan1 = Date.UTC(year, 0, 1);
  const [y2, m2, d2] = today.split("-").map(Number);
  const todayUTC = Date.UTC(y2, m2 - 1, d2);
  const since = Math.floor((todayUTC - jan1) / 86400000);

  return (ord[((since % ord.length) + ord.length) % ord.length] || "").toLowerCase();
}

// Every morning: reminds today's on-call person (unless they're on vacation
// today — that's a conflict handled separately), and tells the admin alert
// number who is on call today.
export const oncallReminderSms = onSchedule(
  { schedule: "every day 07:00", timeZone: TZ, timeoutSeconds: 120 },
  async () => {
    const token = await getOutlookAccessToken();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
    const tmrwD = new Date(); tmrwD.setDate(tmrwD.getDate() + 1);
    const end   = tmrwD.toLocaleDateString("en-CA", { timeZone: TZ });

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

    // Outlook is still used for vacation detection
    const vacationNames = new Set();
    const outlookOnCall = new Set();
    for (const e of evs) {
      const s = (e.subject || "").toLowerCase();
      const name = firstNameFromSubject(e.subject);
      if (!name) continue;
      if (s.includes("vacation")) vacationNames.add(name);
      else if (s.includes("on call") || s.includes("oncall")) outlookOnCall.add(name);
    }

    // Priority for on-call name:
    // 1. onCallAssignments (manual swap/override for today)
    // 2. Rotation formula from Firestore (avoids stale Outlook events)
    // 3. Outlook fallback (only if no roster configured)
    const assignSnap = await db.collection("onCallAssignments").where("date", "==", today).get();
    let onCallNames;
    if (!assignSnap.empty) {
      // If duplicates exist (old data bug), only use the most-recently created doc
      const docs = assignSnap.docs.sort((a, b) => (b.data().createdAt?.toMillis?.() ?? 0) - (a.data().createdAt?.toMillis?.() ?? 0));
      if (docs.length > 1) console.warn(`[oncallReminder] ${docs.length} assignments found for ${today} — using most recent.`);
      const name = (docs[0].data().employeeName || "").split(/\s+/)[0].toLowerCase();
      onCallNames = name ? new Set([name]) : new Set();
    } else {
      const rotPerson = await getRotationOnCallName(today);
      if (rotPerson) {
        onCallNames = new Set([rotPerson]);
      } else {
        onCallNames = new Set([...outlookOnCall]);
      }
    }

    const usersSnap = await db.collection("users").get();
    const users = usersSnap.docs.map(d => d.data());

    // 1. Remind each on-call person — skip anyone on vacation today
    for (const fn of onCallNames) {
      if (vacationNames.has(fn)) { console.log(`[oncallReminder] ${fn} on vacation today — skipping reminder (conflict).`); continue; }
      try {
        const user = findUserByFirstName(users, fn);
        if (!user?.phone) { console.log(`[oncallReminder] No phone for ${fn}.`); continue; }
        await sendSms(user.phone, `Reminder: you're on call today (${today}). - SkySuite`);
        console.log(`[oncallReminder] Sent to ${user.displayName}.`);
      } catch (e) { console.error(`[oncallReminder] ${fn}:`, e.message); }
    }

    // 2. Tell the admin alert number who is on call today
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
