import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, onSnapshot, query, where, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, getDocs, limit,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { useIsAdmin } from "../hooks/useIsAdmin";
import Spinner from "../components/Spinner";
import { getOutlookToken } from "../utils/outlookToken";

type OnCallAssignment = { id: string; date: string; uid: string; employeeName: string };
type DispatchUser    = { uid: string; displayName: string };
type ApprovedVacation = { id: string; employeeName: string; startDate: string; endDate: string; uid?: string };

type Visit = {
  id: string;
  techUid: string;
  techName: string;
  date: string;        // YYYY-MM-DD
  title: string;       // customer / job name
  jobNumber?: string;
  jobId?: string;      // linked job ID (if created from a job)
  visitNumber?: number;
  start?: string;      // HH:MM (24h)
  end?: string;        // HH:MM
  duration?: number;
  status: string;      // see STATUSES keys
  priority?: "high" | "normal" | "";
  flagged?: boolean;
  notes?: string;
  department?: string;
};

type Tech = { uid: string; name: string; section?: string };

// Calendar events pulled from Outlook (vacation / on-call)
type CalChip = { type: "vacation" | "oncall"; label: string; eventId?: string };
type CalMap  = Record<string, CalChip[]>; // key: "firstName|YYYY-MM-DD"

// Status → label + colors (modeled on the dispatch board screenshot)
const STATUSES: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  scheduled: { label: "Scheduled", bg: "#eef2f7", fg: "#0d2e5e", border: "#cbd5e1" },
  traveling: { label: "Traveling", bg: "#dbeafe", fg: "#1e40af", border: "#93c5fd" },
  working:   { label: "Working",   bg: "#1565c0", fg: "#ffffff", border: "#0d47a1" },
  paused:    { label: "Paused",    bg: "#fef9c3", fg: "#854d0e", border: "#fde047" },
  onhold:    { label: "On Hold",   bg: "#ffedd5", fg: "#9a3412", border: "#fdba74" },
  canceled:  { label: "Canceled",  bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" },
  closed:    { label: "Closed",    bg: "#f3f4f6", fg: "#6b7280", border: "#d1d5db" },
  complete:  { label: "Complete",  bg: "#dcfce7", fg: "#166534", border: "#86efac" },
};
const STATUS_ORDER = ["scheduled", "traveling", "working", "paused", "onhold", "canceled", "closed", "complete"];

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayStr() { return fmtYMD(new Date()); }
function weekDays(dateStr: string): string[] {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay();                 // 0 Sun .. 6 Sat
  const offsetToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d); mon.setDate(d.getDate() + offsetToMon);
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return fmtYMD(x); });
}
function prettyDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtTime(t?: string) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join("");
}

export default function DispatchPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [techs, setTechs] = useState<Tech[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<"week" | "day">("week");
  const [anchor, setAnchor] = useState<string>(todayStr());   // selected date
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [activeStatus, setActiveStatus] = useState<string>("all"); // "all" or a status key

  const [modal, setModal] = useState<{ techUid: string; techName: string; date: string; visit?: Visit } | null>(null);
  const [calMap, setCalMap] = useState<CalMap>({});

  // On-call swap state
  const [assignments, setAssignments]     = useState<OnCallAssignment[]>([]);
  const [allUsers, setAllUsers]           = useState<DispatchUser[]>([]);
  const [swapModal, setSwapModal]         = useState<{ assignment: OnCallAssignment } | null>(null);
  const [swapToUid, setSwapToUid]         = useState("");
  const [swapOfferDate, setSwapOfferDate] = useState("");
  const [swapReason, setSwapReason]       = useState("");
  const [swapping, setSwapping]           = useState(false);

  // Top-level view: job board vs monthly on-call vs monthly vacation
  const [boardView, setBoardView] = useState<"board" | "oncall" | "vacation">("board");
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`;
  });
  const [monthCalMap, setMonthCalMap] = useState<CalMap>({});

  // Approved vacation from Firestore (for vacation monthly view)
  const [approvedVacation, setApprovedVacation] = useState<ApprovedVacation[]>([]);
  const [vacStarted, setVacStarted] = useState(false);

  // On-call monthly CRUD modals
  const [addOnCallModal, setAddOnCallModal] = useState<string | null>(null); // date string
  const [addOnCallUid, setAddOnCallUid]     = useState("");
  const [addOnCallBusy, setAddOnCallBusy]   = useState(false);
  const [deleteOnCallId, setDeleteOnCallId] = useState<string | null>(null);

  // On-call action picker (chip click → choose Swap / Give Away / Delete)
  const [onCallActionModal, setOnCallActionModal] = useState<{ date: string; assignment: OnCallAssignment } | null>(null);
  const [giveAwayModal, setGiveAwayModal]         = useState<{ assignment: OnCallAssignment } | null>(null);
  const [giveToUid, setGiveToUid]                 = useState("");
  const [giveAwayBusy, setGiveAwayBusy]           = useState(false);

  // Vacation monthly CRUD modals
  const [addVacModal, setAddVacModal] = useState<string | null>(null); // start date
  const [addVacEnd, setAddVacEnd]     = useState("");
  const [addVacName, setAddVacName]   = useState("");
  const [addVacUid, setAddVacUid]     = useState("");
  const [addVacBusy, setAddVacBusy]   = useState(false);
  const [deleteVacId, setDeleteVacId] = useState<string | null>(null);

  // Technicians flagged to show on the dispatch board
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .filter(u => u.showInDispatch && (u.uid || u.id))
        .map(u => ({ uid: u.uid || u.id, name: u.displayName || u.email || "Unknown", section: u.section }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setTechs(list);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);

  // Visits (real-time)
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, "dispatchVisits")), snap => {
      setVisits(snap.docs.map(d => ({ id: d.id, ...d.data() } as Visit)));
    }, () => {});
    return unsub;
  }, []);

  // On-call assignments (real-time)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "onCallAssignments"), snap => {
      setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() } as OnCallAssignment)));
    }, () => {});
    return unsub;
  }, []);

  // force re-fetch after writing to Outlook (add / delete vacation)
  const [monthRefreshKey, setMonthRefreshKey] = useState(0);

  // Monthly Outlook fetch — runs when on-call or vacation view is open, re-runs on month change
  useEffect(() => {
    if (boardView === "board") return;
    const [y, m] = monthAnchor.split("-").map(Number);
    // Expand range to cover full calendar grid (prev/next month overflow days)
    const firstDay = new Date(y, m-1, 1);
    const firstDow = firstDay.getDay(); // 0=Sun
    const gridStartD = new Date(y, m-1, 1 - firstDow);
    const lastDay = new Date(y, m, 0); // last day of month
    const lastDow = lastDay.getDay();
    const trailingDays = lastDow === 6 ? 0 : 6 - lastDow;
    const gridEndD = new Date(y, m, 0);
    gridEndD.setDate(gridEndD.getDate() + trailingDays + 1); // exclusive
    const start = fmtYMD(gridStartD);
    const end   = fmtYMD(gridEndD);
    let cancelled = false;
    setMonthCalMap({});
    getOutlookToken().then(async token => {
      if (!token || token === "disconnected" || cancelled) return;
      try {
        const CAL_ID = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";
        const headers = { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="America/Toronto"' };
        const evs: any[] = [];
        let url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(CAL_ID)}/calendarView?startDateTime=${start}T00:00:00&endDateTime=${end}T00:00:00&$top=200&$select=id,subject,start,end`;
        while (url) {
          const res = await fetch(url, { headers });
          const json = await res.json();
          if (!res.ok || cancelled) return;
          evs.push(...(json.value || []));
          url = json["@odata.nextLink"] || null;
        }
        if (cancelled) return;
        const map: CalMap = {};
        for (const ev of evs) {
          const subj = (ev.subject || "") as string;
          const sl = subj.toLowerCase();
          let type: "vacation" | "oncall" | null = null;
          if (sl.includes("vacation")) type = "vacation";
          else if (sl.includes("on call") || sl.includes("oncall")) type = "oncall";
          if (!type) continue;
          let personName = "";
          if (type === "vacation") {
            const mx = subj.match(/vacation\s*[-–]\s*(.+)/i);
            personName = mx ? mx[1].trim() : "";
          } else {
            const mx = subj.match(/^(.+?)\s+(?:on\s+call|oncall)/i);
            personName = mx ? mx[1].trim() : "";
          }
          const firstName = personName.split(/\s+/)[0].toLowerCase();
          if (!firstName || firstName === "vacation") continue;
          const evStart = ev.start?.date || ev.start?.dateTime?.slice(0, 10) || "";
          const evEnd   = ev.end?.date   || ev.end?.dateTime?.slice(0, 10)   || "";
          if (!evStart || !evEnd) continue;
          let cur = new Date(evStart + "T12:00:00");
          const evEndD = new Date(evEnd + "T12:00:00");
          while (cur < evEndD) {
            const d = fmtYMD(cur);
            if (d >= start && d < end) {
              const key = `${firstName}|${d}`;
              (map[key] ||= []).push({ type, label: subj, eventId: ev.id });
            }
            cur.setDate(cur.getDate() + 1);
          }
        }
        setMonthCalMap(map);
      } catch {}
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [boardView, monthAnchor, monthRefreshKey]);

  // All users for swap dropdown
  useEffect(() => {
    getDocs(collection(db, "users")).then(snap => {
      const list = snap.docs.map(d => ({
        uid: (d.data().uid || d.id) as string,
        displayName: (d.data().displayName || d.data().email || "") as string,
      })).filter(u => u.displayName).sort((a, b) => a.displayName.localeCompare(b.displayName));
      setAllUsers(list);
    }).catch(() => {});
  }, []);

  // Approved vacation listener — lazy, starts on first visit to vacation view
  useEffect(() => {
    if (boardView !== "vacation" || vacStarted) return;
    setVacStarted(true);
    const unsub = onSnapshot(
      query(collection(db, "timeOffRequests"), where("status", "==", "APPROVED")),
      snap => setApprovedVacation(snap.docs.map(d => ({ id: d.id, ...d.data() } as ApprovedVacation))),
      () => {}
    );
    return unsub;
  }, [boardView, vacStarted]);

  const days = useMemo(() => (view === "week" ? weekDays(anchor) : [anchor]), [view, anchor]);

  // Pull vacation + on-call events from Outlook for the displayed date range
  useEffect(() => {
    const start = days[0];
    const end   = days[days.length - 1];
    // Add one day to end so the calendarView includes the last day
    const endD = new Date(end + "T00:00:00"); endD.setDate(endD.getDate() + 1);
    const endStr = fmtYMD(endD);

    let cancelled = false;
    getOutlookToken().then(async token => {
      if (!token || token === "disconnected" || cancelled) return;
      try {
        const CAL_ID = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";
        const headers = { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="America/Toronto"' };
        const evs: any[] = [];
        let url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(CAL_ID)}/calendarView?startDateTime=${start}T00:00:00&endDateTime=${endStr}T00:00:00&$top=200&$select=id,subject,start,end`;
        while (url) {
          const res  = await fetch(url, { headers });
          const json = await res.json();
          if (!res.ok || cancelled) return;
          evs.push(...(json.value || []));
          url = json["@odata.nextLink"] || null;
        }
        if (cancelled) return;

        const map: CalMap = {};
        const TZ = "America/Toronto";

        for (const ev of evs) {
          const subj = (ev.subject || "") as string;
          const sl   = subj.toLowerCase();
          let type: "vacation" | "oncall" | null = null;
          if (sl.includes("vacation")) type = "vacation";
          else if (sl.includes("on call") || sl.includes("oncall")) type = "oncall";
          if (!type) continue;

          // Extract person name from subject:
          // Vacation format: "Vacation - John Smith"  → extract after "Vacation - "
          // On-call format:  "John Smith On Call"     → extract before " On Call"
          let personName = "";
          if (type === "vacation") {
            const m = subj.match(/vacation\s*[-–]\s*(.+)/i);
            personName = m ? m[1].trim() : "";
          } else {
            const m = subj.match(/^(.+?)\s+(?:on\s+call|oncall)/i);
            personName = m ? m[1].trim() : "";
          }
          const firstName = personName.split(/\s+/)[0].toLowerCase();
          if (!firstName || firstName === "vacation") continue;

          // Use just the date portion — avoids timezone shift from appending "Z"
          // to dateTime values already returned in Toronto local time by the Prefer header
          const evStartDate = ev.start?.date || ev.start?.dateTime?.slice(0, 10) || "";
          const evEndDate   = ev.end?.date   || ev.end?.dateTime?.slice(0, 10)   || "";
          if (!evStartDate || !evEndDate) continue;
          let cur = new Date(evStartDate + "T12:00:00"); // noon avoids DST edge cases
          const endD = new Date(evEndDate + "T12:00:00");
          while (cur < endD) {
            const d = fmtYMD(cur);
            if (d >= start && d <= end) {
              const key = `${firstName}|${d}`;
              (map[key] ||= []).push({ type, label: subj, eventId: ev.id });
            }
            cur.setDate(cur.getDate() + 1);
          }
        }
        setCalMap(map);
      } catch {}
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [days[0], days[days.length - 1]]);

  // Index visits by techUid|date
  const byCell = useMemo(() => {
    const m: Record<string, Visit[]> = {};
    for (const v of visits) {
      if (v.status === "canceled" && activeStatus !== "canceled") continue;
      if (flaggedOnly && !v.flagged) continue;
      if (activeStatus !== "all" && v.status !== activeStatus) continue;
      const k = `${v.techUid}|${v.date}`;
      (m[k] ||= []).push(v);
    }
    for (const k in m) m[k].sort((a, b) => {
      const ta = a.start || "99:99", tb = b.start || "99:99";
      if (ta !== tb) return ta.localeCompare(tb);
      return (a.visitNumber || 0) - (b.visitNumber || 0);
    });
    return m;
  }, [visits, flaggedOnly, activeStatus]);

  const weekSummary = useMemo(() => {
    const vacations: Record<string, string[]> = {};
    const oncall: Record<string, string> = {};
    for (const [key, chips] of Object.entries(calMap)) {
      const [, date] = key.split("|");
      for (const chip of chips) {
        if (chip.type === "vacation") {
          const m = chip.label.match(/vacation\s*[-–]\s*(.+)/i);
          const name = m ? m[1].trim() : key.split("|")[0];
          (vacations[date] ||= []).push(name);
        } else if (chip.type === "oncall") {
          const m = chip.label.match(/^(.+?)\s+(?:on\s+call|oncall)/i);
          oncall[date] = m ? m[1].trim() : key.split("|")[0];
        }
      }
    }
    return { vacations, oncall };
  }, [calMap]);

  function shift(dir: number) {
    const d = new Date(anchor + "T00:00:00");
    d.setDate(d.getDate() + dir * (view === "week" ? 7 : 1));
    setAnchor(fmtYMD(d));
  }

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of visits) c[v.status] = (c[v.status] || 0) + 1;
    return c;
  }, [visits]);

  // Monthly calendar helpers
  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  function calMonthDays(ym: string): string[] {
    const [y, m] = ym.split("-").map(Number);
    const arr: string[] = [];
    const cur = new Date(y, m-1, 1);
    while (cur.getMonth() === m-1) { arr.push(fmtYMD(cur)); cur.setDate(cur.getDate()+1); }
    return arr;
  }
  function shiftMo(ym: string, dir: number): string {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m-1+dir, 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  }

  // Monthly summary derived from Outlook calMap (same logic as weekSummary)
  const monthSummary = useMemo(() => {
    const vacations: Record<string, string[]> = {};
    const oncall: Record<string, string> = {};
    for (const [key, chips] of Object.entries(monthCalMap)) {
      const [, date] = key.split("|");
      for (const chip of chips) {
        if (chip.type === "vacation") {
          const mx = chip.label.match(/vacation\s*[-–]\s*(.+)/i);
          const name = mx ? mx[1].trim() : key.split("|")[0];
          (vacations[date] ||= []).push(name);
        } else if (chip.type === "oncall") {
          const mx = chip.label.match(/^(.+?)\s+(?:on\s+call|oncall)/i);
          oncall[date] = mx ? mx[1].trim() : key.split("|")[0];
        }
      }
    }
    return { vacations, oncall };
  }, [monthCalMap]);

  // Firestore assignments keyed by date — all entries so duplicates are visible
  const assignmentByDate = useMemo(() => {
    const m: Record<string, OnCallAssignment[]> = {};
    for (const a of assignments) (m[a.date] ||= []).push(a);
    return m;
  }, [assignments]);

  // Approved vacation from Firestore keyed by date (for vacation monthly view)
  const vacByDate = useMemo(() => {
    const m: Record<string, { id: string; name: string }[]> = {};
    for (const v of approvedVacation) {
      if (!v.startDate || !v.endDate) continue;
      let cur = new Date(v.startDate + "T12:00:00");
      const stopD = new Date(v.endDate + "T12:00:00");
      stopD.setDate(stopD.getDate() + 1); // include end date
      while (cur < stopD) {
        const d = fmtYMD(cur);
        (m[d] ||= []).push({ id: v.id, name: v.employeeName });
        cur.setDate(cur.getDate() + 1);
      }
    }
    return m;
  }, [approvedVacation]);

  // On-call monthly CRUD handlers
  async function handleAddOnCall() {
    if (!addOnCallModal || !addOnCallUid) return;
    const person = allUsers.find(u => u.uid === addOnCallUid);
    if (!person) return;
    setAddOnCallBusy(true);
    try {
      // Delete any existing assignments for this date before adding the new one
      const existing = await getDocs(query(collection(db, "onCallAssignments"), where("date", "==", addOnCallModal)));
      await Promise.all(existing.docs.map(d => deleteDoc(doc(db, "onCallAssignments", d.id))));
      await addDoc(collection(db, "onCallAssignments"), {
        date: addOnCallModal,
        uid: addOnCallUid,
        employeeName: person.displayName,
        assignedByUid: auth.currentUser?.uid || "",
        createdAt: serverTimestamp(),
      });
      setAddOnCallModal(null); setAddOnCallUid("");
    } catch {}
    setAddOnCallBusy(false);
  }

  async function handleDeleteOnCall() {
    if (!deleteOnCallId) return;
    try { await deleteDoc(doc(db, "onCallAssignments", deleteOnCallId)); }
    catch {}
    setDeleteOnCallId(null);
  }

  async function handleGiveAway() {
    if (!giveAwayModal || !giveToUid) return;
    const { assignment } = giveAwayModal;
    const newPerson = allUsers.find(u => u.uid === giveToUid);
    if (!newPerson) return;
    setGiveAwayBusy(true);
    try {
      await updateDoc(doc(db, "onCallAssignments", assignment.id), {
        uid: giveToUid, employeeName: newPerson.displayName,
      });
      await addDoc(collection(db, "onCallGiveaways"), {
        fromUid: assignment.uid, fromName: assignment.employeeName,
        toUid: giveToUid, toName: newPerson.displayName,
        date: assignment.date, gaveAwayAt: serverTimestamp(),
      });
      setGiveAwayModal(null); setGiveToUid("");
    } catch {}
    setGiveAwayBusy(false);
  }

  // Vacation entries from Outlook calMap — keyed by date with eventId for deletion
  const monthVacItems = useMemo(() => {
    const m: Record<string, { name: string; eventId: string }[]> = {};
    for (const [key, chips] of Object.entries(monthCalMap)) {
      const [, date] = key.split("|");
      for (const chip of chips) {
        if (chip.type === "vacation" && chip.eventId) {
          const mx = chip.label.match(/vacation\s*[-–]\s*(.+)/i);
          const name = mx ? mx[1].trim() : key.split("|")[0];
          const existing = (m[date] ||= []);
          if (!existing.some(x => x.eventId === chip.eventId))
            existing.push({ name, eventId: chip.eventId });
        }
      }
    }
    return m;
  }, [monthCalMap]);

  const CAL_ID = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";

  // Vacation monthly CRUD handlers — write directly to Outlook via Graph API
  async function handleAddVacation() {
    if (!addVacModal || !addVacName.trim()) return;
    setAddVacBusy(true);
    try {
      const token = await getOutlookToken();
      if (!token || token === "disconnected") throw new Error("no token");
      const endDate = addVacEnd || addVacModal;
      // Graph API "end" for all-day events is exclusive (next day)
      const endExclusive = fmtYMD(new Date(new Date(endDate + "T12:00:00").getTime() + 86_400_000));
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(CAL_ID)}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Prefer: 'outlook.timezone="America/Toronto"',
          },
          body: JSON.stringify({
            subject: `Vacation - ${addVacName.trim()}`,
            isAllDay: true,
            start: { dateTime: `${addVacModal}T00:00:00`, timeZone: "America/Toronto" },
            end:   { dateTime: `${endExclusive}T00:00:00`, timeZone: "America/Toronto" },
          }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      setMonthRefreshKey(k => k + 1);
      setAddVacModal(null); setAddVacName(""); setAddVacEnd(""); setAddVacUid("");
    } catch {
      alert("Could not create Outlook event. Check your calendar connection.");
    }
    setAddVacBusy(false);
  }

  async function handleDeleteVacation() {
    if (!deleteVacId) return;
    // deleteVacId is either a Firestore doc ID (legacy) or an Outlook event ID
    // Firestore legacy entries start with a predictable short ID; Outlook IDs are long AAMk... strings
    const isOutlook = deleteVacId.length > 80;
    try {
      if (isOutlook) {
        const token = await getOutlookToken();
        if (!token || token === "disconnected") throw new Error("no token");
        const res = await fetch(
          `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(CAL_ID)}/events/${encodeURIComponent(deleteVacId)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok && res.status !== 404) throw new Error(await res.text());
        setMonthRefreshKey(k => k + 1);
      } else {
        await deleteDoc(doc(db, "timeOffRequests", deleteVacId));
      }
    } catch {
      alert("Could not delete the vacation entry.");
    }
    setDeleteVacId(null);
  }

  // On-call swap handlers
  const requesterOnCallDays = assignments
    .filter(a => a.uid === swapToUid && a.date >= todayStr())
    .sort((a, b) => a.date.localeCompare(b.date));

  function openSwap(date: string) {
    const assignment = assignments.find(a => a.date === date);
    if (!assignment) return;
    setSwapModal({ assignment });
    setSwapToUid(""); setSwapOfferDate(""); setSwapReason("");
  }

  function closeSwap() {
    setSwapModal(null); setSwapToUid(""); setSwapOfferDate(""); setSwapReason("");
  }

  async function submitSwap() {
    if (!swapModal || !swapToUid) return;
    const { assignment } = swapModal;
    const newPerson = allUsers.find(u => u.uid === swapToUid);
    if (!newPerson) return;
    setSwapping(true);
    try {
      if (isAdmin) {
        await updateDoc(doc(db, "onCallAssignments", assignment.id), {
          uid: swapToUid, employeeName: newPerson.displayName,
        });
        if (swapOfferDate) {
          const existing = assignments.find(a => a.date === swapOfferDate && a.uid === swapToUid);
          if (existing) {
            await updateDoc(doc(db, "onCallAssignments", existing.id), {
              uid: assignment.uid, employeeName: assignment.employeeName,
            });
          } else {
            await addDoc(collection(db, "onCallAssignments"), {
              date: swapOfferDate, uid: assignment.uid, employeeName: assignment.employeeName,
              assignedByUid: auth.currentUser?.uid || "", createdAt: serverTimestamp(),
            });
          }
        }
      } else {
        let targetAssignmentId = "";
        if (swapOfferDate) {
          const match = assignments.find(a => a.date === swapOfferDate && a.uid === swapToUid);
          if (match) targetAssignmentId = match.id;
        }
        await addDoc(collection(db, "onCallSwapRequests"), {
          date: assignment.date, assignmentId: assignment.id,
          requesterUid: swapToUid, requesterName: newPerson.displayName,
          targetUid: assignment.uid, targetName: assignment.employeeName,
          targetDate: swapOfferDate || "", targetAssignmentId,
          reason: swapReason.trim(), status: "PENDING",
          createdAt: serverTimestamp(), resolvedAt: null,
        });
      }
      closeSwap();
    } catch {}
    setSwapping(false);
  }

  if (isAdmin === null) return <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>;

  return (
    <div>
      {/* ── Header bar ── */}
      <div style={s.headerBar}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span style={{ fontSize: 20, fontWeight: 800 }}>🗓 Job Board</span>
          <div style={s.segment}>
            <button style={boardView === "board"   ? s.segOn : s.segOff} onClick={() => setBoardView("board")}>JOB BOARD</button>
            <button style={boardView === "oncall"  ? s.segOn : s.segOff} onClick={() => setBoardView("oncall")}>ON CALL</button>
            <button style={boardView === "vacation"? s.segOn : s.segOff} onClick={() => setBoardView("vacation")}>VACATION</button>
          </div>
          {boardView === "board" && (
            <>
              <div style={s.segment}>
                <button style={view === "day" ? s.segOn : s.segOff} onClick={() => setView("day")}>DAY</button>
                <button style={view === "week" ? s.segOn : s.segOff} onClick={() => setView("week")}>WEEK</button>
              </div>
              <div style={s.segment}>
                <button style={!flaggedOnly ? s.segOn : s.segOff} onClick={() => setFlaggedOnly(false)}>ALL</button>
                <button style={flaggedOnly ? s.segOn : s.segOff} onClick={() => setFlaggedOnly(true)}>FLAGGED</button>
              </div>
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {boardView === "board" ? (
            <>
              <button style={s.navBtn} onClick={() => shift(-1)}>←</button>
              <input type="date" value={anchor} onChange={e => setAnchor(e.target.value || todayStr())} style={s.dateInput} />
              <button style={s.navBtn} onClick={() => shift(1)}>→</button>
              <button style={s.todayBtn} onClick={() => setAnchor(todayStr())}>TODAY</button>
            </>
          ) : (
            <>
              <button style={s.navBtn} onClick={() => setMonthAnchor(m => shiftMo(m, -1))}>←</button>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", minWidth: 160, textAlign: "center" }}>
                {(() => { const [y,m] = monthAnchor.split("-").map(Number); return `${MONTH_NAMES[m-1]} ${y}`; })()}
              </span>
              <button style={s.navBtn} onClick={() => setMonthAnchor(m => shiftMo(m, 1))}>→</button>
              <button style={s.todayBtn} onClick={() => { const n = new Date(); setMonthAnchor(`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`); }}>THIS MONTH</button>
            </>
          )}
        </div>
      </div>

      {/* ── Weekly vacation + on-call preview ── */}
      {(Object.keys(weekSummary.oncall).length > 0 || Object.keys(weekSummary.vacations).length > 0) && (
        <div style={{ background: "#f0f4ff", borderBottom: "1px solid #dbe4ff", padding: "8px 18px", display: "flex", gap: 24, flexWrap: "wrap", fontSize: 12 }}>
          {days.some(d => weekSummary.oncall[d]) && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 800, color: "#6d28d9", flexShrink: 0 }}>📞 On Call:</span>
              {days.map(d => weekSummary.oncall[d] ? (
                <span key={d} style={{ background: "#ede9fe", color: "#5b21b6", borderRadius: 99, padding: "2px 9px", fontWeight: 600 }}>
                  {DAY_NAMES[(new Date(d + "T00:00:00").getDay() + 6) % 7]}: {weekSummary.oncall[d]}
                </span>
              ) : null)}
            </div>
          )}
          {Object.keys(weekSummary.vacations).some(d => days.includes(d)) && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 800, color: "#c2410c", flexShrink: 0 }}>☀ Vacation:</span>
              {(() => {
                const people: Record<string, string[]> = {};
                for (const d of days) {
                  for (const name of weekSummary.vacations[d] || []) {
                    (people[name] ||= []).push(DAY_NAMES[(new Date(d + "T00:00:00").getDay() + 6) % 7]);
                  }
                }
                return Object.entries(people).map(([name, dayList]) => (
                  <span key={name} style={{ background: "#fff7ed", color: "#9a3412", borderRadius: 99, padding: "2px 9px", fontWeight: 600 }}>
                    {name} ({dayList.join(", ")})
                  </span>
                ));
              })()}
            </div>
          )}
        </div>
      )}

      {/* ── Monthly On-Call / Vacation calendar ── */}
      {boardView !== "board" && (() => {
        const [yr, mo] = monthAnchor.split("-").map(Number);
        const mDays  = calMonthDays(monthAnchor);
        const firstDow = new Date(mDays[0] + "T00:00:00").getDay();
        const lastDow  = new Date(mDays[mDays.length-1] + "T00:00:00").getDay();
        const todayYMD = todayStr();
        const isOncall = boardView === "oncall";

        const prevDays: string[] = [];
        for (let i = firstDow; i > 0; i--) prevDays.push(fmtYMD(new Date(yr, mo-1, 1 - i)));
        const trailingCount = lastDow === 6 ? 0 : 6 - lastDow;
        const nextDays: string[] = [];
        for (let i = 1; i <= trailingCount; i++) nextDays.push(fmtYMD(new Date(yr, mo, i)));

        const chipBase: React.CSSProperties = { borderRadius: 4, padding: "3px 8px", fontSize: 11, fontWeight: 700, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const };

        function OnCallDayCell({ d, overflow }: { d: string; overflow?: boolean }) {
          const isToday = d === todayYMD;
          const dayAssignments = !overflow ? (assignmentByDate[d] || []) : [];
          const outlookName = !overflow && dayAssignments.length === 0 ? monthSummary.oncall[d] : undefined;
          const dayNum = parseInt(d.slice(8));
          const canAdd = !overflow && isAdmin && dayAssignments.length === 0;
          return (
            <div
              style={{ background: overflow ? "#f9fafb" : "#fff", minHeight: 90, padding: "6px 8px", cursor: canAdd ? "pointer" : "default" }}
              onClick={() => { if (canAdd) { setAddOnCallModal(d); setAddOnCallUid(""); } }}
              title={canAdd ? "Click to assign on call" : undefined}
            >
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, color: isToday ? "#fff" : overflow ? "#c0c8d4" : "#374151", background: isToday ? "#1565c0" : "transparent", borderRadius: isToday ? "50%" : 0, width: isToday ? 22 : "auto", height: isToday ? 22 : "auto", display: "flex", alignItems: "center", justifyContent: "center" }}>{dayNum}</div>
              {dayAssignments.map(assignment => (
                <div
                  key={assignment.id}
                  style={{ ...chipBase, background: "#f5f3ff", color: "#6d28d9", border: "1px solid #ddd6fe", cursor: isAdmin ? "pointer" : "default" }}
                  onClick={e => { e.stopPropagation(); if (isAdmin) setOnCallActionModal({ date: d, assignment }); }}
                  title={isAdmin ? "Click for options" : undefined}
                >
                  {assignment.employeeName}
                </div>
              ))}
              {outlookName && (
                <div style={{ ...chipBase, background: "#f5f3ff", color: "#8b5cf6", border: "1px solid #ddd6fe", opacity: 0.65 }} title="Outlook only">
                  {outlookName}
                </div>
              )}
            </div>
          );
        }

        function VacDayCell({ d, overflow }: { d: string; overflow?: boolean }) {
          const isToday = d === todayYMD;
          const outlookVacs = !overflow ? (monthVacItems[d] || []) : [];
          const fsVacs = !overflow ? (vacByDate[d] || []) : [];
          const dayNum = parseInt(d.slice(8));
          const canAdd = !overflow && isAdmin;
          return (
            <div
              style={{ background: overflow ? "#f9fafb" : "#fff", minHeight: 90, padding: "6px 8px", cursor: canAdd ? "pointer" : "default" }}
              onClick={() => { if (canAdd) { setAddVacModal(d); setAddVacEnd(d); setAddVacName(""); setAddVacUid(""); } }}
              title={canAdd ? "Click to add vacation" : undefined}
            >
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, color: isToday ? "#fff" : overflow ? "#c0c8d4" : "#374151", background: isToday ? "#1565c0" : "transparent", borderRadius: isToday ? "50%" : 0, width: isToday ? 22 : "auto", height: isToday ? 22 : "auto", display: "flex", alignItems: "center", justifyContent: "center" }}>{dayNum}</div>
              {outlookVacs.map((v, i) => (
                <div key={"o" + i} style={{ display: "flex", gap: 2, alignItems: "stretch", marginBottom: 2 }}>
                  <div
                    style={{ ...chipBase, flex: 1, background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa", cursor: isAdmin ? "pointer" : "default", marginBottom: 0 }}
                    onClick={e => { e.stopPropagation(); if (isAdmin) setDeleteVacId(v.eventId); }}
                    title={isAdmin ? "Click to delete" : undefined}
                  >{v.name}</div>
                  {isAdmin && (
                    <div
                      style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 4, padding: "2px 6px", fontSize: 13, color: "#c2410c", cursor: "pointer", display: "flex", alignItems: "center" }}
                      onClick={e => { e.stopPropagation(); setDeleteVacId(v.eventId); }}
                    >✕</div>
                  )}
                </div>
              ))}
              {fsVacs.map((v, i) => (
                <div key={"f" + i} style={{ display: "flex", gap: 2, alignItems: "stretch", marginBottom: 2 }}>
                  <div
                    style={{ ...chipBase, flex: 1, background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa", cursor: isAdmin ? "pointer" : "default", marginBottom: 0 }}
                    onClick={e => { e.stopPropagation(); if (isAdmin) setDeleteVacId(v.id); }}
                    title={isAdmin ? "Click to delete" : undefined}
                  >{v.name}</div>
                  {isAdmin && (
                    <div
                      style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 4, padding: "2px 6px", fontSize: 13, color: "#c2410c", cursor: "pointer", display: "flex", alignItems: "center" }}
                      onClick={e => { e.stopPropagation(); setDeleteVacId(v.id); }}
                    >✕</div>
                  )}
                </div>
              ))}
            </div>
          );
        }

        return (
          <div style={{ padding: "16px 18px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, background: "#e5e7eb", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(h => (
                <div key={h} style={{ background: "#f8fafc", padding: "8px 4px", textAlign: "center", fontSize: 11, fontWeight: 800, color: "#6b7280", textTransform: "uppercase" as const }}>{h}</div>
              ))}
              {prevDays.map(d => isOncall ? <OnCallDayCell key={d} d={d} overflow /> : <VacDayCell key={d} d={d} overflow />)}
              {mDays.map(d    => isOncall ? <OnCallDayCell key={d} d={d} />         : <VacDayCell key={d} d={d} />)}
              {nextDays.map(d => isOncall ? <OnCallDayCell key={d} d={d} overflow /> : <VacDayCell key={d} d={d} overflow />)}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 12, alignItems: "center", fontSize: 12, color: "#6b7280", flexWrap: "wrap" }}>
              {isOncall ? (<>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 12, height: 12, borderRadius: 2, background: "#f5f3ff", border: "1px solid #ddd6fe" }} /> On call (Firestore)</div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 12, height: 12, borderRadius: 2, background: "#f5f3ff", border: "1px solid #ddd6fe", opacity: 0.5 }} /> Outlook only (read-only)</div>
              </>) : (<>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 12, height: 12, borderRadius: 2, background: "#fff7ed", border: "1px solid #fed7aa" }} /> Vacation (Outlook — add / delete)</div>
              </>)}
            </div>
          </div>
        );
      })()}

      {boardView === "board" && (
        loading ? (
          <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>
        ) : techs.length === 0 ? (
          <div style={s.empty}>
            No technicians on the Job Board yet.<br />
            Go to <strong>Admin → Users</strong> and turn on <strong>Show in Dispatch</strong> for the techs you want here.
          </div>
        ) : (
          <div style={s.boardWrap}>
            <div style={{ ...s.grid, gridTemplateColumns: `150px repeat(${days.length}, minmax(120px, 1fr))` }}>
              <div style={s.cornerCell}>Technician</div>
              {days.map(d => {
                const isToday = d === todayStr();
                return (
                  <div key={d} style={{ ...s.dayHead, ...(isToday ? { color: "#1565c0" } : {}) }}>
                    {DAY_NAMES[(new Date(d + "T00:00:00").getDay() + 6) % 7]} <span style={{ color: "#9ca3af", fontWeight: 600 }}>{prettyDate(d)}</span>
                  </div>
                );
              })}
              {techs.map(t => (
                <Row key={t.uid} tech={t} days={days} byCell={byCell} calMap={calMap}
                  onAdd={(date) => setModal({ techUid: t.uid, techName: t.name, date })}
                  onOpen={(v) => {
                    if (v.jobId) { navigate(`/jobs/${v.jobId}`); }
                    else { setModal({ techUid: t.uid, techName: t.name, date: v.date, visit: v }); }
                  }}
                  onSwap={openSwap}
                  canEdit={!!isAdmin} />
              ))}
            </div>
          </div>
        )
      )}

      {/* ── Status filter footer (board view only) ── */}
      {boardView === "board" && <div style={s.footer}>
        <button style={activeStatus === "all" ? s.tabOn("#374151") : s.tabOff} onClick={() => setActiveStatus("all")}>
          All Visits {visits.length > 0 ? `(${visits.length})` : ""}
        </button>
        {STATUS_ORDER.map(k => {
          const st = STATUSES[k]; const n = statusCounts[k] || 0;
          return (
            <button key={k} onClick={() => setActiveStatus(activeStatus === k ? "all" : k)}
              style={activeStatus === k ? s.tabOn(st.bg === "#ffffff" ? "#374151" : st.fg) : { ...s.tabOff, background: st.bg, color: st.fg, borderColor: st.border }}>
              {st.label}{n ? ` (${n})` : ""}
            </button>
          );
        })}
      </div>}

      {modal && (
        <VisitModal
          init={modal}
          onClose={() => setModal(null)}
        />
      )}

      {/* ── Add On-Call Modal ── */}
      {addOnCallModal && (
        <div style={s.backdrop} onClick={() => setAddOnCallModal(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: "#0d2e5e", marginBottom: 4 }}>Add On-Call Assignment</h2>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 18 }}>
              {new Date(addOnCallModal + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </p>
            <label style={s.lbl}>Who is on call?</label>
            <select style={s.inp} value={addOnCallUid} onChange={e => setAddOnCallUid(e.target.value)}>
              <option value="">Select employee…</option>
              {allUsers.map(u => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}
            </select>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button onClick={() => setAddOnCallModal(null)} style={s.cancelBtn}>Cancel</button>
              <button onClick={handleAddOnCall} disabled={addOnCallBusy || !addOnCallUid} style={{ ...s.saveBtn, opacity: (addOnCallBusy || !addOnCallUid) ? 0.5 : 1 }}>
                {addOnCallBusy ? "Saving…" : "Assign"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── On-Call Action Picker ── */}
      {onCallActionModal && (
        <div style={s.backdrop} onClick={() => setOnCallActionModal(null)}>
          <div style={{ ...s.modal, maxWidth: 340 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "#0d2e5e", marginBottom: 4 }}>On-Call Options</h2>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
              {new Date(onCallActionModal.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              {" — "}<strong style={{ color: "#111827" }}>{onCallActionModal.assignment.employeeName}</strong>
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, padding: "11px 0", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
                onClick={() => { const a = onCallActionModal; setOnCallActionModal(null); openSwap(a.date); }}
              >↔ Swap</button>
              <button
                style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, padding: "11px 0", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
                onClick={() => { setGiveAwayModal({ assignment: onCallActionModal.assignment }); setGiveToUid(""); setOnCallActionModal(null); }}
              >🎁 Give Away</button>
              <button
                style={{ background: "transparent", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 8, padding: "11px 0", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
                onClick={() => { setDeleteOnCallId(onCallActionModal.assignment.id); setOnCallActionModal(null); }}
              >✕ Delete</button>
            </div>
            <div style={{ marginTop: 14, textAlign: "right" }}>
              <button onClick={() => setOnCallActionModal(null)} style={s.cancelBtn}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Give Away Modal ── */}
      {giveAwayModal && (
        <div style={s.backdrop} onClick={() => { setGiveAwayModal(null); setGiveToUid(""); }}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: "#0d2e5e", marginBottom: 4 }}>Give Away On-Call Day</h2>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
              {new Date(giveAwayModal.assignment.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              {" — "}<strong style={{ color: "#111827" }}>{giveAwayModal.assignment.employeeName}</strong> gives this day away
            </p>
            <label style={s.lbl}>Give to</label>
            <select style={s.inp} value={giveToUid} onChange={e => setGiveToUid(e.target.value)}>
              <option value="">Select employee…</option>
              {allUsers.filter(u => u.uid !== giveAwayModal.assignment.uid).map(u => (
                <option key={u.uid} value={u.uid}>{u.displayName}</option>
              ))}
            </select>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button onClick={() => { setGiveAwayModal(null); setGiveToUid(""); }} style={s.cancelBtn}>Cancel</button>
              <button
                onClick={handleGiveAway}
                disabled={giveAwayBusy || !giveToUid}
                style={{ ...s.saveBtn, background: "#7c3aed", opacity: (giveAwayBusy || !giveToUid) ? 0.5 : 1 }}
              >
                {giveAwayBusy ? "Saving…" : "Give Away"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete On-Call Confirm ── */}
      {deleteOnCallId && (() => {
        const a = assignments.find(x => x.id === deleteOnCallId);
        return (
          <div style={s.backdrop} onClick={() => setDeleteOnCallId(null)}>
            <div style={{ ...s.modal, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#0d2e5e", marginBottom: 8 }}>Remove On-Call Assignment?</h2>
              <p style={{ fontSize: 13, color: "#374151", marginBottom: 18 }}>
                Remove <strong>{a?.employeeName}</strong> from on call on{" "}
                {a ? new Date(a.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : ""}?
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button onClick={() => setDeleteOnCallId(null)} style={s.cancelBtn}>Cancel</button>
                <button onClick={handleDeleteOnCall} style={s.delBtn}>Remove</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Add Vacation Modal ── */}
      {addVacModal && (
        <div style={s.backdrop} onClick={() => setAddVacModal(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: "#0d2e5e", marginBottom: 4 }}>Add Vacation</h2>
            <label style={s.lbl}>Employee</label>
            <select style={s.inp} value={addVacUid} onChange={e => { setAddVacUid(e.target.value); const u = allUsers.find(x => x.uid === e.target.value); if (u) setAddVacName(u.displayName); }}>
              <option value="">Select employee…</option>
              {allUsers.map(u => <option key={u.uid} value={u.uid}>{u.displayName}</option>)}
            </select>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={s.lbl}>Start date</label>
                <input type="date" style={s.inp} value={addVacModal} onChange={e => setAddVacModal(e.target.value || addVacModal)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={s.lbl}>End date</label>
                <input type="date" style={s.inp} value={addVacEnd} onChange={e => setAddVacEnd(e.target.value)} min={addVacModal} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button onClick={() => setAddVacModal(null)} style={s.cancelBtn}>Cancel</button>
              <button onClick={handleAddVacation} disabled={addVacBusy || !addVacUid} style={{ ...s.saveBtn, opacity: (addVacBusy || !addVacUid) ? 0.5 : 1 }}>
                {addVacBusy ? "Saving…" : "Add Vacation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Vacation Confirm ── */}
      {deleteVacId && (() => {
        const vac = approvedVacation.find(x => x.id === deleteVacId);
        return (
          <div style={s.backdrop} onClick={() => setDeleteVacId(null)}>
            <div style={{ ...s.modal, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#0d2e5e", marginBottom: 8 }}>Remove Vacation?</h2>
              <p style={{ fontSize: 13, color: "#374151", marginBottom: 18 }}>
                Remove vacation for <strong>{vac?.employeeName}</strong>
                {vac?.startDate ? ` (${new Date(vac.startDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}${vac.endDate && vac.endDate !== vac.startDate ? ` – ${new Date(vac.endDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""})` : ""}?
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button onClick={() => setDeleteVacId(null)} style={s.cancelBtn}>Cancel</button>
                <button onClick={handleDeleteVacation} style={s.delBtn}>Remove</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── On-Call Swap Modal ── */}
      {swapModal && (
        <div style={s.backdrop} onClick={closeSwap}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: "#0d2e5e", marginBottom: 4 }}>
              {isAdmin ? "Swap On-Call Day" : "Request On-Call Swap"}
            </h2>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 18 }}>
              {new Date(swapModal.assignment.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              {" — "}<strong style={{ color: "#111827" }}>{swapModal.assignment.employeeName}</strong> is on call
            </p>

            <label style={s.lbl}>{isAdmin ? "Swap to" : "Who will cover?"}</label>
            <select style={s.inp} value={swapToUid} onChange={e => { setSwapToUid(e.target.value); setSwapOfferDate(""); }}>
              <option value="">Select employee…</option>
              {allUsers.filter(u => u.uid !== swapModal.assignment.uid).map(u => (
                <option key={u.uid} value={u.uid}>{u.displayName}</option>
              ))}
            </select>

            {swapToUid && (
              <>
                <label style={s.lbl}>Offer a day in exchange (optional)</label>
                <select style={s.inp} value={swapOfferDate} onChange={e => setSwapOfferDate(e.target.value)}>
                  <option value="">None — just take over the day</option>
                  {requesterOnCallDays.map(d => (
                    <option key={d.id} value={d.date}>
                      {new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    </option>
                  ))}
                </select>
              </>
            )}

            {!isAdmin && (
              <>
                <label style={s.lbl}>Reason (optional)</label>
                <textarea
                  style={{ ...s.inp, minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
                  value={swapReason}
                  onChange={e => setSwapReason(e.target.value)}
                  placeholder="Why do you need to swap?"
                />
              </>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button onClick={closeSwap} style={s.cancelBtn}>Cancel</button>
              <button
                onClick={submitSwap}
                disabled={swapping || !swapToUid}
                style={{ ...s.saveBtn, opacity: (swapping || !swapToUid) ? 0.5 : 1 }}
              >
                {swapping ? "Saving…" : isAdmin ? "Swap Now" : "Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ tech, days, byCell, calMap, onAdd, onOpen, onSwap, canEdit }: {
  tech: Tech; days: string[]; byCell: Record<string, Visit[]>; calMap: CalMap;
  onAdd: (date: string) => void; onOpen: (v: Visit) => void; onSwap: (date: string) => void; canEdit: boolean;
}) {
  const firstName = tech.name.split(/\s+/)[0].toLowerCase();
  return (
    <>
      <div style={s.techCell}>
        <div style={s.avatar}>{initials(tech.name)}</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#0d2e5e" }}>{tech.name}</div>
          {tech.section && <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "capitalize" }}>{tech.section}</div>}
        </div>
      </div>
      {days.map(d => {
        const cellVisits = byCell[`${tech.uid}|${d}`] || [];
        const chips = calMap[`${firstName}|${d}`] || [];
        return (
          <div key={d} style={s.cell} onClick={() => canEdit && onAdd(d)} title={canEdit ? "Click to add a visit" : ""}>
            {chips.map((chip, i) => (
              <div key={i}
                onClick={chip.type === "oncall" ? (e) => { e.stopPropagation(); onSwap(d); } : undefined}
                title={chip.type === "oncall" ? "Click to swap on-call" : undefined}
                style={{
                  borderRadius: 5, padding: "4px 8px", marginBottom: 5, fontSize: 11, fontWeight: 700,
                  background: chip.type === "vacation" ? "#fff7ed" : "#f5f3ff",
                  color:      chip.type === "vacation" ? "#c2410c"  : "#6d28d9",
                  border:     `1px solid ${chip.type === "vacation" ? "#fed7aa" : "#ddd6fe"}`,
                  cursor:     chip.type === "oncall" ? "pointer" : "default",
                }}>
                {chip.type === "vacation" ? "☀ Vacation" : "📞 On Call"}
              </div>
            ))}
            {cellVisits.map(v => {
              const st = STATUSES[v.status] || STATUSES.scheduled;
              return (
                <div key={v.id}
                  onClick={(e) => { e.stopPropagation(); onOpen(v); }}
                  style={{ ...s.visit, background: st.bg, color: st.fg, borderColor: st.border }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", opacity: 0.85 }}>{st.label}</span>
                    <span style={{ display: "flex", gap: 3, alignItems: "center" }}>
                      {v.priority === "high" && <span style={s.priHigh}>HIGH</span>}
                      {v.flagged && <span style={s.flag}>⚑</span>}
                    </span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.title}</div>
                  {v.jobNumber && <div style={{ fontSize: 10, opacity: 0.85 }}>{v.jobNumber}{v.visitNumber ? ` · Visit #${v.visitNumber}` : ""}</div>}
                  {v.department && <div style={{ fontSize: 10, opacity: 0.75 }}>{v.department}</div>}
                  {(v.start || v.end) && <div style={{ fontSize: 10, opacity: 0.85 }}>{fmtTime(v.start)}{v.end ? ` - ${fmtTime(v.end)}` : ""}</div>}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

type JobOption = { id: string; jobNumber: string; customerName: string; status: string; description: string };

function VisitModal({ init, onClose }: { init: { techUid: string; techName: string; date: string; visit?: Visit }; onClose: () => void }) {
  const v = init.visit;
  const isCancelled = v?.status === "canceled";
  const [title, setTitle] = useState(v?.title || "");
  const [jobNumber, setJobNumber] = useState(v?.jobNumber || "");
  const [date, setDate] = useState(v?.date || init.date);
  const [endDateRange, setEndDateRange] = useState("");
  const [excludeWeekends, setExcludeWeekends] = useState(true);
  const [start, setStart] = useState(v?.start || "08:00");
  const [end, setEnd] = useState(v?.end || "09:00");
  const [priority, setPriority] = useState<string>(v?.priority || "normal");
  const [flagged, setFlagged] = useState(!!v?.flagged);
  const [notes, setNotes] = useState(v?.notes || "");
  const [busy, setBusy] = useState(false);
  const [rescheduleMode, setRescheduleMode] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(v?.date || init.date);

  // Compute dates to create when in multi-day mode
  const visitDates = useMemo(() => {
    const effectiveEnd = (!v && endDateRange && endDateRange >= date) ? endDateRange : date;
    const dates: string[] = [];
    let cur = new Date(date + "T12:00:00");
    const last = new Date(effectiveEnd + "T12:00:00");
    while (cur <= last) {
      const dow = cur.getDay();
      if (!excludeWeekends || (dow !== 0 && dow !== 6)) {
        dates.push(cur.toISOString().slice(0, 10));
      }
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  }, [date, endDateRange, excludeWeekends, v]);

  // Job search (add-only)
  const [jobQuery, setJobQuery] = useState("");
  const [allJobs, setAllJobs] = useState<JobOption[]>([]);
  const [jobDrop, setJobDrop] = useState(false);

  useEffect(() => {
    if (v) return; // edit mode — no need to load jobs
    getDocs(query(collection(db, "jobs"), where("status", "in", ["Open", "In Progress"]), limit(400)))
      .then(snap => setAllJobs(snap.docs.map(d => ({
        id: d.id,
        jobNumber: d.data().jobNumber || "",
        customerName: d.data().customerName || "",
        status: d.data().status || "",
        description: d.data().issueDescription || d.data().title || "",
      }))))
      .catch(() => {});
  }, []);

  const jobResults = useMemo(() => {
    const q = jobQuery.trim().toLowerCase();
    if (!q) return [];
    return allJobs.filter(j =>
      j.jobNumber.toLowerCase().includes(q) || j.customerName.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [jobQuery, allJobs]);

  function selectJob(j: JobOption) {
    setTitle(j.customerName + (j.description ? ` — ${j.description}` : ""));
    setJobNumber(j.jobNumber);
    setJobQuery(`${j.jobNumber}  •  ${j.customerName}`);
    setJobDrop(false);
  }

  async function save() {
    if (!title.trim()) return;
    setBusy(true);
    const base = {
      techUid: init.techUid, techName: init.techName,
      title: title.trim(), jobNumber: jobNumber.trim(),
      start, end, priority, flagged, notes: notes.trim(),
    };
    try {
      if (v) {
        await updateDoc(doc(db, "dispatchVisits", v.id), { ...base, date });
      } else {
        for (const d of visitDates) {
          await addDoc(collection(db, "dispatchVisits"), { ...base, date: d, status: "scheduled", createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || "" });
        }
      }
      onClose();
    } catch (e) { setBusy(false); }
  }
  async function removeVisitPayroll(visitId: string) {
    const snap = await getDocs(query(collection(db, "payrollEntries"), where("visitId", "==", visitId)));
    for (const d of snap.docs) await deleteDoc(doc(db, "payrollEntries", d.id));
  }
  async function remove() {
    if (!v) return;
    if (!window.confirm(`Delete "${v.title}"?`)) return;
    setBusy(true);
    try {
      await removeVisitPayroll(v.id);
      await deleteDoc(doc(db, "dispatchVisits", v.id));
      onClose();
    } catch { setBusy(false); }
  }
  async function confirmReschedule() {
    if (!v || !rescheduleDate) return;
    setBusy(true);
    try { await updateDoc(doc(db, "dispatchVisits", v.id), { date: rescheduleDate, status: "scheduled" }); onClose(); }
    catch { setBusy(false); }
  }
  async function markComplete() {
    if (!v) return;
    setBusy(true);
    try { await updateDoc(doc(db, "dispatchVisits", v.id), { status: "complete" }); onClose(); }
    catch { setBusy(false); }
  }
  async function cancelVisit() {
    if (!v || !window.confirm("Cancel this visit? This cannot be undone.")) return;
    setBusy(true);
    try {
      await removeVisitPayroll(v.id);
      await updateDoc(doc(db, "dispatchVisits", v.id), { status: "canceled" });
      onClose();
    } catch { setBusy(false); }
  }

  return (
    <div style={s.backdrop} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0d2e5e", marginBottom: 2 }}>{v ? "Edit Visit" : "Add Visit"}</h2>
        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>{init.techName}</p>

        {/* Job search — add mode only */}
        {!v && (
          <div style={{ position: "relative", marginBottom: 4 }}>
            <label style={s.lbl}>Search Job #  or Customer</label>
            <input
              style={s.inp}
              value={jobQuery}
              onChange={e => { setJobQuery(e.target.value); setJobDrop(true); }}
              onFocus={() => jobResults.length > 0 && setJobDrop(true)}
              onBlur={() => setTimeout(() => setJobDrop(false), 150)}
              placeholder="Job # or customer name…"
              autoFocus
            />
            {jobDrop && jobResults.length > 0 && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.12)", zIndex: 200, maxHeight: 260, overflowY: "auto" }}>
                {jobResults.map(j => (
                  <div
                    key={j.id}
                    onMouseDown={() => selectJob(j)}
                    style={{ padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid #f0f0f0" }}
                    onMouseOver={e => (e.currentTarget.style.background = "#f0f7ff")}
                    onMouseOut={e => (e.currentTarget.style.background = "")}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      <span style={{ fontWeight: 700, fontSize: 12, color: "#1565c0" }}>{j.jobNumber}</span>
                      <span style={{ fontWeight: 600, fontSize: 13, color: "#374151" }}>{j.customerName}</span>
                      <span style={{ fontSize: 11, color: "#6b7280", background: "#f3f4f6", borderRadius: 4, padding: "1px 5px" }}>{j.status}</span>
                    </div>
                    {j.description && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.description}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <label style={s.lbl}>Visit Title</label>
        <input style={s.inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="Office Renovation" autoFocus={!!v} />

        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label style={s.lbl}>Job #</label><input style={s.inp} value={jobNumber} onChange={e => setJobNumber(e.target.value)} placeholder="#P25-0093" /></div>
          <div style={{ flex: 1 }}><label style={s.lbl}>{v ? "Date" : "Start Date"}</label><input type="date" style={s.inp} value={date} onChange={e => setDate(e.target.value)} /></div>
        </div>

        {!v && (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={s.lbl}>End Date <span style={{ fontWeight: 400, color: "#9ca3af" }}>(optional — for multiple visits)</span></label>
              <input type="date" style={s.inp} value={endDateRange} min={date} onChange={e => setEndDateRange(e.target.value)} />
            </div>
            {endDateRange && endDateRange >= date && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#374151", whiteSpace: "nowrap", paddingBottom: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={excludeWeekends} onChange={e => setExcludeWeekends(e.target.checked)} />
                Skip weekends
              </label>
            )}
          </div>
        )}

        {!v && endDateRange && endDateRange >= date && (
          <div style={{ background: visitDates.length === 0 ? "#fef2f2" : "#f0fdf4", border: `1px solid ${visitDates.length === 0 ? "#fca5a5" : "#bbf7d0"}`, borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, color: visitDates.length === 0 ? "#dc2626" : "#166534", marginTop: 4 }}>
            {visitDates.length === 0 ? "No dates selected (all excluded)" : `${visitDates.length} visit${visitDates.length !== 1 ? "s" : ""} will be created`}
          </div>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label style={s.lbl}>Start</label><input type="time" style={s.inp} value={start} onChange={e => setStart(e.target.value)} /></div>
          <div style={{ flex: 1 }}><label style={s.lbl}>End</label><input type="time" style={s.inp} value={end} onChange={e => setEnd(e.target.value)} /></div>
        </div>

        <div style={{ display: "flex", gap: 16, alignItems: "center", margin: "12px 0" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>
            <input type="checkbox" checked={priority === "high"} onChange={e => setPriority(e.target.checked ? "high" : "normal")} /> High priority
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>
            <input type="checkbox" checked={flagged} onChange={e => setFlagged(e.target.checked)} /> Flagged
          </label>
        </div>

        <label style={s.lbl}>Notes</label>
        <textarea style={{ ...s.inp, minHeight: 56, resize: "vertical" }} value={notes} onChange={e => setNotes(e.target.value)} />

        {v && (
          <div style={{ marginTop: 14 }}>
            {isCancelled ? (
              <div style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 700 }}>
                ⛔ Cancelled — cannot be reopened
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => setRescheduleMode(m => !m)} disabled={busy} style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    📅 Reschedule
                  </button>
                  <button onClick={markComplete} disabled={busy} style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    ✓ Mark Complete
                  </button>
                  <button onClick={cancelVisit} disabled={busy} style={{ background: "transparent", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    ✕ Cancel Visit
                  </button>
                </div>
                {rescheduleMode && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                    <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} style={{ ...s.inp, flex: 1 }} />
                    <button onClick={confirmReschedule} disabled={busy || !rescheduleDate} style={{ ...s.saveBtn, opacity: (busy || !rescheduleDate) ? 0.5 : 1, whiteSpace: "nowrap" }}>Confirm</button>
                    <button onClick={() => setRescheduleMode(false)} style={s.cancelBtn}>✕</button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
          {v ? <button onClick={remove} disabled={busy} style={s.delBtn}>Delete</button> : <span />}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={s.cancelBtn}>Close</button>
            {(!v || !isCancelled) && (
              <button onClick={save} disabled={busy || !title.trim() || visitDates.length === 0} style={{ ...s.saveBtn, opacity: (busy || !title.trim() || visitDates.length === 0) ? 0.5 : 1 }}>
                {busy ? "Saving…" : !v && visitDates.length > 1 ? `Add ${visitDates.length} Visits` : "Save"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, any> = {
  headerBar: { display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0d2e5e", color: "#fff", borderRadius: 0, padding: "12px 18px", marginBottom: 14, flexWrap: "wrap", gap: 10 },
  segment: { display: "flex", background: "rgba(255,255,255,0.12)", borderRadius: 8, overflow: "hidden" },
  segOn: { background: "#fff", color: "#0d2e5e", border: "none", padding: "6px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer" },
  segOff: { background: "transparent", color: "rgba(255,255,255,0.8)", border: "none", padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  navBtn: { background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", borderRadius: 8, width: 34, height: 32, fontSize: 16, cursor: "pointer" },
  dateInput: { border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 13, fontWeight: 600 },
  todayBtn: { background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer" },
  boardWrap: { overflow: "auto", maxHeight: "calc(100vh - 250px)", border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" },
  grid: { display: "grid", minWidth: 990, width: "100%" },
  cornerCell: { position: "sticky", top: 0, left: 0, zIndex: 4, background: "#f8fafc", borderBottom: "2px solid #e5e7eb", borderRight: "1px solid #e5e7eb", padding: "10px 12px", fontSize: 12, fontWeight: 800, color: "#6b7280", textTransform: "uppercase" },
  dayHead: { position: "sticky", top: 0, zIndex: 3, background: "#f8fafc", borderBottom: "2px solid #e5e7eb", borderRight: "1px solid #f0f0f0", padding: "14px 12px", fontSize: 14, fontWeight: 700, color: "#374151", textAlign: "center" },
  techCell: { position: "sticky", left: 0, zIndex: 2, background: "#fff", borderBottom: "1px solid #f0f0f0", borderRight: "1px solid #e5e7eb", padding: "12px", display: "flex", alignItems: "center", gap: 10 },
  avatar: { width: 32, height: 32, borderRadius: "50%", background: "#e8f0ff", color: "#1565c0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0 },
  cell: { minHeight: 180, borderBottom: "1px solid #f0f0f0", borderRight: "1px solid #f0f0f0", padding: 6, cursor: "pointer", background: "#fafafa" },
  visit: { border: "1px solid", borderRadius: 7, padding: "7px 9px", marginBottom: 6, cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" },
  priHigh: { fontSize: 8, fontWeight: 800, background: "#dc2626", color: "#fff", borderRadius: 3, padding: "1px 4px" },
  flag: { fontSize: 11, color: "#dc2626" },
  footer: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12, padding: "10px 4px", borderTop: "1px solid #eee" },
  tabOn: (c: string) => ({ background: c, color: "#fff", border: `1px solid ${c}`, borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }),
  tabOff: { background: "#fff", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  empty: { textAlign: "center", padding: 60, color: "#9ca3af", fontSize: 14, lineHeight: 1.8, border: "1px dashed #d1d5db", borderRadius: 12 },
  backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { background: "#fff", borderRadius: 16, padding: 26, width: "100%", maxWidth: 440, boxShadow: "0 8px 40px rgba(0,0,0,0.2)", maxHeight: "90vh", overflowY: "auto" },
  lbl: { display: "block", fontSize: 12, fontWeight: 700, color: "#374151", margin: "10px 0 4px" },
  inp: { width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 10px", fontSize: 14, boxSizing: "border-box" },
  saveBtn: { background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  cancelBtn: { background: "#6b7280", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  delBtn: { background: "transparent", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 8, padding: "9px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
};
