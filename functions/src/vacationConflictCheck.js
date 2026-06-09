import { onSchedule } from "firebase-functions/v2/scheduler";
import { getOutlookAccessToken } from "./utils/getOutlookToken.js";
import { SHARED_CAL_ID } from "./utils/getVacationCalendar.js";
import { sendSms } from "./utils/twilio.js";
import { db } from "./utils/firestore.js";

function firstName(subject) {
  return (subject || "").replace(/on ?call/ig, "").replace(/vacation/ig, "").replace(/[-–]/g, " ").trim().split(/\s+/)[0]?.toLowerCase() || "";
}

// Each morning, checks the next 60 days for anyone scheduled on call on a day
// they're also on vacation, and texts a single alert number with the conflicts.
export const vacationConflictCheck = onSchedule(
  { schedule: "every day 07:30", timeZone: "America/Toronto", timeoutSeconds: 120 },
  async () => {
    const cfg = (await db.collection("settings").doc("onCallConfig").get()).data() || {};
    const alertPhone = cfg.alertPhone;
    if (!alertPhone) { console.log("[conflictCheck] No alertPhone set; skipping."); return; }

    const token = await getOutlookAccessToken();
    const start = new Date().toISOString().slice(0, 10);
    const endD  = new Date(); endD.setDate(endD.getDate() + 60);
    const end   = endD.toISOString().slice(0, 10);

    // Map: date → { oncall:Set<name>, vacation:Set<name> }
    const byDate = {};
    let url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(SHARED_CAL_ID)}/calendarView?startDateTime=${start}T00:00:00&endDateTime=${end}T23:59:59&$top=999&$select=subject,start,end`;
    while (url) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Graph error");
      for (const e of json.value || []) {
        const s = (e.subject || "").toLowerCase();
        const isVac = s.includes("vacation");
        const isOnCall = (s.includes("on call") || s.includes("oncall")) && !isVac;
        if (!isVac && !isOnCall) continue;
        const name = firstName(e.subject);
        if (!name) continue;
        // Expand across the event's day range
        let cur = new Date((e.start?.date || e.start?.dateTime?.slice(0, 10)) + "T12:00:00");
        const last = new Date((e.end?.date || e.end?.dateTime?.slice(0, 10) || e.start?.date) + "T12:00:00");
        while (cur < last) {
          const d = cur.toISOString().slice(0, 10);
          if (!byDate[d]) byDate[d] = { oncall: new Set(), vacation: new Set() };
          byDate[d][isVac ? "vacation" : "oncall"].add(name);
          cur.setDate(cur.getDate() + 1);
        }
      }
      url = json["@odata.nextLink"] || null;
    }

    // Find days where the same person is both on call and on vacation
    const conflicts = [];
    for (const [date, sets] of Object.entries(byDate)) {
      for (const name of sets.oncall) {
        if (sets.vacation.has(name)) conflicts.push({ date, name });
      }
    }
    conflicts.sort((a, b) => a.date.localeCompare(b.date));

    if (!conflicts.length) { console.log("[conflictCheck] No conflicts."); return; }

    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const lines = conflicts.slice(0, 15).map(c => `${cap(c.name)} — ${c.date}`).join("\n");
    const more = conflicts.length > 15 ? `\n…and ${conflicts.length - 15} more` : "";
    await sendSms(alertPhone, `⚠️ On-call/vacation conflicts:\n${lines}${more}\n– SkySuite`);
    console.log(`[conflictCheck] Sent ${conflicts.length} conflict(s) to ${alertPhone}.`);
  }
);
