import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, doc, getDocs, onSnapshot,
  query, updateDoc, deleteDoc, where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useToast } from "../components/Toast";
import { useRole, canApproveTimeOff, isAdminRole } from "../hooks/useRole";
import { fmtISODate, timeOffStatusBadge } from "../utils/formatting";
import type { TimeOffRequest } from "../types";
import { auth, db } from "../firebase";
import { getOutlookToken } from "../utils/outlookToken";

const callSyncVacation = httpsCallable(getFunctions(), "syncVacationEvent");
const callVacation     = httpsCallable(getFunctions(), "vacationAction");
const CAL_ID     = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const SHORT_MONTHS = MONTHS.map(m=>m.slice(0,3));
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

type View = "month" | "list" | "approvals";

export default function TimeOffPage() {
  const { toast, confirm } = useToast();
  const role = useRole();
  const canApprove = canApproveTimeOff(role);

  const [allRequests, setAllRequests] = useState<TimeOffRequest[]>([]);

  // Calendar
  const todayDate = new Date();
  const [year,  setYear]  = useState(todayDate.getFullYear());
  const [month, setMonth] = useState(todayDate.getMonth());
  const [view, setView] = useState<View>("month");
  const [events, setEvents] = useState<{id:string;subject:string;start:string;end:string}[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [token, setToken] = useState("");

  const today = new Date().toISOString().split("T")[0];

  // Listen for all requests (for approvers)
  useEffect(() => {
    if (!canApprove) return;
    return onSnapshot(query(collection(db, "timeOffRequests")), snap => {
      setAllRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as TimeOffRequest))
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)));
    });
  }, [canApprove]);

  // Outlook token
  // Outlook token — use shared utility so the refresh token is never burned twice
  useEffect(() => {
    getOutlookToken().then(t => {
      if (t && t !== "disconnected") setToken(t);
    }).catch(() => {});
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

  function switchView(v: View) {
    setView(v);
    if (v === "month" || v === "list") loadVacations();
  }

  async function approveRequest(r: TimeOffRequest) {
    await updateDoc(doc(db, "timeOffRequests", r.id), { status: "APPROVED" });
    // Wait for the Outlook event to be created, then refresh the calendar so it shows immediately
    await callSyncVacation({ requestId: r.id }).catch(() => {});
    await loadVacations();
  }
  async function denyRequest(r: TimeOffRequest) {
    await updateDoc(doc(db, "timeOffRequests", r.id), { status: "DENIED" });
    await callSyncVacation({ requestId: r.id }).catch(() => {});
    await loadVacations();
  }
  async function deleteRequest(r: TimeOffRequest) {
    if (!await confirm(`Delete this request from ${r.employeeName}?`)) return;
    // Remove the Outlook calendar event first (while the doc still exists), then delete the request
    await callSyncVacation({ requestId: r.id, remove: true }).catch(() => {});
    await deleteDoc(doc(db, "timeOffRequests", r.id));
    await loadVacations();
  }

  // Calendar grid
  const todayStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth()+1).padStart(2,"0")}-${String(todayDate.getDate()).padStart(2,"0")}`;
  const first = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const fmtYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const grid: string[] = [];
  for (let i = 0; i < first; i++) grid.push(fmtYMD(new Date(year, month, 1 - (first - i))));
  for (let d = 1; d <= daysInMonth; d++) grid.push(`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`);
  while (grid.length % 7 !== 0) { const nx = new Date(grid[grid.length-1] + "T12:00:00"); nx.setDate(nx.getDate()+1); grid.push(fmtYMD(nx)); }

  // Vacation map: date → [{id,name,calId,start,lastDay}]
  type VacPill = { id: string; name: string; calId?: string; start: string; lastDay: string };
  const vacByDate: Record<string, VacPill[]> = {};
  events.forEach((ev: any) => {
    let cur = new Date(ev.start + "T12:00:00");
    const end = new Date(ev.end + "T12:00:00"); // exclusive
    const lastD = new Date(end); lastD.setDate(lastD.getDate() - 1);
    const lastDay = lastD.toISOString().slice(0, 10);
    const name = (ev.subject.replace(/vacation\s*[-–]?\s*/i, "").replace(/[-–]\s*vacation/i, "").trim().split(/\s+/)[0]) || "";
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

        {/* ── Tab buttons ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, borderBottom: "2px solid #f0f0f0", marginBottom: 20, flexWrap: "wrap" }}>
          <TabBtn label="Calendar"  active={view==="month"} onClick={()=>switchView("month")} />
          <TabBtn label="List View" active={view==="list"}  onClick={()=>switchView("list")} />
          {canApprove && (
            <TabBtn
              label={`Approvals${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
              active={view==="approvals"}
              onClick={()=>switchView("approvals")}
            />
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, paddingBottom: 2 }}>
            <Link to="/time-off/request" style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "none" }}>
              + Request Vacation
            </Link>
            <Link to="/time-off/my-requests" style={{ background: "#f3f4f6", color: "#374151", border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "none" }}>
              My Requests
            </Link>
          </div>
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
            {isAdminRole(role) && <span style={{ fontSize: 11, color: "#9ca3af" }}>Click a day to add a vacation · tap a vacation to edit or delete it</span>}
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
                  const inMonth = date.slice(0,7) === `${year}-${String(month+1).padStart(2,"0")}`;
                  const admin = isAdminRole(role);
                  return (
                    <div key={i}
                      onClick={admin && date ? () => openAdd(date) : undefined}
                      title={admin && date ? "Click to add a vacation" : undefined}
                      style={{ minHeight: 110, background: isToday ? "#fff8f0" : (inMonth ? "#fafafa" : "#f1f1f1"), border: isToday ? "2px solid #f97316" : "1px solid #e5e7eb", borderRadius: 6, padding: 6, opacity: inMonth ? 1 : 0.55, cursor: admin && date ? "pointer" : "default" }}>
                      {date && <>
                        <div style={{ fontSize: inMonth ? 12 : 10, fontWeight: isToday ? 800 : 500, color: isToday ? "#f97316" : (inMonth ? "#374151" : "#9ca3af"), marginBottom: 2 }}>
                          {inMonth ? parseInt(date.slice(8)) : `${SHORT_MONTHS[parseInt(date.slice(5,7))-1]} ${parseInt(date.slice(8))}`}
                        </div>
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

        {/* ── Approvals (managers/admins only) ── */}
        {view === "approvals" && canApprove && (
          <div>
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
                            <button onClick={() => approveRequest(r)} style={{ ...btnS("#059669"), fontSize: 12, padding: "4px 10px", marginRight: 6 }}>Approve</button>
                            <button onClick={() => denyRequest(r)}    style={{ ...btnS("#dc2626"), fontSize: 12, padding: "4px 10px" }}>Deny</button>
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
