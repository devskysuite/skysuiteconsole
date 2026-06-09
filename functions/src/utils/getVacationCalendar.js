import { db } from "./firestore.js";

// Resolves the dedicated "Vacation" calendar id in the shared Outlook account.
// Caches the id on settings/outlookOnCall.vacationCalId. Creates the calendar if missing.
export async function getVacationCalendarId(token) {
  const ref  = db.collection("settings").doc("outlookOnCall");
  const snap = await ref.get();
  const cached = snap.data()?.vacationCalId;
  if (cached) return cached;

  // Look for an existing calendar named like "Vacation"
  const r = await fetch("https://graph.microsoft.com/v1.0/me/calendars?$top=100", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await r.json();
  let cal = (j.value || []).find(c => (c.name || "").toLowerCase().includes("vacation"));

  // Create one if none exists
  if (!cal) {
    const cr = await fetch("https://graph.microsoft.com/v1.0/me/calendars", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Vacation" }),
    });
    cal = await cr.json();
  }

  if (cal?.id) await ref.update({ vacationCalId: cal.id }).catch(() => {});
  return cal?.id || null;
}
