import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function initFirebase() {
  if (!getApps().length) {
    initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)) });
  }
}

/** Add one calendar day to a YYYY-MM-DD string. */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return [
    dt.getFullYear(),
    String(dt.getMonth() + 1).padStart(2, "0"),
    String(dt.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Escape special chars in iCal text values (RFC 5545 §3.3.11). */
function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    initFirebase();
    const db = getFirestore();
    const snap = await db.collection("onCallAssignments").get();

    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//RBT Hub//On-Call Schedule//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:RBT On-Call Schedule",
      "X-WR-TIMEZONE:America/Toronto",
      "X-PUBLISHED-TTL:PT15M",
    ];

    for (const doc of snap.docs) {
      const { date, employeeName } = doc.data() as { date: string; employeeName: string };
      if (!date || !employeeName) continue;
      const firstName = employeeName.split(" ")[0];
      const dtStart = date.replace(/-/g, "");
      const dtEnd = nextDay(date).replace(/-/g, "");
      lines.push(
        "BEGIN:VEVENT",
        `UID:oncall-${date}@rbt-hub`,
        `DTSTART;VALUE=DATE:${dtStart}`,
        `DTEND;VALUE=DATE:${dtEnd}`,
        `SUMMARY:${escapeText(firstName)} On-Call`,
        "END:VEVENT"
      );
    }

    lines.push("END:VCALENDAR");

    const body = lines.join("\r\n") + "\r\n";

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="rbt-oncall.ics"');
    res.setHeader("Cache-Control", "public, max-age=900");
    return res.status(200).send(body);
  } catch (e: any) {
    return res.status(500).send("Error generating calendar feed.");
  }
}
