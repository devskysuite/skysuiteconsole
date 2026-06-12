import { useCallback, useEffect, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { migratePricing, PricingData } from "./QuotePricingTab";
import { useIsAdmin } from "../hooks/useIsAdmin";

interface ScopePreset {
  id: string;
  name: string;
  content: string;
}

export default function QuoteScopeTab({ quoteId, pricing: raw }: { quoteId: string; pricing: PricingData }) {
  const isAdmin = useIsAdmin();
  const [p, setP] = useState<PricingData>(() => migratePricing(raw));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [presets, setPresets] = useState<ScopePreset[]>([]);
  const [savePresetModal, setSavePresetModal] = useState<{ sectionId: string; content: string } | null>(null);
  const [newPresetName, setNewPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [loadMenuOpen, setLoadMenuOpen] = useState<string | null>(null); // sectionId
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();

  // Load presets from Firestore
  useEffect(() => {
    const q = query(collection(db, "scopePresets"), orderBy("name"));
    const unsub = onSnapshot(q, snap => {
      setPresets(snap.docs.map(d => ({ id: d.id, ...d.data() } as ScopePreset)));
    });
    return unsub;
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
    transition: "all 0.2s",
  } as React.CSSProperties);

  return (
    <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0d2e5e" }}>Scope of Work</div>
          <div style={pill(saveState)}>
            {saveState === "saved" ? "✓ Saved" : saveState === "saving" ? "Saving…" : "All changes saved"}
          </div>
        </div>
        <a
          href={`/quotes/${quoteId}/print`}
          target="_blank"
          rel="noreferrer"
          style={{ background: "#0d2e5e", color: "#fff", textDecoration: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}
        >
          🖨 Generate / Print PDF
        </a>
      </div>

      {/* Saved presets panel */}
      {presets.length > 0 && (
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 18px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
            Saved Presets
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {presets.map(pr => (
              <div key={pr.id} style={{ display: "flex", alignItems: "center", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6, padding: "4px 4px 4px 12px", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{pr.name}</span>
                {isAdmin && (
                  <button onClick={() => deletePreset(pr.id)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, padding: "0 4px", lineHeight: 1 }} title="Delete preset">×</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sections */}
      {p.sections.map((sec, i) => (
        <div key={sec.id} style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", overflow: "hidden" }}>
          {/* Section header */}
          <div style={{ background: "#0d2e5e", padding: "10px 18px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#93c5fd", textTransform: "uppercase", letterSpacing: 0.5 }}>Section {i + 1}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#fff", flex: 1 }}>{sec.name || `Section ${i + 1}`}</span>

            {/* Load preset button */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setLoadMenuOpen(loadMenuOpen === sec.id ? null : sec.id)}
                style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 6, padding: "4px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
              >
                Load Preset ▾
              </button>
              {loadMenuOpen === sec.id && (
                <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 200, zIndex: 50, overflow: "hidden" }}>
                  {presets.length === 0 && (
                    <div style={{ padding: "12px 16px", fontSize: 12, color: "#9ca3af" }}>No presets saved yet.</div>
                  )}
                  {presets.map(pr => (
                    <button key={pr.id} onClick={() => applyPreset(sec.id, pr.content)}
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 16px", fontSize: 13, fontWeight: 600, color: "#0d2e5e", background: "none", border: "none", borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      {pr.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Save as preset */}
            <button
              onClick={() => { setSavePresetModal({ sectionId: sec.id, content: sec.scopeOfWork || "" }); setNewPresetName(""); }}
              style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 6, padding: "4px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              Save as Preset
            </button>
          </div>

          {/* Write-up area */}
          <div style={{ padding: "16px 20px" }}>
            <textarea
              value={sec.scopeOfWork || ""}
              onChange={e => handleChange(sec.id, e.target.value)}
              placeholder={`Describe the scope of work for "${sec.name || `Section ${i + 1}`}"…\n\nTip: Use Load Preset to apply a saved template, or Save as Preset to create one from this text.`}
              rows={10}
              style={{
                width: "100%", padding: "12px 14px", border: "1px solid #d1d5db", borderRadius: 8,
                fontSize: 13, lineHeight: 1.8, fontFamily: "inherit", resize: "vertical",
                boxSizing: "border-box", outline: "none", background: "#ffffff",
                color: "#111827", WebkitTextFillColor: "#111827",
              }}
              onFocus={e => { e.target.style.borderColor = "#1565c0"; }}
              onBlur={e => { e.target.style.borderColor = "#d1d5db"; }}
            />
            <div style={{ marginTop: 6, fontSize: 11, color: "#9ca3af", textAlign: "right" }}>
              {(sec.scopeOfWork || "").length} characters
            </div>
          </div>
        </div>
      ))}

      {p.sections.length === 0 && (
        <div style={{ padding: "60px 24px", textAlign: "center", color: "#9ca3af", fontSize: 14 }}>
          No sections yet — add sections on the Overview tab first.
        </div>
      )}

      {/* Save Preset Modal */}
      {savePresetModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 28, width: 420, boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#0d2e5e", marginBottom: 6 }}>Save as Preset</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 18 }}>Give this scope template a name so you can reuse it on future quotes.</div>
            <input
              autoFocus
              value={newPresetName}
              onChange={e => setNewPresetName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && savePreset()}
              placeholder="e.g. Conveyor Wiring — Standard"
              style={{ width: "100%", padding: "10px 14px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box", outline: "none", marginBottom: 18, color: "#111827", WebkitTextFillColor: "#111827", background: "#fff" }}
            />
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

      {/* Close load menu on outside click */}
      {loadMenuOpen && <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setLoadMenuOpen(null)} />}
    </div>
  );
}
