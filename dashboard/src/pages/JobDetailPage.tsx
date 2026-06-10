import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, updateDoc, where } from "firebase/firestore";
import { auth, db } from "../firebase";
import CreateVisitModal from "./CreateVisitModal";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Job {
  id: string;
  jobNumber: string;
  customerId: string;
  customerName: string;
  propertyId: string;
  propertyName: string;
  propertyRep: string;
  billingCustomer: string;
  customerPO: string;
  workType: string;
  pricebook: string;
  jobType: string;
  customerWO: string;
  authorizedBy: string;
  nte: number;
  quoteSubtotal: number;
  quoteTax: number;
  costAmount: number;
  projectManager: string;
  accountManager: string;
  soldBy: string;
  preferredTechnician: string;
  departmentsNeeded: string;
  priority: string;
  issueDescription: string;
  status: string;
  createdAt: string;
  createdBy: string;
}

interface PropertyInfo {
  propertyAddress?: string;
  propertyType?: string;
}

interface Visit {
  id: string;
  visitNumber: number;
  jobId: string;
  jobNumber: string;
  status: string;
  date: string;
  start: string;
  end: string;
  duration: number;
  title: string;
  description: string;
  toDo: string;
  department: string;
  techUid: string;
  techName: string;
  additionalTechnicians: string[];
  forms: string[];
  requiredSkills: string[];
  requiredCertifications: string[];
}

interface HistoryEntry {
  id: string;
  action: string;
  performedBy: string;
  timestamp: string;
  note?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt$(n: number): string {
  return "$" + (n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}
function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-CA", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtTime(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${ap}`;
}

// ── Colours ───────────────────────────────────────────────────────────────────
const JOB_STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  "Open":         { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd" },
  "In Progress":  { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" },
  "Completed":    { bg: "#dcfce7", color: "#166534", border: "#86efac" },
  "Cancelled":    { bg: "#f3f4f6", color: "#374151", border: "#d1d5db" },
  "Invoiced":     { bg: "#ede9fe", color: "#5b21b6", border: "#c4b5fd" },
};

const VISIT_STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  scheduled:  { bg: "#eef2f7", color: "#0d2e5e", border: "#cbd5e1" },
  traveling:  { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd" },
  working:    { bg: "#1565c0", color: "#ffffff", border: "#0d47a1" },
  paused:     { bg: "#fef9c3", color: "#854d0e", border: "#fde047" },
  onhold:     { bg: "#ffedd5", color: "#9a3412", border: "#fdba74" },
  canceled:   { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5" },
  closed:     { bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" },
  complete:   { bg: "#dcfce7", color: "#166534", border: "#86efac" },
};
const VISIT_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled", traveling: "Traveling", working: "Working",
  paused: "Paused", onhold: "On Hold", canceled: "Canceled",
  closed: "Closed", complete: "Complete",
};

const JOB_STATUSES = ["Open", "In Progress", "Completed", "Cancelled", "Invoiced"];
const VISIT_STATUSES = ["scheduled", "traveling", "working", "paused", "onhold", "canceled", "closed", "complete"];
const TABS = ["Scheduling", "Quotes", "Tasks", "Forms & Attachments", "Parts & Purchasing", "Job Costing", "Reports & Invoices"];

// Same option lists as CreateJobModal
const WORK_TYPES  = ["Service Call","Quoted Work","Maintenance","Emergency","Project","Inspection","Commissioning","Start-up","Other"];
const JOB_TYPES   = ["Service","Project","Quote","Emergency","Warranty"];
const DEPARTMENTS = ["Electrical","Automation","Industrial","Commercial","HVAC","Plumbing","Maintenance","General","Other"];
const PRIORITIES  = ["Low","Medium","High","Critical"];

// ── Edit mode ─────────────────────────────────────────────────────────────────
interface JobDraft {
  billingCustomer: string; propertyRep: string; authorizedBy: string;
  customerPO: string; customerWO: string;
  workType: string; pricebook: string; jobType: string;
  nte: string; quoteSubtotal: string; quoteTax: string; costAmount: string;
  projectManager: string; accountManager: string; soldBy: string; preferredTechnician: string;
  departmentsNeeded: string; priority: string; issueDescription: string;
}

const FIELD_LABELS: Record<string, string> = {
  billingCustomer: "Billing Customer", propertyRep: "Property Rep", authorizedBy: "Authorized By",
  customerPO: "Customer PO #", customerWO: "Customer WO #",
  workType: "Work Type", pricebook: "Pricebook", jobType: "Job Type",
  nte: "NTE", quoteSubtotal: "Quote Subtotal", quoteTax: "Quote Tax", costAmount: "Cost Amount",
  projectManager: "Project Manager", accountManager: "Account Manager", soldBy: "Sold By",
  preferredTechnician: "Preferred Technician", departmentsNeeded: "Departments",
  priority: "Priority", issueDescription: "Issue Description",
};

const eInp: React.CSSProperties = {
  width: "100%", padding: "5px 8px",
  border: "1px solid #93c5fd", borderRadius: 5,
  fontSize: 12, boxSizing: "border-box" as const,
  color: "#111827", background: "#fff", outline: "none", marginTop: 2,
};
const eSel: React.CSSProperties = { ...eInp, appearance: "auto" as React.CSSProperties["appearance"] };

// Prepend the current value if it isn't already in the option list, so the
// select never silently shows blank for legacy/free-text values
function withCurrent(list: string[], current: string): string[] {
  return current && !list.includes(current) ? [current, ...list] : list;
}

// ── Sidebar helpers ───────────────────────────────────────────────────────────
function SLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2, marginTop: 14 }}>
      {children}
    </div>
  );
}
function SValue({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, color: "#111827", wordBreak: "break-word" }}>
      {children || "—"}
    </div>
  );
}
function FieldBlock({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: "#111827" }}>{value || "—"}</div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<Job | null>(null);
  const [propInfo, setPropInfo] = useState<PropertyInfo | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Scheduling");
  const [showHistory, setShowHistory] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [addVisitOpen, setAddVisitOpen] = useState(false);
  const [rescheduleVisitId, setRescheduleVisitId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [allTechs, setAllTechs] = useState<{ uid: string; name: string }[]>([]);
  const [editingTechsId, setEditingTechsId] = useState<string | null>(null);
  const [editTechs, setEditTechs] = useState<string[]>([]);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<JobDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [users, setUsers] = useState<string[]>([]);
  const [contacts, setContacts] = useState<string[]>([]);
  const [pricebooks, setPricebooks] = useState<string[]>([]);

  // Job
  useEffect(() => {
    if (!jobId) return;
    return onSnapshot(doc(db, "jobs", jobId), snap => {
      setJob(snap.exists() ? ({ id: snap.id, ...snap.data() } as Job) : null);
      setLoading(false);
    });
  }, [jobId]);

  // Property info (address + type)
  useEffect(() => {
    if (!job?.propertyId) return;
    getDoc(doc(db, "properties", job.propertyId))
      .then(snap => { if (snap.exists()) setPropInfo(snap.data() as PropertyInfo); })
      .catch(() => {});
  }, [job?.propertyId]);

  // Visits — stored in dispatchVisits with jobId field
  // Note: no orderBy here to avoid requiring a composite Firestore index; sort client-side
  useEffect(() => {
    if (!jobId) return;
    return onSnapshot(
      query(collection(db, "dispatchVisits"), where("jobId", "==", jobId)),
      snap => setVisits(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as Visit))
          .sort((a, b) => (a.visitNumber || 0) - (b.visitNumber || 0))
      ),
      () => {}
    );
  }, [jobId]);

  // History (ascending — oldest first, panel will reverse)
  useEffect(() => {
    if (!jobId) return;
    return onSnapshot(
      query(collection(db, "jobs", jobId, "history"), orderBy("timestamp", "asc")),
      snap => setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() } as HistoryEntry))),
      () => {}
    );
  }, [jobId]);

  async function changeJobStatus(newStatus: string) {
    if (!jobId || !job || newStatus === job.status || statusBusy) return;
    setStatusBusy(true);
    try {
      await updateDoc(doc(db, "jobs", jobId), { status: newStatus });
      await addDoc(collection(db, "jobs", jobId, "history"), {
        action: `Status changed to "${newStatus}"`,
        performedBy: auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
        timestamp: new Date().toISOString(),
      });
    } catch (e) { console.error(e); }
    setStatusBusy(false);
  }

  async function removeVisitPayroll(visitId: string) {
    const snap = await getDocs(query(collection(db, "payrollEntries"), where("visitId", "==", visitId)));
    for (const d of snap.docs) await deleteDoc(doc(db, "payrollEntries", d.id));
  }

  async function changeVisitStatus(visitId: string, visitNumber: number, newStatus: string) {
    if (!jobId) return;
    try {
      await updateDoc(doc(db, "dispatchVisits", visitId), { status: newStatus });
      if (newStatus === "canceled") await removeVisitPayroll(visitId);
      await addDoc(collection(db, "jobs", jobId, "history"), {
        action: `Visit #${visitNumber} status changed to "${VISIT_STATUS_LABELS[newStatus] || newStatus}"`,
        performedBy: auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
        timestamp: new Date().toISOString(),
      });
    } catch (e) { console.error(e); }
  }

  async function deleteVisit(visitId: string, visitNumber: number) {
    if (!jobId) return;
    if (!window.confirm(`Delete Visit #${visitNumber}? This cannot be undone.`)) return;
    try {
      await removeVisitPayroll(visitId);
      await deleteDoc(doc(db, "dispatchVisits", visitId));
      await addDoc(collection(db, "jobs", jobId, "history"), {
        action: `Visit #${visitNumber} deleted`,
        performedBy: auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
        timestamp: new Date().toISOString(),
      });
    } catch (e) { console.error(e); }
  }

  async function deleteJob() {
    if (!jobId || !job) return;
    if (!window.confirm(`Delete job ${job.jobNumber}? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, "jobs", jobId));
      navigate(-1);
    } catch (e) { console.error(e); }
  }

  function startEdit() {
    if (!job) return;
    setDraft({
      billingCustomer:     job.billingCustomer || "",
      propertyRep:         job.propertyRep || "",
      authorizedBy:        job.authorizedBy || "",
      customerPO:          job.customerPO || "",
      customerWO:          job.customerWO || "",
      workType:            job.workType || "",
      pricebook:           job.pricebook || "",
      jobType:             job.jobType || "",
      nte:                 job.nte ? String(job.nte) : "",
      quoteSubtotal:       job.quoteSubtotal ? String(job.quoteSubtotal) : "",
      quoteTax:            job.quoteTax ? String(job.quoteTax) : "",
      costAmount:          job.costAmount ? String(job.costAmount) : "",
      projectManager:      job.projectManager || "",
      accountManager:      job.accountManager || "",
      soldBy:              job.soldBy || "",
      preferredTechnician: job.preferredTechnician || "",
      departmentsNeeded:   job.departmentsNeeded || "",
      priority:            job.priority || "",
      issueDescription:    job.issueDescription || "",
    });
    setEditing(true);
    // Lazily load dropdown data the first time edit mode opens
    if (users.length === 0) {
      getDocs(collection(db, "users")).then(snap => {
        setUsers(snap.docs.map(d => d.data().displayName as string).filter(Boolean).sort((a, b) => a.localeCompare(b)));
      }).catch(() => {});
    }
    if (contacts.length === 0 && job.customerId) {
      getDocs(collection(db, "customers", job.customerId, "contacts")).then(snap => {
        setContacts(snap.docs.map(d => d.data().name as string).filter(Boolean).sort((a, b) => a.localeCompare(b)));
      }).catch(() => {});
    }
    if (pricebooks.length === 0) {
      getDocs(collection(db, "pricebooks")).then(snap => {
        setPricebooks(snap.docs.map(d => d.data().name as string).filter(Boolean).sort((a, b) => a.localeCompare(b)));
      }).catch(() => {});
    }
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(null);
  }

  const dSet = (k: keyof JobDraft) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setDraft(d => d ? { ...d, [k]: e.target.value } : d);

  async function saveEdit() {
    if (!jobId || !job || !draft || savingEdit) return;
    setSavingEdit(true);
    const updates: Record<string, string | number> = {
      billingCustomer:     draft.billingCustomer,
      propertyRep:         draft.propertyRep,
      authorizedBy:        draft.authorizedBy,
      customerPO:          draft.customerPO,
      customerWO:          draft.customerWO,
      workType:            draft.workType,
      pricebook:           draft.pricebook,
      jobType:             draft.jobType,
      nte:                 parseFloat(draft.nte) || 0,
      quoteSubtotal:       parseFloat(draft.quoteSubtotal) || 0,
      quoteTax:            parseFloat(draft.quoteTax) || 0,
      costAmount:          parseFloat(draft.costAmount) || 0,
      projectManager:      draft.projectManager,
      accountManager:      draft.accountManager,
      soldBy:              draft.soldBy,
      preferredTechnician: draft.preferredTechnician,
      departmentsNeeded:   draft.departmentsNeeded,
      priority:            draft.priority,
      issueDescription:    draft.issueDescription,
    };
    const changed = Object.keys(updates).filter(k => {
      const before = (job as unknown as Record<string, unknown>)[k] ?? (typeof updates[k] === "number" ? 0 : "");
      return updates[k] !== before;
    });
    try {
      if (changed.length > 0) {
        await updateDoc(doc(db, "jobs", jobId), updates);
        await addDoc(collection(db, "jobs", jobId, "history"), {
          action:      "Job Edited",
          performedBy: auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
          timestamp:   new Date().toISOString(),
          note:        "Changed: " + changed.map(k => FIELD_LABELS[k] || k).join(", "),
        });
      }
      setEditing(false);
      setDraft(null);
    } catch (e) { console.error(e); }
    setSavingEdit(false);
  }

  // Load dispatch techs (lazy)
  useEffect(() => {
    if (allTechs.length > 0) return;
    getDocs(query(collection(db, "users"), where("showInDispatch", "==", true)))
      .then(snap => setAllTechs(
        snap.docs
          .map(d => ({ uid: (d.data().uid as string) || d.id, name: (d.data().displayName as string) || (d.data().email as string) || "Unknown" }))
          .filter(t => t.name)
          .sort((a, b) => a.name.localeCompare(b.name))
      )).catch(() => {});
  }, []);

  // Merge sub-collection history with derived creation event as fallback
  const displayHistory: HistoryEntry[] = history.length > 0
    ? history
    : job
      ? [{ id: "__created", action: "Job Created", performedBy: job.createdBy || "Unknown", timestamp: job.createdAt || "" }]
      : [];

  if (loading) {
    return <div style={{ padding: 60, textAlign: "center", color: "#9ca3af" }}>Loading…</div>;
  }
  if (!job) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        <div style={{ color: "#374151", fontWeight: 600, marginBottom: 12 }}>Job not found</div>
        <button onClick={() => navigate(-1)} style={{ color: "#1565c0", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>← Go back</button>
      </div>
    );
  }

  const jsc = JOB_STATUS_COLORS[job.status] || JOB_STATUS_COLORS.Open;
  const quoteTotal = (job.quoteSubtotal || 0) + (job.quoteTax || 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px)", background: "#f9fafb" }}>

      {/* ── Breadcrumb ── */}
      <div style={{ padding: "8px 24px", fontSize: 12, color: "#9ca3af", background: "#fff", borderBottom: "1px solid #f0f0f0", flexShrink: 0 }}>
        <span>Operations</span>
        <span style={{ margin: "0 6px", color: "#d1d5db" }}>/</span>
        <Link to="/properties" style={{ color: "#6b7280", textDecoration: "none" }}>Jobs</Link>
      </div>

      {/* ── Job header bar ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "10px 20px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flexShrink: 0 }}>
        {/* Job number */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: "#111827", whiteSpace: "nowrap" }}>Job: {job.jobNumber}</span>
        </div>

        {/* Status badge + action buttons */}
        <span style={{ background: jsc.bg, color: jsc.color, border: `1px solid ${jsc.border}`, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
          {job.status}
        </span>
        {job.status === "Cancelled" ? (
          <>
            <span style={{ fontSize: 11, color: "#991b1b", fontWeight: 600 }}>⛔ Cannot be reopened</span>
            <button
              onClick={deleteJob}
              style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
            >🗑 Delete Job</button>
          </>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            {job.status !== "Completed" && job.status !== "Invoiced" && (
              <button
                onClick={() => changeJobStatus("In Progress")}
                disabled={statusBusy || job.status === "In Progress"}
                style={{ background: job.status === "In Progress" ? "#e5e7eb" : "#fef3c7", color: "#92400e", border: "1px solid #fcd34d", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: job.status === "In Progress" ? "default" : "pointer", opacity: job.status === "In Progress" ? 0.5 : 1 }}
              >In Progress</button>
            )}
            <button
              onClick={() => changeJobStatus("Completed")}
              disabled={statusBusy}
              style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
            >✓ Complete</button>
            <button
              onClick={() => { if (window.confirm("Cancel this job? It cannot be reopened.")) changeJobStatus("Cancelled"); }}
              disabled={statusBusy}
              style={{ background: "transparent", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
            >✕ Cancel</button>
          </div>
        )}

        {/* Status pills */}
        <span style={{ background: "#f3f4f6", color: "#6b7280", fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 99, border: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>No Quotes ▾</span>
        <span style={{ background: "#f3f4f6", color: "#6b7280", fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 99, border: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>No POs ▾</span>
        <span style={{ background: "#f3f4f6", color: "#6b7280", fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 99, border: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>No Receipts ▾</span>
        {job.status === "Invoiced"
          ? <span style={{ background: "#dcfce7", color: "#166534", fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 99, whiteSpace: "nowrap" }}>Invoiced</span>
          : <span style={{ background: "#fef3c7", color: "#92400e", fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 99, whiteSpace: "nowrap" }}>Not Invoiced</span>
        }

        {/* Right buttons */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {editing ? (
            <>
              <button
                onClick={cancelEdit}
                disabled={savingEdit}
                style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#374151" }}
              >CANCEL</button>
              <button
                onClick={saveEdit}
                disabled={savingEdit}
                style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "6px 22px", fontSize: 12, fontWeight: 700, cursor: savingEdit ? "not-allowed" : "pointer", opacity: savingEdit ? 0.7 : 1 }}
              >{savingEdit ? "SAVING…" : "SAVE"}</button>
            </>
          ) : (
            <button
              onClick={startEdit}
              style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#374151" }}
            >EDIT</button>
          )}
          <button style={{ background: "#0d2e5e", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>OPEN JOB REPORT</button>
        </div>
      </div>

      {/* ── Two-column body ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Left sidebar ── */}
        <div style={{ width: 210, flexShrink: 0, borderRight: "1px solid #e5e7eb", background: "#fff", padding: "12px 16px 32px", overflowY: "auto" }}>
          <SLabel>Customer</SLabel>
          <SValue>
            {job.customerId
              ? <Link to={`/customers/${job.customerId}`} style={{ color: "#1565c0", fontWeight: 600, textDecoration: "none" }}>{job.customerName || "—"}</Link>
              : (job.customerName || "—")
            }
          </SValue>

          <SLabel>Billing Customer</SLabel>
          {editing && draft
            ? <input style={eInp} value={draft.billingCustomer} onChange={dSet("billingCustomer")} />
            : <SValue>{job.billingCustomer || job.customerName || "—"}</SValue>}

          <SLabel>Property</SLabel>
          <SValue>
            {job.propertyId
              ? <Link to={`/properties/${job.propertyId}`} style={{ color: "#1565c0", fontWeight: 600, textDecoration: "none" }}>{job.propertyName || "—"}</Link>
              : (job.propertyName || "—")
            }
          </SValue>

          <SLabel>Property Type</SLabel>
          <SValue>{propInfo?.propertyType || "—"}</SValue>

          <SLabel>Address</SLabel>
          <SValue>{propInfo?.propertyAddress || "—"}</SValue>

          <SLabel>Authorized By</SLabel>
          {editing && draft
            ? <select style={eSel} value={draft.authorizedBy} onChange={dSet("authorizedBy")}>
                <option value="">Select...</option>
                {withCurrent(contacts, draft.authorizedBy).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            : <SValue>{job.authorizedBy || "—"}</SValue>}

          <SLabel>Property Representative</SLabel>
          {editing && draft
            ? <select style={eSel} value={draft.propertyRep} onChange={dSet("propertyRep")}>
                <option value="">Select...</option>
                {withCurrent(contacts, draft.propertyRep).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            : <SValue>{job.propertyRep || "—"}</SValue>}

          <SLabel>Purchase Order (Customer)</SLabel>
          {editing && draft
            ? <input style={eInp} value={draft.customerPO} onChange={dSet("customerPO")} />
            : <SValue>{job.customerPO || "—"}</SValue>}

          <SLabel>Work Order (Customer)</SLabel>
          {editing && draft
            ? <input style={eInp} value={draft.customerWO} onChange={dSet("customerWO")} />
            : <SValue>{job.customerWO || "—"}</SValue>}

          <SLabel>Quote Subtotal</SLabel>
          {editing && draft
            ? <input type="number" min="0" step="0.01" style={eInp} value={draft.quoteSubtotal} onChange={dSet("quoteSubtotal")} />
            : <SValue>{job.quoteSubtotal ? fmt$(job.quoteSubtotal) : "—"}</SValue>}

          <SLabel>Quote Tax</SLabel>
          {editing && draft
            ? <input type="number" min="0" step="0.01" style={eInp} value={draft.quoteTax} onChange={dSet("quoteTax")} />
            : <SValue>{job.quoteTax ? fmt$(job.quoteTax) : "—"}</SValue>}

          <SLabel>Quote Total</SLabel>
          <SValue>{editing && draft
            ? fmt$((parseFloat(draft.quoteSubtotal) || 0) + (parseFloat(draft.quoteTax) || 0))
            : fmt$(quoteTotal)}</SValue>

          <SLabel>Amount Not to Exceed</SLabel>
          {editing && draft
            ? <input type="number" min="0" step="0.01" style={eInp} value={draft.nte} onChange={dSet("nte")} />
            : <SValue>{job.nte ? fmt$(job.nte) : "—"}</SValue>}

          <SLabel>Cost Amount</SLabel>
          {editing && draft
            ? <input type="number" min="0" step="0.01" style={eInp} value={draft.costAmount} onChange={dSet("costAmount")} />
            : <SValue>{job.costAmount ? fmt$(job.costAmount) : "—"}</SValue>}
        </div>

        {/* ── Main content ── */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

          {/* ── Fields section ── */}
          <div style={{ background: "#fff", padding: "18px 24px", borderBottom: "1px solid #e5e7eb", flexShrink: 0 }}>

            {/* Row 1: key fields */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0 14px", marginBottom: 18 }}>
              {editing && draft ? (
                <>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Job Type</div>
                    <select style={eSel} value={draft.jobType} onChange={dSet("jobType")}>
                      <option value="">Select...</option>
                      {withCurrent(JOB_TYPES, draft.jobType).map(j => <option key={j} value={j}>{j}</option>)}
                    </select>
                  </div>
                  {([
                    ["Project Manager", "projectManager"],
                    ["Account Manager", "accountManager"],
                    ["Sold By", "soldBy"],
                    ["Preferred Technician", "preferredTechnician"],
                  ] as [string, keyof JobDraft][]).map(([label, key]) => (
                    <div key={key}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{label}</div>
                      <select style={eSel} value={draft[key]} onChange={dSet(key)}>
                        <option value="">Select...</option>
                        {withCurrent(users, draft[key]).map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <FieldBlock label="Job Type"            value={job.jobType} />
                  <FieldBlock label="Project Manager"     value={job.projectManager} />
                  <FieldBlock label="Account Manager"     value={job.accountManager} />
                  <FieldBlock label="Sold By"             value={job.soldBy} />
                  <FieldBlock label="Preferred Technician" value={job.preferredTechnician} />
                </>
              )}
              <FieldBlock label="Labor Rate"          value="—" />
              <FieldBlock label="Modifiers"           value="—" />
            </div>

            {/* Departments */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>Departments</div>
              {editing && draft ? (
                <select style={{ ...eSel, maxWidth: 220 }} value={draft.departmentsNeeded} onChange={dSet("departmentsNeeded")}>
                  <option value="">Select...</option>
                  {withCurrent(DEPARTMENTS, draft.departmentsNeeded).map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              ) : job.departmentsNeeded
                ? <span style={{ background: "#f3f4f6", color: "#374151", fontSize: 12, fontWeight: 600, padding: "3px 12px", borderRadius: 99, border: "1px solid #e5e7eb" }}>{job.departmentsNeeded}</span>
                : <span style={{ color: "#9ca3af", fontSize: 13 }}>—</span>
              }
            </div>

            {/* Issue / Priority / Office Notes */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 1fr", gap: "0 20px", marginBottom: 14 }}>
              {editing && draft ? (
                <>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Issue Description</div>
                    <textarea rows={3} style={{ ...eInp, resize: "vertical", minHeight: 60, fontFamily: "inherit" }} value={draft.issueDescription} onChange={dSet("issueDescription")} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Priority</div>
                    <select style={eSel} value={draft.priority} onChange={dSet("priority")}>
                      <option value="">Select...</option>
                      {withCurrent(PRIORITIES, draft.priority).map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <FieldBlock label="Issue Description" value={job.issueDescription} />
                  <FieldBlock label="Priority"          value={job.priority} />
                </>
              )}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Office Notes</div>
                <div style={{ fontSize: 12, color: "#1565c0", cursor: "pointer" }}>Add / View / Edit all office notes for job</div>
              </div>
            </div>

            {/* Work Type / Pricebook */}
            <div style={{ display: "grid", gridTemplateColumns: "180px 200px", gap: "0 20px" }}>
              {editing && draft ? (
                <>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Work Type</div>
                    <select style={eSel} value={draft.workType} onChange={dSet("workType")}>
                      <option value="">Select...</option>
                      {withCurrent(WORK_TYPES, draft.workType).map(w => <option key={w} value={w}>{w}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Pricebook</div>
                    <select style={eSel} value={draft.pricebook} onChange={dSet("pricebook")}>
                      <option value="">Select...</option>
                      {withCurrent(pricebooks, draft.pricebook).map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <FieldBlock label="Work Type" value={job.workType} />
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Pricebook</div>
                    <div style={{ fontSize: 13, color: "#1565c0", fontWeight: 600 }}>{job.pricebook || "—"}</div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Tabs ── */}
          <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", display: "flex", overflowX: "auto", flexShrink: 0 }}>
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "11px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer",
                  background: "none", border: "none",
                  borderBottom: activeTab === tab ? "2px solid #0d2e5e" : "2px solid transparent",
                  color: activeTab === tab ? "#0d2e5e" : "#6b7280",
                  whiteSpace: "nowrap",
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* ── Tab body ── */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

            {activeTab === "Scheduling" && (
              <div>
                {/* ── Add Visit button ── */}
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
                  <button
                    onClick={() => setAddVisitOpen(true)}
                    style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                  >
                    + Add Visit
                  </button>
                </div>

                {visits.length === 0 ? (
                  <div style={{ color: "#9ca3af", fontSize: 14, textAlign: "center", paddingTop: 40 }}>
                    No visits — click + Add Visit to schedule one
                  </div>
                ) : (
                  visits.map(visit => {
                    const vsc = VISIT_STATUS_COLORS[visit.status] || VISIT_STATUS_COLORS.scheduled;
                    const addlTechs = Array.isArray(visit.additionalTechnicians)
                      ? visit.additionalTechnicians.join(", ")
                      : (visit.additionalTechnicians as unknown as string) || "";
                    return (
                      <div key={visit.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, marginBottom: 16 }}>
                        {/* Visit header */}
                        <div
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 18px", borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}
                          onClick={() => navigate(`/jobs/${jobId}/visits/${visit.id}`)}
                        >
                          <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>Visit #{visit.visitNumber}</span>
                          <span style={{ background: vsc.bg, color: vsc.color, border: `1px solid ${vsc.border}`, borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 700 }}>
                            {VISIT_STATUS_LABELS[visit.status] || visit.status}
                          </span>
                          {visit.status === "complete" ? (
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }} onClick={e => e.stopPropagation()}>
                              <span style={{ fontSize: 11, color: "#166534", fontWeight: 600 }}>✓ Completed</span>
                            </div>
                          ) : visit.status === "canceled" ? (
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }} onClick={e => e.stopPropagation()}>
                              <span style={{ fontSize: 11, color: "#991b1b", fontWeight: 600 }}>⛔ Cannot be reopened</span>
                              <button
                                onClick={() => deleteVisit(visit.id, visit.visitNumber)}
                                style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                              >🗑 Delete</button>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => { setRescheduleVisitId(rescheduleVisitId === visit.id ? null : visit.id); setRescheduleDate(visit.date || ""); setEditingTechsId(null); }}
                                style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                              >📅 Reschedule</button>
                              <button
                                onClick={() => {
                                  setEditingTechsId(editingTechsId === visit.id ? null : visit.id);
                                  setEditTechs(Array.isArray(visit.additionalTechnicians) ? visit.additionalTechnicians : []);
                                  setRescheduleVisitId(null);
                                }}
                                style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                              >👥 Techs</button>
                              <button
                                onClick={() => changeVisitStatus(visit.id, visit.visitNumber, "complete")}
                                style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                              >✓ Complete</button>
                              <button
                                onClick={() => { if (window.confirm("Cancel this visit? This cannot be undone.")) changeVisitStatus(visit.id, visit.visitNumber, "canceled"); }}
                                style={{ background: "transparent", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                              >✕ Cancel</button>
                            </div>
                          )}
                        </div>

                        {/* Reschedule picker */}
                        {rescheduleVisitId === visit.id && (
                          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 18px", borderBottom: "1px solid #f3f4f6" }} onClick={e => e.stopPropagation()}>
                            <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)}
                              style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "5px 10px", fontSize: 13 }} />
                            <button
                              disabled={!rescheduleDate || statusBusy}
                              onClick={async () => {
                                if (!rescheduleDate) return;
                                await updateDoc(doc(db, "dispatchVisits", visit.id), { date: rescheduleDate, status: "scheduled" });
                                setRescheduleVisitId(null);
                              }}
                              style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                            >Confirm</button>
                            <button onClick={() => setRescheduleVisitId(null)}
                              style={{ background: "#6b7280", color: "#fff", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✕</button>
                          </div>
                        )}

                        {/* Techs editor */}
                        {editingTechsId === visit.id && (
                          <div style={{ padding: "10px 18px", borderBottom: "1px solid #f3f4f6", background: "#f9fafb" }} onClick={e => e.stopPropagation()}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Additional Technicians</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                              {allTechs.filter(t => t.name !== visit.techName).map(t => (
                                <label key={t.uid} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, border: `1px solid ${editTechs.includes(t.name) ? "#7c3aed" : "#d1d5db"}`, background: editTechs.includes(t.name) ? "#ede9fe" : "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, color: editTechs.includes(t.name) ? "#7c3aed" : "#374151" }}>
                                  <input type="checkbox" style={{ display: "none" }} checked={editTechs.includes(t.name)} onChange={e => {
                                    if (e.target.checked) setEditTechs(prev => [...prev, t.name]);
                                    else setEditTechs(prev => prev.filter(n => n !== t.name));
                                  }} />
                                  {editTechs.includes(t.name) ? "✓ " : ""}{t.name}
                                </label>
                              ))}
                              {allTechs.filter(t => t.name !== visit.techName).length === 0 && (
                                <span style={{ fontSize: 12, color: "#9ca3af" }}>No other technicians available</span>
                              )}
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button
                                onClick={async () => {
                                  await updateDoc(doc(db, "dispatchVisits", visit.id), { additionalTechnicians: editTechs });
                                  setEditingTechsId(null);
                                }}
                                style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 6, padding: "5px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                              >Save</button>
                              <button onClick={() => setEditingTechsId(null)} style={{ background: "#6b7280", color: "#fff", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✕</button>
                            </div>
                          </div>
                        )}

                        {/* Visit fields */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0 16px", padding: "14px 18px" }}>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3, display: "flex", alignItems: "center", gap: 4 }}>
                              📅 Scheduled for
                            </div>
                            <div style={{ fontSize: 13, color: "#111827" }}>
                              {visit.date ? fmtDate(visit.date) : "—"}
                              {visit.start ? ` · ${fmtTime(visit.start)}` : ""}
                              {visit.duration ? ` (${visit.duration}h)` : ""}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Department</div>
                            <div style={{ fontSize: 13, color: "#111827" }}>{visit.department || "—"}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3, display: "flex", alignItems: "center", gap: 4 }}>
                              👤 Primary Technician
                            </div>
                            <div style={{ fontSize: 13, color: "#111827" }}>{visit.techName || "—"}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Additional Technicians</div>
                            <div style={{ fontSize: 13, color: "#111827" }}>{addlTechs || "—"}</div>
                          </div>
                        </div>

                        {(visit.description || visit.toDo) && (
                          <div style={{ display: "grid", gridTemplateColumns: visit.description && visit.toDo ? "1fr 1fr" : "1fr", gap: "0 16px", padding: "0 18px 14px" }}>
                            {visit.description && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Visit Description</div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{visit.description}</div>
                              </div>
                            )}
                            {visit.toDo && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>To Do</div>
                                <div style={{ fontSize: 13, color: "#374151", whiteSpace: "pre-line" }}>{visit.toDo}</div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}

                <div style={{ marginTop: 24, fontSize: 12, color: "#9ca3af" }}>
                  Job created {fmtDate(job.createdAt)} by {job.createdBy || "Unknown"}
                </div>
              </div>
            )}

            {activeTab !== "Scheduling" && (
              <div style={{ textAlign: "center", color: "#9ca3af", paddingTop: 60, fontSize: 14 }}>
                {activeTab} — coming soon
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Show History button (fixed bottom-right) ── */}
      <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 300 }}>
        <button
          onClick={() => setShowHistory(h => !h)}
          style={{
            background: "#fff", border: "1px solid #d1d5db",
            borderRadius: 8, padding: "8px 18px",
            fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#374151",
            boxShadow: "0 2px 10px rgba(0,0,0,0.10)",
          }}
        >
          {showHistory ? "HIDE HISTORY" : "SHOW HISTORY"}
        </button>
      </div>

      {/* ── History panel ── */}
      {showHistory && (
        <div style={{
          position: "fixed", bottom: 0, right: 0, zIndex: 200,
          width: 380, height: "55vh",
          background: "#fff",
          borderTop: "1px solid #e5e7eb", borderLeft: "1px solid #e5e7eb",
          borderTopLeftRadius: 12,
          boxShadow: "-4px -4px 24px rgba(0,0,0,0.10)",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 18px", borderBottom: "1px solid #e5e7eb", flexShrink: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>Job History</span>
            <button onClick={() => setShowHistory(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#6b7280", lineHeight: 1 }}>✕</button>
          </div>

          <div style={{ overflowY: "auto", flex: 1, padding: "14px 18px" }}>
            {displayHistory.length === 0 ? (
              <div style={{ color: "#9ca3af", fontSize: 13, textAlign: "center", paddingTop: 24 }}>No history</div>
            ) : (
              [...displayHistory].reverse().map((entry, idx) => (
                <div key={entry.id || idx} style={{ display: "flex", gap: 10, marginBottom: 18, paddingBottom: 18, borderBottom: idx < displayHistory.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                  <div style={{ flexShrink: 0, paddingTop: 4 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#0d2e5e" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{entry.action}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                      {entry.performedBy}
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>
                      {fmtDateTime(entry.timestamp)}
                    </div>
                    {entry.note && <div style={{ fontSize: 12, color: "#374151", marginTop: 4, fontStyle: "italic" }}>{entry.note}</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Add Visit modal ── */}
      {addVisitOpen && job && (
        <CreateVisitModal
          jobId={job.id}
          jobNumber={job.jobNumber}
          customerName={job.customerName}
          propertyName={job.propertyName}
          defaultDepartment={job.departmentsNeeded}
          defaultTechName={job.preferredTechnician}
          visitNumber={visits.length + 1}
          onClose={() => setAddVisitOpen(false)}
          onCreated={() => setAddVisitOpen(false)}
        />
      )}

    </div>
  );
}
