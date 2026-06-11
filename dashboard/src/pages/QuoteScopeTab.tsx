import { useCallback, useRef, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { migratePricing, PricingData } from "./QuotePricingTab";

export default function QuoteScopeTab({ quoteId, pricing: raw }: { quoteId: string; pricing: PricingData }) {
  const [p, setP] = useState<PricingData>(() => migratePricing(raw));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();

  const save = useCallback(async (data: PricingData) => {
    setSaveState("saving");
    try {
      await updateDoc(doc(db, "quotes", quoteId), { pricing: data });
      setSaveState("saved");
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveState("idle"), 3000);
    } catch {
      setSaveState("idle");
    }
  }, [quoteId]);

  function handleChange(sectionId: string, text: string) {
    const next: PricingData = {
      ...p,
      sections: p.sections.map(s => s.id === sectionId ? { ...s, scopeOfWork: text } : s),
    };
    setP(next);
    clearTimeout(timers.current[sectionId]);
    timers.current[sectionId] = setTimeout(() => save(next), 800);
  }

  return (
    <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 20 }}>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#0d2e5e" }}>Scope of Work</div>
        <div style={{
          fontSize: 12, fontWeight: 700, padding: "3px 12px", borderRadius: 99,
          background: saveState === "saved" ? "#dcfce7" : saveState === "saving" ? "#fef9c3" : "#f3f4f6",
          color: saveState === "saved" ? "#166534" : saveState === "saving" ? "#854d0e" : "#9ca3af",
          transition: "all 0.2s",
        }}>
          {saveState === "saved" ? "✓ Saved" : saveState === "saving" ? "Saving…" : "All changes saved"}
        </div>
      </div>

      {p.sections.map((sec, i) => (
        <div key={sec.id} style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", overflow: "hidden" }}>
          {/* Section header */}
          <div style={{ background: "#0d2e5e", padding: "10px 18px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#93c5fd", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Section {i + 1}
            </span>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>
              {sec.name || `Section ${i + 1}`}
            </span>
          </div>

          {/* Write-up area */}
          <div style={{ padding: "16px 20px" }}>
            <textarea
              value={sec.scopeOfWork || ""}
              onChange={e => handleChange(sec.id, e.target.value)}
              placeholder={`Describe the scope of work for "${sec.name || `Section ${i + 1}`}"…`}
              rows={8}
              style={{
                width: "100%",
                padding: "12px 14px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                fontSize: 13,
                lineHeight: 1.7,
                fontFamily: "inherit",
                resize: "vertical",
                boxSizing: "border-box",
                outline: "none",
                background: "#ffffff",
                color: "#111827",
                WebkitTextFillColor: "#111827",
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
    </div>
  );
}
