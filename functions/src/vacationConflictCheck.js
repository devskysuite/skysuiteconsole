import { onSchedule } from "firebase-functions/v2/scheduler";
import { getOutlookAccessToken } from "./utils/getOutlookToken.js";
import { SHARED_CAL_ID } from "./utils/getVacationCalendar.js";
import { sendSms } from "./utils/twilio.js";
import { firstNameFromSubject, findUserByFirstName, eventDays } from "./utils/names.js";
import { db } from "./utils/firestore.js";

const TZ = "America/Toronto";
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Core scan. adminOnly=true → only text the alert number (skip per-person texts).
// Returns a summary so callers (e.g. a manual "run now") can show the result.
export async function runConflictCheck({ adminOnly = false } = {}) {
  const cfg = (await db.collection("settings").doc("onCallConfig").get()).data() || {};
  const alertPhone = cfg.alertPhone;
  if (!alertPhone) { console.log("[conflictCheck] No alertPhone set; skipping."); return { ok: false, reason: "No alert phone set in Setup → Conflict Alerts.", conflicts: [] }; }

  const token = await getOutlookAccessToken();
  const start = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const endD  = new Date(); endD.setDate(endD.getDate() + 365);
  const end   = endD.toLocaleDateString("en-CA", { timeZone: TZ });

  // Map: date → { oncall:Set<name>, vacation:Set<name> }
  const byDate = {};
  const headers = { Authorization: `Bearer ${token}`, Prefer: `outlook.timezone="${TZ}"` };
  let url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(SHARED_CAL_ID)}/calendarView?startDateTime=${start}T00:00:00&endDateTime=${end}T23:59:59&$top=999&$select=subject,start,end,isAllDay`;
  while (url) {
    const res = await fetch(url, { headers });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || "Graph error");
    for (const e of json.value || []) {
      const s = (e.subject || "").toLowerCase();
      const isVac = s.includes("vacation");
      const isOnCall = (s.includes("on call") || s.includes("oncall")) && !isVac;
      if (!isVac && !isOnCall) continue;
      const name = firstNameFromSubject(e.subject);
      if (!name) continue;
      for (const d of eventDays(e)) {
        if (!byDate[d]) byDate[d] = { oncall: new Set(), vacation: new Set() };
        byDate[d][isVac ? "vacation" : "oncall"].add(name);
      }
    }
    url = json["@odata.nextLink"] || null;
  }

  // Days where the same person is both on call and on vacation
  const conflicts = [];
  for (const [date, sets] of Object.entries(byDate)) {
    for (const name of sets.oncall) {
      if (sets.vacation.has(name)) conflicts.push({ date, name });
    }
  }
  conflicts.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  if (!conflicts.length) {
    if (adminOnly) await sendSms(alertPhone, "No on-call / vacation conflicts found in the next 365 days.\n- SkySuite").catch(e => console.error("[conflictCheck] admin:", e.message));
    console.log("[conflictCheck] No conflicts.");
    return { ok: true, conflicts: [], adminOnly };
  }

  // Group by person for clean per-person date lists
  const byPerson = {};
  for (const c of conflicts) { (byPerson[c.name] ||= []).push(c.date); }

  // 1. Summary to the single alert number — one line per person
  const lines = Object.entries(byPerson).map(([name, dates]) => `${cap(name)}: ${dates.sort().join(", ")}`);
  await sendSms(alertPhone, `On-call/vacation conflicts (next 365 days):\n${lines.join("\n")}\n- SkySuite`).catch(e => console.error("[conflictCheck] alert:", e.message));

  // 2. Text each affected person (skipped in adminOnly/manual mode)
  if (!adminOnly) {
    const usersSnap = await db.collection("users").get();
    const users = usersSnap.docs.map(d => d.data());
    for (const [name, dates] of Object.entries(byPerson)) {
      try {
        const user = findUserByFirstName(users, name);
        if (!user?.phone) { console.log(`[conflictCheck] No phone for ${name}.`); continue; }
        await sendSms(user.phone, `Heads up ${cap(name)} — you're scheduled on call during your vacation: ${dates.sort().join(", ")}. Please arrange a swap. - SkySuite`);
      } catch (e) { console.error(`[conflictCheck] ${name}:`, e.message); }
    }
  }

  console.log(`[conflictCheck] ${conflicts.length} conflict day(s) across ${Object.keys(byPerson).length} people${adminOnly ? " (admin-only)" : ""}.`);
  return { ok: true, conflicts, people: Object.keys(byPerson).length, adminOnly };
}

// Each morning at 7:00 — full run (admin summary + per-person texts).
export const vacationConflictCheck = onSchedule(
  { schedule: "every day 07:00", timeZone: TZ, timeoutSeconds: 300 },
  async () => { await runConflictCheck({ adminOnly: false }); }
);
