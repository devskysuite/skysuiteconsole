import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { Link } from "react-router-dom";
import { auth, db } from "../firebase";
import { getIdToken } from "firebase/auth";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { useToast } from "../components/Toast";
import Spinner from "../components/Spinner";
import { fmtISODate, swapStatusBadge } from "../utils/formatting";
import type { OnCallAssignment, OnCallSwapRequest } from "../types";

/* ── helpers ── */

/** Build a calendar grid for a single month. */
function calendarWeeksForMonth(year: number, month: number): { iso: string; day: number; isCurrentMonth: boolean }[][] {
  const weeks: { iso: string; day: number; isCurrentMonth: boolean }[][] = [];
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDow = first.getDay(); // 0=Sun
  let week: { iso: string; day: number; isCurrentMonth: boolean }[] = [];
  // Fill leading blanks
  for (let i = 0; i < startDow; i++) week.push({ iso: "", day: 0, isCurrentMonth: false });
  for (let d = 1; d <= last.getDate(); d++) {
    const dt = new Date(year, month, d);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    week.push({ iso: `${yyyy}-${mm}-${dd}`, day: d, isCurrentMonth: true });
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  // Fill trailing blanks
  if (week.length > 0) {
    while (week.length < 7) week.push({ iso: "", day: 0, isCurrentMonth: false });
    weeks.push(week);
  }
  return weeks;
}

/** Format "YYYY-MM-DD" to "Mon, Mar 23". */
function fmtScheduleDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  const dayName = dt.toLocaleDateString("en-US", { weekday: "short" });
  const monthDay = dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${dayName}, ${monthDay}`;
}

/** Today in "YYYY-MM-DD" form. */
function todayISO(): string {
  const n = new Date();
  const yyyy = n.getFullYear();
  const mm = String(n.getMonth() + 1).padStart(2, "0");
  const dd = String(n.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/* ── component ── */

export default function OnCallPage() {
  const isAdmin = useIsAdmin();
  const { toast } = useToast();

  /* current user */
  const [currentUid, setCurrentUid] = useState("");
  const [currentName, setCurrentName] = useState("");
  const [loading, setLoading] = useState(true);

  /* data */
  const [assignments, setAssignments] = useState<OnCallAssignment[]>([]);
  const [swapRequests, setSwapRequests] = useState<OnCallSwapRequest[]>([]);
  const [allUsers, setAllUsers] = useState<{ uid: string; displayName: string }[]>([]);

  /* swap modal state */
  const [swapAssignment, setSwapAssignment] = useState<OnCallAssignment | null>(null);
  const [swapWithUid, setSwapWithUid] = useState(""); // admin can pick who swaps
  const [swapOfferDate, setSwapOfferDate] = useState("");
  const [swapReason, setSwapReason] = useState("");
  const [submittingSwap, setSubmittingSwap] = useState(false);

  /* calendar month navigation */
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());

  const today = todayISO();
  const weeks = calendarWeeksForMonth(calYear, calMonth);
  const calMonthLabel = new Date(calYear, calMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  function prevMonth() {
    if (calMonth === 0) { setCalYear(calYear - 1); setCalMonth(11); }
    else setCalMonth(calMonth - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(calYear + 1); setCalMonth(0); }
    else setCalMonth(calMonth + 1);
  }
  function goToday() {
    const n = new Date();
    setCalYear(n.getFullYear());
    setCalMonth(n.getMonth());
  }

  /* ── auth ── */
  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      setCurrentUid(user.uid);
      try {
        const snap = await getDocs(query(collection(db, "users"), where("uid", "==", user.uid)));
        const name = snap.empty
          ? user.displayName || user.email?.split("@")[0] || ""
          : snap.docs[0].data().displayName || "";
        setCurrentName(name);
      } catch {
        setCurrentName(user.displayName || user.email?.split("@")[0] || "");
      }
    });
  }, []);

  /* ── load all users (for swap dropdown) ── */
  useEffect(() => {
    getDocs(collection(db, "users")).then((snap) => {
      const users = snap.docs.map((d) => ({
        uid: d.data().uid as string,
        displayName: (d.data().displayName || d.data().email || "") as string,
      }));
      users.sort((a, b) => a.displayName.localeCompare(b.displayName));
      setAllUsers(users);
    });
  }, []);

  /* ── subscribe to assignments ── */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "onCallAssignments"), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as OnCallAssignment));
      setAssignments(list);
      setLoading(false);
    });
    return unsub;
  }, []);

  /* ── subscribe to swap requests ── */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "onCallSwapRequests"), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as OnCallSwapRequest));
      setSwapRequests(list);
    });
    return unsub;
  }, []);

  /* ── derived data ── */

  // Map date -> assignment for quick look-up
  const assignmentByDate: Record<string, OnCallAssignment> = {};
  for (const a of assignments) {
    assignmentByDate[a.date] = a;
  }

  // Requester's future on-call days (for swap offer picker)
  const requesterUid = swapWithUid || currentUid;
  const requesterOnCallDays = assignments
    .filter((a) => a.uid === requesterUid && a.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Incoming pending swap requests targeting me
  const incomingSwaps = swapRequests.filter(
    (r) => r.targetUid === currentUid && r.status === "PENDING"
  );

  // My sent swap requests (all statuses)
  const mySentSwaps = [...swapRequests]
    .filter((r) => r.requesterUid === currentUid)
    .sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() ?? a.createdAt?.seconds ?? 0;
      const bTime = b.createdAt?.toMillis?.() ?? b.createdAt?.seconds ?? 0;
      return bTime - aTime;
    });

  /* ── handlers ── */

  function openSwapModal(assignment: OnCallAssignment) {
    setSwapAssignment(assignment);
    setSwapWithUid(isAdmin ? "" : currentUid);
    setSwapOfferDate("");
    setSwapReason("");
  }

  function closeSwapModal() {
    setSwapAssignment(null);
    setSwapWithUid("");
    setSwapOfferDate("");
    setSwapReason("");
  }

  async function submitSwapRequest() {
    if (!swapAssignment || !swapWithUid) {
      toast("Please select who will swap.", "error");
      return;
    }

    const requester = allUsers.find((u) => u.uid === swapWithUid);
    const requesterName = requester?.displayName || currentName;

    // Find the requester's assignment if an offer date was selected
    let targetAssignmentId = "";
    if (swapOfferDate) {
      const match = assignments.find(
        (a) => a.date === swapOfferDate && a.uid === swapWithUid
      );
      if (match) targetAssignmentId = match.id;
    }

    setSubmittingSwap(true);
    try {
      if (isAdmin) {
        // Admin: execute swap immediately without approval
        // 1. Update the original assignment to the new person
        await updateDoc(doc(db, "onCallAssignments", swapAssignment.id), {
          uid: swapWithUid,
          employeeName: requesterName,
        });

        // 2. Handle the exchange date if offered
        if (swapOfferDate) {
          if (targetAssignmentId) {
            await updateDoc(doc(db, "onCallAssignments", targetAssignmentId), {
              uid: swapAssignment.uid,
              employeeName: swapAssignment.employeeName,
            });
          } else {
            await addDoc(collection(db, "onCallAssignments"), {
              date: swapOfferDate,
              uid: swapAssignment.uid,
              employeeName: swapAssignment.employeeName,
              assignedByUid: currentUid,
              createdAt: serverTimestamp(),
            });
          }
        }

        // If the swapped date is today, trigger the phone forwarding update
        if (swapAssignment.date === today && auth.currentUser) {
          getIdToken(auth.currentUser)
            .then((token) =>
              fetch("/api/trigger-oncall-update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idToken: token }),
              })
            )
            .then((res) => {
              if (res.ok) toast("Phone forwarding update triggered.", "success");
              else console.error("Failed to trigger forwarding update");
            })
            .catch((err) => console.error("Forwarding trigger error:", err));
        }

        toast("Swap applied!", "success");
      } else {
        // Regular user: create a pending swap request
        await addDoc(collection(db, "onCallSwapRequests"), {
          date: swapAssignment.date,
          assignmentId: swapAssignment.id,
          requesterUid: swapWithUid,
          requesterName,
          targetUid: swapAssignment.uid,
          targetName: swapAssignment.employeeName,
          targetDate: swapOfferDate || "",
          targetAssignmentId,
          reason: swapReason.trim(),
          status: "PENDING",
          createdAt: serverTimestamp(),
          resolvedAt: null,
        });
        toast("Swap request sent!", "success");
      }
      closeSwapModal();
    } catch (err: any) {
      toast(err?.message || "Failed to process swap.", "error");
    } finally {
      setSubmittingSwap(false);
    }
  }

  async function acceptSwap(swap: OnCallSwapRequest) {
    try {
      // 1. Update the assignment for swap.date: change to current user (target)
      await updateDoc(doc(db, "onCallAssignments", swap.assignmentId), {
        uid: currentUid,
        employeeName: currentName,
      });

      // 2. Handle the exchange date if offered
      if (swap.targetDate) {
        if (swap.targetAssignmentId) {
          // Update existing assignment to the requester
          await updateDoc(doc(db, "onCallAssignments", swap.targetAssignmentId), {
            uid: swap.requesterUid,
            employeeName: swap.requesterName,
          });
        } else {
          // Create new assignment for the requester on the target date
          await addDoc(collection(db, "onCallAssignments"), {
            date: swap.targetDate,
            uid: swap.requesterUid,
            employeeName: swap.requesterName,
            assignedByUid: currentUid,
            createdAt: serverTimestamp(),
          });
        }
      }

      // 3. Mark swap as ACCEPTED
      await updateDoc(doc(db, "onCallSwapRequests", swap.id), {
        status: "ACCEPTED",
        resolvedAt: serverTimestamp(),
      });

      toast("Swap confirmed!", "success");
    } catch (err: any) {
      toast(err?.message || "Failed to accept swap.", "error");
    }
  }

  async function cancelSwap(swap: OnCallSwapRequest) {
    try {
      await deleteDoc(doc(db, "onCallSwapRequests", swap.id));
      toast("Swap request cancelled.", "info");
    } catch (err: any) {
      toast(err?.message || "Failed to cancel swap request.", "error");
    }
  }

  async function declineSwap(swap: OnCallSwapRequest) {
    try {
      await updateDoc(doc(db, "onCallSwapRequests", swap.id), {
        status: "DECLINED",
        resolvedAt: serverTimestamp(),
      });
      toast("Swap declined.", "info");
    } catch (err: any) {
      toast(err?.message || "Failed to decline swap.", "error");
    }
  }

  /* ── render ── */

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
        <Spinner size={32} />
      </div>
    );
  }

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={styles.pageTitle}>On-Call Schedule</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            style={styles.subscribeBtn}
            onClick={() => {
              const url = "https://rbt-hub.vercel.app/api/oncall.ics";
              navigator.clipboard.writeText(url)
                .then(() => toast("Calendar feed URL copied! Paste it into Google Calendar, Outlook, or Apple Calendar to subscribe.", "success"))
                .catch(() => toast(`Feed URL: ${url}`, "info"));
            }}
          >
            Subscribe to Calendar
          </button>
          {isAdmin && (
            <Link to="/on-call/manage" style={styles.manageLink}>
              Manage Assignments
            </Link>
          )}
        </div>
      </div>

      {/* ── Incoming Swap Requests ── */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>Incoming Swap Requests</h2>
        {incomingSwaps.length === 0 ? (
          <div style={styles.emptyBox}>No pending swap requests for you.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {incomingSwaps.map((swap) => (
              <div key={swap.id} style={styles.incomingCard}>
                <div style={{ marginBottom: 10 }}>
                  <strong>{swap.requesterName}</strong> wants to swap their on-call day on{" "}
                  <strong>{fmtScheduleDate(swap.date)}</strong>
                  {swap.targetDate ? (
                    <>
                      {" "}and offers <strong>{fmtScheduleDate(swap.targetDate)}</strong> in exchange
                    </>
                  ) : null}
                  .
                </div>
                {swap.reason && (
                  <div style={{ fontSize: 13, color: "#555", marginBottom: 10 }}>
                    Reason: {swap.reason}
                  </div>
                )}
                <div style={{ display: "flex", gap: 10 }}>
                  <button style={styles.btnGreen} onClick={() => acceptSwap(swap)}>
                    Accept
                  </button>
                  <button style={styles.btnRedOutline} onClick={() => declineSwap(swap)}>
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Calendar Schedule ── */}
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <button onClick={prevMonth} style={styles.calNavBtn}>&larr;</button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select
              style={styles.monthSelect}
              value={calMonth}
              onChange={(e) => setCalMonth(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i}>
                  {new Date(2000, i, 1).toLocaleDateString("en-US", { month: "long" })}
                </option>
              ))}
            </select>
            <select
              style={styles.monthSelect}
              value={calYear}
              onChange={(e) => setCalYear(Number(e.target.value))}
            >
              {Array.from({ length: 5 }, (_, i) => {
                const y = now.getFullYear() - 1 + i;
                return <option key={y} value={y}>{y}</option>;
              })}
            </select>
            {(calYear !== now.getFullYear() || calMonth !== now.getMonth()) && (
              <button onClick={goToday} style={styles.calTodayBtn}>Today</button>
            )}
          </div>
          <button onClick={nextMonth} style={styles.calNavBtn}>&rarr;</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0, borderLeft: "1px solid #cbd5e1", borderTop: "1px solid #cbd5e1" }}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} style={styles.calDayHeader}>{d}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0, borderLeft: "1px solid #cbd5e1" }}>
            {week.map((cell, ci) => {
              if (!cell.iso) return <div key={ci} style={styles.calCell} />;
              const assignment = assignmentByDate[cell.iso];
              const isToday = cell.iso === today;
              const isPast = cell.iso < today;
              const isMine = assignment?.uid === currentUid;
              const canSwap = assignment && !isPast && (isAdmin || !isMine);
              const clickable = canSwap;
              let bg = "#fff";
              let border = "none";
              if (isToday) { bg = "#166534"; border = "2px solid #166534"; }
              else if (isMine && !isPast) bg = "#fef9e7";
              else if (isPast) bg = "#fafafa";
              return (
                <div
                  key={ci}
                  style={{
                    ...styles.calCell,
                    backgroundColor: bg,
                    border,
                    opacity: isPast ? 0.5 : 1,
                    cursor: clickable ? "pointer" : "default",
                  }}
                  onClick={() => {
                    if (canSwap) openSwapModal(assignment);
                  }}
                  title={canSwap ? `Request swap with ${assignment.employeeName}` : ""}
                >
                  <div style={{ fontSize: 12, fontWeight: isToday ? 800 : 600, color: isToday ? "#fff" : "#555", marginBottom: 2 }}>
                    {cell.day}
                  </div>
                  {assignment ? (
                    <div style={{ fontSize: 11, fontWeight: isMine ? 700 : 500, color: isToday ? "rgba(255,255,255,0.9)" : isMine && !isPast ? "#b45309" : "#333", lineHeight: 1.2 }}>
                      {assignment.employeeName}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: "#ccc" }}>—</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Swap Modal ── */}
      {swapAssignment && (
        <div style={styles.overlay} onClick={closeSwapModal}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ ...styles.sectionTitle, marginBottom: 6 }}>{isAdmin ? "Swap Days" : "Request Swap"}</h2>
            <p style={{ fontSize: 14, color: "#555", marginBottom: 16 }}>
              Swap <strong>{fmtScheduleDate(swapAssignment.date)}</strong> from{" "}
              <strong>{swapAssignment.employeeName}</strong>
            </p>

            {/* Admin: pick who requests the swap */}
            {isAdmin ? (
              <div style={styles.field}>
                <label style={styles.label}>Swap to</label>
                <select
                  style={styles.input}
                  value={swapWithUid}
                  onChange={(e) => { setSwapWithUid(e.target.value); setSwapOfferDate(""); }}
                >
                  <option value="">Select an employee...</option>
                  {allUsers
                    .filter((u) => u.uid !== swapAssignment.uid && u.displayName !== swapAssignment.employeeName)
                    .map((u) => (
                      <option key={u.uid} value={u.uid}>{u.displayName}</option>
                    ))}
                </select>
              </div>
            ) : null}

            {/* Offer date picker — only when requester is selected */}
            {swapWithUid && (
              <div style={styles.field}>
                <label style={styles.label}>Offer a day in exchange (optional)</label>
                {requesterOnCallDays.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#888" }}>No upcoming on-call days to offer.</p>
                ) : (
                  <select
                    style={styles.input}
                    value={swapOfferDate}
                    onChange={(e) => setSwapOfferDate(e.target.value)}
                  >
                    <option value="">None — just take over the day</option>
                    {requesterOnCallDays.map((d) => (
                      <option key={d.id} value={d.date}>{fmtScheduleDate(d.date)}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div style={styles.field}>
              <label style={styles.label}>Reason (optional)</label>
              <textarea
                style={{ ...styles.input, resize: "vertical" as const, minHeight: 70, fontFamily: "inherit" }}
                value={swapReason}
                onChange={(e) => setSwapReason(e.target.value)}
                placeholder="Why do you need to swap?"
              />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button style={styles.btn} disabled={submittingSwap || !swapWithUid} onClick={submitSwapRequest}>
                {submittingSwap ? "Processing..." : isAdmin ? "Swap Now" : "Send Request"}
              </button>
              <button style={styles.btnOutline} onClick={closeSwapModal}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── My Sent Swap Requests ── */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>My Sent Swap Requests</h2>
        {mySentSwaps.length === 0 ? (
          <p style={{ color: "#888", fontSize: 14 }}>You haven't sent any swap requests.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Swap With</th>
                  <th style={styles.th}>Exchange Date</th>
                  <th style={styles.th}>Reason</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {mySentSwaps.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={styles.td}>{fmtISODate(r.date)}</td>
                    <td style={styles.td}>{r.targetName}</td>
                    <td style={styles.td}>{r.targetDate ? fmtISODate(r.targetDate) : "—"}</td>
                    <td style={styles.td}>{r.reason || "—"}</td>
                    <td style={styles.td}>
                      <span style={swapStatusBadge(r.status)}>{r.status}</span>
                    </td>
                    <td style={styles.td}>
                      {r.status === "PENDING" && (
                        <button style={{ ...styles.btnRedOutline, fontSize: 12, padding: "4px 10px" }} onClick={() => cancelSwap(r)}>Cancel</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── styles ── */

const styles: Record<string, React.CSSProperties> = {
  pageTitle: {
    fontSize: 28,
    fontWeight: 900,
    color: "#1e7d3a",
    marginBottom: 0,
  },
  manageLink: {
    backgroundColor: "#1e7d3a",
    color: "#fff",
    borderRadius: 8,
    padding: "9px 20px",
    fontWeight: 700,
    fontSize: 14,
    textDecoration: "none",
  },
  subscribeBtn: {
    backgroundColor: "#fff",
    border: "1px solid #1e7d3a",
    color: "#1e7d3a",
    borderRadius: 8,
    padding: "9px 20px",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    border: "1px solid #e5e5e5",
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 800,
    marginBottom: 14,
    color: "#333",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    boxShadow: "none",
  },
  th: {
    backgroundColor: "#f8f9fa",
    padding: "10px 14px",
    fontSize: 12,
    textTransform: "uppercase" as const,
    fontWeight: 700,
    color: "#888",
    textAlign: "left" as const,
    letterSpacing: 0.5,
    borderBottom: "1px solid #eee",
  },
  td: {
    padding: "12px 14px",
    borderBottom: "1px solid #f0f0f0",
    fontSize: 14,
    color: "#333",
  },
  btn: {
    backgroundColor: "#1e7d3a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "9px 20px",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
  },
  btnOutline: {
    backgroundColor: "#fff",
    border: "1px solid #1e7d3a",
    color: "#1e7d3a",
    borderRadius: 8,
    padding: "9px 20px",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
  },
  btnGreen: {
    backgroundColor: "#166534",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "9px 20px",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
  },
  btnRedOutline: {
    backgroundColor: "#fff",
    border: "1px solid #991b1b",
    color: "#991b1b",
    borderRadius: 8,
    padding: "9px 20px",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
  },
  input: {
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: 700,
    color: "#333",
    marginTop: 12,
    marginBottom: 4,
  },
  field: {
    display: "flex",
    flexDirection: "column" as const,
    marginBottom: 12,
  },
  emptyBox: {
    backgroundColor: "#edfaf1",
    border: "1px solid #34c759",
    borderRadius: 10,
    padding: "16px 20px",
    color: "#1a7a3c",
    fontSize: 14,
    fontWeight: 600,
  },
  myDayCard: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f8f9fa",
    borderRadius: 10,
    padding: "14px 18px",
    border: "1px solid #e5e5e5",
  },
  swapForm: {
    backgroundColor: "#fafbfc",
    border: "1px solid #e5e5e5",
    borderRadius: 10,
    padding: 20,
    marginTop: 8,
  },
  incomingCard: {
    backgroundColor: "#fffbeb",
    border: "1px solid #fbbf24",
    borderRadius: 10,
    padding: "16px 20px",
    fontSize: 14,
  },
  calNavBtn: {
    background: "none",
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "6px 14px",
    fontSize: 18,
    cursor: "pointer",
    color: "#1e7d3a",
    fontWeight: 700,
  },
  monthSelect: {
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 15,
    fontWeight: 700,
    color: "#1e7d3a",
    cursor: "pointer",
    background: "#fff",
  },
  calTodayBtn: {
    background: "none",
    border: "1px solid #1e7d3a",
    borderRadius: 6,
    padding: "4px 12px",
    fontSize: 12,
    cursor: "pointer",
    color: "#1e7d3a",
    fontWeight: 700,
  },
  calDayHeader: {
    textAlign: "center" as const,
    fontSize: 11,
    fontWeight: 700,
    color: "#888",
    textTransform: "uppercase" as const,
    padding: "6px 0",
    borderBottom: "1px solid #eee",
  },
  calCell: {
    minHeight: 64,
    padding: "6px 8px",
    borderRight: "1px solid #cbd5e1",
    borderBottom: "1px solid #cbd5e1",
  },
  overlay: {
    position: "fixed" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 28,
    width: "100%",
    maxWidth: 420,
    boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
  },
};
