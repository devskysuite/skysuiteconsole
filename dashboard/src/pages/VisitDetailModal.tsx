import { useEffect, useState } from "react";
import { addDoc, collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { auth, db } from "../firebase";

const DEPARTMENTS = ["Electrical","Automation","Industrial","Commercial","HVAC","Plumbing","Maintenance","General","Other"];

export interface VisitData {
  id: string;
  visitNumber: number;
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
  jobNumber: string;
  jobId: string;
}

interface Props {
  visit: VisitData;
  customerName: string;
  propertyName?: string;
  onClose: () => void;
  onSaved?: () => void;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "#6b7280",
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px",
  border: "1px solid #d1d5db", borderRadius: 6,
  fontSize: 13, boxSizing: "border-box" as const,
  color: "#111827", background: "#fff", outline: "none",
};

function arrToStr(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  return (v as string) || "";
}

export default function VisitDetailModal({ visit, customerName, propertyName, onClose, onSaved }: Props) {
  const [techs, setTechs] = useState<{ uid: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const [form, setForm] = useState({
    description:            visit.description || "",
    toDo:                   visit.toDo || "",
    forms:                  arrToStr(visit.forms),
    requiredSkills:         arrToStr(visit.requiredSkills),
    requiredCertifications: arrToStr(visit.requiredCertifications),
    department:             visit.department || "",
    primaryTechUid:         visit.techUid || "",
    additionalTechnicians:  arrToStr(visit.additionalTechnicians),
    date:                   visit.date || "",
    time:                   visit.start || "",
    duration:               String(visit.duration || 1),
  });

  useEffect(() => {
    getDocs(query(collection(db, "users"), where("showInDispatch", "==", true)))
      .then(snap => {
        const list = snap.docs
          .map(d => ({ uid: (d.data().uid as string) || d.id, name: (d.data().displayName as string) || (d.data().email as string) || "Unknown" }))
          .filter(t => t.name)
          .sort((a, b) => a.name.localeCompare(b.name));
        setTechs(list);
      })
      .catch(() => {});
  }, []);

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
    if (!form.department) errs.department = true;
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSaving(true);
    try {
      const selectedTech = techs.find(t => t.uid === form.primaryTechUid);
      const performer = auth.currentUser?.displayName || auth.currentUser?.email || "Unknown";
      const title = form.description.trim() || `${customerName}${propertyName ? " – " + propertyName : ""}`;

      let endTime = visit.end;
      if (form.time) {
        const [h, m] = form.time.split(":").map(Number);
        const durMin = Math.round((parseFloat(form.duration) || 1) * 60);
        const totalMin = h * 60 + m + durMin;
        endTime = `${String(Math.floor(totalMin / 60) % 24).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
      }

      await updateDoc(doc(db, "dispatchVisits", visit.id), {
        techUid:               form.primaryTechUid || "",
        techName:              selectedTech?.name || visit.techName || "",
        date:                  form.date,
        title,
        start:                 form.time,
        end:                   endTime,
        description:           form.description,
        toDo:                  form.toDo,
        department:            form.department,
        duration:              parseFloat(form.duration) || 1,
        additionalTechnicians: form.additionalTechnicians ? form.additionalTechnicians.split(",").map(s => s.trim()).filter(Boolean) : [],
        requiredSkills:        form.requiredSkills ? form.requiredSkills.split(",").map(s => s.trim()).filter(Boolean) : [],
        requiredCertifications: form.requiredCertifications ? form.requiredCertifications.split(",").map(s => s.trim()).filter(Boolean) : [],
        forms:                 form.forms ? form.forms.split(",").map(s => s.trim()).filter(Boolean) : [],
      });

      await addDoc(collection(db, "jobs", visit.jobId, "history"), {
        action:      `Visit #${visit.visitNumber} Edited`,
        performedBy: performer,
        timestamp:   new Date().toISOString(),
      });

      onSaved?.();
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
            <div style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>Visit #{visit.visitNumber}</div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{visit.jobNumber} · {customerName}{propertyName ? " · " + propertyName : ""}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#9ca3af", lineHeight: 1 }}>✕</button>
        </div>

        {/* ── Form ── */}
        <div style={{ padding: "20px 24px 28px" }}>

          {/* Visit Description */}
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Visit Description</label>
            <input style={inp} placeholder="Short description" {...bind("description")} />
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
                <span style={{ color: "#ef4444", fontSize: 9, fontWeight: 700 }}>REQUIRED</span>
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
                onChange={e => setForm(f => ({ ...f, primaryTechUid: e.target.value }))}
              >
                <option value="">Select Primary Technician</option>
                {techs.map(t => <option key={t.uid} value={t.uid}>{t.name}</option>)}
              </select>
            </div>
          </div>

          {/* Additional Technicians */}
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Additional Technicians</label>
            <input style={inp} placeholder="Select Additional Technicians (comma-separated)" {...bind("additionalTechnicians")} />
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
              style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, padding: "9px 28px", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}
            >
              {saving ? "Saving…" : "Save Visit"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
