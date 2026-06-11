import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";

interface QuoteDefaults {
  electricianRate: number;
  programmerRate: number;
  electricianInternalCost: number;
  programmerInternalCost: number;
  travelRate: number;
  mileageRate: number;
  materialMarkup: number;
  otherCostsMarkup: number;
  overheadRate: number;
  taxRate: number;
}

const DEFAULTS: QuoteDefaults = {
  electricianRate: 95,
  programmerRate: 125,
  electricianInternalCost: 47.70,
  programmerInternalCost: 57.70,
  travelRate: 95,
  mileageRate: 0.50,
  materialMarkup: 38,
  otherCostsMarkup: 20,
  overheadRate: 0,
  taxRate: 26.5,
};

// Fields stored as decimals in Firestore (0.38 = 38%)
const PERCENT_FIELDS: (keyof QuoteDefaults)[] = [
  "materialMarkup",
  "otherCostsMarkup",
  "overheadRate",
  "taxRate",
];

type DraftValues = Record<keyof QuoteDefaults, string>;

function toDisplay(key: keyof QuoteDefaults, value: number): string {
  if (PERCENT_FIELDS.includes(key)) {
    return String(parseFloat((value * 100).toFixed(4)));
  }
  return String(value);
}

function toFirestore(key: keyof QuoteDefaults, raw: string): number {
  const n = parseFloat(raw) || 0;
  if (PERCENT_FIELDS.includes(key)) {
    return parseFloat((n / 100).toFixed(6));
  }
  return n;
}

function initDraft(data: Partial<QuoteDefaults>): DraftValues {
  const result = {} as DraftValues;
  for (const key of Object.keys(DEFAULTS) as (keyof QuoteDefaults)[]) {
    const value = data[key] !== undefined ? data[key]! : DEFAULTS[key];
    result[key] = toDisplay(key, value);
  }
  return result;
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  padding: "20px 24px",
  marginBottom: 20,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "#111827",
  marginBottom: 16,
  paddingBottom: 10,
  borderBottom: "1px solid #f3f4f6",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: 16,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 7,
  fontSize: 13,
  boxSizing: "border-box",
  outline: "none",
};

interface FieldProps {
  label: string;
  fieldKey: keyof QuoteDefaults;
  draft: DraftValues;
  onChange: (key: keyof QuoteDefaults, val: string) => void;
}

function Field({ label, fieldKey, draft, onChange }: FieldProps) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <input
        type="text"
        inputMode="decimal"
        value={draft[fieldKey]}
        onChange={e => onChange(fieldKey, e.target.value.replace(/[^0-9.]/g, ""))}
        style={inputStyle}
      />
    </div>
  );
}

export default function QuoteSetupPage() {
  const [draft, setDraft] = useState<DraftValues>(initDraft(DEFAULTS));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getDoc(doc(db, "settings", "quoteDefaults"))
      .then(snap => {
        if (snap.exists()) {
          setDraft(initDraft(snap.data() as Partial<QuoteDefaults>));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function handleChange(key: keyof QuoteDefaults, val: string) {
    setDraft(prev => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    const values: Partial<QuoteDefaults> = {};
    for (const key of Object.keys(DEFAULTS) as (keyof QuoteDefaults)[]) {
      values[key] = toFirestore(key, draft[key]);
    }
    try {
      await setDoc(doc(db, "settings", "quoteDefaults"), { ...values }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {}
    setSaving(false);
  }

  return (
    <div style={{ padding: "24px 32px", maxWidth: 800 }}>

      <div style={{ fontSize: 20, fontWeight: 800, color: "#0d2e5e", marginBottom: 24 }}>
        Quote Defaults
      </div>

      {loading ? (
        <div style={{ color: "#9ca3af", fontSize: 14 }}>Loading…</div>
      ) : (
        <>
          {/* Card 1 — Labour Rates */}
          <div style={cardStyle}>
            <div style={cardTitleStyle}>Labour Rates</div>
            <div style={gridStyle}>
              <Field label="Electrician Rate ($/hr)"          fieldKey="electricianRate"         draft={draft} onChange={handleChange} />
              <Field label="Programmer Rate ($/hr)"           fieldKey="programmerRate"           draft={draft} onChange={handleChange} />
              <Field label="Travel Rate ($/hr)"               fieldKey="travelRate"               draft={draft} onChange={handleChange} />
              <Field label="Electrician Internal Cost ($/hr)" fieldKey="electricianInternalCost"  draft={draft} onChange={handleChange} />
              <Field label="Programmer Internal Cost ($/hr)"  fieldKey="programmerInternalCost"   draft={draft} onChange={handleChange} />
              <Field label="Mileage Rate ($/km)"              fieldKey="mileageRate"              draft={draft} onChange={handleChange} />
            </div>
          </div>

          {/* Card 2 — Markups & Tax */}
          <div style={cardStyle}>
            <div style={cardTitleStyle}>Markups &amp; Tax</div>
            <div style={{ ...gridStyle, gridTemplateColumns: "1fr 1fr" }}>
              <Field label="Material Markup (%)"    fieldKey="materialMarkup"    draft={draft} onChange={handleChange} />
              <Field label="Other Costs Markup (%)" fieldKey="otherCostsMarkup"  draft={draft} onChange={handleChange} />
              <Field label="Overhead Rate (%)"      fieldKey="overheadRate"      draft={draft} onChange={handleChange} />
              <Field label="Tax Rate (%)"           fieldKey="taxRate"           draft={draft} onChange={handleChange} />
            </div>
          </div>

          {/* Save row */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                background: "#16a34a",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "10px 28px",
                fontSize: 14,
                fontWeight: 700,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && (
              <span style={{ fontSize: 13, fontWeight: 600, color: "#16a34a" }}>
                ✓ Saved
              </span>
            )}
          </div>

        </>
      )}
    </div>
  );
}
