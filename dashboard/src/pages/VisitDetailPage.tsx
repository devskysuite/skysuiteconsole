import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { addDoc, arrayRemove, arrayUnion, collection, doc, getDoc, getDocs, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { auth, db } from "../firebase";

// ── Constants ─────────────────────────────────────────────────────────────────
const DEPARTMENTS = ["Electrical","Automation","Industrial","Commercial","HVAC","Plumbing","Maintenance","General","Other"];
const VISIT_STATUSES = ["scheduled","traveling","working","paused","onhold","canceled","closed","complete"];
const VISIT_STATUS_LABELS: Record<string, string> = {
  scheduled:"Scheduled", traveling:"Traveling", working:"Working",
  paused:"Paused", onhold:"On Hold", canceled:"Canceled",
  closed:"Closed", complete:"Complete",
};
const VISIT_STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  scheduled: { bg:"#eef2f7", color:"#0d2e5e", border:"#cbd5e1" },
  traveling: { bg:"#dbeafe", color:"#1e40af", border:"#93c5fd" },
  working:   { bg:"#1565c0", color:"#ffffff", border:"#0d47a1" },
  paused:    { bg:"#fef9c3", color:"#854d0e", border:"#fde047" },
  onhold:    { bg:"#ffedd5", color:"#9a3412", border:"#fdba74" },
  canceled:  { bg:"#fee2e2", color:"#991b1b", border:"#fca5a5" },
  closed:    { bg:"#f3f4f6", color:"#6b7280", border:"#d1d5db" },
  complete:  { bg:"#dcfce7", color:"#166534", border:"#86efac" },
};
const PO_STATUSES = ["Pending","Approved","Ordered","Received","Canceled"];

// ── Types ─────────────────────────────────────────────────────────────────────
interface PartItem   { id: string; description: string; qty: number; unitCost: number; notes: string; }
interface ReceiptItem{ id: string; date: string; vendor: string; receiptNumber: string; amount: number; description: string; }
interface POItem     { id: string; poNumber: string; vendor: string; description: string; amount: number; status: string; }

interface VisitDoc {
  id: string; visitNumber: number; jobId: string; jobNumber: string;
  status: string; date: string; start: string; end: string; duration: number;
  title: string; description: string; toDo: string; department: string;
  techUid: string; techName: string; additionalTechnicians: string[];
  forms: string[]; requiredSkills: string[]; requiredCertifications: string[];
  createdAt: string; createdBy: string;
  parts: PartItem[];
  receipts: ReceiptItem[];
  purchaseOrders: POItem[];
  notes: string;
}
interface JobSnap {
  jobNumber: string; customerName: string; customerId: string;
  propertyName: string; propertyId: string;
  workType: string; priority: string; departmentsNeeded: string;
  issueDescription: string; preferredTechnician: string;
}
interface PropertySnap { propertyAddress?: string; propertyType?: string; }
interface VisitDraft {
  description: string; toDo: string; notes: string;
  forms: string; requiredSkills: string; requiredCertifications: string;
  department: string; primaryTechUid: string; additionalTechnicians: string[];
  date: string; time: string; duration: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(s: string) {
  if (!s) return "—";
  return new Date(s + "T00:00:00").toLocaleDateString("en-CA", { year:"numeric", month:"short", day:"numeric" });
}
function fmtTime(t: string) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2,"0")} ${h >= 12 ? "pm" : "am"}`;
}
function arrStr(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  return (v as string) || "";
}
function uid(): string { return `${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }
function fmtMoney(n: number) { return `$${(n || 0).toFixed(2)}`; }

// ── Shared style atoms ────────────────────────────────────────────────────────
const eInp: React.CSSProperties = {
  width:"100%", padding:"6px 10px",
  border:"1px solid #93c5fd", borderRadius:5,
  fontSize:13, boxSizing:"border-box" as const,
  color:"#111827", background:"#fff", outline:"none",
};
const eSel: React.CSSProperties = { ...eInp, appearance:"auto" as React.CSSProperties["appearance"] };
const tInp: React.CSSProperties = { padding:"5px 8px", border:"1px solid #e5e7eb", borderRadius:4, fontSize:12, color:"#111827", boxSizing:"border-box" as const, width:"100%", background:"#fff" };

function SLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.6, marginBottom:2, marginTop:14 }}>{children}</div>;
}
function SValue({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize:13, color:"#111827", wordBreak:"break-word" }}>{(children as string) || "—"}</div>;
}
function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ marginBottom:28 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, paddingBottom:6, borderBottom:"1px solid #f3f4f6" }}>
        <div style={{ fontSize:11, fontWeight:800, color:"#6b7280", textTransform:"uppercase", letterSpacing:0.8 }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Small table helpers ───────────────────────────────────────────────────────
const th: React.CSSProperties = { textAlign:"left", fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", padding:"6px 10px", background:"#f9fafb", borderBottom:"1px solid #f0f0f0", whiteSpace:"nowrap" };
const td: React.CSSProperties = { padding:"7px 10px", fontSize:13, color:"#111827", borderBottom:"1px solid #f9fafb", verticalAlign:"middle" };
const tdRight: React.CSSProperties = { ...td, textAlign:"right", fontWeight:600 };

// ── Page ──────────────────────────────────────────────────────────────────────
export default function VisitDetailPage() {
  const { jobId, visitId } = useParams<{ jobId: string; visitId: string }>();
  const navigate = useNavigate();

  const [visit, setVisit]     = useState<VisitDoc | null>(null);
  const [job, setJob]         = useState<JobSnap | null>(null);
  const [propInfo, setPropInfo] = useState<PropertySnap | null>(null);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState<VisitDraft | null>(null);
  const [saving, setSaving]   = useState(false);
  const [techs, setTechs]     = useState<{ uid: string; name: string }[]>([]);

  // ── Line-item add forms ────────────────────────────────────────────────────
  const [showAddPart, setShowAddPart]       = useState(false);
  const [showAddReceipt, setShowAddReceipt] = useState(false);
  const [showAddPO, setShowAddPO]           = useState(false);

  const BLANK_PART:    Omit<PartItem,   "id"> = { description:"", qty:1, unitCost:0, notes:"" };
  const BLANK_RECEIPT: Omit<ReceiptItem,"id"> = { date:"", vendor:"", receiptNumber:"", amount:0, description:"" };
  const BLANK_PO:      Omit<POItem,     "id"> = { poNumber:"", vendor:"", description:"", amount:0, status:"Pending" };

  const [newPart,    setNewPart]    = useState<typeof BLANK_PART>(BLANK_PART);
  const [newReceipt, setNewReceipt] = useState<typeof BLANK_RECEIPT>(BLANK_RECEIPT);
  const [newPO,      setNewPO]      = useState<typeof BLANK_PO>(BLANK_PO);

  // ── Load visit (real-time) ─────────────────────────────────────────────────
  useEffect(() => {
    if (!visitId) return;
    return onSnapshot(doc(db, "dispatchVisits", visitId), snap => {
      setVisit(snap.exists() ? ({ id: snap.id, ...snap.data() } as VisitDoc) : null);
      setLoading(false);
    });
  }, [visitId]);

  useEffect(() => {
    if (!jobId) return;
    getDoc(doc(db, "jobs", jobId)).then(snap => {
      if (snap.exists()) setJob(snap.data() as JobSnap);
    }).catch(() => {});
  }, [jobId]);

  useEffect(() => {
    if (!job?.propertyId) return;
    getDoc(doc(db, "properties", job.propertyId)).then(snap => {
      if (snap.exists()) setPropInfo(snap.data() as PropertySnap);
    }).catch(() => {});
  }, [job?.propertyId]);

  // ── Edit helpers ──────────────────────────────────────────────────────────
  function startEdit() {
    if (!visit) return;
    setDraft({
      description:            visit.description || "",
      toDo:                   visit.toDo || "",
      notes:                  visit.notes || "",
      forms:                  arrStr(visit.forms),
      requiredSkills:         arrStr(visit.requiredSkills),
      requiredCertifications: arrStr(visit.requiredCertifications),
      department:             visit.department || "",
      primaryTechUid:         visit.techUid || "",
      additionalTechnicians:  Array.isArray(visit.additionalTechnicians) ? visit.additionalTechnicians : [],
      date:                   visit.date || "",
      time:                   visit.start || "",
      duration:               String(visit.duration || 1),
    });
    setEditing(true);
    if (techs.length === 0) {
      getDocs(query(collection(db, "users"), where("showInDispatch", "==", true))).then(snap => {
        setTechs(snap.docs.map(d => ({
          uid: (d.data().uid as string) || d.id,
          name: (d.data().displayName as string) || (d.data().email as string) || "Unknown",
        })).filter(t => t.name).sort((a, b) => a.name.localeCompare(b.name)));
      }).catch(() => {});
    }
  }
  function cancelEdit() { setEditing(false); setDraft(null); }
  const dSet = (k: keyof VisitDraft) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setDraft(d => d ? { ...d, [k]: e.target.value } : d);

  async function saveEdit() {
    if (!visitId || !visit || !draft || saving) return;
    setSaving(true);
    const selectedTech = techs.find(t => t.uid === draft.primaryTechUid);
    let endTime = visit.end;
    if (draft.time) {
      const [h, m] = draft.time.split(":").map(Number);
      const totalMin = h * 60 + m + Math.round((parseFloat(draft.duration) || 1) * 60);
      endTime = `${String(Math.floor(totalMin / 60) % 24).padStart(2,"0")}:${String(totalMin % 60).padStart(2,"0")}`;
    }
    try {
      await updateDoc(doc(db, "dispatchVisits", visitId), {
        description:            draft.description,
        toDo:                   draft.toDo,
        notes:                  draft.notes,
        forms:                  draft.forms ? draft.forms.split(",").map(s => s.trim()).filter(Boolean) : [],
        requiredSkills:         draft.requiredSkills ? draft.requiredSkills.split(",").map(s => s.trim()).filter(Boolean) : [],
        requiredCertifications: draft.requiredCertifications ? draft.requiredCertifications.split(",").map(s => s.trim()).filter(Boolean) : [],
        department:             draft.department,
        techUid:                draft.primaryTechUid || "",
        techName:               selectedTech?.name || visit.techName || "",
        additionalTechnicians:  draft.additionalTechnicians,
        date:                   draft.date,
        start:                  draft.time,
        end:                    endTime,
        duration:               parseFloat(draft.duration) || 1,
      });
      if (jobId) {
        await addDoc(collection(db, "jobs", jobId, "history"), {
          action:      `Visit #${visit.visitNumber} Edited`,
          performedBy: auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
          timestamp:   new Date().toISOString(),
        });
      }
      setEditing(false); setDraft(null);
    } catch (e) { console.error(e); }
    setSaving(false);
  }

  async function changeStatus(newStatus: string) {
    if (!visitId || !visit || newStatus === visit.status) return;
    await updateDoc(doc(db, "dispatchVisits", visitId), { status: newStatus });
    if (jobId) {
      await addDoc(collection(db, "jobs", jobId, "history"), {
        action:      `Visit #${visit.visitNumber} status changed to "${VISIT_STATUS_LABELS[newStatus] || newStatus}"`,
        performedBy: auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
        timestamp:   new Date().toISOString(),
      });
    }
  }

  // ── Parts CRUD ─────────────────────────────────────────────────────────────
  async function savePart() {
    if (!visitId || !newPart.description) return;
    const item: PartItem = { ...newPart, id: uid() };
    await updateDoc(doc(db, "dispatchVisits", visitId), { parts: arrayUnion(item) });
    setNewPart(BLANK_PART); setShowAddPart(false);
  }
  async function removePart(item: PartItem) {
    if (!visitId) return;
    await updateDoc(doc(db, "dispatchVisits", visitId), { parts: arrayRemove(item) });
  }

  // ── Receipts CRUD ──────────────────────────────────────────────────────────
  async function saveReceipt() {
    if (!visitId || !newReceipt.vendor) return;
    const item: ReceiptItem = { ...newReceipt, id: uid() };
    await updateDoc(doc(db, "dispatchVisits", visitId), { receipts: arrayUnion(item) });
    setNewReceipt(BLANK_RECEIPT); setShowAddReceipt(false);
  }
  async function removeReceipt(item: ReceiptItem) {
    if (!visitId) return;
    await updateDoc(doc(db, "dispatchVisits", visitId), { receipts: arrayRemove(item) });
  }

  // ── PO CRUD ────────────────────────────────────────────────────────────────
  async function savePO() {
    if (!visitId || !newPO.poNumber) return;
    const item: POItem = { ...newPO, id: uid() };
    await updateDoc(doc(db, "dispatchVisits", visitId), { purchaseOrders: arrayUnion(item) });
    setNewPO(BLANK_PO); setShowAddPO(false);
  }
  async function removePO(item: POItem) {
    if (!visitId) return;
    await updateDoc(doc(db, "dispatchVisits", visitId), { purchaseOrders: arrayRemove(item) });
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  const parts    = visit?.parts           ?? [];
  const receipts = visit?.receipts        ?? [];
  const pos      = visit?.purchaseOrders  ?? [];

  const partsTotal    = parts.reduce((s, p) => s + (p.qty || 0) * (p.unitCost || 0), 0);
  const receiptsTotal = receipts.reduce((s, r) => s + (r.amount || 0), 0);
  const posTotal      = pos.reduce((s, p) => s + (p.amount || 0), 0);
  const grandTotal    = partsTotal + receiptsTotal + posTotal;

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return <div style={{ padding:60, textAlign:"center", color:"#9ca3af" }}>Loading…</div>;
  if (!visit) return (
    <div style={{ padding:60, textAlign:"center" }}>
      <div style={{ color:"#374151", fontWeight:600, marginBottom:12 }}>Visit not found</div>
      <button onClick={() => navigate(-1)} style={{ color:"#1565c0", background:"none", border:"none", cursor:"pointer", fontSize:14 }}>← Go back</button>
    </div>
  );

  const vsc = VISIT_STATUS_COLORS[visit.status] || VISIT_STATUS_COLORS.scheduled;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 96px)", background:"#f9fafb" }}>

      {/* ── Breadcrumb ── */}
      <div style={{ padding:"8px 24px", fontSize:12, color:"#9ca3af", background:"#fff", borderBottom:"1px solid #f0f0f0", flexShrink:0 }}>
        <span>Operations</span>
        <span style={{ margin:"0 6px", color:"#d1d5db" }}>/</span>
        <Link to="/dispatch" style={{ color:"#6b7280", textDecoration:"none" }}>Jobs</Link>
        <span style={{ margin:"0 6px", color:"#d1d5db" }}>/</span>
        <Link to={`/jobs/${jobId}`} style={{ color:"#6b7280", textDecoration:"none" }}>{job?.jobNumber || "Job"}</Link>
        <span style={{ margin:"0 6px", color:"#d1d5db" }}>/</span>
        <span style={{ color:"#374151" }}>Visit #{visit.visitNumber}</span>
      </div>

      {/* ── Header bar ── */}
      <div style={{ background:"#fff", borderBottom:"1px solid #e5e7eb", padding:"10px 20px", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", flexShrink:0 }}>
        <span style={{ fontSize:15, fontWeight:800, color:"#111827" }}>
          Visit #{visit.visitNumber} — {job?.jobNumber || visit.jobNumber}
        </span>
        <select
          value={visit.status}
          onChange={e => changeStatus(e.target.value)}
          style={{ background:vsc.bg, color:vsc.color, border:`1px solid ${vsc.border}`, borderRadius:6, padding:"4px 10px", fontSize:12, fontWeight:700, cursor:"pointer", appearance:"auto" as React.CSSProperties["appearance"] }}
        >
          {VISIT_STATUSES.map(s => <option key={s} value={s}>{VISIT_STATUS_LABELS[s]}</option>)}
        </select>
        <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
          {editing ? (
            <>
              <button onClick={cancelEdit} disabled={saving} style={{ background:"none", border:"1px solid #d1d5db", borderRadius:6, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer", color:"#374151" }}>CANCEL</button>
              <button onClick={saveEdit} disabled={saving} style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:6, padding:"6px 22px", fontSize:12, fontWeight:700, cursor:saving?"not-allowed":"pointer", opacity:saving?0.7:1 }}>
                {saving ? "SAVING…" : "SAVE"}
              </button>
            </>
          ) : (
            <button onClick={startEdit} style={{ background:"none", border:"1px solid #d1d5db", borderRadius:6, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer", color:"#374151" }}>EDIT</button>
          )}
          <button onClick={() => window.print()} style={{ background:"#0d2e5e", color:"#fff", border:"none", borderRadius:6, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer" }}>PRINT / PDF</button>
        </div>
      </div>

      {/* ── Two-column body ── */}
      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* ── Left sidebar ── */}
        <div style={{ width:210, flexShrink:0, borderRight:"1px solid #e5e7eb", background:"#fff", padding:"12px 16px 32px", overflowY:"auto" }}>
          <SLabel>Customer</SLabel>
          <SValue>
            {job?.customerId
              ? <Link to={`/customers/${job.customerId}`} style={{ color:"#1565c0", fontWeight:600, textDecoration:"none" }}>{job.customerName || "—"}</Link>
              : <>{job?.customerName || "—"}</>
            }
          </SValue>
          <SLabel>Property</SLabel>
          <SValue>
            {job?.propertyId
              ? <Link to={`/properties/${job.propertyId}`} style={{ color:"#1565c0", fontWeight:600, textDecoration:"none" }}>{job.propertyName || "—"}</Link>
              : <>{job?.propertyName || "—"}</>
            }
          </SValue>
          <SLabel>Property Type</SLabel>
          <SValue>{propInfo?.propertyType || "—"}</SValue>
          <SLabel>Address</SLabel>
          <SValue>{propInfo?.propertyAddress || "—"}</SValue>
          <SLabel>Job</SLabel>
          <SValue><Link to={`/jobs/${jobId}`} style={{ color:"#1565c0", fontWeight:600, textDecoration:"none" }}>{job?.jobNumber || "—"}</Link></SValue>
          <SLabel>Work Type</SLabel>
          <SValue>{job?.workType || "—"}</SValue>
          <SLabel>Priority</SLabel>
          <SValue>{job?.priority || "—"}</SValue>
          <SLabel>Department</SLabel>
          {editing && draft
            ? <select style={eSel} value={draft.department} onChange={dSet("department")}>
                <option value="">Select…</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            : <SValue>{visit.department || "—"}</SValue>
          }
          <SLabel>Issue Description</SLabel>
          <SValue>{job?.issueDescription || "—"}</SValue>
        </div>

        {/* ── Main content ── */}
        <div style={{ flex:1, overflowY:"auto", padding:"24px 28px" }}>

          {/* ── Scheduling ── */}
          <Section title="Scheduling">
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:"0 20px" }}>
              {[
                { label:"Date",      node: editing && draft ? <input type="date" style={eInp} value={draft.date} onChange={dSet("date")} /> : <div style={{ fontSize:13, color:"#111827" }}>{fmtDate(visit.date)}</div> },
                { label:"Start Time",node: editing && draft ? <input type="time" style={eInp} value={draft.time} onChange={dSet("time")} /> : <div style={{ fontSize:13, color:"#111827" }}>{fmtTime(visit.start) || "—"}</div> },
                { label:"End Time",  node: <div style={{ fontSize:13, color:"#111827" }}>{fmtTime(visit.end) || "—"}</div> },
                { label:"Duration",  node: editing && draft
                  ? <div style={{ position:"relative" }}><input type="number" min="0.5" step="0.5" style={{ ...eInp, paddingRight:32 }} value={draft.duration} onChange={dSet("duration")} /><span style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", fontSize:11, color:"#9ca3af", pointerEvents:"none" }}>hr</span></div>
                  : <div style={{ fontSize:13, color:"#111827" }}>{visit.duration ? `${visit.duration}h` : "—"}</div>
                },
              ].map(col => (
                <div key={col.label}>
                  <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>{col.label}</div>
                  {col.node}
                </div>
              ))}
            </div>
          </Section>

          {/* ── Technicians ── */}
          <Section title="Technicians">
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 20px" }}>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>Primary Technician</div>
                {editing && draft
                  ? <select style={eSel} value={draft.primaryTechUid} onChange={dSet("primaryTechUid")}><option value="">Select…</option>{techs.map(t => <option key={t.uid} value={t.uid}>{t.name}</option>)}</select>
                  : <div style={{ fontSize:13, color:"#111827" }}>{visit.techName || "—"}</div>
                }
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>Additional Technicians</div>
                {editing && draft ? (
                  <div style={{ border:"1px solid #93c5fd", borderRadius:5, padding:"6px 8px", maxHeight:130, overflowY:"auto", background:"#fafafa" }}>
                    {techs.filter(t => t.uid !== draft.primaryTechUid).map(t => (
                      <label key={t.uid} style={{ display:"flex", alignItems:"center", gap:6, padding:"3px 0", cursor:"pointer", fontSize:13, color:"#111827" }}>
                        <input type="checkbox" checked={draft.additionalTechnicians.includes(t.name)} onChange={e => {
                          setDraft(d => d ? { ...d, additionalTechnicians: e.target.checked ? [...d.additionalTechnicians, t.name] : d.additionalTechnicians.filter(n => n !== t.name) } : d);
                        }} />
                        {t.name}
                      </label>
                    ))}
                    {techs.filter(t => t.uid !== draft.primaryTechUid).length === 0 && <span style={{ fontSize:12, color:"#9ca3af" }}>No other technicians available</span>}
                  </div>
                ) : (
                  <div style={{ fontSize:13, color:"#111827" }}>{arrStr(visit.additionalTechnicians) || "—"}</div>
                )}
              </div>
            </div>
          </Section>

          {/* ── Description & To Do ── */}
          <Section title="Description & To Do">
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 20px" }}>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>Visit Description</div>
                {editing && draft
                  ? <input style={eInp} value={draft.description} onChange={dSet("description")} />
                  : <div style={{ fontSize:13, color:"#111827" }}>{visit.description || "—"}</div>
                }
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>To Do</div>
                {editing && draft
                  ? <textarea rows={4} style={{ ...eInp, resize:"vertical", minHeight:80, fontFamily:"inherit" }} value={draft.toDo} onChange={dSet("toDo")} />
                  : <div style={{ fontSize:13, color:"#374151", whiteSpace:"pre-line" }}>{visit.toDo || "—"}</div>
                }
              </div>
            </div>
          </Section>

          {/* ── Notes ── */}
          <Section title="Notes">
            {editing && draft
              ? <textarea rows={3} style={{ ...eInp, resize:"vertical", minHeight:64, fontFamily:"inherit", width:"100%" }} placeholder="Internal notes…" value={draft.notes} onChange={dSet("notes")} />
              : <div style={{ fontSize:13, color:"#374151", whiteSpace:"pre-line" }}>{visit.notes || <span style={{ color:"#9ca3af", fontStyle:"italic" }}>None</span>}</div>
            }
          </Section>

          {/* ── Requirements ── */}
          <Section title="Requirements">
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:"0 20px" }}>
              {[
                { label:"Required Skills", key:"requiredSkills" as keyof VisitDraft, val: arrStr(visit.requiredSkills) },
                { label:"Required Certifications", key:"requiredCertifications" as keyof VisitDraft, val: arrStr(visit.requiredCertifications) },
                { label:"Forms", key:"forms" as keyof VisitDraft, val: arrStr(visit.forms) },
              ].map(col => (
                <div key={col.label}>
                  <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>{col.label}</div>
                  {editing && draft
                    ? <input style={eInp} placeholder="Comma-separated" value={draft[col.key]} onChange={dSet(col.key)} />
                    : <div style={{ fontSize:13, color:"#111827" }}>{col.val || "—"}</div>
                  }
                </div>
              ))}
            </div>
          </Section>

          {/* ── Parts / Inventory Used ── */}
          <Section
            title="Parts / Inventory Used"
            action={
              <button onClick={() => setShowAddPart(v => !v)} style={{ background:"#0d2e5e", color:"#fff", border:"none", borderRadius:5, padding:"3px 12px", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                {showAddPart ? "Cancel" : "+ Add Part"}
              </button>
            }
          >
            {showAddPart && (
              <div style={{ background:"#f0f9ff", border:"1px solid #bae6fd", borderRadius:8, padding:12, marginBottom:12 }}>
                <div style={{ display:"grid", gridTemplateColumns:"3fr 1fr 1fr 2fr auto", gap:"0 8px", alignItems:"end" }}>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:"#6b7280", textTransform:"uppercase", marginBottom:3 }}>Description *</div>
                    <input style={tInp} placeholder="Part description" value={newPart.description} onChange={e => setNewPart(p => ({...p, description:e.target.value}))} />
                  </div>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:"#6b7280", textTransform:"uppercase", marginBottom:3 }}>Qty</div>
                    <input type="number" min="0" step="1" style={tInp} value={newPart.qty} onChange={e => setNewPart(p => ({...p, qty:parseFloat(e.target.value)||0}))} />
                  </div>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:"#6b7280", textTransform:"uppercase", marginBottom:3 }}>Unit Cost ($)</div>
                    <input type="number" min="0" step="0.01" style={tInp} value={newPart.unitCost} onChange={e => setNewPart(p => ({...p, unitCost:parseFloat(e.target.value)||0}))} />
                  </div>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, color:"#6b7280", textTransform:"uppercase", marginBottom:3 }}>Notes</div>
                    <input style={tInp} placeholder="Optional notes" value={newPart.notes} onChange={e => setNewPart(p => ({...p, notes:e.target.value}))} />
                  </div>
                  <button onClick={savePart} style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:5, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", height:31, alignSelf:"end" }}>Save</button>
                </div>
              </div>
            )}
            {parts.length === 0 ? (
              <div style={{ color:"#9ca3af", fontSize:13, fontStyle:"italic", padding:"6px 0" }}>No parts recorded</div>
            ) : (
              <table style={{ width:"100%", borderCollapse:"collapse", border:"1px solid #f0f0f0", borderRadius:8, overflow:"hidden" }}>
                <thead><tr><th style={th}>Description</th><th style={{...th,textAlign:"right"}}>Qty</th><th style={{...th,textAlign:"right"}}>Unit Cost</th><th style={{...th,textAlign:"right"}}>Total</th><th style={th}>Notes</th><th style={th}></th></tr></thead>
                <tbody>
                  {parts.map(p => (
                    <tr key={p.id}>
                      <td style={td}>{p.description}</td>
                      <td style={tdRight}>{p.qty}</td>
                      <td style={tdRight}>{fmtMoney(p.unitCost)}</td>
                      <td style={tdRight}>{fmtMoney(p.qty * p.unitCost)}</td>
                      <td style={{ ...td, color:"#6b7280" }}>{p.notes || "—"}</td>
                      <td style={{ ...td, textAlign:"center" }}>
                        <button onClick={() => removePart(p)} style={{ background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:14, padding:0 }} title="Remove">✕</button>
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background:"#f9fafb" }}>
                    <td colSpan={3} style={{ ...td, fontWeight:700, textAlign:"right", color:"#6b7280" }}>Parts Total</td>
                    <td style={{ ...tdRight, fontWeight:800, color:"#111827" }}>{fmtMoney(partsTotal)}</td>
                    <td colSpan={2} style={td} />
                  </tr>
                </tbody>
              </table>
            )}
          </Section>

          {/* ── Receipts ── */}
          <Section
            title="Receipts"
            action={
              <button onClick={() => setShowAddReceipt(v => !v)} style={{ background:"#0d2e5e", color:"#fff", border:"none", borderRadius:5, padding:"3px 12px", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                {showAddReceipt ? "Cancel" : "+ Add Receipt"}
              </button>
            }
          >
            {showAddReceipt && (
              <div style={{ background:"#f0f9ff", border:"1px solid #bae6fd", borderRadius:8, padding:12, marginBottom:12 }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr auto", gap:"0 8px", alignItems:"end" }}>
                  {[
                    { label:"Date", node:<input type="date" style={tInp} value={newReceipt.date} onChange={e=>setNewReceipt(r=>({...r,date:e.target.value}))} /> },
                    { label:"Receipt #", node:<input style={tInp} placeholder="Receipt #" value={newReceipt.receiptNumber} onChange={e=>setNewReceipt(r=>({...r,receiptNumber:e.target.value}))} /> },
                    { label:"Vendor *", node:<input style={tInp} placeholder="Vendor name" value={newReceipt.vendor} onChange={e=>setNewReceipt(r=>({...r,vendor:e.target.value}))} /> },
                    { label:"Description", node:<input style={tInp} placeholder="Description" value={newReceipt.description} onChange={e=>setNewReceipt(r=>({...r,description:e.target.value}))} /> },
                    { label:"Amount ($)", node:<input type="number" min="0" step="0.01" style={tInp} value={newReceipt.amount} onChange={e=>setNewReceipt(r=>({...r,amount:parseFloat(e.target.value)||0}))} /> },
                  ].map(c => (
                    <div key={c.label}>
                      <div style={{ fontSize:10, fontWeight:700, color:"#6b7280", textTransform:"uppercase", marginBottom:3 }}>{c.label}</div>
                      {c.node}
                    </div>
                  ))}
                  <button onClick={saveReceipt} style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:5, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", height:31, alignSelf:"end" }}>Save</button>
                </div>
              </div>
            )}
            {receipts.length === 0 ? (
              <div style={{ color:"#9ca3af", fontSize:13, fontStyle:"italic", padding:"6px 0" }}>No receipts recorded</div>
            ) : (
              <table style={{ width:"100%", borderCollapse:"collapse", border:"1px solid #f0f0f0", borderRadius:8, overflow:"hidden" }}>
                <thead><tr><th style={th}>Date</th><th style={th}>Receipt #</th><th style={th}>Vendor</th><th style={th}>Description</th><th style={{...th,textAlign:"right"}}>Amount</th><th style={th}></th></tr></thead>
                <tbody>
                  {receipts.map(r => (
                    <tr key={r.id}>
                      <td style={td}>{r.date ? fmtDate(r.date) : "—"}</td>
                      <td style={td}>{r.receiptNumber || "—"}</td>
                      <td style={td}>{r.vendor}</td>
                      <td style={{ ...td, color:"#6b7280" }}>{r.description || "—"}</td>
                      <td style={tdRight}>{fmtMoney(r.amount)}</td>
                      <td style={{ ...td, textAlign:"center" }}>
                        <button onClick={() => removeReceipt(r)} style={{ background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:14, padding:0 }} title="Remove">✕</button>
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background:"#f9fafb" }}>
                    <td colSpan={4} style={{ ...td, fontWeight:700, textAlign:"right", color:"#6b7280" }}>Receipts Total</td>
                    <td style={{ ...tdRight, fontWeight:800, color:"#111827" }}>{fmtMoney(receiptsTotal)}</td>
                    <td style={td} />
                  </tr>
                </tbody>
              </table>
            )}
          </Section>

          {/* ── Purchase Orders ── */}
          <Section
            title="Purchase Orders"
            action={
              <button onClick={() => setShowAddPO(v => !v)} style={{ background:"#0d2e5e", color:"#fff", border:"none", borderRadius:5, padding:"3px 12px", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                {showAddPO ? "Cancel" : "+ Add PO"}
              </button>
            }
          >
            {showAddPO && (
              <div style={{ background:"#f0f9ff", border:"1px solid #bae6fd", borderRadius:8, padding:12, marginBottom:12 }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 2fr 1fr 1fr auto", gap:"0 8px", alignItems:"end" }}>
                  {[
                    { label:"PO # *", node:<input style={tInp} placeholder="PO-001" value={newPO.poNumber} onChange={e=>setNewPO(p=>({...p,poNumber:e.target.value}))} /> },
                    { label:"Vendor", node:<input style={tInp} placeholder="Vendor" value={newPO.vendor} onChange={e=>setNewPO(p=>({...p,vendor:e.target.value}))} /> },
                    { label:"Description", node:<input style={tInp} placeholder="Description" value={newPO.description} onChange={e=>setNewPO(p=>({...p,description:e.target.value}))} /> },
                    { label:"Amount ($)", node:<input type="number" min="0" step="0.01" style={tInp} value={newPO.amount} onChange={e=>setNewPO(p=>({...p,amount:parseFloat(e.target.value)||0}))} /> },
                    { label:"Status", node:<select style={{ ...tInp, appearance:"auto" as React.CSSProperties["appearance"] }} value={newPO.status} onChange={e=>setNewPO(p=>({...p,status:e.target.value}))}>{PO_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}</select> },
                  ].map(c => (
                    <div key={c.label}>
                      <div style={{ fontSize:10, fontWeight:700, color:"#6b7280", textTransform:"uppercase", marginBottom:3 }}>{c.label}</div>
                      {c.node}
                    </div>
                  ))}
                  <button onClick={savePO} style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:5, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap", height:31, alignSelf:"end" }}>Save</button>
                </div>
              </div>
            )}
            {pos.length === 0 ? (
              <div style={{ color:"#9ca3af", fontSize:13, fontStyle:"italic", padding:"6px 0" }}>No purchase orders recorded</div>
            ) : (
              <table style={{ width:"100%", borderCollapse:"collapse", border:"1px solid #f0f0f0", borderRadius:8, overflow:"hidden" }}>
                <thead><tr><th style={th}>PO #</th><th style={th}>Vendor</th><th style={th}>Description</th><th style={{...th,textAlign:"right"}}>Amount</th><th style={th}>Status</th><th style={th}></th></tr></thead>
                <tbody>
                  {pos.map(p => {
                    const statusColors: Record<string,{bg:string;color:string}> = {
                      Pending:{bg:"#fef9c3",color:"#854d0e"}, Approved:{bg:"#dcfce7",color:"#166534"},
                      Ordered:{bg:"#dbeafe",color:"#1e40af"}, Received:{bg:"#f0fdf4",color:"#15803d"},
                      Canceled:{bg:"#fee2e2",color:"#991b1b"},
                    };
                    const sc = statusColors[p.status] || { bg:"#f3f4f6", color:"#374151" };
                    return (
                      <tr key={p.id}>
                        <td style={{ ...td, fontWeight:700 }}>{p.poNumber}</td>
                        <td style={td}>{p.vendor || "—"}</td>
                        <td style={{ ...td, color:"#6b7280" }}>{p.description || "—"}</td>
                        <td style={tdRight}>{fmtMoney(p.amount)}</td>
                        <td style={td}><span style={{ background:sc.bg, color:sc.color, borderRadius:99, padding:"2px 8px", fontSize:11, fontWeight:700 }}>{p.status}</span></td>
                        <td style={{ ...td, textAlign:"center" }}>
                          <button onClick={() => removePO(p)} style={{ background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:14, padding:0 }} title="Remove">✕</button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background:"#f9fafb" }}>
                    <td colSpan={3} style={{ ...td, fontWeight:700, textAlign:"right", color:"#6b7280" }}>POs Total</td>
                    <td style={{ ...tdRight, fontWeight:800, color:"#111827" }}>{fmtMoney(posTotal)}</td>
                    <td colSpan={2} style={td} />
                  </tr>
                </tbody>
              </table>
            )}
          </Section>

          {/* ── Amounts ── */}
          <Section title="Amounts">
            <table style={{ width:"100%", maxWidth:360, borderCollapse:"collapse", border:"1px solid #f0f0f0", borderRadius:8, overflow:"hidden" }}>
              <tbody>
                {[
                  { label:"Labor", val: visit.duration ? `${visit.duration}h (rate not set)` : "—", money: false },
                  { label:"Parts / Inventory", val: fmtMoney(partsTotal), money: true },
                  { label:"Receipts", val: fmtMoney(receiptsTotal), money: true },
                  { label:"Purchase Orders", val: fmtMoney(posTotal), money: true },
                ].map(row => (
                  <tr key={row.label}>
                    <td style={{ ...td, color:"#6b7280" }}>{row.label}</td>
                    <td style={{ ...tdRight, color: row.money && (parseFloat(row.val.replace(/[^0-9.]/g,""))||0) > 0 ? "#111827" : "#9ca3af" }}>{row.val}</td>
                  </tr>
                ))}
                <tr style={{ background:"#f0fdf4", borderTop:"2px solid #86efac" }}>
                  <td style={{ ...td, fontWeight:800, color:"#166534" }}>Grand Total</td>
                  <td style={{ ...tdRight, fontWeight:900, color:"#166534", fontSize:15 }}>{fmtMoney(grandTotal)}</td>
                </tr>
              </tbody>
            </table>
            {grandTotal === 0 && <div style={{ marginTop:8, fontSize:11, color:"#9ca3af", fontStyle:"italic" }}>Add parts, receipts, or POs above to calculate totals</div>}
          </Section>

          <div style={{ fontSize:11, color:"#9ca3af", marginTop:8 }}>
            Created {visit.createdAt ? new Date(visit.createdAt).toLocaleString("en-CA", { year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" }) : "—"} by {visit.createdBy || "Unknown"}
          </div>
        </div>
      </div>
    </div>
  );
}
