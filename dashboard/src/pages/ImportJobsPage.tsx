import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { collection, doc, getDocs, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";

// ── Types ──────────────────────────────────────────────────────────────────────
interface ParsedJob {
  jobNumber: string;
  customerName: string;
  billingCustomer: string;
  propertyName: string;
  propertyAddress: string;
  issueDescription: string;
  title: string;
  tags: string;
  status: string;
  projectManager: string;
  totalBilled: number;
  createdAt: string;
  completedAt: string;
  visitCount: number;
  quoteSubtotal: number;
  jobPOsStatus: string;
  reviewStatus: string;
  invoicingStatus: string;
  jobType: string;
  createdBy: string;
  customerPO: string;
  invoiceIds: string;
  _existingDocId: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const STATUS_MAP: Record<string, string> = {
  "open": "Open",
  "in progress": "In Progress",
  "complete": "Completed",
  "completed": "Completed",
  "canceled": "Cancelled",
  "cancelled": "Cancelled",
  "ready to invoice": "Ready to Invoice",
  "final invoice": "Ready to Invoice",
  "void/cancelled job": "Cancelled",
};

function mapStatus(raw: string): string {
  return STATUS_MAP[(raw || "").toLowerCase().trim()] || raw || "Open";
}

function parseMoney(raw: string): number {
  if (!raw) return 0;
  return parseFloat(String(raw).replace(/[$,]/g, "")) || 0;
}

function parseDate(raw: string): string {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {}
  return "";
}

function makeTitle(desc: string): string {
  if (!desc) return "";
  const first = desc.split(/\r?\n/)[0].trim();
  return first.length > 100 ? first.slice(0, 97) + "…" : first;
}

function parseCSV(fileContent: ArrayBuffer): Record<string, string>[] {
  const wb = XLSX.read(fileContent, { type: "array", raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
  return rows;
}

function rowToJob(row: Record<string, string>): ParsedJob | null {
  const jobNumber = String(row["Job"] || "").trim();
  if (!jobNumber || !jobNumber.match(/^\d{2}-\d+/)) return null;
  return {
    jobNumber,
    customerName:    String(row["Customer"] || "").trim(),
    billingCustomer: String(row["Billing Customer"] || "").trim(),
    propertyName:    String(row["Property"] || "").trim(),
    propertyAddress: String(row["Address"] || "").replace(/\r?\n/g, ", ").trim(),
    issueDescription: String(row["Issue Description"] || "").trim(),
    title:           makeTitle(String(row["Issue Description"] || "")),
    tags:            String(row["Tags"] || "").trim(),
    status:          mapStatus(String(row["Completion Status"] || "")),
    projectManager:  String(row["Project Manager"] || "").trim(),
    totalBilled:     parseMoney(String(row["Total Billed for Job"] || "")),
    createdAt:       parseDate(String(row["Created On"] || "")),
    completedAt:     parseDate(String(row["Job Completion Date"] || "")),
    visitCount:      parseInt(String(row["Visits"] || "0"), 10) || 0,
    quoteSubtotal:   parseMoney(String(row["Amount Quoted"] || "")),
    jobPOsStatus:    String(row["Job POs Status"] || "").trim(),
    reviewStatus:    String(row["Review Status"] || "").trim(),
    invoicingStatus: String(row["Invoicing Status"] || "").trim(),
    jobType:         String(row["Job Type"] || "").trim(),
    createdBy:       String(row["Created By"] || "").trim(),
    customerPO:      String(row["Customer Purchase Order #"] || "").trim(),
    invoiceIds:      String(row["Invoices"] || "").trim(),
    _existingDocId:  null,
  };
}

const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  "Open":             { bg: "#dbeafe", color: "#1e40af" },
  "In Progress":      { bg: "#fef3c7", color: "#92400e" },
  "Completed":        { bg: "#dcfce7", color: "#166534" },
  "Cancelled":        { bg: "#fee2e2", color: "#991b1b" },
  "Ready to Invoice": { bg: "#f3e8ff", color: "#6b21a8" },
};

function Badge({ status }: { status: string }) {
  const s = STATUS_BADGE[status] || { bg: "#f3f4f6", color: "#6b7280" };
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 5, padding: "2px 7px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function ImportJobsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs]           = useState<ParsedJob[]>([]);
  const [checking, setChecking]   = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult]       = useState<{ created: number; updated: number; errors: string[] } | null>(null);
  const [filter, setFilter]       = useState<"all" | "new" | "update">("all");

  async function handleFile(file: File) {
    setResult(null);
    setJobs([]);
    setChecking(true);
    try {
      const buf  = await file.arrayBuffer();
      const rows = parseCSV(buf);
      const parsed: ParsedJob[] = [];
      for (const row of rows) {
        const job = rowToJob(row);
        if (job) parsed.push(job);
      }

      // Load all existing job numbers from Firestore once
      const existingSnap = await getDocs(collection(db, "jobs"));
      const existingMap  = new Map<string, string>(); // jobNumber → docId
      for (const d of existingSnap.docs) {
        const jn = d.data().jobNumber;
        if (jn) existingMap.set(String(jn), d.id);
      }

      for (const job of parsed) {
        job._existingDocId = existingMap.get(job.jobNumber) ?? null;
      }

      setJobs(parsed);
    } catch (e) {
      console.error(e);
      alert("Failed to parse CSV. Check console for details.");
    }
    setChecking(false);
  }

  async function runImport() {
    if (jobs.length === 0) return;
    setImporting(true);
    const errors: string[] = [];
    let created = 0, updated = 0;

    // Strip internal field before writing to Firestore
    function toFirestore(job: ParsedJob) {
      const { _existingDocId, ...data } = job;
      void _existingDocId;
      return data;
    }

    // Batch in chunks of 400
    const BATCH_SIZE = 400;
    for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
      const chunk = jobs.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      for (const job of chunk) {
        try {
          const data = toFirestore(job);
          if (job._existingDocId) {
            // Update existing doc — merge so we don't overwrite SkySuite-added fields
            batch.update(doc(db, "jobs", job._existingDocId), data);
            updated++;
          } else {
            // Create new doc using job number as the stable ID
            batch.set(doc(db, "jobs", job.jobNumber), data);
            created++;
          }
        } catch (e) {
          errors.push(`${job.jobNumber}: ${String(e)}`);
        }
      }
      try {
        await batch.commit();
      } catch (e) {
        errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${String(e)}`);
      }
    }

    setImporting(false);
    setResult({ created, updated, errors });
  }

  const newJobs    = jobs.filter(j => !j._existingDocId);
  const updateJobs = jobs.filter(j =>  j._existingDocId);
  const shown = filter === "new" ? newJobs : filter === "update" ? updateJobs : jobs;

  const th: React.CSSProperties = { padding: "9px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, textAlign: "left", whiteSpace: "nowrap", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" };
  const td: React.CSSProperties = { padding: "8px 12px", fontSize: 13, color: "#374151", verticalAlign: "middle", borderBottom: "1px solid #f3f4f6", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  return (
    <div style={{ background: "#f9fafb", minHeight: "calc(100vh - 56px)", padding: "28px 32px" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>Import Jobs from BuildOps</div>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            Upload a BuildOps Jobs CSV export. Existing jobs (matched by job number) will be updated — your SkySuite POs, visits, and notes are preserved.
          </div>
        </div>

        {/* Upload zone */}
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          style={{ border: "2px dashed #d1d5db", borderRadius: 12, padding: "36px 24px", textAlign: "center", cursor: "pointer", background: "#fff", marginBottom: 24, transition: "border-color 0.2s" }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
          <div style={{ fontWeight: 700, color: "#374151", marginBottom: 4 }}>Drop CSV here or click to browse</div>
          <div style={{ fontSize: 12, color: "#9ca3af" }}>BuildOps → Jobs → Export CSV</div>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
        </div>

        {checking && <div style={{ textAlign: "center", color: "#6b7280", padding: 40 }}>Parsing CSV and checking against Firestore…</div>}

        {/* Result banner */}
        {result && (
          <div style={{ marginBottom: 20, padding: "16px 20px", background: result.errors.length ? "#fef3c7" : "#dcfce7", border: `1px solid ${result.errors.length ? "#fcd34d" : "#86efac"}`, borderRadius: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: result.errors.length ? 8 : 0 }}>
              Import complete — {result.created} created, {result.updated} updated{result.errors.length ? `, ${result.errors.length} errors` : ""}
            </div>
            {result.errors.map((e, i) => <div key={i} style={{ fontSize: 12, color: "#92400e" }}>{e}</div>)}
          </div>
        )}

        {/* Preview */}
        {jobs.length > 0 && !importing && (
          <>
            {/* Stats + filters */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{jobs.length} jobs parsed</div>
              <span style={{ background: "#dcfce7", color: "#166534", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{newJobs.length} new</span>
              <span style={{ background: "#dbeafe", color: "#1e40af", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>{updateJobs.length} will update</span>
              <div style={{ flex: 1 }} />
              {(["all", "new", "update"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{ background: filter === f ? "#1565c0" : "#fff", color: filter === f ? "#fff" : "#374151", border: "1px solid #d1d5db", borderRadius: 6, padding: "5px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  {f === "all" ? `All (${jobs.length})` : f === "new" ? `New (${newJobs.length})` : `Updates (${updateJobs.length})`}
                </button>
              ))}
              <button
                onClick={runImport}
                style={{ background: "#0d2e5e", color: "#fff", border: "none", borderRadius: 8, padding: "8px 22px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}
              >
                Import {jobs.length} Jobs
              </button>
            </div>

            {/* Note about re-imports */}
            <div style={{ marginBottom: 14, padding: "10px 14px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: 12, color: "#1e40af" }}>
              <strong>Safe to re-import:</strong> When you import again with completed or updated jobs, the {updateJobs.length} matched job{updateJobs.length !== 1 ? "s" : ""} will be updated in place — any POs, visits, or notes you've added in SkySuite will not be affected.
            </div>

            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Job #</th>
                    <th style={th}>Customer</th>
                    <th style={th}>Title / Description</th>
                    <th style={th}>Status</th>
                    <th style={th}>PM</th>
                    <th style={th}>Type</th>
                    <th style={th}>Created</th>
                    <th style={th}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(job => (
                    <tr key={job.jobNumber} style={{ background: job._existingDocId ? "#fafffe" : "#fff" }}>
                      <td style={{ ...td, fontWeight: 700, color: "#1565c0" }}>{job.jobNumber}</td>
                      <td style={td}>{job.customerName}</td>
                      <td style={{ ...td, maxWidth: 300 }} title={job.issueDescription}>{job.title || "—"}</td>
                      <td style={{ ...td, maxWidth: 160 }}><Badge status={job.status} /></td>
                      <td style={td}>{job.projectManager || "—"}</td>
                      <td style={td}>{job.jobType || "—"}</td>
                      <td style={td}>{job.createdAt || "—"}</td>
                      <td style={{ ...td, fontWeight: 700, color: job._existingDocId ? "#1e40af" : "#166534" }}>
                        {job._existingDocId ? "UPDATE" : "CREATE"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {importing && (
          <div style={{ textAlign: "center", padding: 60, color: "#6b7280" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
            <div style={{ fontWeight: 700 }}>Importing {jobs.length} jobs…</div>
            <div style={{ fontSize: 12, marginTop: 8 }}>This may take a moment for large imports.</div>
          </div>
        )}
      </div>
    </div>
  );
}
