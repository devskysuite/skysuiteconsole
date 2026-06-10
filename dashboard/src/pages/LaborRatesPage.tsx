import { useEffect, useState } from "react";
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";

const LABOR_TYPES = ["Electrician", "Automation Tech", "General Labour", "Supervisor", "Project Manager", "Apprentice"];

interface FieldUser {
  id: string;
  displayName: string;
  laborType?: string;
  laborRates?: { rt: number; ot: number; dt: number; pto: number };
}

type Draft = { rt: string; ot: string; dt: string; pto: string; laborType: string };

const inp: React.CSSProperties = {
  border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 8px 6px 22px",
  fontSize: 13, width: 90, textAlign: "right", outline: "none",
};
const th: React.CSSProperties = {
  padding: "10px 14px", fontSize: 11, fontWeight: 700,
  color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right",
};

export default function LaborRatesPage() {
  const [users, setUsers]     = useState<FieldUser[]>([]);
  const [drafts, setDrafts]   = useState<Record<string, Draft>>({});
  const [saving, setSaving]   = useState<Record<string, boolean>>({});
  const [saved, setSaved]     = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDocs(query(collection(db, "users"), where("showInDispatch", "==", true)))
      .then(snap => {
        const list: FieldUser[] = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as Omit<FieldUser, "id">) }))
          .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
        setUsers(list);
        const init: Record<string, Draft> = {};
        for (const u of list) {
          init[u.id] = {
            rt:        u.laborRates?.rt != null ? String(u.laborRates.rt) : "",
            ot:        u.laborRates?.ot != null ? String(u.laborRates.ot) : "",
            dt:        u.laborRates?.dt != null ? String(u.laborRates.dt) : "",
            pto:       u.laborRates?.pto != null ? String(u.laborRates.pto) : "",
            laborType: u.laborType || "",
          };
        }
        setDrafts(init);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function save(uid: string) {
    const d = drafts[uid];
    if (!d) return;
    setSaving(s => ({ ...s, [uid]: true }));
    try {
      await updateDoc(doc(db, "users", uid), {
        laborType:  d.laborType,
        laborRates: {
          rt:  parseFloat(d.rt)  || 0,
          ot:  parseFloat(d.ot)  || 0,
          dt:  parseFloat(d.dt)  || 0,
          pto: parseFloat(d.pto) || 0,
        },
      });
      setSaved(s => ({ ...s, [uid]: true }));
      setTimeout(() => setSaved(s => ({ ...s, [uid]: false })), 1800);
    } catch {}
    setSaving(s => ({ ...s, [uid]: false }));
  }

  function set(uid: string, field: keyof Draft, val: string) {
    setDrafts(s => ({ ...s, [uid]: { ...s[uid], [field]: val } }));
    setSaved(s => ({ ...s, [uid]: false }));
  }

  return (
    <div style={{ background: "#f9fafb", minHeight: "calc(100vh - 96px)", padding: "28px 32px" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>Labor Rate Settings</div>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            Payroll rates per field employee — used for job costing calculations.
          </div>
        </div>

        {/* Card */}
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ ...th, textAlign: "left", paddingLeft: 20 }}>Employee</th>
                <th style={{ ...th, textAlign: "left" }}>Labor Type</th>
                <th style={th}>RT / hr</th>
                <th style={th}>OT / hr</th>
                <th style={th}>DT / hr</th>
                <th style={th}>PTO / hr</th>
                <th style={{ ...th, paddingRight: 20 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} style={{ padding: 32, textAlign: "center", color: "#9ca3af" }}>Loading…</td></tr>
              )}
              {!loading && users.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 32, textAlign: "center", color: "#9ca3af" }}>No field employees found. Mark employees "On Job Board" in Users to add them here.</td></tr>
              )}
              {users.map((u, i) => {
                const d = drafts[u.id] || { rt: "", ot: "", dt: "", pto: "", laborType: "" };
                return (
                  <tr key={u.id} style={{ borderBottom: i < users.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                    <td style={{ padding: "12px 14px 12px 20px", fontWeight: 600, fontSize: 14, color: "#111827" }}>
                      {u.displayName}
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <select
                        value={d.laborType}
                        onChange={e => set(u.id, "laborType", e.target.value)}
                        style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 8px", fontSize: 13, minWidth: 160, outline: "none" }}
                      >
                        <option value="">— Select Type —</option>
                        {LABOR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    {(["rt", "ot", "dt", "pto"] as const).map(f => (
                      <td key={f} style={{ padding: "12px 14px" }}>
                        <div style={{ position: "relative", display: "inline-block" }}>
                          <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "#9ca3af", fontSize: 13, pointerEvents: "none" }}>$</span>
                          <input
                            type="number" step="0.01" min="0"
                            value={d[f]}
                            onChange={e => set(u.id, f, e.target.value)}
                            placeholder="0.00"
                            style={inp}
                          />
                        </div>
                      </td>
                    ))}
                    <td style={{ padding: "12px 14px 12px 20px", paddingRight: 20, textAlign: "right" }}>
                      <button
                        onClick={() => save(u.id)}
                        disabled={saving[u.id]}
                        style={{
                          background: saved[u.id] ? "#dcfce7" : "#1565c0",
                          color: saved[u.id] ? "#166534" : "#fff",
                          border: "none", borderRadius: 6,
                          padding: "6px 16px", fontSize: 12, fontWeight: 700,
                          cursor: saving[u.id] ? "not-allowed" : "pointer",
                          whiteSpace: "nowrap",
                          transition: "background 0.2s",
                        }}
                      >
                        {saving[u.id] ? "Saving…" : saved[u.id] ? "✓ Saved" : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 14, fontSize: 12, color: "#9ca3af" }}>
          OT is typically 1.5× RT, DT is 2×. Rates appear in Job Costing under each job.
        </div>
      </div>
    </div>
  );
}
