/**
 * dailyOnCallFill
 *
 * Runs every day at 6:00 AM Eastern.
 * Ensures the on-call calendar always has exactly 365 days scheduled.
 * Reads rotation orders + roster from Firestore, fills any gaps via Graph API.
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "./utils/firestore.js";

const TENANT_ID = "1c1d62e8-f392-4caa-a8a6-0ce98e0913d9";
const CLIENT_ID  = "9a1a21f1-40a3-4872-a4d6-888bd51d116d";
const CAL_ID     = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";

async function getAccessToken() {
  const snap = await db.collection("settings").doc("outlookOnCall").get();
  const refreshToken = snap.data()?.refreshToken;
  if (!refreshToken) throw new Error("No Outlook refresh token in Firestore.");

  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: "Calendars.ReadWrite offline_access",
      }),
    }
  );
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${data.error_description}`);

  // Save updated refresh token
  await db.collection("settings").doc("outlookOnCall").set(
    { refreshToken: data.refresh_token },
    { merge: true }
  );
  return data.access_token;
}

async function graphGet(token, path) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function graphPost(token, path, body) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export const dailyOnCallFill = onSchedule(
  { schedule: "every day 06:00", timeZone: "America/Toronto", memory: "512MiB", timeoutSeconds: 540 },
  async () => {
    console.log("[dailyOnCallFill] Starting...");

    // 1. Load roster + rotation orders
    const [cfgSnap, ordSnap] = await Promise.all([
      db.collection("settings").doc("onCallConfig").get(),
      db.collection("settings").doc("rotationOrders").get(),
    ]);

    const employees = cfgSnap.data()?.employees || [];
    if (!employees.length) { console.log("No employees in roster. Skipping."); return; }

    const rotOrders = ordSnap.exists() ? ordSnap.data() : {};
    console.log(`Roster: ${employees.join(", ")}`);

    // Auto-generate rotation order for any missing year
    function getOrderForYear(year) {
      if (rotOrders[String(year)]?.length) return rotOrders[String(year)];
      const shuffled = [...employees].sort(() => Math.random() - 0.5);
      rotOrders[String(year)] = shuffled;
      return shuffled;
    }

    // Save any newly generated orders
    await db.collection("settings").doc("rotationOrders").set(rotOrders, { merge: true });

    // 2. Get access token
    const token = await getAccessToken();

    // 3. Find the 365-day window
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const endDate = new Date(today); endDate.setDate(endDate.getDate() + 364);
    const endStr = endDate.toISOString().slice(0, 10);

    // 4. Fetch existing on-call events
    const occupied = new Set();
    let url = `/me/calendars/${encodeURIComponent(CAL_ID)}/calendarView?startDateTime=${todayStr}T00:00:00&endDateTime=${endStr}T23:59:59&$top=999&$select=id,subject,start`;
    while (url) {
      const data = await graphGet(token, url.startsWith("https://") ? url.replace("https://graph.microsoft.com/v1.0", "") : url);
      (data.value || []).forEach(e => {
        const s = (e.subject || "").toLowerCase();
        if ((s.includes("on call") || s.includes("oncall")) && !s.includes("vacation")) {
          const d = e.start?.date || e.start?.dateTime?.slice(0, 10);
          if (d) occupied.add(d);
        }
      });
      url = data["@odata.nextLink"] || null;
    }
    console.log(`Existing on-call days: ${occupied.size}`);

    // 5. Find gaps and build events to create
    const toAdd = [];
    let cur = new Date(todayStr + "T12:00:00");
    let globalIdx = 0; // continuous index across all days

    // Figure out where we are in the rotation by counting from Jan 1 of this year
    const yearStart = new Date(`${today.getFullYear()}-01-01T12:00:00`);
    const daysSinceYearStart = Math.floor((cur - yearStart) / 86400000);
    const yearOrder = getOrderForYear(today.getFullYear());
    globalIdx = daysSinceYearStart;

    while (cur.toISOString().slice(0, 10) <= endStr) {
      const d = cur.toISOString().slice(0, 10);
      const yr = cur.getFullYear();
      const order = getOrderForYear(yr);

      if (!occupied.has(d)) {
        const name = order[globalIdx % order.length];
        const nextDay = addDays(d, 1);
        toAdd.push({
          subject: `${name} On Call`,
          start: { dateTime: `${d}T00:00:00`, timeZone: "America/Toronto" },
          end:   { dateTime: `${nextDay}T00:00:00`, timeZone: "America/Toronto" },
          isAllDay: true,
        });
      }
      globalIdx++;
      cur.setDate(cur.getDate() + 1);
    }

    if (toAdd.length === 0) {
      console.log("✅ Calendar is complete — no gaps to fill.");
      return;
    }

    console.log(`Filling ${toAdd.length} gaps...`);

    // 6. Create events in batches of 4
    let pushed = 0;
    for (let i = 0; i < toAdd.length; i += 4) {
      const chunk = toAdd.slice(i, i + 4);
      await graphPost(token, "/$batch", {
        requests: chunk.map((e, j) => ({
          id: String(j + 1),
          method: "POST",
          url: `/me/calendars/${CAL_ID}/events`,
          headers: { "Content-Type": "application/json" },
          body: e,
        })),
      });
      pushed += chunk.length;
      // Small delay to avoid throttling
      await new Promise(r => setTimeout(r, 250));
    }

    console.log(`✅ dailyOnCallFill: created ${pushed} events. Calendar now has ${occupied.size + pushed} days.`);
  }
);
