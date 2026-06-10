import { useEffect, useState } from "react";
import { addDoc, collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "../firebase";

const DEPARTMENTS = ["Electrical","Automation","Industrial","Commercial","HVAC","Plumbing","Maintenance","General","Other"];

interface Props {
  jobId: string;
  jobNumber: string;
  customerName: string;
  propertyName: string;
  defaultDepartment?: string;
  defaultTechName?: string;
  visitNumber: number;
  onClose: () => void;
  onCreated?: () => void;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "#6b7280",
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5,
};
const req: React.CSSProperties = { color: "#ef4444", fontSize: 9, fontWeight: 700, letterSpacing: 0.3 };
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px",
  border: "1px solid #d1d5db", borderRadius: 6,
  fontSize: 13, boxSizing: "border-box" as const,
  color: "#111827", background: "#fff", outline: "none",
};

// ── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        position: "relative", width: 40, height: 22, borderRadius: 11,
        background: on ? "#1565c0" : "#d1d5db",
        border: "none", cursor: "pointer", flexShrink: 0, transition: "background 0.2s",
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: on ? 21 : 3,
        width: 16, height: 16, borderRadius: "50%", background: "#fff",
        transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
      }} />
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function CreateVisitModal({ jobId, jobNumber, customerName, propertyName, defaultDepartment, defaultTechName, visitNumber, onClose, onCreated }: Props) {
  const [techs, setTechs] = useState<{ uid: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [multiple, setMultiple] = useState(false);
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const [additionalTechs, setAdditionalTechs] = useState<string[]>([]);
  const [form, setForm] = useState({
    description: "",
    toDo: "",
    forms: "",
    requiredSkills: "",
    requiredCertifications: "",
    department: defaultDepartment || "",
    primaryTechUid: "",
    date: "",
    time: "",
    duration: "1",
  });

  useEffect(() => {
    getDocs(query(collection(db, "users"), where("showInDispatch", "==", true)))
      .then(snap => {
        const list = snap.docs
          .map(d => ({ uid: (d.data().uid as string) || d.id, name: (d.data().displayName as string) || (d.data().email as string) || "Unknown" }))
          .filter(t => t.name)
          .sort((a, b) => a.name.localeCompare(b.name));
        setTechs(list);
        // Auto-select preferred technician if provided
        if (defaultTechName) {
          const match = list.find(t => t.name === defaultTechName);
          if (match) setForm(f => ({ ...f, primaryTechUid: match.uid }));
        }
      })
      .catch(() => {});
  }, [defaultTechName]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  function bind(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        setForm(f => ({ ...f, [key]: e.target.value }));
        if (errors[key]) setErrors(er => ({ ...er, [key]: false }));
      },
    };
  }

  async function handleSave() {
    const errs: Record<string, boolean> = {};
    if (!form.description.trim()) errs.description = true;
    if (!form.department) errs.department = true;
    if (Object.keys(errs).length) { setErrors(errs); return; }

    // Block duplicate job number on same day unless all existing visits are complete
    if (form.date && jobNumber) {
      const snap = await getDocs(query(
        collection(db, "dispatchVisits"),
        where("jobNumber", "==", jobNumber),
        where("date", "==", form.date),
      ));
      const blocking = snap.docs.filter(d => d.data().status !== "complete");
      if (blocking.length > 0) {
        alert(`${jobNumber} already has a visit scheduled on this date. Mark the existing visit complete before adding another.`);
        return;
      }
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const performer = auth.currentUser?.displayName || auth.currentUser?.email || "Unknown";

      // Compute end time
      let endTime = "";
      if (form.time) {
        const [h, m] = form.time.split(":").map(Number);
        const durMin = Math.round((parseFloat(form.duration) || 1) * 60);
        const totalMin = h * 60 + m + durMin;
        endTime = `${String(Math.floor(totalMin / 60) % 24).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
      }

      const selectedTech = techs.find(t => t.uid === form.primaryTechUid);
      const title = form.description.trim() || `${customerName}${propertyName ? " – " + propertyName : ""}`;

      const duration = parseFloat(form.duration) || 1;
      const visitRef = await addDoc(collection(db, "dispatchVisits"), {
        // Dispatch board core fields
        techUid:   form.primaryTechUid || "",
        techName:  selectedTech?.name || "",
        date:      form.date || "",
        title,
        jobNumber,
        start:     form.time || "",
        end:       endTime,
        status:    "scheduled",
        priority:  "normal",
        flagged:   false,
        notes:     form.toDo || "",
        // Extended fields
        jobId,
        visitNumber,
        description:              form.description,
        toDo:                     form.toDo,
        department:               form.department,
        duration,
        additionalTechnicians:    additionalTechs,
        requiredSkills:           form.requiredSkills
          ? form.requiredSkills.split(",").map(s => s.trim()).filter(Boolean)
          : [],
        requiredCertifications:   form.requiredCertifications
          ? form.requiredCertifications.split(",").map(s => s.trim()).filter(Boolean)
          : [],
        forms:                    form.forms
          ? form.forms.split(",").map(s => s.trim()).filter(Boolean)
          : [],
        createdAt:  now,
        createdBy:  performer,
      });

      // Auto-create payroll entry for primary + additional techs
      const allTechs = [selectedTech?.name || "", ...additionalTechs].filter(Boolean);
      try {
        for (const techName of allTechs) {
          await addDoc(collection(db, "payrollEntries"), {
            employeeName:  techName,
            employeeCode:  "",
            date:          form.date || "",
            department:    form.department,
            event:         "Visit",
            jobNumber,
            phase:         "",
            costCode:      "",
            visitRef:      String(visitNumber),
            visitId:       visitRef.id,
            jobId,
            eventStatus:   "Scheduled",
            reviewStatus:  "UNSUBMITTED",
            customer:      customerName,
            property:      propertyName,
            location:      "",
            notes:         "",
            rt:            0,
            ot:            0,
            dt:            0,
            pto:           0,
            laborRate:     "",
            laborType:     "",
            source:        "visit",
            createdAt:     now,
          });
        }
      } catch {}

      // Log to job history
      await addDoc(collection(db, "jobs", jobId, "history"), {
        action:      `Visit #${visitNumber} Added`,
        performedBy: performer,
        timestamp:   now,
      });

      onCreated?.();
      onClose();
    } catch (e) {
      console.error(e);
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 680, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 12px 48px rgba(0,0,0,0.2)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid #e5e7eb" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>Add Visit #{visitNumber}</div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{jobNumber} · {customerName}{propertyName ? " · " + propertyName : ""}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, color: "#374151", fontWeight: 500 }}>Create Multiple Visits</span>
            <Toggle on={multiple} onChange={setMultiple} />
          </div>
        </div>

        {/* ── Form ── */}
        <div style={{ padding: "20px 24px 28px" }}>

          {/* Visit Description */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...lbl, display: "flex", justifyContent: "space-between" }}>
              <span>Visit Description</span>
              <span style={req}>REQUIRED</span>
            </label>
            <input
              style={{ ...inp, borderColor: errors.description ? "#ef4444" : "#d1d5db" }}
              placeholder="Short description"
              {...bind("description")}
            />
            {errors.description && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>Description is required</div>}
          </div>

          {/* TO DO */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...lbl, fontSize: 10 }}>To Do – Actions before dispatch. Leave empty if there are no actions</label>
            <textarea
              rows={3}
              style={{ ...inp, resize: "vertical", minHeight: 72, fontFamily: "inherit" }}
              placeholder="TO DO"
              {...bind("toDo")}
            />
          </div>

          {/* Forms */}
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Forms</label>
            <input style={inp} placeholder="Select Forms (comma-separated)" {...bind("forms")} />
          </div>

          {/* Required Skills + Certifications */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div>
              <label style={lbl}>Required Skills</label>
              <input style={inp} placeholder="Select required skills" {...bind("requiredSkills")} />
            </div>
            <div>
              <label style={lbl}>Required Certifications</label>
              <input style={inp} placeholder="Select required certifications" {...bind("requiredCertifications")} />
            </div>
          </div>

          {/* Department + Primary Technician */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div>
              <label style={{ ...lbl, display: "flex", justifyContent: "space-between" }}>
                <span>Department</span>
                <span style={req}>REQUIRED</span>
              </label>
              <select
                style={{ ...inp, borderColor: errors.department ? "#ef4444" : "#d1d5db", appearance: "auto" as React.CSSProperties["appearance"] }}
                {...bind("department")}
              >
                <option value="">Select Department</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              {errors.department && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>Select a department</div>}
            </div>
            <div>
              <label style={lbl}>Primary Technician</label>
              <select
                style={{ ...inp, appearance: "auto" as React.CSSProperties["appearance"] }}
                value={form.primaryTechUid}
                onChange={e => {
                  const newUid = e.target.value;
                  const newName = techs.find(t => t.uid === newUid)?.name || "";
                  setForm(f => ({ ...f, primaryTechUid: newUid }));
                  setAdditionalTechs(prev => prev.filter(n => n !== newName));
                }}
              >
                <option value="">Select Primary Technician</option>
                {techs.map(t => <option key={t.uid} value={t.uid}>{t.name}</option>)}
              </select>
            </div>
          </div>

          {/* Additional Technicians */}
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Additional Technicians</label>
            {techs.filter(t => t.uid !== form.primaryTechUid).length === 0 ? (
              <div style={{ fontSize: 12, color: "#9ca3af", padding: "8px 0" }}>
                {form.primaryTechUid ? "No other technicians available" : "Select a primary technician first"}
              </div>
            ) : (
              <div style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 10px", maxHeight: 130, overflowY: "auto", background: "#fafafa" }}>
                {techs.filter(t => t.uid !== form.primaryTechUid).map(t => (
                  <label key={t.uid} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", fontSize: 13, color: "#111827" }}>
                    <input
                      type="checkbox"
                      checked={additionalTechs.includes(t.name)}
                      onChange={e => {
                        if (e.target.checked) setAdditionalTechs(prev => [...prev, t.name]);
                        else setAdditionalTechs(prev => prev.filter(n => n !== t.name));
                      }}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            )}
            {additionalTechs.length > 0 && (
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                Selected: {additionalTechs.join(", ")}
              </div>
            )}
          </div>

          {/* Date / Time / Duration */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 160px", gap: 16, marginBottom: 24 }}>
            <div>
              <label style={lbl}>Date</label>
              <input type="date" style={inp} {...bind("date")} />
            </div>
            <div>
              <label style={lbl}>Time</label>
              <input type="time" style={inp} {...bind("time")} />
            </div>
            <div>
              <label style={lbl}>Duration</label>
              <div style={{ position: "relative" }}>
                <input
                  type="number" min="0.5" step="0.5"
                  style={{ ...inp, paddingRight: 36 }}
                  {...bind("duration")}
                />
                <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "#9ca3af", pointerEvents: "none" }}>hr</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={onClose} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "9px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#374151" }}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "9px 28px", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}
            >
              {saving ? "Saving…" : "Add Visit"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
