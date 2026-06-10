import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, query, updateDoc, where } from "firebase/firestore";
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

// ── Types ─────────────────────────────────────────────────────────────────────
interface VisitDoc {
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
  createdAt: string;
  createdBy: string;
}

interface JobSnap {
  jobNumber: string;
  customerName: string;
  customerId: string;
  propertyName: string;
  propertyId: string;
  workType: string;
  priority: string;
  departmentsNeeded: string;
  issueDescription: string;
  preferredTechnician: string;
}

interface PropertySnap {
  propertyAddress?: string;
  propertyType?: string;
}

// ── Edit draft ────────────────────────────────────────────────────────────────
interface VisitDraft {
  description: string; toDo: string;
  forms: string; requiredSkills: string; requiredCertifications: string;
  department: string; primaryTechUid: string; additionalTechnicians: string;
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

// ── Shared style atoms ────────────────────────────────────────────────────────
const eInp: React.CSSProperties = {
  width:"100%", padding:"6px 10px",
  border:"1px solid #93c5fd", borderRadius:5,
  fontSize:13, boxSizing:"border-box" as const,
  color:"#111827", background:"#fff", outline:"none",
};
const eSel: React.CSSProperties = { ...eInp, appearance:"auto" as React.CSSProperties["appearance"] };

function SLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.6, marginBottom:2, marginTop:14 }}>{children}</div>;
}
function SValue({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize:13, color:"#111827", wordBreak:"break-word" }}>{(children as string) || "—"}</div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom:28 }}>
      <div style={{ fontSize:11, fontWeight:800, color:"#6b7280", textTransform:"uppercase", letterSpacing:0.8, marginBottom:12, paddingBottom:6, borderBottom:"1px solid #f3f4f6" }}>{title}</div>
      {children}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function VisitDetailPage() {
  const { jobId, visitId } = useParams<{ jobId: string; visitId: string }>();
  const navigate = useNavigate();

  const [visit, setVisit] = useState<VisitDoc | null>(null);
  const [job, setJob] = useState<JobSnap | null>(null);
  const [propInfo, setPropInfo] = useState<PropertySnap | null>(null);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<VisitDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [techs, setTechs] = useState<{ uid: string; name: string }[]>([]);

  // Load visit (real-time)
  useEffect(() => {
    if (!visitId) return;
    return onSnapshot(doc(db, "dispatchVisits", visitId), snap => {
      setVisit(snap.exists() ? ({ id: snap.id, ...snap.data() } as VisitDoc) : null);
      setLoading(false);
    });
  }, [visitId]);

  // Load job
  useEffect(() => {
    if (!jobId) return;
    getDoc(doc(db, "jobs", jobId)).then(snap => {
      if (snap.exists()) setJob(snap.data() as JobSnap);
    }).catch(() => {});
  }, [jobId]);

  // Load property info once job is known
  useEffect(() => {
    if (!job?.propertyId) return;
    getDoc(doc(db, "properties", job.propertyId)).then(snap => {
      if (snap.exists()) setPropInfo(snap.data() as PropertySnap);
    }).catch(() => {});
  }, [job?.propertyId]);

  function startEdit() {
    if (!visit) return;
    setDraft({
      description:            visit.description || "",
      toDo:                   visit.toDo || "",
      forms:                  arrStr(visit.forms),
      requiredSkills:         arrStr(visit.requiredSkills),
      requiredCertifications: arrStr(visit.requiredCertifications),
      department:             visit.department || "",
      primaryTechUid:         visit.techUid || "",
      additionalTechnicians:  arrStr(visit.additionalTechnicians),
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
        forms:                  draft.forms ? draft.forms.split(",").map(s => s.trim()).filter(Boolean) : [],
        requiredSkills:         draft.requiredSkills ? draft.requiredSkills.split(",").map(s => s.trim()).filter(Boolean) : [],
        requiredCertifications: draft.requiredCertifications ? draft.requiredCertifications.split(",").map(s => s.trim()).filter(Boolean) : [],
        department:             draft.department,
        techUid:                draft.primaryTechUid || "",
        techName:               selectedTech?.name || visit.techName || "",
        additionalTechnicians:  draft.additionalTechnicians ? draft.additionalTechnicians.split(",").map(s => s.trim()).filter(Boolean) : [],
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
      setEditing(false);
      setDraft(null);
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

  if (loading) return <div style={{ padding:60, textAlign:"center", color:"#9ca3af" }}>Loading…</div>;
  if (!visit) return (
    <div style={{ padding:60, textAlign:"center" }}>
      <div style={{ color:"#374151", fontWeight:600, marginBottom:12 }}>Visit not found</div>
      <button onClick={() => navigate(-1)} style={{ color:"#1565c0", background:"none", border:"none", cursor:"pointer", fontSize:14 }}>← Go back</button>
    </div>
  );

  const vsc = VISIT_STATUS_COLORS[visit.status] || VISIT_STATUS_COLORS.scheduled;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 64px)", background:"#f9fafb" }}>

      {/* ── Breadcrumb ── */}
      <div style={{ padding:"8px 24px", fontSize:12, color:"#9ca3af", background:"#fff", borderBottom:"1px solid #f0f0f0", flexShrink:0 }}>
        <span>Operations</span>
        <span style={{ margin:"0 6px", color:"#d1d5db" }}>/</span>
        <Link to="/properties" style={{ color:"#6b7280", textDecoration:"none" }}>Jobs</Link>
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
          style={{
            background:vsc.bg, color:vsc.color, border:`1px solid ${vsc.border}`,
            borderRadius:6, padding:"4px 10px", fontSize:12, fontWeight:700,
            cursor:"pointer", appearance:"auto" as React.CSSProperties["appearance"],
          }}
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
          <SValue>
            <Link to={`/jobs/${jobId}`} style={{ color:"#1565c0", fontWeight:600, textDecoration:"none" }}>{job?.jobNumber || "—"}</Link>
          </SValue>

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
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>Date</div>
                {editing && draft
                  ? <input type="date" style={eInp} value={draft.date} onChange={dSet("date")} />
                  : <div style={{ fontSize:13, color:"#111827" }}>{fmtDate(visit.date)}</div>
                }
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>Start Time</div>
                {editing && draft
                  ? <input type="time" style={eInp} value={draft.time} onChange={dSet("time")} />
                  : <div style={{ fontSize:13, color:"#111827" }}>{fmtTime(visit.start) || "—"}</div>
                }
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>End Time</div>
                <div style={{ fontSize:13, color:"#111827" }}>{fmtTime(visit.end) || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>Duration</div>
                {editing && draft
                  ? <div style={{ position:"relative" }}>
                      <input type="number" min="0.5" step="0.5" style={{ ...eInp, paddingRight:32 }} value={draft.duration} onChange={dSet("duration")} />
                      <span style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", fontSize:11, color:"#9ca3af", pointerEvents:"none" }}>hr</span>
                    </div>
                  : <div style={{ fontSize:13, color:"#111827" }}>{visit.duration ? `${visit.duration}h` : "—"}</div>
                }
              </div>
            </div>
          </Section>

          {/* ── Technicians ── */}
          <Section title="Technicians">
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 20px" }}>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>Primary Technician</div>
                {editing && draft
                  ? <select style={eSel} value={draft.primaryTechUid} onChange={dSet("primaryTechUid")}>
                      <option value="">Select…</option>
                      {techs.map(t => <option key={t.uid} value={t.uid}>{t.name}</option>)}
                    </select>
                  : <div style={{ fontSize:13, color:"#111827" }}>{visit.techName || "—"}</div>
                }
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>Additional Technicians</div>
                {editing && draft
                  ? <input style={eInp} placeholder="Comma-separated" value={draft.additionalTechnicians} onChange={dSet("additionalTechnicians")} />
                  : <div style={{ fontSize:13, color:"#111827" }}>{arrStr(visit.additionalTechnicians) || "—"}</div>
                }
              </div>
            </div>
          </Section>

          {/* ── Description / To Do ── */}
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

          {/* ── Requirements ── */}
          <Section title="Requirements">
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:"0 20px" }}>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>Required Skills</div>
                {editing && draft
                  ? <input style={eInp} placeholder="Comma-separated" value={draft.requiredSkills} onChange={dSet("requiredSkills")} />
                  : <div style={{ fontSize:13, color:"#111827" }}>{arrStr(visit.requiredSkills) || "—"}</div>
                }
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>Required Certifications</div>
                {editing && draft
                  ? <input style={eInp} placeholder="Comma-separated" value={draft.requiredCertifications} onChange={dSet("requiredCertifications")} />
                  : <div style={{ fontSize:13, color:"#111827" }}>{arrStr(visit.requiredCertifications) || "—"}</div>
                }
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>Forms</div>
                {editing && draft
                  ? <input style={eInp} placeholder="Comma-separated" value={draft.forms} onChange={dSet("forms")} />
                  : <div style={{ fontSize:13, color:"#111827" }}>{arrStr(visit.forms) || "—"}</div>
                }
              </div>
            </div>
          </Section>

          {/* ── Hours — coming soon ── */}
          <Section title="Hours">
            <div style={{ color:"#9ca3af", fontSize:13, fontStyle:"italic" }}>Time tracking coming soon</div>
          </Section>

          <div style={{ fontSize:11, color:"#9ca3af", marginTop:8 }}>
            Created {visit.createdAt ? new Date(visit.createdAt).toLocaleString("en-CA", { year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" }) : "—"} by {visit.createdBy || "Unknown"}
          </div>
        </div>
      </div>
    </div>
  );
}
