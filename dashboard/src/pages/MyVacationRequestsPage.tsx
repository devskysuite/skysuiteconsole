import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { fmtISODate, timeOffStatusBadge } from "../utils/formatting";
import type { TimeOffRequest } from "../types";
import { auth, db } from "../firebase";

export default function MyVacationRequestsPage() {
  const [myRequests, setMyRequests] = useState<TimeOffRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { setLoading(false); return; }
      const snap = await getDocs(query(collection(db, "timeOffRequests"), where("uid", "==", user.uid)));
      const results = snap.docs.map(d => ({ id: d.id, ...d.data() } as TimeOffRequest));
      for (const r of results) {
        if (r.status === "PENDING" && r.startDate < today) {
          updateDoc(doc(db, "timeOffRequests", r.id), { status: "DENIED" }).catch(() => {});
          r.status = "DENIED";
        }
      }
      results.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      setMyRequests(results);
      setLoading(false);
    });
  }, []);

  const th: React.CSSProperties = { textAlign: "left", fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, paddingBottom: 8, borderBottom: "1px solid #eee" };
  const td: React.CSSProperties = { padding: "12px 8px 12px 0", fontSize: 14, color: "#333" };

  return (
    <div style={{ padding: "24px 0 32px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0d2e5e", margin: 0 }}>My Vacation Requests</h1>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
        {loading ? (
          <p style={{ color: "#9ca3af", fontSize: 14 }}>Loading…</p>
        ) : myRequests.length === 0 ? (
          <p style={{ color: "#888", fontSize: 14 }}>No requests submitted yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Start</th>
                  <th style={th}>End</th>
                  <th style={th}>Reason</th>
                  <th style={th}>Status</th>
                  <th style={th}>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {myRequests.map(r => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                    <td style={td}>{fmtISODate(r.startDate)}</td>
                    <td style={td}>{fmtISODate(r.endDate)}</td>
                    <td style={td}>{r.reason || "—"}</td>
                    <td style={td}><span style={timeOffStatusBadge(r.status)}>{r.status}</span></td>
                    <td style={td}>
                      {r.createdAt?.toDate
                        ? r.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
                        : "—"}
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
