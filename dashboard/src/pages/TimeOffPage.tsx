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
import { auth, db } from "../firebase";
import { useToast } from "../components/Toast";
import { fmtISODate, timeOffStatusBadge } from "../utils/formatting";
import type { TimeOffRequest } from "../types";

export default function TimeOffPage() {
  const [currentUser, setCurrentUser] = useState<{ uid: string; email: string; displayName: string } | null>(null);
  const { confirm } = useToast();
  const [myRequests, setMyRequests] = useState<TimeOffRequest[]>([]);

  const [singleDay, setSingleDay] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const today = new Date().toISOString().split("T")[0];

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { setCurrentUser(null); return; }
      try {
        const snap = await getDocs(
          query(collection(db, "users"), where("uid", "==", user.uid))
        );
        const data = snap.empty ? null : snap.docs[0].data();
        setCurrentUser({
          uid: user.uid,
          email: user.email ?? "",
          displayName: data?.displayName ?? user.email ?? "",
        });
      } catch {
        setCurrentUser({ uid: user.uid, email: user.email ?? "", displayName: user.email ?? "" });
      }
    });
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    loadMyRequests();
  }, [currentUser]);

  async function loadMyRequests() {
    if (!currentUser) return;
    const snap = await getDocs(
      query(
        collection(db, "timeOffRequests"),
        where("uid", "==", currentUser.uid)
      )
    );
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TimeOffRequest));

    // Auto-deny PENDING requests whose start date has passed
    const now = new Date().toISOString().split("T")[0];
    for (const r of results) {
      if (r.status === "PENDING" && r.startDate < now) {
        updateDoc(doc(db, "timeOffRequests", r.id), { status: "DENIED" }).catch(() => {});
        r.status = "DENIED";
      }
    }

    results.sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() ?? 0;
      const bTime = b.createdAt?.toMillis?.() ?? 0;
      return bTime - aTime;
    });
    setMyRequests(results);
  }

  async function submitRequest() {
    setError("");
    setSuccess("");

    if (!startDate || (!singleDay && !endDate)) {
      setError(singleDay ? "Please select a date." : "Please select a start and end date.");
      return;
    }
    const effectiveEnd = singleDay ? startDate : endDate;
    if (effectiveEnd < startDate) {
      setError("End date cannot be before start date.");
      return;
    }
    if (!currentUser) {
      setError("Not logged in.");
      return;
    }

    // Check for overlapping dates with existing PENDING or APPROVED requests
    const overlap = myRequests.find(
      (r) =>
        r.status !== "DENIED" &&
        startDate <= r.endDate &&
        effectiveEnd >= r.startDate
    );
    if (overlap) {
      setError(
        `You already have a ${overlap.status.toLowerCase()} request for ${overlap.startDate} – ${overlap.endDate}. Choose different dates.`
      );
      return;
    }

    // Warn if requesting dates that were previously denied
    const deniedOverlap = myRequests.find(
      (r) =>
        r.status === "DENIED" &&
        startDate <= r.endDate &&
        effectiveEnd >= r.startDate
    );
    if (deniedOverlap) {
      const proceed = await confirm(
        "The time off you are requesting has previously been denied. Are you sure you want to request this time off?"
      );
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

      // Send email notification to admin
      try {
        const idToken = await auth.currentUser?.getIdToken() ?? "";
        await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idToken,
            type: "time-off",
            payload: {
              employee_name: currentUser.displayName,
              employee_email: currentUser.email,
              start_date: startDate,
              end_date: effectiveEnd,
              reason: reason.trim() || "No reason provided",
            },
          }),
        });
      } catch (emailErr) {
        console.error("Email notification failed:", emailErr);
        // Don't block the request — it was saved to Firestore already
      }

      setSuccess("Time off request submitted successfully.");
      setStartDate("");
      setEndDate("");
      setReason("");
      await loadMyRequests();
    } catch (e: any) {
      setError(e?.message ?? "Failed to submit request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 style={styles.h1}>Time Off Requests</h1>

      {/* ── Submit Form ── */}
      <div style={styles.card}>
        <h2 style={styles.h2}>Request Vacation</h2>

        {/* Single / Multiple day toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: singleDay ? "#aaa" : "#333" }}>Multiple Days</span>
          <div
            onClick={() => { setSingleDay(!singleDay); setEndDate(""); }}
            style={{
              width: 44, height: 24, borderRadius: 12, cursor: "pointer",
              backgroundColor: singleDay ? "#1e7d3a" : "#ccc",
              position: "relative", transition: "background-color 0.2s",
            }}
          >
            <div style={{
              width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff",
              position: "absolute", top: 2,
              left: singleDay ? 22 : 2, transition: "left 0.2s",
              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: singleDay ? "#333" : "#aaa" }}>Single Day</span>
        </div>

        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>{singleDay ? "Date" : "Start Date"}</label>
            <input
              type="date"
              style={styles.input}
              min={today}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          {!singleDay && (
            <div style={styles.field}>
              <label style={styles.label}>End Date</label>
              <input
                type="date"
                style={styles.input}
                min={startDate || today}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          )}
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Reason (optional)</label>
          <textarea
            style={{ ...styles.input, resize: "vertical", minHeight: 80, fontFamily: "inherit" }}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Any additional details…"
          />
        </div>

        {error && <p style={styles.error}>{error}</p>}
        {success && <p style={styles.successMsg}>{success}</p>}

        <button style={styles.btn} onClick={submitRequest} disabled={busy}>
          {busy ? "Submitting…" : "Submit Request"}
        </button>
      </div>

      {/* ── My Requests ── */}
      <div style={styles.card}>
        <h2 style={styles.h2}>My Requests</h2>
        {myRequests.length === 0 ? (
          <p style={{ color: "#888", fontSize: 14 }}>No requests submitted yet.</p>
        ) : (
          <table style={styles.table}>
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
              {myRequests.map((r) => (
                <tr key={r.id} style={styles.tr}>
                  <td style={styles.td}>{fmtISODate(r.startDate)}</td>
                  <td style={styles.td}>{fmtISODate(r.endDate)}</td>
                  <td style={styles.td}>{r.reason || "—"}</td>
                  <td style={styles.td}>
                    <span style={timeOffStatusBadge(r.status)}>{r.status}</span>
                  </td>
                  <td style={styles.td}>
                    {r.createdAt?.toDate
                      ? r.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
                      : r.createdAt
                      ? new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  h1: { fontSize: 24, fontWeight: 800, marginBottom: 20 },
  h2: { fontSize: 16, fontWeight: 700, marginBottom: 16, color: "#333" },
  card: {
    border: "1px solid #e5e5e5",
    borderRadius: 12,
    padding: 24,
    marginBottom: 24,
    backgroundColor: "#fff",
  },
  row: { display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 },
  field: { display: "flex", flexDirection: "column", flex: 1, minWidth: 200, marginBottom: 16 },
  label: { fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#555" },
  input: { border: "1px solid #ddd", borderRadius: 8, padding: "9px 12px", fontSize: 14 },
  btn: {
    backgroundColor: "#1e7d3a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 22px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  error: { color: "#cc0000", fontSize: 13, marginBottom: 12 },
  successMsg: { color: "#007700", fontSize: 13, marginBottom: 12 },
  table: { width: "100%", borderCollapse: "collapse" },
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
  tr: { borderBottom: "1px solid #f5f5f5" },
  td: { padding: "12px 8px 12px 0", fontSize: 14, color: "#333" },
};
