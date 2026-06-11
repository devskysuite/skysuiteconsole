import { useCallback, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import {
  calcSummary,
  DEFAULT_PRICING,
  LabourLine,
  MaterialLine,
  PricingData,
  PricingSettings,
  TravelData,
} from "./QuotePricingTab";

// ── Helpers ────────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }
function fmt$(n: number) {
  return "$" + (n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Cell Styles ────────────────────────────────────────────────────────────────
const BORDER = "1px solid #d1d5db";

const cellBase: React.CSSProperties = {
  border: BORDER,
  padding: 0,
  verticalAlign: "middle",
  position: "relative",
};
const cellInp: React.CSSProperties = {
  width: "100%", height: "100%",
  padding: "4px 6px",
  border: "none", outline: "none",
  background: "transparent",
  fontSize: 12,
  fontFamily: "inherit",
  boxSizing: "border-box",
};
const calcCell: React.CSSProperties = {
  ...cellBase,
  background: "#f9fafb",
  padding: "4px 8px",
  fontSize: 12,
  textAlign: "right",
  color: "#374151",
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const sectionHdr: React.CSSProperties = {
  background: "#0d2e5e",
  color: "#fff",
  fontWeight: 800,
  fontSize: 12,
  padding: "7px 10px",
  letterSpacing: 0.5,
  border: BORDER,
};
const subHdr: React.CSSProperties = {
  background: "#1e3a6e",
  color: "#cbd5e1",
  fontWeight: 700,
  fontSize: 11,
  padding: "5px 8px",
  textTransform: "uppercase" as const,
  letterSpacing: 0.4,
  border: BORDER,
  textAlign: "left" as const,
};
const totRow: React.CSSProperties = {
  background: "#f0f4ff",
  fontWeight: 700,
  fontSize: 12,
  padding: "5px 8px",
  border: BORDER,
  textAlign: "right" as const,
  color: "#1e40af",
};

// ── Editable cell ──────────────────────────────────────────────────────────────
function Cell({
  value, onChange, type = "text", align = "left", w,
}: {
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  align?: "left" | "right" | "center";
  w?: number | string;
}) {
  return (
    <td style={{ ...cellBase, width: w, minWidth: w }}>
      <input
        type={type}
        style={{ ...cellInp, textAlign: align }}
        value={value}
        onChange={e => onChange(e.target.value)}
        step={type === "number" ? "any" : undefined}
      />
    </td>
  );
}

// ── Overview Panel ─────────────────────────────────────────────────────────────
function OvRow({ label, value, sub }: { label: string; value: string; sub?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: sub ? "3px 0" : "5px 0", borderBottom: "1px solid #f3f4f6" }}>
      <span style={{ fontSize: sub ? 11 : 12, color: sub ? "#6b7280" : "#374151", paddingLeft: sub ? 10 : 0 }}>{label}</span>
      <span style={{ fontSize: sub ? 11 : 12, fontWeight: sub ? 500 : 700, color: "#111827" }}>{value}</span>
    </div>
  );
}

function OvSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: "#0d2e5e", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 5, paddingBottom: 4, borderBottom: "2px solid #0d2e5e" }}>{title}</div>
      {children}
    </div>
  );
}

function MkpField({ label, pct, onChange }: { label: string; pct: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #f3f4f6" }}>
      <span style={{ fontSize: 11, color: "#6b7280" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="number"
          step={0.1}
          value={+(pct * 100).toFixed(1)}
          onChange={e => onChange(+e.target.value / 100)}
          style={{ width: 54, border: "1px solid #d1d5db", borderRadius: 4, padding: "2px 5px", fontSize: 11, textAlign: "right" }}
        />
        <span style={{ fontSize: 11, color: "#9ca3af" }}>%</span>
      </div>
    </div>
  );
}

function RateField({ label, value, onChange, prefix = "$" }: { label: string; value: number; onChange: (v: number) => void; prefix?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #f3f4f6" }}>
      <span style={{ fontSize: 11, color: "#6b7280" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{prefix}</span>
        <input
          type="number"
          step="any"
          value={value}
          onChange={e => onChange(+e.target.value)}
          style={{ width: 64, border: "1px solid #d1d5db", borderRadius: 4, padding: "2px 5px", fontSize: 11, textAlign: "right" }}
        />
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function QuoteOverviewTab({ quoteId, pricing: init }: { quoteId: string; pricing: PricingData }) {
  const [p, setP] = useState<PricingData>(() => ({ ...DEFAULT_PRICING, ...init, settings: { ...DEFAULT_PRICING.settings, ...init.settings } }));
  const [saving, setSaving] = useState(false);

  const save = useCallback(async (data: PricingData) => {
    setSaving(true);
    try { await updateDoc(doc(db, "quotes", quoteId), { pricing: data }); } finally { setSaving(false); }
  }, [quoteId]);

  function upd(next: PricingData) { setP(next); save(next); }
  function updS(k: keyof PricingSettings, v: number) { upd({ ...p, settings: { ...p.settings, [k]: v } }); }

  // Materials
  function addMat() {
    upd({ ...p, materials: [...p.materials, { id: uid(), qty: 1, unit: "ea", manufacturer: "", partNumber: "", description: "", unitPrice: 0, supplier: "" }] });
  }
  function updMat(id: string, k: keyof MaterialLine, v: string | number) {
    upd({ ...p, materials: p.materials.map(m => m.id === id ? { ...m, [k]: v } : m) });
  }
  function delMat(id: string) { upd({ ...p, materials: p.materials.filter(m => m.id !== id) }); }

  // Other Costs
  function addOther() { upd({ ...p, otherCosts: [...p.otherCosts, { description: "", cost: 0, markup: p.settings.otherCostsMarkup }] }); }
  function updOther(i: number, k: string, v: string | number) {
    const oc = [...p.otherCosts]; oc[i] = { ...oc[i], [k]: v }; upd({ ...p, otherCosts: oc });
  }
  function delOther(i: number) { upd({ ...p, otherCosts: p.otherCosts.filter((_, idx) => idx !== i) }); }

  // Labour
  function addLabour(role: "elec" | "prog") {
    const line: LabourLine = { id: uid(), hours: 0, description: "", timeType: "Regular Time" };
    upd(role === "elec" ? { ...p, electricianLines: [...p.electricianLines, line] } : { ...p, programmerLines: [...p.programmerLines, line] });
  }
  function updLabour(role: "elec" | "prog", id: string, k: keyof LabourLine, v: string | number) {
    const key = role === "elec" ? "electricianLines" : "programmerLines";
    upd({ ...p, [key]: p[key].map((l: LabourLine) => l.id === id ? { ...l, [k]: v } : l) });
  }
  function delLabour(role: "elec" | "prog", id: string) {
    const key = role === "elec" ? "electricianLines" : "programmerLines";
    upd({ ...p, [key]: (p[key] as LabourLine[]).filter(l => l.id !== id) });
  }

  // Travel
  function updTravel(k: keyof TravelData, v: number) { upd({ ...p, travel: { ...p.travel, [k]: v } }); }

  const s = calcSummary(p);

  const thStyle = (w?: number | string): React.CSSProperties => ({
    ...subHdr,
    width: w,
    minWidth: w,
    position: "sticky",
    top: 0,
    zIndex: 1,
  });

  const delBtnStyle: React.CSSProperties = {
    background: "none", border: "none", color: "#ef4444",
    fontSize: 14, cursor: "pointer", padding: "0 4px", lineHeight: 1,
  };
  const addRowStyle: React.CSSProperties = {
    background: "none", border: "1px dashed #9ca3af",
    color: "#6b7280", borderRadius: 4, padding: "3px 10px",
    fontSize: 11, cursor: "pointer", margin: "4px 0",
  };

  return (
    <div style={{ display: "flex", gap: 0, alignItems: "flex-start", height: "calc(100vh - 220px)", overflow: "hidden" }}>

      {/* ── LEFT: Spreadsheet ── */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", paddingRight: 12 }}>
        {saving && <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>Saving…</div>}

        {/* MATERIALS */}
        <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 16, tableLayout: "auto" }}>
          <tbody>
            <tr><td colSpan={10} style={sectionHdr}>MATERIALS</td></tr>
            <tr>
              <th style={thStyle(28)}>#</th>
              <th style={thStyle(46)}>Qty</th>
              <th style={thStyle(46)}>Unit</th>
              <th style={thStyle(100)}>Manufacturer</th>
              <th style={thStyle(90)}>Part #</th>
              <th style={{ ...thStyle(), minWidth: 200 }}>Description</th>
              <th style={thStyle(80)}>Unit Price</th>
              <th style={thStyle(80)}>Total</th>
              <th style={thStyle(100)}>Supplier</th>
              <th style={thStyle(30)}></th>
            </tr>
            {p.materials.map((m, i) => {
              const total = (m.qty || 0) * (m.unitPrice || 0);
              return (
                <tr key={m.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={{ ...calcCell, textAlign: "center", fontWeight: 400, color: "#9ca3af" }}>{i + 1}</td>
                  <Cell value={m.qty} onChange={v => updMat(m.id, "qty", +v)} type="number" align="right" w={46} />
                  <Cell value={m.unit} onChange={v => updMat(m.id, "unit", v)} w={46} />
                  <Cell value={m.manufacturer} onChange={v => updMat(m.id, "manufacturer", v)} w={100} />
                  <Cell value={m.partNumber} onChange={v => updMat(m.id, "partNumber", v)} w={90} />
                  <Cell value={m.description} onChange={v => updMat(m.id, "description", v)} />
                  <Cell value={m.unitPrice} onChange={v => updMat(m.id, "unitPrice", +v)} type="number" align="right" w={80} />
                  <td style={calcCell}>{fmt$(total)}</td>
                  <Cell value={m.supplier} onChange={v => updMat(m.id, "supplier", v)} w={100} />
                  <td style={{ ...cellBase, textAlign: "center", width: 30 }}>
                    <button onClick={() => delMat(m.id)} style={delBtnStyle}>×</button>
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={7} style={{ border: BORDER, padding: "4px 8px", background: "#fafafa" }}>
                <button onClick={addMat} style={addRowStyle}>+ Add Row</button>
              </td>
              <td style={totRow}>{fmt$(s.matCost)}</td>
              <td colSpan={2} style={{ ...totRow, textAlign: "left", color: "#059669", paddingLeft: 10 }}>
                Sell: {fmt$(s.matSell)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* LABOUR — ELECTRICIAN */}
        <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 16 }}>
          <tbody>
            <tr><td colSpan={7} style={sectionHdr}>LABOUR — ELECTRICIAN &nbsp;<span style={{ fontWeight: 400, fontSize: 11, opacity: 0.7 }}>Rate: {fmt$(p.settings.electricianRate)}/hr</span></td></tr>
            <tr>
              <th style={thStyle(28)}>#</th>
              <th style={{ ...thStyle(), minWidth: 220 }}>Description</th>
              <th style={thStyle(140)}>Time Type</th>
              <th style={thStyle(60)}>Hours</th>
              <th style={thStyle(80)}>Rate/hr</th>
              <th style={thStyle(90)}>Total</th>
              <th style={thStyle(30)}></th>
            </tr>
            {p.electricianLines.map((l, i) => {
              const rate = l.timeType === "1.5x Overtime" ? p.settings.electricianRate * 1.5
                : l.timeType === "Double Time" ? p.settings.electricianRate * 2
                : p.settings.electricianRate;
              const total = (l.hours || 0) * rate;
              return (
                <tr key={l.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={{ ...calcCell, textAlign: "center", fontWeight: 400, color: "#9ca3af" }}>{i + 1}</td>
                  <Cell value={l.description} onChange={v => updLabour("elec", l.id, "description", v)} />
                  <td style={cellBase}>
                    <select
                      value={l.timeType}
                      onChange={e => updLabour("elec", l.id, "timeType", e.target.value)}
                      style={{ ...cellInp, cursor: "pointer" }}
                    >
                      <option>Regular Time</option>
                      <option>1.5x Overtime</option>
                      <option>Double Time</option>
                    </select>
                  </td>
                  <Cell value={l.hours} onChange={v => updLabour("elec", l.id, "hours", +v)} type="number" align="right" w={60} />
                  <td style={calcCell}>{fmt$(rate)}</td>
                  <td style={calcCell}>{fmt$(total)}</td>
                  <td style={{ ...cellBase, textAlign: "center", width: 30 }}>
                    <button onClick={() => delLabour("elec", l.id)} style={delBtnStyle}>×</button>
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={3} style={{ border: BORDER, padding: "4px 8px", background: "#fafafa" }}>
                <button onClick={() => addLabour("elec")} style={addRowStyle}>+ Add Row</button>
              </td>
              <td style={totRow}>{s.elecHours} hrs</td>
              <td style={{ border: BORDER, background: "#f0f4ff" }}></td>
              <td style={totRow}>{fmt$(s.elecSell)}</td>
              <td style={{ border: BORDER, background: "#f0f4ff" }}></td>
            </tr>
          </tbody>
        </table>

        {/* LABOUR — PROGRAMMER */}
        <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 16 }}>
          <tbody>
            <tr><td colSpan={7} style={sectionHdr}>LABOUR — PROGRAMMER &nbsp;<span style={{ fontWeight: 400, fontSize: 11, opacity: 0.7 }}>Rate: {fmt$(p.settings.programmerRate)}/hr</span></td></tr>
            <tr>
              <th style={thStyle(28)}>#</th>
              <th style={{ ...thStyle(), minWidth: 220 }}>Description</th>
              <th style={thStyle(140)}>Time Type</th>
              <th style={thStyle(60)}>Hours</th>
              <th style={thStyle(80)}>Rate/hr</th>
              <th style={thStyle(90)}>Total</th>
              <th style={thStyle(30)}></th>
            </tr>
            {p.programmerLines.map((l, i) => {
              const rate = l.timeType === "1.5x Overtime" ? p.settings.programmerRate * 1.5
                : l.timeType === "Double Time" ? p.settings.programmerRate * 2
                : p.settings.programmerRate;
              const total = (l.hours || 0) * rate;
              return (
                <tr key={l.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={{ ...calcCell, textAlign: "center", fontWeight: 400, color: "#9ca3af" }}>{i + 1}</td>
                  <Cell value={l.description} onChange={v => updLabour("prog", l.id, "description", v)} />
                  <td style={cellBase}>
                    <select
                      value={l.timeType}
                      onChange={e => updLabour("prog", l.id, "timeType", e.target.value)}
                      style={{ ...cellInp, cursor: "pointer" }}
                    >
                      <option>Regular Time</option>
                      <option>1.5x Overtime</option>
                      <option>Double Time</option>
                    </select>
                  </td>
                  <Cell value={l.hours} onChange={v => updLabour("prog", l.id, "hours", +v)} type="number" align="right" w={60} />
                  <td style={calcCell}>{fmt$(rate)}</td>
                  <td style={calcCell}>{fmt$(total)}</td>
                  <td style={{ ...cellBase, textAlign: "center", width: 30 }}>
                    <button onClick={() => delLabour("prog", l.id)} style={delBtnStyle}>×</button>
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={3} style={{ border: BORDER, padding: "4px 8px", background: "#fafafa" }}>
                <button onClick={() => addLabour("prog")} style={addRowStyle}>+ Add Row</button>
              </td>
              <td style={totRow}>{s.progHours} hrs</td>
              <td style={{ border: BORDER, background: "#f0f4ff" }}></td>
              <td style={totRow}>{fmt$(s.progSell)}</td>
              <td style={{ border: BORDER, background: "#f0f4ff" }}></td>
            </tr>
          </tbody>
        </table>

        {/* OTHER COSTS */}
        <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 16 }}>
          <tbody>
            <tr><td colSpan={6} style={sectionHdr}>OTHER COSTS</td></tr>
            <tr>
              <th style={thStyle(28)}>#</th>
              <th style={{ ...thStyle(), minWidth: 200 }}>Description</th>
              <th style={thStyle(100)}>Cost</th>
              <th style={thStyle(90)}>Markup %</th>
              <th style={thStyle(100)}>Sell Price</th>
              <th style={thStyle(30)}></th>
            </tr>
            {p.otherCosts.map((o, i) => {
              const markup = o.markup ?? p.settings.otherCostsMarkup;
              const sell = (o.cost || 0) * (1 + markup);
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={{ ...calcCell, textAlign: "center", fontWeight: 400, color: "#9ca3af" }}>{i + 1}</td>
                  <Cell value={o.description} onChange={v => updOther(i, "description", v)} />
                  <Cell value={o.cost} onChange={v => updOther(i, "cost", +v)} type="number" align="right" w={100} />
                  <td style={cellBase}>
                    <input
                      type="number" step={0.1}
                      value={+(markup * 100).toFixed(1)}
                      onChange={e => updOther(i, "markup", +e.target.value / 100)}
                      style={{ ...cellInp, textAlign: "right" }}
                    />
                  </td>
                  <td style={calcCell}>{fmt$(sell)}</td>
                  <td style={{ ...cellBase, textAlign: "center", width: 30 }}>
                    <button onClick={() => delOther(i)} style={delBtnStyle}>×</button>
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={2} style={{ border: BORDER, padding: "4px 8px", background: "#fafafa" }}>
                <button onClick={addOther} style={addRowStyle}>+ Add Row</button>
              </td>
              <td style={totRow}>{fmt$(s.otherCost)}</td>
              <td style={{ border: BORDER, background: "#f0f4ff" }}></td>
              <td style={totRow}>{fmt$(s.otherSell)}</td>
              <td style={{ border: BORDER, background: "#f0f4ff" }}></td>
            </tr>
          </tbody>
        </table>

        {/* TRAVEL & SITE */}
        <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 16 }}>
          <tbody>
            <tr><td colSpan={7} style={sectionHdr}>TRAVEL & SITE</td></tr>
            <tr>
              <th style={thStyle()}>Workers</th>
              <th style={thStyle()}>Days On Site</th>
              <th style={thStyle()}>Travel Hrs/Trip</th>
              <th style={thStyle()}>Hrs/Day On Site</th>
              <th style={thStyle()}>KM/Day</th>
              <th style={thStyle()}>407 Charge ($)</th>
              <th style={thStyle()}>Travel Sell Total</th>
            </tr>
            <tr>
              <Cell value={p.travel.workers} onChange={v => updTravel("workers", +v)} type="number" align="right" />
              <Cell value={p.travel.days} onChange={v => updTravel("days", +v)} type="number" align="right" />
              <Cell value={p.travel.travelTimeHrs} onChange={v => updTravel("travelTimeHrs", +v)} type="number" align="right" />
              <Cell value={p.travel.hoursPerDay} onChange={v => updTravel("hoursPerDay", +v)} type="number" align="right" />
              <Cell value={p.travel.kmPerDay} onChange={v => updTravel("kmPerDay", +v)} type="number" align="right" />
              <Cell value={p.travel.charge407} onChange={v => updTravel("charge407", +v)} type="number" align="right" />
              <td style={totRow}>{fmt$(s.travelSell)}</td>
            </tr>
          </tbody>
        </table>

      </div>

      {/* ── RIGHT: Overview Panel ── */}
      <div style={{
        width: 260, flexShrink: 0,
        borderLeft: "1px solid #e5e7eb",
        paddingLeft: 16,
        overflowY: "auto",
        height: "100%",
        background: "#fff",
      }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#0d2e5e", marginBottom: 14, paddingBottom: 8, borderBottom: "2px solid #0d2e5e" }}>
          QUOTE OVERVIEW
        </div>

        <OvSection title="Rates">
          <RateField label="Electrician ($/hr)" value={p.settings.electricianRate} onChange={v => updS("electricianRate", v)} />
          <RateField label="Programmer ($/hr)"  value={p.settings.programmerRate}  onChange={v => updS("programmerRate", v)} />
          <RateField label="Travel ($/hr)"       value={p.settings.travelRate}      onChange={v => updS("travelRate", v)} />
          <RateField label="Mileage ($/km)"      value={p.settings.mileageRate}     onChange={v => updS("mileageRate", v)} />
        </OvSection>

        <OvSection title="Materials">
          <MkpField label="Markup %" pct={p.settings.materialMarkup} onChange={v => updS("materialMarkup", v)} />
          <OvRow label="Cost" value={fmt$(s.matCost)} sub />
          <OvRow label="Sell" value={fmt$(s.matSell)} sub />
        </OvSection>

        <OvSection title="Labour — Electrician">
          <OvRow label="Hours" value={`${s.elecHours} hrs`} sub />
          <OvRow label="Total Sell" value={fmt$(s.elecSell)} sub />
        </OvSection>

        <OvSection title="Labour — Programmer">
          <OvRow label="Hours" value={`${s.progHours} hrs`} sub />
          <OvRow label="Total Sell" value={fmt$(s.progSell)} sub />
        </OvSection>

        <OvSection title="Other Costs">
          <MkpField label="Default Markup %" pct={p.settings.otherCostsMarkup} onChange={v => updS("otherCostsMarkup", v)} />
          <OvRow label="Cost" value={fmt$(s.otherCost)} sub />
          <OvRow label="Sell" value={fmt$(s.otherSell)} sub />
        </OvSection>

        <OvSection title="Travel">
          <OvRow label="Travel Hrs" value={`${s.totalTravelHrs} hrs`} sub />
          <OvRow label="Sell" value={fmt$(s.travelSell)} sub />
        </OvSection>

        {/* Grand Total */}
        <div style={{ background: "#0d2e5e", borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "#93c5fd" }}>Materials</span>
            <span style={{ fontSize: 11, color: "#fff", fontWeight: 600 }}>{fmt$(s.matSell)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "#93c5fd" }}>Labour</span>
            <span style={{ fontSize: 11, color: "#fff", fontWeight: 600 }}>{fmt$(s.elecSell + s.progSell + s.travelSell)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: "#93c5fd" }}>Other Costs</span>
            <span style={{ fontSize: 11, color: "#fff", fontWeight: 600 }}>{fmt$(s.otherSell)}</span>
          </div>
          <div style={{ borderTop: "1px solid #1e3a6e", paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 14, color: "#fff", fontWeight: 800 }}>TOTAL</span>
            <span style={{ fontSize: 16, color: "#22d3ee", fontWeight: 900 }}>{fmt$(s.totalSell)}</span>
          </div>
        </div>

        {/* Profit */}
        <OvSection title="Profit Analysis">
          <OvSection title="">
            <MkpField label="Overhead %" pct={p.settings.overheadRate} onChange={v => updS("overheadRate", v)} />
            <MkpField label="Tax Rate %" pct={p.settings.taxRate}      onChange={v => updS("taxRate", v)} />
          </OvSection>
          <OvRow label="Total Cost" value={fmt$(s.totalCost)} />
          <OvRow label="Net Profit" value={fmt$(s.netProfit)} />
          <OvRow label="Margin %" value={`${(s.netMarginPct * 100).toFixed(1)}%`} />
          <OvRow label="After-Tax Profit" value={fmt$(s.afterTaxProfit)} sub />
        </OvSection>

        {saving && <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", marginTop: 8 }}>Saving…</div>}
      </div>
    </div>
  );
}
