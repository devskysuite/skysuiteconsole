import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";
import { Link } from "react-router-dom";

interface Job {
  id: string;
  jobNumber: string;
  title?: string;
  issueDescription?: string;
  customerName?: string;
  billingCustomer?: string;
  status?: string;
  projectManager?: string;
  totalBilled?: number;
  propertyName?: string;
  propertyAddress?: string;
  createdAt?: string;
  completedAt?: string;
  visitCount?: number;
  quoteSubtotal?: number;
  jobPOsStatus?: string;
  reviewStatus?: string;
  invoicingStatus?: string;
  jobType?: string;
  createdBy?: string;
  customerPO?: string;
  tags?: string;
}

type SortDir = "asc" | "desc";

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  "Open":             { bg: "#dbeafe", color: "#1e40af" },
  "In Progress":      { bg: "#fef3c7", color: "#92400e" },
  "Completed":        { bg: "#dcfce7", color: "#166534" },
  "Cancelled":        { bg: "#fee2e2", color: "#991b1b" },
  "Ready to Invoice": { bg: "#f3e8ff", color: "#6b21a8" },
};

function Badge({ label }: { label?: string }) {
  if (!label) return <span style={{ color: "#9ca3af" }}>—</span>;
  const s = STATUS_COLORS[label] || { bg: "#f3f4f6", color: "#6b7280" };
  return <span style={{ background: s.bg, color: s.color, borderRadius: 4, padding: "1px 6px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{label}</span>;
}

function fmtDate(s?: string) {
  if (!s) return "—";
  return new Date(s + (s.includes("T") ? "" : "T12:00:00")).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}
function fmtC(n?: number) {
  if (!n) return "—";
  return `$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sortVal(job: Job, key: string): string | number {
  switch (key) {
    case "jobNumber":      return String(job.jobNumber || "");
    case "customer":       return (job.customerName || "").toLowerCase();
    case "description":    return (job.issueDescription || job.title || "").toLowerCase();
    case "tags":           return (job.tags || "").toLowerCase();
    case "status":         return (job.status || "").toLowerCase();
    case "pm":             return (job.projectManager || "").toLowerCase();
    case "totalBilled":    return job.totalBilled || 0;
    case "property":       return (job.propertyName || "").toLowerCase();
    case "createdAt":      return job.createdAt || "";
    case "completedAt":    return job.completedAt || "";
    case "visits":         return job.visitCount || 0;
    case "quoted":         return job.quoteSubtotal || 0;
    case "poStatus":       return (job.jobPOsStatus || "").toLowerCase();
    case "reviewStatus":   return (job.reviewStatus || "").toLowerCase();
    case "invoicing":      return (job.invoicingStatus || "").toLowerCase();
    case "jobType":        return (job.jobType || "").toLowerCase();
    case "billingCustomer":return (job.billingCustomer || "").toLowerCase();
    case "createdBy":      return (job.createdBy || "").toLowerCase();
    case "customerPO":     return (job.customerPO || "").toLowerCase();
    default:               return "";
  }
}

// ── Sortable header cell ───────────────────────────────────────────────────────
function Th({ label, col, sort, dir, onSort }: {
  label: string; col: string;
  sort: string; dir: SortDir;
  onSort: (col: string) => void;
}) {
  const active = sort === col;
  return (
    <th
      onClick={() => onSort(col)}
      style={{
        padding: "5px 8px", fontSize: 11, fontWeight: 700,
        color: active ? "#1565c0" : "#6b7280",
        textTransform: "uppercase", letterSpacing: 0.4,
        whiteSpace: "nowrap", cursor: "pointer", userSelect: "none",
        background: "#f9fafb", borderBottom: "1px solid #e5e7eb",
        position: "sticky", top: 0, zIndex: 2,
        textAlign: "left",
      }}
    >
      {label}
      <span style={{ marginLeft: 3, opacity: active ? 1 : 0.3, fontSize: 10 }}>
        {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </th>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function OperationsJobsPage() {
  const [jobs, setJobs]       = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [sortKey, setSortKey] = useState("jobNumber");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    getDocs(query(collection(db, "jobs"), orderBy("jobNumber", "desc")))
      .then(snap => {
        setJobs(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Job, "id">) })));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function handleSort(col: string) {
    setSortDir(prev => sortKey === col ? (prev === "asc" ? "desc" : "asc") : "asc");
    setSortKey(col);
  }

  const filtered = jobs
    .filter(j => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        String(j.jobNumber).includes(q) ||
        (j.issueDescription || j.title || "").toLowerCase().includes(q) ||
        (j.customerName || "").toLowerCase().includes(q) ||
        (j.status || "").toLowerCase().includes(q) ||
        (j.projectManager || "").toLowerCase().includes(q) ||
        (j.customerPO || "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const av = sortVal(a, sortKey), bv = sortVal(b, sortKey);
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });

  const thP = { sort: sortKey, dir: sortDir, onSort: handleSort };
  const td: React.CSSProperties = { padding: "7px 8px", fontSize: 12, color: "#374151", verticalAlign: "middle", borderBottom: "1px solid #f3f4f6", whiteSpace: "nowrap" };

  return (
    <div style={{ background: "#f9fafb", minHeight: "calc(100vh - 56px)", display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
        <div>
          <span style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>Jobs</span>
          <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: 10 }}>{filtered.length} of {jobs.length}</span>
        </div>
        <input
          style={{ border: "1px solid #d1d5db", borderRadius: 7, padding: "6px 12px", fontSize: 13, outline: "none", width: 280 }}
          placeholder="Search job #, customer, PM, description…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Table — scrolls both axes */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
          <thead>
            <tr>
              <Th label="Job"                col="jobNumber"      {...thP} />
              <Th label="Customer"           col="customer"       {...thP} />
              <Th label="Issue Description"  col="description"    {...thP} />
              <Th label="Tags"               col="tags"           {...thP} />
              <Th label="Completion Status"  col="status"         {...thP} />
              <Th label="Project Manager"    col="pm"             {...thP} />
              <Th label="Total Billed"       col="totalBilled"    {...thP} />
              <Th label="Property"           col="property"       {...thP} />
              <Th label="Created On"         col="createdAt"      {...thP} />
              <Th label="Job Completion Date" col="completedAt"   {...thP} />
              <Th label="Visits"             col="visits"         {...thP} />
              <Th label="Amount Quoted"      col="quoted"         {...thP} />
              <Th label="Job POs Status"     col="poStatus"       {...thP} />
              <Th label="Review Status"      col="reviewStatus"   {...thP} />
              <Th label="Invoicing Status"   col="invoicing"      {...thP} />
              <Th label="Job Type"           col="jobType"        {...thP} />
              <Th label="Billing Customer"   col="billingCustomer" {...thP} />
              <Th label="Created By"         col="createdBy"      {...thP} />
              <Th label="Customer PO #"      col="customerPO"     {...thP} />
            </tr>
          </thead>
          <tbody style={{ background: "#fff" }}>
            {loading && (
              <tr><td colSpan={19} style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Loading…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={19} style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>
                {search ? "No jobs match your search." : "No jobs found."}
              </td></tr>
            )}
            {filtered.map(job => (
              <tr key={job.id} style={{ borderBottom: "1px solid #f3f4f6" }} className="hover-row">
                <td style={{ ...td, fontWeight: 700 }}>
                  <Link to={`/jobs/${job.id}`} style={{ color: "#1565c0", textDecoration: "none" }}>{job.jobNumber}</Link>
                </td>
                <td style={td}>{job.customerName || "—"}</td>
                <td style={{ ...td, maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={job.issueDescription || job.title}>
                  {job.issueDescription || job.title || "—"}
                </td>
                <td style={{ ...td, color: "#6b7280" }}>{job.tags || "—"}</td>
                <td style={td}><Badge label={job.status} /></td>
                <td style={td}>{job.projectManager || "—"}</td>
                <td style={{ ...td, textAlign: "right" }}>{fmtC(job.totalBilled)}</td>
                <td style={td}>{job.propertyName || "—"}</td>
                <td style={td}>{fmtDate(job.createdAt)}</td>
                <td style={td}>{fmtDate(job.completedAt)}</td>
                <td style={{ ...td, textAlign: "center" }}>{job.visitCount ?? "—"}</td>
                <td style={{ ...td, textAlign: "right" }}>{fmtC(job.quoteSubtotal)}</td>
                <td style={td}>{job.jobPOsStatus || "—"}</td>
                <td style={td}>{job.reviewStatus || "—"}</td>
                <td style={td}>{job.invoicingStatus || "—"}</td>
                <td style={td}>{job.jobType || "—"}</td>
                <td style={td}>{job.billingCustomer || "—"}</td>
                <td style={td}>{job.createdBy || "—"}</td>
                <td style={td}>{job.customerPO || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
