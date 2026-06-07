import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { Link } from "react-router-dom";
import { auth, db } from "../firebase";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { useToast } from "../components/Toast";
import Spinner from "../components/Spinner";
import { fmtISODate, swapStatusBadge } from "../utils/formatting";
import type { OnCallAssignment, OnCallSwapRequest } from "../types";

type UserRecord = { uid: string; displayName: string };

export default function OnCallAdminPage() {
  const isAdmin = useIsAdmin();
  const { toast, confirm } = useToast();

  // Current user
  const [currentUid, setCurrentUid] = useState<string | null>(null);

  // Assign form state
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [selectedUid, setSelectedUid] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Assignments (real-time)
  const [assignments, setAssignments] = useState<OnCallAssignment[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(true);

  // Swap requests (real-time)
  const [swapRequests, setSwapRequests] = useState<OnCallSwapRequest[]>([]);
  const [loadingSwaps, setLoadingSwaps] = useState(true);

  const todayStr = new Date().toISOString().split("T")[0];

  // Get current user uid
  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setCurrentUid(user?.uid ?? null);
    });
  }, []);

  // Fetch all users for dropdown
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "users"));
        const list: UserRecord[] = snap.docs.map((d) => ({
          uid: d.data().uid,
          displayName: d.data().displayName || d.data().email || "Unknown",
        }));
        list.sort((a, b) =>
          a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })
        );
        setUsers(list);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load users");
      }
    })();
  }, []);

  // Real-time listener: assignments
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "onCallAssignments"), (snap) => {
      const results = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as OnCallAssignment)
      );
      setAssignments(results);
      setLoadingAssignments(false);
    });
    return unsub;
  }, []);

  // Real-time listener: swap requests
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "onCallSwapRequests"), (snap) => {
      const results = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as OnCallSwapRequest)
      );
      setSwapRequests(results);
      setLoadingSwaps(false);
    });
    return unsub;
  }, []);

  // Filtered & sorted assignments (today and future, ascending by date)
  const futureAssignments = assignments
    .filter((a) => a.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Sorted swap requests (newest first)
  const sortedSwaps = [...swapRequests].sort((a, b) => {
    const aTime = a.createdAt?.toMillis?.() ?? 0;
    const bTime = b.createdAt?.toMillis?.() ?? 0;
    return bTime - aTime;
  });

  async function handleAssign() {
    setError("");
    if (!selectedUid || !selectedDate) {
      setError("Please select an employee and a date.");
      return;
    }
    if (!currentUid) {
      setError("You must be logged in.");
      return;
    }

    const employee = users.find((u) => u.uid === selectedUid);
    if (!employee) {
      setError("Selected employee not found.");
      return;
    }

    // Check if someone is already assigned for that date
    const existing = assignments.find((a) => a.date === selectedDate);
    if (existing) {
      const ok = await confirm(
        `Replace existing assignment for ${existing.employeeName} on ${fmtISODate(selectedDate)}?`
      );
      if (!ok) return;
      // Delete the old assignment first
      try {
        await deleteDoc(doc(db, "onCallAssignments", existing.id));
      } catch (e: any) {
        toast(`Error removing old assignment: ${e?.message}`, "error");
        return;
      }
    }

    setSaving(true);
    try {
      await addDoc(collection(db, "onCallAssignments"), {
        date: selectedDate,
        uid: selectedUid,
        employeeName: employee.displayName,
        assignedByUid: currentUid,
        createdAt: serverTimestamp(),
      });
      toast(`${employee.displayName} assigned on-call for ${fmtISODate(selectedDate)}`, "success");

      // If assigning today, immediately update the phone forwarding
      if (selectedDate === todayStr) {
        try {
          const idToken = await auth.currentUser?.getIdToken() ?? "";
          await fetch("/api/trigger-oncall-update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken }),
          });
          toast("Phone forwarding updated.", "success");
        } catch {
          toast("Assignment saved, but phone forwarding update failed.", "error");
        }
      }

      setSelectedUid("");
      setSelectedDate("");
    } catch (e: any) {
      toast(`Error: ${e?.message}`, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(assignment: OnCallAssignment) {
    const ok = await confirm(
      `Remove on-call assignment for ${assignment.employeeName} on ${fmtISODate(assignment.date)}?`
    );
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "onCallAssignments", assignment.id));
      toast("Assignment removed.", "success");
    } catch (e: any) {
      toast(`Error: ${e?.message}`, "error");
    }
  }

  // Loading / access guard
  if (isAdmin === null)
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <Spinner />
      </div>
    );
  if (isAdmin === false)
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#cc0000" }}>
        Access denied.
      </div>
    );

  return (
    <div>
      <Link to="/on-call" style={styles.backLink}>
        &larr; Back to On-Call
      </Link>

      <h1 style={styles.pageTitle}>Manage On-Call</h1>

      {/* Section 1: Assign On-Call */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>Assign On-Call</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select
            style={styles.select}
            value={selectedUid}
            onChange={(e) => {
              setSelectedUid(e.target.value);
              setError("");
            }}
          >
            <option value="">Select Employee</option>
            {users.map((u) => (
              <option key={u.uid} value={u.uid}>
                {u.displayName}
              </option>
            ))}
          </select>
          <input
            type="date"
            style={styles.input}
            value={selectedDate}
            min={todayStr}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              setError("");
            }}
          />
          <button
            style={styles.btn}
            onClick={handleAssign}
            disabled={saving || !selectedUid || !selectedDate}
          >
            {saving ? "Assigning\u2026" : "Assign"}
          </button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
      </div>

      {/* Section 2: Current Assignments */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>Current Assignments</h2>
        {loadingAssignments ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <Spinner />
          </div>
        ) : futureAssignments.length === 0 ? (
          <p style={{ color: "#888", fontSize: 14 }}>No upcoming assignments.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Employee</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {futureAssignments.map((a) => (
                  <tr key={a.id} style={styles.tr}>
                    <td style={styles.td}>{fmtISODate(a.date)}</td>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{a.employeeName}</td>
                    <td style={styles.td}>
                      <button style={styles.deleteBtn} onClick={() => handleDelete(a)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 3: Swap Request History */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>Swap Request History</h2>
        {loadingSwaps ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <Spinner />
          </div>
        ) : sortedSwaps.length === 0 ? (
          <p style={{ color: "#888", fontSize: 14 }}>No swap requests yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Requester</th>
                  <th style={styles.th}>Target</th>
                  <th style={styles.th}>Exchange Date</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {sortedSwaps.map((s) => (
                  <tr key={s.id} style={styles.tr}>
                    <td style={styles.td}>{fmtISODate(s.date)}</td>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{s.requesterName}</td>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{s.targetName}</td>
                    <td style={styles.td}>{fmtISODate(s.targetDate)}</td>
                    <td style={styles.td}>
                      <span style={swapStatusBadge(s.status)}>{s.status}</span>
                    </td>
                    <td style={styles.td}>
                      {s.createdAt?.toDate
                        ? s.createdAt
                            .toDate()
                            .toLocaleDateString("en-US", {
                              month: "short",
                              day: "2-digit",
                              year: "numeric",
                            })
                        : s.createdAt
                        ? new Date(s.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "2-digit",
                            year: "numeric",
                          })
                        : "\u2014"}
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

const styles: Record<string, React.CSSProperties> = {
  pageTitle: {
    fontSize: 28,
    fontWeight: 900,
    color: "#1e7d3a",
    marginBottom: 24,
  },
  backLink: {
    display: "inline-block",
    marginBottom: 12,
    color: "#1e7d3a",
    fontSize: 14,
    fontWeight: 600,
    textDecoration: "none",
  },
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: 24,
    marginBottom: 20,
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
    border: "1px solid #e5e5e5",
    maxWidth: 800,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: "#111",
    marginBottom: 14,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  input: {
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 14,
    outline: "none",
  },
  select: {
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 14,
    outline: "none",
    minWidth: 180,
  },
  btn: {
    background: "#1e7d3a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "9px 20px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  error: {
    color: "#d32f2f",
    fontSize: 13,
    marginTop: 10,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    backgroundColor: "#fff",
    borderRadius: 12,
  },
  th: {
    textAlign: "left" as const,
    backgroundColor: "#f8f9fa",
    padding: "10px 14px",
    fontSize: 12,
    fontWeight: 700,
    color: "#888",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    borderBottom: "1px solid #eee",
  },
  tr: {
    borderBottom: "1px solid #f0f0f0",
  },
  td: {
    padding: "12px 14px",
    fontSize: 14,
    color: "#333",
    borderBottom: "1px solid #f0f0f0",
  },
  deleteBtn: {
    background: "none",
    border: "1px solid #e53e3e",
    color: "#e53e3e",
    borderRadius: 6,
    padding: "4px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
};
