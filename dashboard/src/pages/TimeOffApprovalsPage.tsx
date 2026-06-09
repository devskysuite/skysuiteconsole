import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  updateDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../firebase";
import { useRole, canApproveTimeOff } from "../hooks/useRole";
import { useToast } from "../components/Toast";
import Spinner from "../components/Spinner";
import { fmtISODate, timeOffStatusBadge } from "../utils/formatting";
import type { TimeOffRequest } from "../types";

const callSyncVacation = httpsCallable(getFunctions(), "syncVacationEvent");

type Filter = "PENDING" | "APPROVED" | "DENIED" | "PAST" | "ALL";

export default function TimeOffApprovalsPage() {
  const role = useRole();
  const { toast, confirm } = useToast();
  const [requests, setRequests] = useState<TimeOffRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("PENDING");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const canApprove = canApproveTimeOff(role);
  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, "timeOffRequests")), (snap) => {
      const results = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TimeOffRequest));

      // Auto-deny PENDING requests whose start date has passed
      const now = new Date().toISOString().split("T")[0];
      for (const r of results) {
        if (r.status === "PENDING" && r.startDate < now) {
          updateDoc(doc(db, "timeOffRequests", r.id), { status: "DENIED" }).catch(() => {});
          r.status = "DENIED"; // update local state immediately
        }
      }

      // Sort by createdAt ascending (queue order — first requested = first in line)
      results.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() ?? 0;
        const bTime = b.createdAt?.toMillis?.() ?? 0;
        return aTime - bTime;
      });
      setRequests(results);
      setLoading(false);
    });
    return unsub;
  }, []);

  async function updateStatus(id: string, status: "APPROVED" | "DENIED") {
    setBusy(id);
    try {
      await updateDoc(doc(db, "timeOffRequests", id), { status });
      // Add/remove the vacation event on the Outlook calendar
      callSyncVacation({ requestId: id }).catch(() => {});
    } catch (e: any) {
      toast(`Error: ${e?.message}`, "error");
    } finally {
      setBusy(null);
    }
  }

  async function removeRequest(id: string) {
    if (!await confirm("Remove this time-off request? This cannot be undone.")) return;
    setBusy(id);
    try {
      await deleteDoc(doc(db, "timeOffRequests", id));
    } catch (e: any) {
      toast(`Error: ${e?.message}`, "error");
    } finally {
      setBusy(null);
    }
  }

  /** Find approved requests from OTHER employees that overlap with this request's dates */
  function getOverlapping(req: TimeOffRequest): TimeOffRequest[] {
    return requests.filter(
      (r) =>
        r.id !== req.id &&
        r.uid !== req.uid &&
        r.status === "APPROVED" &&
        req.startDate <= r.endDate &&
        req.endDate >= r.startDate
    );
  }

  /** Get the queue position (1-based) among pending requests */
  function getQueuePosition(req: TimeOffRequest): number {
    const pending = requests.filter((r) => r.status === "PENDING" && r.endDate >= today);
    return pending.findIndex((r) => r.id === req.id) + 1;
  }

  if (role === null) return <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>;
  if (!canApprove) return <div style={{ padding: 40, textAlign: "center", color: "#cc0000" }}>Access denied.</div>;

  // Filter out past requests by default (unless viewing PAST or ALL)
  const activeRequests = requests.filter((r) => r.endDate >= today);
  const pastRequests = requests.filter((r) => r.endDate < today);

  let displayed: TimeOffRequest[];
  if (filter === "PENDING") {
    displayed = activeRequests.filter((r) => r.status === "PENDING");
  } else if (filter === "APPROVED") {
    displayed = activeRequests.filter((r) => r.status === "APPROVED");
  } else if (filter === "DENIED") {
    displayed = activeRequests.filter((r) => r.status === "DENIED");
  } else if (filter === "PAST") {
    displayed = pastRequests;
  } else {
    displayed = activeRequests;
  }

  // Apply date range filter (request overlaps the selected range)
  if (dateFrom) {
    displayed = displayed.filter((r) => r.endDate >= dateFrom);
  }
  if (dateTo) {
    displayed = displayed.filter((r) => r.startDate <= dateTo);
  }

  const filterOptions: { key: Filter; label: string; count?: number }[] = [
    { key: "PENDING", label: "Pending", count: activeRequests.filter((r) => r.status === "PENDING").length },
    { key: "APPROVED", label: "Approved", count: activeRequests.filter((r) => r.status === "APPROVED").length },
    { key: "DENIED", label: "Denied", count: activeRequests.filter((r) => r.status === "DENIED").length },
    { key: "ALL", label: "All Active" },
    { key: "PAST", label: "Past", count: pastRequests.length },
  ];

  return (
    <div>
      <h1 style={styles.h1}>Time Off Approvals</h1>

      <div style={styles.card}>
        {/* Filter toggle */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {filterOptions.map((f) => (
            <button
              key={f.key}
              style={filter === f.key ? styles.filterActive : styles.filterBtn}
              onClick={() => setFilter(f.key)}
            >
              {f.label}{f.count !== undefined ? ` (${f.count})` : ""}
            </button>
          ))}
        </div>

        {/* Date range filter */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>Date Range:</span>
          <input
            type="date"
            style={styles.dateInput}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <span style={{ fontSize: 13, color: "#888" }}>to</span>
          <input
            type="date"
            style={styles.dateInput}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
          {(dateFrom || dateTo) && (
            <button
              style={styles.clearBtn}
              onClick={() => { setDateFrom(""); setDateTo(""); }}
            >
              Clear
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>
        ) : displayed.length === 0 ? (
          <p style={{ color: "#888", fontSize: 14 }}>
            No {filter === "ALL" ? "active" : filter.toLowerCase()} requests found.
          </p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                {filter === "PENDING" && <th style={styles.th}>#</th>}
                <th style={styles.th}>Employee</th>
                <th style={styles.th}>Start</th>
                <th style={styles.th}>End</th>
                <th style={styles.th}>Reason</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Submitted</th>
                {filter !== "PAST" && <th style={styles.th}>Conflicts</th>}
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((r) => {
                const overlapping = getOverlapping(r);
                const queuePos = r.status === "PENDING" ? getQueuePosition(r) : 0;
                return (
                  <tr key={r.id} style={styles.tr}>
                    {filter === "PENDING" && (
                      <td style={{ ...styles.td, fontWeight: 700, color: "#1e7d3a", fontSize: 16 }}>
                        {queuePos}
                      </td>
                    )}
                    <td style={{ ...styles.td, fontWeight: 600 }}>{r.employeeName}</td>
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
                    {filter !== "PAST" && (
                      <td style={styles.td}>
                        {r.status === "PENDING" && overlapping.length > 0 ? (
                          <div style={styles.conflictBadge}>
                            <span style={{ fontWeight: 700 }}>⚠ {overlapping.length} off</span>
                            <div style={{ fontSize: 11, marginTop: 2 }}>
                              {overlapping.map((o) => (
                                <div key={o.id}>{o.employeeName} ({fmtISODate(o.startDate)} – {fmtISODate(o.endDate)})</div>
                              ))}
                            </div>
                          </div>
                        ) : r.status === "PENDING" ? (
                          <span style={{ color: "#888", fontSize: 12 }}>None</span>
                        ) : (
                          <span style={{ color: "#888", fontSize: 12 }}>—</span>
                        )}
                      </td>
                    )}
                    <td style={{ ...styles.td, display: "flex", gap: 8, alignItems: "center" }}>
                      {r.status === "PENDING" && (
                        <>
                          <button
                            style={styles.approveBtn}
                            onClick={() => updateStatus(r.id, "APPROVED")}
                            disabled={busy === r.id}
                          >
                            {busy === r.id ? "…" : "Approve"}
                          </button>
                          <button
                            style={styles.denyBtn}
                            onClick={() => updateStatus(r.id, "DENIED")}
                            disabled={busy === r.id}
                          >
                            {busy === r.id ? "…" : "Deny"}
                          </button>
                        </>
                      )}
                      {(r.status === "APPROVED" || r.status === "DENIED") && (
                        <button
                          style={styles.removeBtn}
                          onClick={() => removeRequest(r.id)}
                          disabled={busy === r.id}
                        >
                          {busy === r.id ? "…" : "Remove"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  h1: { fontSize: 24, fontWeight: 800, marginBottom: 20 },
  card: {
    border: "1px solid #e5e5e5",
    borderRadius: 12,
    padding: 24,
    marginBottom: 24,
    backgroundColor: "#fff",
  },
  filterBtn: {
    background: "transparent",
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "6px 16px",
    fontSize: 13,
    cursor: "pointer",
    color: "#555",
  },
  filterActive: {
    backgroundColor: "#1e7d3a",
    border: "1px solid #1e7d3a",
    borderRadius: 8,
    padding: "6px 16px",
    fontSize: 13,
    cursor: "pointer",
    color: "#fff",
    fontWeight: 600,
  },
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
  conflictBadge: {
    backgroundColor: "#fff7ed",
    border: "1px solid #fed7aa",
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: 12,
    color: "#c2410c",
  },
  approveBtn: {
    backgroundColor: "#166534",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  denyBtn: {
    background: "transparent",
    border: "1px solid #991b1b",
    color: "#991b1b",
    borderRadius: 6,
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  dateInput: {
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 13,
  },
  clearBtn: {
    background: "transparent",
    border: "none",
    color: "#1e7d3a",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "underline",
  },
  removeBtn: {
    background: "transparent",
    border: "1px solid #888",
    color: "#888",
    borderRadius: 6,
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
};
