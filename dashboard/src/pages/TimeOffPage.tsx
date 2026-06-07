import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { doc as fsDoc, getDoc as fsGetDoc, setDoc as fsSetDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { useToast } from "../components/Toast";
import { fmtISODate, timeOffStatusBadge } from "../utils/formatting";
import type { TimeOffRequest } from "../types";

const TENANT_ID = "1c1d62e8-f392-4caa-a8a6-0ce98e0913d9";
const CLIENT_ID  = "9a1a21f1-40a3-4872-a4d6-888bd51d116d";
const CAL_ID     = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

type View = "month" | "list" | "request" | "my-requests";

export default function TimeOffPage() {
  const [currentUser, setCurrentUser] = useState<{ uid: string; email: string; displayName: string } | null>(null);
  const { confirm } = useToast();
  const [myRequests, setMyRequests] = useState<TimeOffRequest[]>([]);

  // Calendar state
  const todayDate = new Date();
  const [year,  setYear]  = useState(todayDate.getFullYear());
  const [month, setMonth] = useState(todayDate.getMonth());
  const [view,  setView]  = useState<View>("month");
  const [events, setEvents] = useState<{id:string;subject:string;start:string;end:string}[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [token, setToken] = useState("");

  // Request form state
  const [singleDay, setSingleDay] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate,   setEndDate]   = useState("");
  const [reason,    setReason]    = useState("");
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState("");

  const today = new Date().toISOString().split("T")[0];

  // Load user
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

  // Load Outlook token
  useEffect(() => {
    async function loadToken() {
      try {
        const snap = await fsGetDoc(fsDoc(db, "settings", "outlookOnCall"));
        if (snap.exists() && snap.data().refreshToken) {
          const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
            method: "POST",
            body: new URLSearchParams({ client_id: CLIENT_ID, refresh_token: snap.data().refreshToken, grant_type: "refresh_token", scope: "Calendars.ReadWrite offline_access" }),
          });
          const d = await r.json();
          if (d.access_token) {
            setToken(d.access_token);
            try { await fsSetDoc(fsDoc(db, "settings", "outlookOnCall"), { refreshToken: d.refresh_token }, { merge: true }); } catch {}
          }
        }
      } catch {}
    }
    loadToken();
  }, []);

  // Fetch calendar events when token/month/year changes
  useEffect(() => {
    if (!token) return;
    setCalLoading(true);
    const start = new Date(year, month, 1).toISOString().slice(0, 10);
    const end   = new Date(year, month + 1, 1).toISOString().slice(0, 10);
    (async () => {
      const evs: any[] = [];
      let url = `https://graph.microsoft.com/v1.0/me/calendars/${CAL_ID}/calendarView?startDateTime=${start}T00:00:00&endDateTime=${end}T00:00:00&$top=999&$select=id,subject,start,end`;
      while (url) {
        const d = await (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).json();
        (d.value || []).filter((e: any) => e.subject?.toLowerCase().includes("vacation"))
          .forEach((e: any) => evs.push({ id: e.id, subject: e.subject, start: e.start?.date || e.start?.dateTime?.slice(0, 10) || "", end: e.end?.date || e.end?.dateTime?.slice(0, 10) || "" }));
        url = d["@odata.nextLink"] || "";
      }
      setEvents(evs);
      setCalLoading(false);
    })().catch(() => setCalLoading(false));
  }, [token, year, month]);

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
    if (!startDate || (!singleDay && !endDate)) { setError(singleDay ? "Please select a date." : "Please select a start and end date."); return; }
    const effectiveEnd = singleDay ? startDate : endDate;
    if (effectiveEnd < startDate) { setError("End date cannot be before start date."); return; }
    if (!currentUser) { setError("Not logged in."); return; }

    const overlap = myRequests.find(r => r.status !== "DENIED" && startDate <= r.endDate && effectiveEnd >= r.startDate);
    if (overlap) { setError(`You already have a ${overlap.status.toLowerCase()} request for ${overlap.startDate} – ${overlap.endDate}. Choose different dates.`); return; }

    const deniedOverlap = myRequests.find(r => r.status === "DENIED" && startDate <= r.endDate && effectiveEnd >= r.startDate);
    if (deniedOverlap) {
      const proceed = await confirm("The time off you are requesting has previously been denied. Are you sure you want to request this time off?");
      if (!proceed) return;
    }

    setBusy(true);
    try {
      await addDoc(collection(db, "timeOffRequests"), {
        uid: currentUser.uid,
        employeeName: currentUser.displayName,
        employeeEmail: currentUser.email,
        startDate,
        endDate: effectiveEnd,
        reason: reason.trim(),
        status: "PENDING",
        createdAt: new Date(),
      });
      try {
        const idToken = await auth.currentUser?.getIdToken() ?? "";
        await fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken, type: "time-off", payload: { employee_name: currentUser.displayName, employee_email: currentUser.email, start_date: startDate, end_date: effectiveEnd, reason: reason.trim() || "No reason provided" } }) });
      } catch {}
      setSuccess("Time off request submitted successfully.");
      setStartDate(""); setEndDate(""); setReason("");
      await loadMyRequests();
    } catch (e: any) {
      setError(e?.message ?? "Failed to submit request.");
    } finally {
      setBusy(false);
    }
  }

  // Calendar grid helpers
  const todayStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;
  const first = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const grid: string[] = [];
  for (let i = 0; i < first; i++) grid.push("");
  for (let d = 1; d <= daysInMonth; d++) grid.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);

  // Build vacation map
  const vacMap: Record<string, string[]> = {};
  events.forEach(ev => {
    let cur = new Date(ev.start + "T12:00:00");
    const end = new Date(ev.end + "T12:00:00");
    const name = ev.subject.replace(/vacation\s*[-–]?\s*/i, "").replace(/[-–]\s*vacation/i, "").trim();
    while (cur < end) {
      const d = cur.toISOString().slice(0, 10);
      if (!vacMap[d]) vacMap[d] = [];
      if (!vacMap[d].includes(name)) vacMap[d].push(name);
      cur.setDate(cur.getDate() + 1);
    }
  });

  const prevMonth = () => { let m = month - 1, y = year; if (m < 0) { m = 11; y--; } setMonth(m); setYear(y); };
  const nextMonth = () => { let m = month + 1, y = year; if (m > 11) { m = 0; y++; } setMonth(m); setYear(y); };

  return (
    <div style={{ padding: "0 0 32px" }}>

      {/* ── Full-width calendar card ── */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 24 }}>

        {/* Tab buttons — same style as On-Call page */}
        <div style={{ display: "flex", alignItems: "center", borderBottom: "2px solid #f0f0f0", marginBottom: 20, gap: 0 }}>
          <TabBtn label="📅 Month View"       active={view === "month"}       onClick={() => setView("month")} />
          <TabBtn label="📋 List View"        active={view === "list"}        onClick={() => setView("list")} />
          <TabBtn label="✏️ Request Time Off" active={view === "request"}     onClick={() => setView("request")} />
          <TabBtn label="🗂 My Requests"      active={view === "my-requests"} onClick={() => setView("my-requests")} />
        </div>

        {/* Month nav — only show on calendar views */}
        {(view === "month" || view === "list") && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={prevMonth} style={styles.navBtn}>◀</button>
              <span style={{ fontWeight: 700, fontSize: 20, color: "#0d2e5e", minWidth: 180, textAlign: "center" }}>{MONTHS[month]} {year}</span>
              <button onClick={nextMonth} style={styles.navBtn}>▶</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ background: "#f97316", color: "#fff", fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 99 }}>🏖 Vacation</span>
              {!token && <span style={{ fontSize: 12, color: "#9ca3af" }}>Connect Outlook in On-Call Setup to see vacations</span>}
            </div>
          </div>
        )}


        {/* ── Month Grid ── */}
        {view === "month" && (
          <>
            {calLoading && <div style={{ textAlign: "center", padding: 60, color: "#9ca3af", fontSize: 15 }}>⏳ Loading…</div>}
            {!calLoading && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                {DAYS.map(d => (
                  <div key={d} style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: "#6b7280", padding: "8px 0", textTransform: "uppercase", letterSpacing: 0.5 }}>{d}</div>
                ))}
                {grid.map((date, i) => {
                  const names = date ? (vacMap[date] || []) : [];
                  const isToday = date === todayStr;
                  return (
                    <div key={i} style={{
                      minHeight: 110,
                      background: isToday ? "#fff8f0" : names.length ? "#fff7ed" : "#fafafa",
                      border: isToday ? "2px solid #f97316" : "1px solid #e5e7eb",
                      borderRadius: 6,
                      padding: 6,
                    }}>
                      {date && <>
                        <div style={{ fontSize: 13, fontWeight: isToday ? 800 : 500, color: isToday ? "#f97316" : "#374151", marginBottom: 3 }}>
                          {parseInt(date.slice(8))}
                        </div>
                        {names.slice(0, 3).map(n => (
                          <div key={n} style={{ fontSize: 11, fontWeight: 600, background: "#f97316", color: "white", borderRadius: 4, padding: "2px 5px", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            🏖 {n}
                          </div>
                        ))}
                        {names.length > 3 && <div style={{ fontSize: 10, color: "#9ca3af" }}>+{names.length - 3} more</div>}
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
            {calLoading && <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>⏳ Loading…</div>}
            {!calLoading && events.length === 0 && <p style={{ color: "#9ca3af", fontSize: 14 }}>No vacations this month.</p>}
            {!calLoading && events.map(ev => (
              <div key={ev.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid #f5f5f5" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{ev.subject.replace(/vacation\s*[-–]?\s*/i, "").replace(/[-–]\s*vacation/i, "").trim()}</div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{ev.start} → {ev.end}</div>
                </div>
                <span style={{ background: "#fff3e0", color: "#e65100", fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 99 }}>🏖 Vacation</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Request Time Off Form ── */}
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
                <label style={styles.label}>{singleDay ? "Date" : "Start Date"}</label>
                <input type="date" style={styles.input} min={today} value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              {!singleDay && (
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 160 }}>
                  <label style={styles.label}>End Date</label>
                  <input type="date" style={styles.input} min={startDate || today} value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", marginBottom: 16 }}>
              <label style={styles.label}>Reason (optional)</label>
              <textarea style={{ ...styles.input, resize: "vertical", minHeight: 80, fontFamily: "inherit" }} value={reason} onChange={e => setReason(e.target.value)} placeholder="Any additional details…" />
            </div>

            {error   && <p style={{ color: "#cc0000", fontSize: 13, marginBottom: 12 }}>{error}</p>}
            {success && <p style={{ color: "#007700", fontSize: 13, marginBottom: 12 }}>{success}</p>}

            <button style={styles.btn} onClick={submitRequest} disabled={busy}>
              {busy ? "Submitting…" : "Submit Request"}
            </button>
          </div>
        )}

        {/* ── My Requests ── */}
        {view === "my-requests" && (
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20, color: "#0d2e5e" }}>My Requests</h2>
            {myRequests.length === 0 ? (
              <p style={{ color: "#888", fontSize: 14 }}>No requests submitted yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={styles.th}>Start</th>
                    <th style={styles.th}>End</th>
                    <th style={styles.th}>Reason</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {myRequests.map(r => (
                    <tr key={r.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                      <td style={styles.td}>{fmtISODate(r.startDate)}</td>
                      <td style={styles.td}>{fmtISODate(r.endDate)}</td>
                      <td style={styles.td}>{r.reason || "—"}</td>
                      <td style={styles.td}><span style={timeOffStatusBadge(r.status)}>{r.status}</span></td>
                      <td style={styles.td}>
                        {r.createdAt?.toDate
                          ? r.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
                          : r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

      </div>
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
      marginBottom: -2,
      whiteSpace: "nowrap",
    }}>{label}</button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  navBtn: {
    background: "#f3f4f6",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    padding: "6px 16px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 16,
  },
  label: { fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#555" },
  input: { border: "1px solid #ddd", borderRadius: 8, padding: "9px 12px", fontSize: 14 },
  btn: {
    backgroundColor: "#1565c0",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 24px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  th: {
    textAlign: "left",
    fontSize: 12,
    fontWeight: 700,
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingBottom: 8,
    borderBottom: "1px solid #eee",
  },
  td: { padding: "12px 8px 12px 0", fontSize: 14, color: "#333" },
};
