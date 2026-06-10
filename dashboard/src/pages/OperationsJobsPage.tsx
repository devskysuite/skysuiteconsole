import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";
import { Link } from "react-router-dom";

interface Job {
  id: string;
  jobNumber: string;
  title: string;
  status: string;
  customerName?: string;
  propertyAddress?: string;
  createdAt?: string;
}

const STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  "In Progress": { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd" },
  "Completed":   { bg: "#dcfce7", color: "#166534", border: "#86efac" },
  "Cancelled":   { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5" },
  "On Hold":     { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] || { bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" };
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}

const th: React.CSSProperties = { padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "11px 14px", fontSize: 13, color: "#374151", verticalAlign: "middle" };

export default function OperationsJobsPage() {
  const [jobs, setJobs]       = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");

  useEffect(() => {
    getDocs(query(collection(db, "jobs"), orderBy("jobNumber", "desc")))
      .then(snap => {
        setJobs(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Job, "id">) })));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = jobs.filter(j => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(j.jobNumber).includes(q) ||
      (j.title || "").toLowerCase().includes(q) ||
      (j.customerName || "").toLowerCase().includes(q) ||
      (j.status || "").toLowerCase().includes(q)
    );
  });

  return (
    <div style={{ background: "#f9fafb", minHeight: "calc(100vh - 96px)", padding: "28px 32px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>Jobs</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{jobs.length} total jobs</div>
          </div>
          <input
            style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 14px", fontSize: 13, outline: "none", width: 260 }}
            placeholder="Search by job #, title, customer…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <th style={th}>Job #</th>
                <th style={th}>Title</th>
                <th style={th}>Customer</th>
                <th style={th}>Address</th>
                <th style={th}>Status</th>
                <th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Loading…</td></tr>}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>
                  {search ? "No jobs match your search." : "No jobs found."}
                </td></tr>
              )}
              {filtered.map((job, i) => (
                <tr key={job.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                  <td style={td}>
                    <Link to={`/jobs/${job.id}`} style={{ color: "#1565c0", fontWeight: 700, textDecoration: "none" }}>
                      {job.jobNumber}
                    </Link>
                  </td>
                  <td style={{ ...td, fontWeight: 600, color: "#111827" }}>{job.title || "—"}</td>
                  <td style={td}>{job.customerName || "—"}</td>
                  <td style={{ ...td, color: "#6b7280" }}>{job.propertyAddress || "—"}</td>
                  <td style={td}><StatusBadge status={job.status || "Unknown"} /></td>
                  <td style={{ ...td, color: "#6b7280" }}>{job.createdAt ? new Date(job.createdAt).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
