import { useCallback, useEffect, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { calcSectionTotals, labourRate, migratePricing, PricingData } from "./QuotePricingTab";
import { useIsAdmin } from "../hooks/useIsAdmin";

const fmt$ = (n: number) =>
  n.toLocaleString("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface ScopePreset { id: string; name: string; content: string; }

// ── Row styles ────────────────────────────────────────────────────────────────
const HDR_ROW: React.CSSProperties = { display: "flex", padding: "5px 0", borderBottom: "1px solid #e5e7eb", marginBottom: 2 };
const HDR_LBL: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase" as const, letterSpacing: 0.4 };
const DATA_ROW: React.CSSProperties = { display: "flex", padding: "6px 0", borderBottom: "1px solid #f3f4f6", alignItems: "center" };
const COL_DESC: React.CSSProperties = { flex: 1, fontSize: 12, color: "#374151" };
const COL_SM: React.CSSProperties = { width: 80, textAlign: "right" as const, fontSize: 12, color: "#374151", flexShrink: 0 };
const COL_AMT: React.CSSProperties = { width: 100, textAlign: "right" as const, fontSize: 12, fontWeight: 700, color: "#111827", flexShrink: 0 };
const SUB_TOT: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 12, padding: "6px 0", borderTop: "1px solid #e5e7eb", marginTop: 2 };
const GRP_LBL: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase" as const, letterSpacing: 0.4, marginTop: 14, marginBottom: 4 };

function SectionLineItems({ sec, pricing }: { sec: PricingData["sections"][0]; pricing: PricingData }) {
  const s = pricing.settings;
  const { elecLines, progLines, matSell, elecSell, progSell, otherSell, travelSell, sectionSell } = calcSectionTotals(sec, s);

  const mats  = sec.materials.filter(m => (m.qty || 0) > 0 || m.description.trim());
  const elec  = elecLines.filter(l => (l.hours || 0) > 0 || l.description.trim());
  const prog  = progLines.filter(l => (l.hours || 0) > 0 || l.description.trim());
  const other = sec.otherCosts.filter(o => (o.cost || 0) > 0);
  const hasTrav = (sec.travel.days || 0) > 0 || (sec.travel.kmPerDay || 0) > 0;

  if (!elec.length && !prog.length && !mats.length && !other.length && !hasTrav) {
    return <div style={{ fontSize: 12, color: "#9ca3af", padding: "8px 0" }}>No line items — add materials and labour on the Overview tab.</div>;
  }

  return (
    <div style={{ marginTop: 8 }}>

      {/* Electrician Labour */}
      {elec.length > 0 && (
        <div>
          <div style={GRP_LBL}>Labour — Electrician</div>
          <div style={HDR_ROW}>
            <span style={{ ...HDR_LBL, flex: 1 }}>Description</span>
            <span style={{ ...HDR_LBL, width: 110 }}>Time Type</span>
            <span style={{ ...HDR_LBL, ...COL_SM }}>Hours</span>
            <span style={{ ...HDR_LBL, ...COL_SM }}>Unit Price</span>
            <span style={{ ...HDR_LBL, ...COL_AMT }}>Subtotal</span>
          </div>
          {elec.map(l => (
            <div key={l.id} style={DATA_ROW}>
              <span style={COL_DESC}>{l.description || "—"}</span>
              <span style={{ width: 110, fontSize: 12, color: "#6b7280", flexShrink: 0 }}>{l.timeType}</span>
              <span style={COL_SM}>{l.hours || 0} hrs</span>
              <span style={COL_SM}>{fmt$(labourRate(s, "elec", l.timeType))}</span>
              <span style={COL_AMT}>{fmt$(l.sell)}</span>
            </div>
          ))}
          <div style={SUB_TOT}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Electrician Labour Total</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#0d2e5e", width: 100, textAlign: "right" }}>{fmt$(elecSell)}</span>
          </div>
        </div>
      )}

      {/* Programming Labour */}
      {prog.length > 0 && (
        <div>
          <div style={GRP_LBL}>Labour — Programming</div>
          <div style={HDR_ROW}>
            <span style={{ ...HDR_LBL, flex: 1 }}>Description</span>
            <span style={{ ...HDR_LBL, width: 110 }}>Time Type</span>
            <span style={{ ...HDR_LBL, ...COL_SM }}>Hours</span>
            <span style={{ ...HDR_LBL, ...COL_SM }}>Unit Price</span>
            <span style={{ ...HDR_LBL, ...COL_AMT }}>Subtotal</span>
          </div>
          {prog.map(l => (
            <div key={l.id} style={DATA_ROW}>
              <span style={COL_DESC}>{l.description || "—"}</span>
              <span style={{ width: 110, fontSize: 12, color: "#6b7280", flexShrink: 0 }}>{l.timeType}</span>
              <span style={COL_SM}>{l.hours || 0} hrs</span>
              <span style={COL_SM}>{fmt$(labourRate(s, "prog", l.timeType))}</span>
              <span style={COL_AMT}>{fmt$(l.sell)}</span>
            </div>
          ))}
          <div style={SUB_TOT}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Programming Labour Total</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#0d2e5e", width: 100, textAlign: "right" }}>{fmt$(progSell)}</span>
          </div>
        </div>
      )}

      {/* Materials */}
      {mats.length > 0 && (
        <div>
          <div style={GRP_LBL}>Materials</div>
          <div style={HDR_ROW}>
            <span style={{ ...HDR_LBL, flex: 1 }}>Description</span>
            <span style={{ ...HDR_LBL, width: 140 }}>Part # / Manufacturer</span>
            <span style={{ ...HDR_LBL, ...COL_SM }}>Qty</span>
            <span style={{ ...HDR_LBL, ...COL_SM }}>Unit Price</span>
            <span style={{ ...HDR_LBL, ...COL_AMT }}>Subtotal</span>
          </div>
          {mats.map(m => {
            const sell = (m.qty || 0) * (m.unitPrice || 0) * (1 + s.materialMarkup);
            return (
              <div key={m.id} style={DATA_ROW}>
                <span style={COL_DESC}>{m.description || "—"}</span>
                <span style={{ width: 140, fontSize: 12, color: "#6b7280", flexShrink: 0 }}>{[m.partNumber, m.manufacturer].filter(Boolean).join(" · ") || "—"}</span>
                <span style={COL_SM}>{m.qty || 0} {m.unit || "ea"}</span>
                <span style={COL_SM}>{fmt$(m.unitPrice || 0)}</span>
                <span style={COL_AMT}>{fmt$(sell)}</span>
              </div>
            );
          })}
          <div style={SUB_TOT}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Materials Total</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#0d2e5e", width: 100, textAlign: "right" }}>{fmt$(matSell)}</span>
          </div>
        </div>
      )}

      {/* Other Costs */}
      {other.length > 0 && (
        <div>
          <div style={GRP_LBL}>Other Costs</div>
          <div style={HDR_ROW}>
            <span style={{ ...HDR_LBL, flex: 1 }}>Description</span>
            <span style={{ ...HDR_LBL, ...COL_AMT }}>Subtotal</span>
          </div>
          {other.map((o, i) => (
            <div key={i} style={DATA_ROW}>
              <span style={COL_DESC}>{o.description}</span>
              <span style={COL_AMT}>{fmt$((o.cost||0)*(1+(o.markup??s.otherCostsMarkup)))}</span>
            </div>
          ))}
          <div style={SUB_TOT}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Other Costs Total</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#0d2e5e", width: 100, textAlign: "right" }}>{fmt$(otherSell)}</span>
          </div>
        </div>
      )}

      {/* Travel */}
      {hasTrav && (() => {
        const t = sec.travel;
        const hrs = (t.workers||1)*(t.days||0)*(t.travelTimeHrs||1);
        const timeSell = hrs * s.travelRate;
        const mileSell = (t.kmPerDay||0)*(t.days||0)*s.mileageRate;
        const c407 = t.charge407||0;
        return (
          <div>
            <div style={GRP_LBL}>Travel</div>
            <div style={HDR_ROW}><span style={{ ...HDR_LBL, flex: 1 }}>Description</span><span style={{ ...HDR_LBL, ...COL_AMT }}>Subtotal</span></div>
            {timeSell > 0 && <div style={DATA_ROW}><span style={COL_DESC}>{t.workers} worker(s) × {t.days} day(s) × {t.travelTimeHrs} hr @ {fmt$(s.travelRate)}/hr</span><span style={COL_AMT}>{fmt$(timeSell)}</span></div>}
            {mileSell > 0 && <div style={DATA_ROW}><span style={COL_DESC}>{t.kmPerDay} km/day × {t.days} day(s) @ {fmt$(s.mileageRate)}/km</span><span style={COL_AMT}>{fmt$(mileSell)}</span></div>}
            {c407 > 0     && <div style={DATA_ROW}><span style={COL_DESC}>407 Charges</span><span style={COL_AMT}>{fmt$(c407)}</span></div>}
            <div style={SUB_TOT}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Travel Total</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#0d2e5e", width: 100, textAlign: "right" }}>{fmt$(travelSell)}</span>
            </div>
          </div>
        );
      })()}

    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function QuoteScopeTab({ quoteId, pricing: raw }: { quoteId: string; pricing: PricingData }) {
  const isAdmin = useIsAdmin();
  const [p, setP] = useState<PricingData>(() => migratePricing(raw));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [presets, setPresets] = useState<ScopePreset[]>([]);
  const [savePresetModal, setSavePresetModal] = useState<{ sectionId: string; content: string } | null>(null);
  const [newPresetName, setNewPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [loadMenuOpen, setLoadMenuOpen] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const q = query(collection(db, "scopePresets"), orderBy("name"));
    return onSnapshot(q, snap => setPresets(snap.docs.map(d => ({ id: d.id, ...d.data() } as ScopePreset))));
  }, []);

  const save = useCallback(async (data: PricingData) => {
    setSaveState("saving");
    try {
      await updateDoc(doc(db, "quotes", quoteId), { pricing: data });
      setSaveState("saved");
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveState("idle"), 3000);
    } catch { setSaveState("idle"); }
  }, [quoteId]);

  function handleChange(sectionId: string, text: string) {
    const next: PricingData = { ...p, sections: p.sections.map(s => s.id === sectionId ? { ...s, scopeOfWork: text } : s) };
    setP(next);
    clearTimeout(timers.current[sectionId]);
    timers.current[sectionId] = setTimeout(() => save(next), 800);
  }

  function applyPreset(sectionId: string, content: string) {
    const next: PricingData = { ...p, sections: p.sections.map(s => s.id === sectionId ? { ...s, scopeOfWork: content } : s) };
    setP(next);
    save(next);
    setLoadMenuOpen(null);
  }

  async function savePreset() {
    if (!savePresetModal || !newPresetName.trim()) return;
    setSavingPreset(true);
    await addDoc(collection(db, "scopePresets"), { name: newPresetName.trim(), content: savePresetModal.content });
    setSavingPreset(false);
    setSavePresetModal(null);
    setNewPresetName("");
  }

  async function deletePreset(id: string) {
    if (!confirm("Delete this preset?")) return;
    await deleteDoc(doc(db, "scopePresets", id));
  }

  const pill = (state: typeof saveState) => ({
    fontSize: 12, fontWeight: 700, padding: "3px 12px", borderRadius: 99,
    background: state === "saved" ? "#dcfce7" : state === "saving" ? "#fef9c3" : "#f3f4f6",
    color: state === "saved" ? "#166534" : state === "saving" ? "#854d0e" : "#9ca3af",
  } as React.CSSProperties);

  return (
    <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0d2e5e" }}>Scope of Work</div>
          <div style={pill(saveState)}>
            {saveState === "saved" ? "✓ Saved" : saveState === "saving" ? "Saving…" : "All changes saved"}
          </div>
        </div>
        <a href={`/quotes/${quoteId}/print`} target="_blank" rel="noreferrer"
          style={{ background: "#0d2e5e", color: "#fff", textDecoration: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
          🖨 Generate / Print PDF
        </a>
      </div>

      {/* Saved presets strip */}
      {presets.length > 0 && (
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Saved Presets</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {presets.map(pr => (
              <div key={pr.id} style={{ display: "flex", alignItems: "center", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6, padding: "4px 4px 4px 12px", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{pr.name}</span>
                {isAdmin && <button onClick={() => deletePreset(pr.id)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, padding: "0 4px", lineHeight: 1 }}>×</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sections */}
      {p.sections.map((sec, i) => {
        const { sectionSell } = calcSectionTotals(sec, p.settings);
        return (
          <div key={sec.id} style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", overflow: "hidden" }}>

            {/* Section title bar — blue bold title + total, matching screenshot */}
            <div style={{ padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "2px solid #1e40af" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#93c5fd", textTransform: "uppercase", letterSpacing: 0.4, background: "#0d2e5e", padding: "2px 8px", borderRadius: 4 }}>Section {i + 1}</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: "#1e40af" }}>{sec.name || `Section ${i + 1}`}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {sectionSell > 0 && <span style={{ fontSize: 15, fontWeight: 800, color: "#1e40af" }}>{fmt$(sectionSell)}</span>}
                {/* Load preset */}
                <div style={{ position: "relative" }}>
                  <button onClick={() => setLoadMenuOpen(loadMenuOpen === sec.id ? null : sec.id)}
                    style={{ background: "#f1f5f9", border: "1px solid #cbd5e1", color: "#374151", borderRadius: 6, padding: "4px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    Load Preset ▾
                  </button>
                  {loadMenuOpen === sec.id && (
                    <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 200, zIndex: 50, overflow: "hidden" }}>
                      {presets.length === 0 && <div style={{ padding: "12px 16px", fontSize: 12, color: "#9ca3af" }}>No presets saved yet.</div>}
                      {presets.map(pr => (
                        <button key={pr.id} onClick={() => applyPreset(sec.id, pr.content)}
                          style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 16px", fontSize: 13, fontWeight: 600, color: "#0d2e5e", background: "none", border: "none", borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                          onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                          {pr.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => { setSavePresetModal({ sectionId: sec.id, content: sec.scopeOfWork || "" }); setNewPresetName(""); }}
                  style={{ background: "#f1f5f9", border: "1px solid #cbd5e1", color: "#374151", borderRadius: 6, padding: "4px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  Save as Preset
                </button>
              </div>
            </div>

            <div style={{ padding: "16px 20px" }}>
              {/* Scope textarea */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Scope of Work</div>
                <textarea
                  value={sec.scopeOfWork || ""}
                  onChange={e => handleChange(sec.id, e.target.value)}
                  placeholder={`Describe the scope of work for "${sec.name || `Section ${i + 1}`}"…`}
                  rows={6}
                  style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, lineHeight: 1.8, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box", background: "#fff", color: "#111827", WebkitTextFillColor: "#111827" }}
                  onFocus={e => { e.target.style.borderColor = "#1565c0"; }}
                  onBlur={e => { e.target.style.borderColor = "#d1d5db"; }}
                />
                <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "right", marginTop: 3 }}>{(sec.scopeOfWork || "").length} characters</div>
              </div>

              {/* Divider */}
              <div style={{ borderTop: "1px solid #e5e7eb", marginBottom: 4 }} />

              {/* Line items from Overview */}
              <SectionLineItems sec={sec} pricing={p} />

              {/* Section total */}
              {sectionSell > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", borderTop: "2px solid #1e40af", marginTop: 12, paddingTop: 10, gap: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>Section Total</span>
                  <span style={{ fontSize: 14, fontWeight: 900, color: "#1e40af", minWidth: 110, textAlign: "right" }}>{fmt$(sectionSell)}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {p.sections.length === 0 && (
        <div style={{ padding: "60px 24px", textAlign: "center", color: "#9ca3af", fontSize: 14 }}>
          No sections yet — add sections on the Overview tab first.
        </div>
      )}

      {/* Totals summary */}
      {p.sections.length > 0 && (() => {
        const subtotal = p.sections.reduce((sum, sec) => sum + calcSectionTotals(sec, p.settings).sectionSell, 0);
        const taxRate = p.settings.taxRate ?? 0.265;
        const taxAmt = subtotal * taxRate;
        const grandTotal = subtotal + taxAmt;
        const row = (label: string, value: string, bold?: boolean, topBorder?: string): React.ReactNode => (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: topBorder || "1px solid #f3f4f6" }}>
            <span style={{ fontSize: 13, fontWeight: bold ? 800 : 500, color: bold ? "#0d2e5e" : "#374151" }}>{label}</span>
            <span style={{ fontSize: 13, fontWeight: bold ? 900 : 600, color: bold ? "#0d2e5e" : "#111827" }}>{value}</span>
          </div>
        );
        return (
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: "8px 20px 4px" }}>
            {row("Taxable Subtotal", fmt$(subtotal), false, "none")}
            {row(`HST / Tax (${(taxRate * 100).toFixed(1)}%)`, fmt$(taxAmt))}
            {row("Grand Total", fmt$(grandTotal), true, "2px solid #0d2e5e")}
          </div>
        );
      })()}

      {/* Save Preset Modal */}
      {savePresetModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 28, width: 420, boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#0d2e5e", marginBottom: 6 }}>Save as Preset</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 18 }}>Give this scope template a name to reuse on future quotes.</div>
            <input autoFocus value={newPresetName} onChange={e => setNewPresetName(e.target.value)} onKeyDown={e => e.key === "Enter" && savePreset()}
              placeholder="e.g. Conveyor Wiring — Standard"
              style={{ width: "100%", padding: "10px 14px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box", marginBottom: 18, color: "#111827", WebkitTextFillColor: "#111827", background: "#fff" }} />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setSavePresetModal(null)} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#374151" }}>Cancel</button>
              <button onClick={savePreset} disabled={!newPresetName.trim() || savingPreset}
                style={{ background: "#0d2e5e", border: "none", borderRadius: 8, padding: "9px 22px", fontSize: 13, fontWeight: 700, cursor: "pointer", color: "#fff", opacity: !newPresetName.trim() || savingPreset ? 0.5 : 1 }}>
                {savingPreset ? "Saving…" : "Save Preset"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loadMenuOpen && <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setLoadMenuOpen(null)} />}
    </div>
  );
}
