// Shared name helpers for the SMS jobs so the two functions can't drift apart.

// First alphabetic token of a calendar subject, ignoring "on call"/"vacation"
// and any separators (dash, colon, slash, parens). Returns "" if none.
export function firstNameFromSubject(subject) {
  const cleaned = String(subject || "").replace(/on ?call/ig, "").replace(/vacation/ig, "");
  const m = cleaned.match(/[A-Za-z][A-Za-z'’-]*/);
  return m ? m[0].toLowerCase() : "";
}

// First alphabetic token of a user's display name (coerced — never throws).
export function firstNameOf(displayName) {
  const m = String(displayName || "").trim().match(/[A-Za-z][A-Za-z'’-]*/);
  return m ? m[0].toLowerCase() : "";
}

// Find the user for a first name, preferring one that has a phone number.
export function findUserByFirstName(users, fn) {
  return users.find(u => firstNameOf(u.displayName) === fn && u.phone)
      || users.find(u => firstNameOf(u.displayName) === fn);
}

// Expand a Graph event into the list of YYYY-MM-DD days it covers.
// All-day events have an EXCLUSIVE end (next-day midnight); Microsoft Graph
// returns them as midnight dateTimes with isAllDay:true (NOT a `date` field),
// so detect all-day via the isAllDay flag. Timed events' end is inclusive of
// the start day (so a same-day timed event still yields one day).
export function eventDays(e) {
  const startStr = e.start?.date || e.start?.dateTime?.slice(0, 10);
  if (!startStr) return [];
  const isAllDay = e.isAllDay === true || !!e.start?.date;
  const endStr = e.end?.date || e.end?.dateTime?.slice(0, 10) || startStr;
  const cur = new Date(startStr + "T12:00:00");
  const last = new Date(endStr + "T12:00:00");
  if (isAllDay) last.setDate(last.getDate() - 1); // exclusive end -> last inclusive day
  if (isNaN(cur) || isNaN(last) || last < cur) return [startStr];
  const days = [];
  let guard = 0;
  for (let d = new Date(cur); d <= last && guard < 800; d.setDate(d.getDate() + 1), guard++) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
