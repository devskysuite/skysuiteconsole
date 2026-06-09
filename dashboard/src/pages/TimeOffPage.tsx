import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc, collection, doc, getDocs, onSnapshot,
  query, updateDoc, deleteDoc, where,
} from "firebase/firestore";
import { doc as fsDoc, getDoc as fsGetDoc, setDoc as fsSetDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { auth, db } from "../firebase";

const callSyncVacation     = httpsCallable(getFunctions(), "syncVacationEvent");
const callNotifyApprovers  = httpsCallable(getFunctions(), "notifyApproversSms");
const callVacation         = httpsCallable(getFunctions(), "vacationAction");
import { useToast } from "../components/Toast";
import { useRole, canApproveTimeOff, isAdminRole } from "../hooks/useRole";
import TimeOffNotifySettings from "../components/TimeOffNotifySettings";
import VacationManager from "../components/VacationManager";
import { fmtISODate, timeOffStatusBadge } from "../utils/formatting";
import type { TimeOffRequest } from "../types";

const TENANT_ID = "1c1d62e8-f392-4caa-a8a6-0ce98e0913d9";
const CLIENT_ID  = "9a1a21f1-40a3-4872-a4d6-888bd51d116d";
const CAL_ID     = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

type View = "month" | "list" | "request" | "my-requests" | "approvals" | "manage-vacation";

export default function TimeOffPage() {
  const { toast, confirm } = useToast();
  const role = useRole();
  const canApprove = canApproveTimeOff(role);

  const [currentUser, setCurrentUser] = useState<{ uid: string; email: string; displayName: string } | null>(null);
  const [myRequests,  setMyRequests]  = useState<TimeOffRequest[]>([]);
  const [allRequests, setAllRequests] = useState<TimeOffRequest[]>([]);

  // Calendar
  const todayDate = new Date();
  const [year,  setYear]  = useState(todayDate.getFullYear());
  const [month, setMonth] = useState(todayDate.getMonth());
  const [view,  setView]  = useState<View>("month");
  const [events, setEvents] = useState<{id:string;subject:string;start:string;end:string}[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [token, setToken] = useState("");

  // Request form
  const [singleDay, setSingleDay] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate,   setEndDate]   = useState("");
  const [reason,    setReason]    = useState("");
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState("");

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { setCurrentUser(null); return; }
      try {
        const snap = await getDocs(query(collection(db, "users"), where("uid", "==", user.uid)));
        const data = snap.empty ? null : snap.docs[0].data();
        setCurrentUser({ uid: user.uid, email: user.email ?? "", displayName: data?.displayName ?? user.email ?? "" });
      } catch {
        setCurrentUser({ uid: user.uid, email: user.email ?? "", displayName: user.email ?? "" });
      }
    });
  }, []);

  useEffect(() => { if (currentUser) loadMyRequests(); }, [currentUser]);

  // Listen for all requests (for approvers)
  useEffect(() => {
    if (!canApprove) return;
    return onSnapshot(query(collection(db, "timeOffRequests")), snap => {
      setAllRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as TimeOffRequest))
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)));
    });
  }, [canApprove]);

  // Outlook token
  useEffect(() => {
    (async () => {
      try {
        const snap = await fsGetDoc(fsDoc(db, "settings", "outlookOnCall"));
        if (!snap.exists() || !snap.data().refreshToken) return;
        const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
          method: "POST",
          body: new URLSearchParams({ client_id: CLIENT_ID, refresh_token: snap.data().refreshToken, grant_type: "refresh_token", scope: "Calendars.ReadWrite offline_access" }),
        });
        const d = await r.json();
        if (d.access_token) {
          setToken(d.access_token);
          try { await fsSetDoc(fsDoc(db, "settings", "outlookOnCall"), { refreshToken: d.refresh_token }, { merge: true }); } catch {}
        }
      } catch {}
    })();
  }, []);

  // Load vacation events from the dedicated Vacation calendar (server-side)
  async function loadVacations() {
    setCalLoading(true);
    try {
      const res: any = await callVacation({ action: "list" });
      setEvents(res?.data?.events || []);
    } catch { setEvents([]); }
    setCalLoading(false);
  }
  useEffect(() => { loadVacations(); }, []);

  // People list for the add-vacation picker (admins)
  const [vacPeople, setVacPeople] = useState<string[]>([]);
  useEffect(() => {
    getDocs(collection(db, "users")).then(snap => {
      const names = snap.docs.map(d => d.data().displayName).filter(Boolean) as string[];
      setVacPeople(Array.from(new Set(names)).sort((a, b) => a.localeCompare(b)));
    }).catch(() => {});
  }, []);

  // Add vacation (click a day) / edit-delete vacation (tap a pill) — admins
  const [vacAddModal, setVacAddModal] = useState<{ start: string } | null>(null);
  const [vacName, setVacName]   = useState("");
  const [vacStart, setVacStart] = useState("");
  const [vacEnd, setVacEnd]     = useState("");
  const [vacBusy, setVacBusy]   = useState(false);

  const [vacEditModal, setVacEditModal] = useState<{ id: string; name: string; calId?: string } | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd]     = useState("");

  function openAdd(date: string) {
    setVacName(""); setVacStart(date); setVacEnd(date); setVacAddModal({ start: date });
  }

  async function addVacationDay() {
    if (!vacName || !vacStart) return;
    if (vacEnd && vacEnd < vacStart) { toast("End date can't be before start.", "error"); return; }
    setVacBusy(true);
    try {
      await callVacation({ action: "add", personName: vacName, startDate: vacStart, endDate: vacEnd || vacStart });
      setVacAddModal(null);
      await loadVacations();
    } catch (e: any) { toast(e?.message ?? "Failed to add vacation.", "error"); }
    setVacBusy(false);
  }

  function openEdit(p: { id: string; name: string; calId?: string; start: string; lastDay: string }) {
    setVacEditModal({ id: p.id, name: p.name, calId: p.calId });
    setEditStart(p.start); setEditEnd(p.lastDay);
  }

  async function saveEditVacation() {
    if (!vacEditModal || !editStart) return;
    if (editEnd && editEnd < editStart) { toast("End date can't be before start.", "error"); return; }
    setVacBusy(true);
    try {
      await callVacation({ action: "edit", eventId: vacEditModal.id, eventCalId: vacEditModal.calId, startDate: editStart, endDate: editEnd || editStart });
      setVacEditModal(null);
      await loadVacations();
    } catch (e: any) { toast(e?.message ?? "Failed to update vacation.", "error"); }
    setVacBusy(false);
  }

  async function deleteEditVacation() {
    if (!vacEditModal) return;
    if (!await confirm(`Delete ${vacEditModal.name}'s vacation?`)) return;
    setVacBusy(true);
    try {
      await callVacation({ action: "delete", eventId: vacEditModal.id, eventCalId: vacEditModal.calId });
      setVacEditModal(null);
      await loadVacations();
    } catch (e: any) { toast(e?.message ?? "Failed to delete vacation.", "error"); }
    setVacBusy(false);
  }

  async function loadMyRequests() {
    if (!currentUser) return;
    const snap = await getDocs(query(collection(db, "timeOffRequests"), where("uid", "==", currentUser.uid)));
    const results = snap.docs.map(d => ({ id: d.id, ...d.data() } as TimeOffRequest));
    const now = new Date().toISOString().split("T")[0];
    for (const r of results) {
      if (r.status === "PENDING" && r.startDate < now) {
        updateDoc(doc(db, "timeOffRequests", r.id), { status: "DENIED" }).catch(() => {});
        r.status = "DENIED";
      }
    }
    results.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    setMyRequests(results);
  }

  async function submitRequest() {
    setError(""); setSuccess("");
    if (!startDate || (!singleDay && !endDate)) { setError(singleDay ? "Please select a date." : "Please select start and end dates."); return; }
    const effectiveEnd = singleDay ? startDate : endDate;
    if (effectiveEnd < startDate) { setError("End date cannot be before start date."); return; }
    if (!currentUser) { setError("Not logged in."); return; }
    const overlap = myRequests.find(r => r.status !== "DENIED" && startDate <= r.endDate && effectiveEnd >= r.startDate);
    if (overlap) { setError(`You already have a ${overlap.status.toLowerCase()} request for ${overlap.startDate} – ${overlap.endDate}.`); return; }
    const deniedOverlap = myRequests.find(r => r.status === "DENIED" && startDate <= r.endDate && effectiveEnd >= r.startDate);
    if (deniedOverlap && !await confirm("This time was previously denied. Request anyway?")) return;
    setBusy(true);
    try {
      await addDoc(collection(db, "timeOffRequests"), {
        uid: currentUser.uid, employeeName: currentUser.displayName, employeeEmail: currentUser.email,
        startDate, endDate: effectiveEnd, reason: reason.trim(), status: "PENDING", createdAt: new Date(),
      });
      // Notify approvers per the configured method(s). Always visible in the Approvals tab regardless.
      try {
        const nSnap = await fsGetDoc(fsDoc(db, "settings", "timeOffNotify"));
        const notify = nSnap.data() || {};
        if (notify.sms) {
          callNotifyApprovers({ employeeName: currentUser.displayName, startDate, endDate: effectiveEnd }).catch(() => {});
        }
        if (notify.email) {
          const idToken = await auth.currentUser?.getIdToken() ?? "";
          fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken, type: "time-off", payload: { employee_name: currentUser.displayName, employee_email: currentUser.email, start_date: startDate, end_date: effectiveEnd, reason: reason.trim() || "No reason provided" } }) }).catch(() => {});
        }
      } catch {}
      setSuccess("Vacation request submitted successfully.");
      setStartDate(""); setEndDate(""); setReason("");
      await loadMyRequests();
    } catch (e: any) { setError(e?.message ?? "Failed to submit."); }
    finally { setBusy(false); }
  }

  async function approveRequest(r: TimeOffRequest) {
    await updateDoc(doc(db, "timeOffRequests", r.id), { status: "APPROVED" });
    callSyncVacation({ requestId: r.id }).catch(() => {});
  }
  async function denyRequest(r: TimeOffRequest) {
    await updateDoc(doc(db, "timeOffRequests", r.id), { status: "DENIED" });
    callSyncVacation({ requestId: r.id }).catch(() => {});
  }
  async function deleteRequest(r: TimeOffRequest) {
    if (!await confirm(`Delete this request from ${r.employeeName}?`)) return;
    // Remove the Outlook calendar event first (while the doc still exists), then delete the request
    await callSyncVacation({ requestId: r.id, remove: true }).catch(() => {});
    await deleteDoc(doc(db, "timeOffRequests", r.id));
  }

  // Calendar grid
  const todayStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth()+1).padStart(2,"0")}-${String(todayDate.getDate()).padStart(2,"0")}`;
  const first = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const grid: string[] = [];
  for (let i = 0; i < first; i++) grid.push("");
  for (let d = 1; d <= daysInMonth; d++) grid.push(`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`);

  // Vacation map: date → [{id,name,calId,start,lastDay}]
  type VacPill = { id: string; name: string; calId?: string; start: string; lastDay: string };
  const vacByDate: Record<string, VacPill[]> = {};
  events.forEach((ev: any) => {
    let cur = new Date(ev.start + "T12:00:00");
    const end = new Date(ev.end + "T12:00:00"); // exclusive
    const lastD = new Date(end); lastD.setDate(lastD.getDate() - 1);
    const lastDay = lastD.toISOString().slice(0, 10);
    const name = ev.subject.replace(/vacation\s*[-–]?\s*/i, "").replace(/[-–]\s*vacation/i, "").trim();
    while (cur < end) {
      const d = cur.toISOString().slice(0, 10);
      if (!vacByDate[d]) vacByDate[d] = [];
      if (!vacByDate[d].some(x => x.id === ev.id)) vacByDate[d].push({ id: ev.id, name, calId: ev.calId, start: ev.start, lastDay });
      cur.setDate(cur.getDate() + 1);
    }
  });

  const pendingCount = allRequests.filter(r => r.status === "PENDING").length;

  const prevMonth = () => { let m = month - 1, y = year; if (m < 0) { m = 11; y--; } setMonth(m); setYear(y); };
  const nextMonth = () => { let m = month + 1, y = year; if (m > 11) { m = 0; y++; } setMonth(m); setYear(y); };

  return (
    <div style={{ padding: "0 0 32px" }}>

      {/* ── Header — matches On-Call Manager ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0d2e5e", margin: 0 }}>Vacation Management</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {token
            ? <span style={{ fontSize: 13, color: "#059669", fontWeight: 600 }}>✅ Connected</span>
            : <span style={{ fontSize: 13, color: "#9ca3af", fontWeight: 600 }}>⚠️ Not connected — connect Outlook in On-Call → Setup</span>}
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>

        {/* ── Tab buttons — identical to On-Call ── */}
        <div style={{ display: "flex", alignItems: "center", borderBottom: "2px solid #f0f0f0", marginBottom: 20 }}>
          <TabBtn label="📅 Calendar"          active={view==="month"}       onClick={()=>setView("month")} />
          <TabBtn label="📋 List View"         active={view==="list"}        onClick={()=>setView("list")} />
          <TabBtn label="✏️ Request Vacation"  active={view==="request"}     onClick={()=>setView("request")} />
          <TabBtn label="🗂 My Requests"       active={view==="my-requests"} onClick={()=>setView("my-requests")} />
          {canApprove && (
            <TabBtn
              label={`✅ Approvals${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
              active={view==="approvals"}
              onClick={()=>setView("approvals")}
            />
          )}
          {isAdminRole(role) && (
            <TabBtn label="🏖 Manage Vacation" active={view==="manage-vacation"} onClick={()=>setView("manage-vacation")} />
          )}
        </div>

        {/* ── Month nav ── */}
        {(view === "month" || view === "list") && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <button onClick={prevMonth} style={navS}>◀</button>
            <span style={{ fontWeight: 700, fontSize: 18, color: "#0d2e5e" }}>{MONTHS[month]} {year}</span>
            <button onClick={nextMonth} style={navS}>▶</button>
          </div>
        )}

        {/* ── Legend ── */}
        {view === "month" && (
          <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ background: "#f97316", color: "#fff", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99 }}>Vacation</span>
            {isAdminRole(role) && <span style={{ fontSize: 11, color: "#9ca3af" }}>Click a day to add a vacation · tap a 🏖 to edit or delete it</span>}
          </div>
        )}

        {/* ── Calendar grid ── */}
        {view === "month" && (
          <>
            {calLoading && <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>⏳ Loading...</div>}
            {!calLoading && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>
                {DAYS.map(d => <div key={d} style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: "#6b7280", padding: "8px 0", textTransform: "uppercase" }}>{d}</div>)}
                {grid.map((date, i) => {
                  const dayVacs = date ? (vacByDate[date] || []) : [];
                  const isToday = date === todayStr;
                  const admin = isAdminRole(role);
                  return (
                    <div key={i}
                      onClick={admin && date ? () => openAdd(date) : undefined}
                      title={admin && date ? "Click to add a vacation" : undefined}
                      style={{ minHeight: 110, background: isToday ? "#fff8f0" : "#fafafa", border: isToday ? "2px solid #f97316" : "1px solid #e5e7eb", borderRadius: 6, padding: 6, cursor: admin && date ? "pointer" : "default" }}>
                      {date && <>
                        <div style={{ fontSize: 12, fontWeight: isToday ? 800 : 500, color: isToday ? "#f97316" : "#374151", marginBottom: 2 }}>{parseInt(date.slice(8))}</div>
                        {dayVacs.map(v => (
                          <div key={v.id}
                            title={admin ? "Tap to edit or delete" : undefined}
                            onClick={admin ? (e) => { e.stopPropagation(); openEdit(v); } : undefined}
                            style={{ fontSize: 11, fontWeight: 600, background: "#f97316", color: "white", borderRadius: 4, padding: "2px 5px", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: admin ? "pointer" : "default" }}>
                            Vacation - {v.name}
                          </div>
                        ))}
                      </>}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── List View ── */}
        {view === "list" && (
          <div>
            {calLoading && <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>⏳ Loading...</div>}
            {!calLoading && events.length === 0 && <p style={{ color: "#9ca3af", fontSize: 13 }}>No vacations this month.</p>}
            {!calLoading && events.map(ev => (
              <div key={ev.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid #f5f5f5" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{ev.subject.replace(/vacation\s*[-–]?\s*/i,"").replace(/[-–]\s*vacation/i,"").trim()}</div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{ev.start} → {ev.end}</div>
                </div>
                <span style={{ background: "#fff3e0", color: "#e65100", fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 99 }}>🏖 Vacation</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Request Vacation ── */}
        {view === "request" && (
          <div style={{ maxWidth: 560 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20, color: "#0d2e5e" }}>Request Vacation</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: singleDay ? "#aaa" : "#333" }}>Multiple Days</span>
              <div onClick={() => { setSingleDay(!singleDay); setEndDate(""); }}
                style={{ width: 44, height: 24, borderRadius: 12, cursor: "pointer", backgroundColor: singleDay ? "#1565c0" : "#ccc", position: "relative", transition: "background-color 0.2s" }}>
                <div style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff", position: "absolute", top: 2, left: singleDay ? 22 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: singleDay ? "#333" : "#aaa" }}>Single Day</span>
            </div>
            <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 160 }}>
                <label style={lbl}>{singleDay ? "Date" : "Start Date"}</label>
                <input type="date" style={inp} min={today} value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              {!singleDay && (
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 160 }}>
                  <label style={lbl}>End Date</label>
                  <input type="date" style={inp} min={startDate || today} value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", marginBottom: 16 }}>
              <label style={lbl}>Reason (optional)</label>
              <textarea style={{ ...inp, resize: "vertical", minHeight: 80, fontFamily: "inherit" }} value={reason} onChange={e => setReason(e.target.value)} placeholder="Any additional details…" />
            </div>
            {error   && <p style={{ color: "#cc0000", fontSize: 13, marginBottom: 12 }}>{error}</p>}
            {success && <p style={{ color: "#007700", fontSize: 13, marginBottom: 12 }}>{success}</p>}
            <button style={btnS("#1565c0")} onClick={submitRequest} disabled={busy}>{busy ? "Submitting…" : "Submit Request"}</button>
          </div>
        )}

        {/* ── My Requests ── */}
        {view === "my-requests" && (
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16, color: "#0d2e5e" }}>My Vacation Requests</h2>
            {myRequests.length === 0 ? (
              <p style={{ color: "#888", fontSize: 14 }}>No requests submitted yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Start</th><th style={th}>End</th><th style={th}>Reason</th><th style={th}>Status</th><th style={th}>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {myRequests.map(r => (
                    <tr key={r.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                      <td style={td}>{fmtISODate(r.startDate)}</td>
                      <td style={td}>{fmtISODate(r.endDate)}</td>
                      <td style={td}>{r.reason || "—"}</td>
                      <td style={td}><span style={timeOffStatusBadge(r.status)}>{r.status}</span></td>
                      <td style={td}>{r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString("en-US",{month:"short",day:"2-digit",year:"numeric"}) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Approvals (managers/admins only) ── */}
        {view === "approvals" && canApprove && (
          <div>
            {isAdminRole(role) && <TimeOffNotifySettings />}
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16, color: "#0d2e5e" }}>Vacation Approvals</h2>
            {allRequests.length === 0 ? (
              <p style={{ color: "#888", fontSize: 14 }}>No requests yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Employee</th><th style={th}>Dates</th><th style={th}>Reason</th><th style={th}>Status</th><th style={th}>Submitted</th><th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {allRequests.map(r => (
                    <tr key={r.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                      <td style={td}><div style={{ fontWeight: 600 }}>{r.employeeName}</div><div style={{ fontSize: 11, color: "#9ca3af" }}>{r.employeeEmail}</div></td>
                      <td style={td}>{fmtISODate(r.startDate)}{r.startDate !== r.endDate ? ` → ${fmtISODate(r.endDate)}` : ""}</td>
                      <td style={td}>{r.reason || "—"}</td>
                      <td style={td}><span style={timeOffStatusBadge(r.status)}>{r.status}</span></td>
                      <td style={td}>{r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString("en-US",{month:"short",day:"2-digit",year:"numeric"}) : "—"}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {r.status === "PENDING" && (
                          <>
                            <button onClick={() => approveRequest(r)} style={{ ...btnS("#059669"), fontSize: 12, padding: "4px 10px", marginRight: 6 }}>✅ Approve</button>
                            <button onClick={() => denyRequest(r)}    style={{ ...btnS("#dc2626"), fontSize: 12, padding: "4px 10px" }}>❌ Deny</button>
                          </>
                        )}
                        {r.status !== "PENDING" && (
                          <button onClick={() => deleteRequest(r)} style={{ background: "transparent", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: 6, padding: "3px 10px", fontSize: 12, cursor: "pointer" }}>Remove</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Manage Vacation (admins only) ── */}
        {view === "manage-vacation" && isAdminRole(role) && (
          <VacationManager />
        )}

      </div>

      {/* ── Add Vacation modal (click a day) ── */}
      {vacAddModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setVacAddModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 28, width: "100%", maxWidth: 400, boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0d2e5e", marginBottom: 16 }}>🏖 Add Vacation</h2>

            <label style={lbl}>Person</label>
            <select value={vacName} onChange={e => setVacName(e.target.value)} style={{ ...inp, marginBottom: 14, width: "100%" }}>
              <option value="">Select person…</option>
              {vacPeople.map(p => <option key={p} value={p}>{p}</option>)}
            </select>

            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Start date</label>
                <input type="date" value={vacStart} onChange={e => setVacStart(e.target.value)} style={{ ...inp, width: "100%" }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>End date</label>
                <input type="date" value={vacEnd} min={vacStart} onChange={e => setVacEnd(e.target.value)} style={{ ...inp, width: "100%" }} />
              </div>
            </div>
            <p style={{ fontSize: 11, color: "#9ca3af", marginTop: -8, marginBottom: 14 }}>Same start &amp; end = a single day.</p>

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button disabled={!vacName || vacBusy} onClick={addVacationDay} style={{ background: "#f97316", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: (!vacName || vacBusy) ? 0.5 : 1 }}>{vacBusy ? "Adding…" : "Add Vacation"}</button>
              <button onClick={() => setVacAddModal(null)} style={{ background: "#6b7280", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit / Delete Vacation modal (tap a pill) ── */}
      {vacEditModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setVacEditModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 28, width: "100%", maxWidth: 400, boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0d2e5e", marginBottom: 4 }}>🏖 {vacEditModal.name}'s Vacation</h2>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>Change the dates or delete this vacation.</p>

            <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Start date</label>
                <input type="date" value={editStart} onChange={e => setEditStart(e.target.value)} style={{ ...inp, width: "100%" }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>End date</label>
                <input type="date" value={editEnd} min={editStart} onChange={e => setEditEnd(e.target.value)} style={{ ...inp, width: "100%" }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
              <button disabled={vacBusy} onClick={deleteEditVacation} style={{ background: "transparent", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Delete</button>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setVacEditModal(null)} style={{ background: "#6b7280", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                <button disabled={vacBusy || !editStart} onClick={saveEditVacation} style={{ background: "#f97316", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: (vacBusy || !editStart) ? 0.5 : 1 }}>{vacBusy ? "Saving…" : "Save"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: "8px 20px", fontWeight: 600, fontSize: 14, cursor: "pointer",
      background: "none", border: "none",
      borderBottom: active ? "3px solid #1565c0" : "3px solid transparent",
      color: active ? "#1565c0" : "#6b7280",
      marginBottom: -2, whiteSpace: "nowrap",
    }}>{label}</button>
  );
}

const navS: React.CSSProperties = { background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontWeight: 700, fontSize: 16 };
const btnS = (bg: string): React.CSSProperties => ({ background: bg, color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" });
const lbl: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#555" };
const inp: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 8, padding: "9px 12px", fontSize: 14 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, paddingBottom: 8, borderBottom: "1px solid #eee" };
const td: React.CSSProperties = { padding: "12px 8px 12px 0", fontSize: 14, color: "#333" };
