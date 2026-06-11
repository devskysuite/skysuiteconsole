import { useCallback, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import {
  calcSummary,
  DEFAULT_PRICING,
  LabourLine,
  MaterialLine,
  PricingData,
  TravelData,
} from "./QuotePricingTab";

// ── Helpers ────────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }
function fmt$(n: number) {
  return "$" + (n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function blankMat(): MaterialLine {
  return { id: uid(), qty: 0, unit: "ea", manufacturer: "", partNumber: "", description: "", unitPrice: 0, supplier: "" };
}
function blankLabour(): LabourLine {
  return { id: uid(), hours: 0, description: "", timeType: "Regular Time" };
}

// Pre-populate blank rows so it looks like an Excel template from the start
const MAT_ROWS   = 20;
const ELEC_ROWS  = 10;
const PROG_ROWS  = 10;

function initPricing(raw: PricingData): PricingData {
  const p = { ...DEFAULT_PRICING, ...raw, settings: { ...DEFAULT_PRICING.settings, ...raw.settings } };
  // Pad up to template row counts if the arrays are shorter
  while (p.materials.length < MAT_ROWS)        p.materials        = [...p.materials,        blankMat()];
  while (p.electricianLines.length < ELEC_ROWS) p.electricianLines = [...p.electricianLines, blankLabour()];
  while (p.programmerLines.length < PROG_ROWS)  p.programmerLines  = [...p.programmerLines,  blankLabour()];
  return p;
}

// ── Cell Styles ────────────────────────────────────────────────────────────────
const B = "1px solid #d1d5db";

const cellBase: React.CSSProperties = { border: B, padding: 0, verticalAlign: "middle" };
const calcCell: React.CSSProperties = { border: B, background: "#f5f7fa", padding: "4px 8px", fontSize: 12, textAlign: "right", color: "#374151", fontWeight: 600, whiteSpace: "nowrap" };
const calcCellL: React.CSSProperties = { ...calcCell, textAlign: "left", color: "#6b7280", fontWeight: 400 };
const numCell: React.CSSProperties  = { ...calcCell, color: "#0d2e5e" };
const totCell: React.CSSProperties  = { border: B, background: "#e8f0fe", padding: "5px 8px", fontSize: 12, textAlign: "right", fontWeight: 800, color: "#1e3a8a", whiteSpace: "nowrap" };
const sectionHdr: React.CSSProperties = { background: "#0d2e5e", color: "#fff", fontWeight: 800, fontSize: 12, padding: "7px 12px", letterSpacing: 0.5, border: B };
const colHdr = (w?: number | string): React.CSSProperties => ({
  background: "#1e3a6e", color: "#cbd5e1", fontWeight: 700, fontSize: 11,
  padding: "5px 8px", textTransform: "uppercase", letterSpacing: 0.4,
  border: B, textAlign: "left", whiteSpace: "nowrap",
  width: w, minWidth: w,
});
const rowNum: React.CSSProperties = { ...calcCellL, textAlign: "center", color: "#9ca3af", width: 30, minWidth: 30, userSelect: "none" };
const delBtnSt: React.CSSProperties = { background: "none", border: "none", color: "#ef4444", fontSize: 14, cursor: "pointer", padding: "0 4px", display: "block", margin: "0 auto" };
const addRowSt: React.CSSProperties = { background: "none", border: "1px dashed #9ca3af", color: "#6b7280", borderRadius: 4, padding: "3px 14px", fontSize: 11, cursor: "pointer" };
const cellInp: React.CSSProperties = { width: "100%", height: "100%", padding: "4px 7px", border: "none", outline: "none", background: "transparent", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box" };

function Cell({ value, onChange, type = "text", align = "left", w }: {
  value: string | number; onChange: (v: string) => void;
  type?: string; align?: "left" | "right" | "center"; w?: number | string;
}) {
  return (
    <td style={{ ...cellBase, width: w, minWidth: w }}>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        style={{ ...cellInp, textAlign: align }} step={type === "number" ? "any" : undefined} />
    </td>
  );
}

function SelectCell({ value, onChange, options, w }: { value: string; onChange: (v: string) => void; options: string[]; w?: number | string }) {
  return (
    <td style={{ ...cellBase, width: w, minWidth: w }}>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ ...cellInp, cursor: "pointer" }}>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </td>
  );
}

// ── Summary footer bar ─────────────────────────────────────────────────────────
function SummaryBar({ s }: { s: ReturnType<typeof calcSummary> }) {
  const item = (label: string, value: string, accent?: boolean) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 18px", borderRight: "1px solid #1e3a6e" }}>
      <span style={{ fontSize: 10, color: "#93c5fd", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 900, color: accent ? "#22d3ee" : "#fff", marginTop: 1 }}>{value}</span>
    </div>
  );
  return (
    <div style={{ position: "sticky", bottom: 0, background: "#0d2e5e", display: "flex", alignItems: "center", padding: "8px 0", zIndex: 10, borderTop: "2px solid #1e40af" }}>
      {item("Materials", fmt$(s.matSell))}
      {item("Electrician", fmt$(s.elecSell))}
      {item("Programmer", fmt$(s.progSell))}
      {item("Other Costs", fmt$(s.otherSell))}
      {item("Travel", fmt$(s.travelSell))}
      <div style={{ flex: 1 }} />
      {item("Net Profit", fmt$(s.netProfit))}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 20px" }}>
        <span style={{ fontSize: 10, color: "#93c5fd", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Total Quote</span>
        <span style={{ fontSize: 18, fontWeight: 900, color: "#22d3ee", marginTop: 1 }}>{fmt$(s.totalSell)}</span>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function QuoteOverviewTab({ quoteId, pricing: raw }: { quoteId: string; pricing: PricingData }) {
  const [p, setP] = useState<PricingData>(() => initPricing(raw));
  const [saving, setSaving] = useState(false);

  const save = useCallback(async (data: PricingData) => {
    setSaving(true);
    try { await updateDoc(doc(db, "quotes", quoteId), { pricing: data }); } finally { setSaving(false); }
  }, [quoteId]);

  function upd(next: PricingData) { setP(next); save(next); }

  // Materials
  function addMat() { upd({ ...p, materials: [...p.materials, blankMat()] }); }
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
  const TIME_TYPES = ["Regular Time", "1.5x Overtime", "Double Time"];
  function addLabour(role: "elec" | "prog") {
    const key = role === "elec" ? "electricianLines" : "programmerLines";
    upd({ ...p, [key]: [...p[key], blankLabour()] });
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

  const tbl: React.CSSProperties = { borderCollapse: "collapse", width: "100%", tableLayout: "auto" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 160px)", overflow: "hidden" }}>
      {/* Saving indicator */}
      {saving && <div style={{ position: "absolute", top: 8, right: 16, fontSize: 11, color: "#9ca3af", zIndex: 20 }}>Saving…</div>}

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>

        {/* ── MATERIALS ── */}
        <table style={tbl}>
          <tbody>
            <tr><td colSpan={11} style={sectionHdr}>MATERIALS &nbsp;<span style={{ fontWeight:400, fontSize:11, opacity:0.7 }}>Markup: {(p.settings.materialMarkup*100).toFixed(0)}%</span></td></tr>
            <tr>
              <th style={colHdr(30)}>#</th>
              <th style={colHdr(50)}>Qty</th>
              <th style={colHdr(50)}>Unit</th>
              <th style={colHdr(110)}>Manufacturer</th>
              <th style={colHdr(100)}>Part #</th>
              <th style={{ ...colHdr(), minWidth: 240 }}>Description</th>
              <th style={colHdr(90)}>Unit Price</th>
              <th style={colHdr(95)}>Total Cost</th>
              <th style={colHdr(95)}>Sell Price</th>
              <th style={colHdr(110)}>Supplier</th>
              <th style={colHdr(30)}></th>
            </tr>
            {p.materials.map((m, i) => {
              const cost = (m.qty || 0) * (m.unitPrice || 0);
              const sell = cost * (1 + p.settings.materialMarkup);
              return (
                <tr key={m.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                  <td style={rowNum}>{i + 1}</td>
                  <Cell value={m.qty || ""} onChange={v => updMat(m.id, "qty", +v || 0)} type="number" align="right" w={50} />
                  <Cell value={m.unit} onChange={v => updMat(m.id, "unit", v)} w={50} />
                  <Cell value={m.manufacturer} onChange={v => updMat(m.id, "manufacturer", v)} w={110} />
                  <Cell value={m.partNumber} onChange={v => updMat(m.id, "partNumber", v)} w={100} />
                  <Cell value={m.description} onChange={v => updMat(m.id, "description", v)} />
                  <Cell value={m.unitPrice || ""} onChange={v => updMat(m.id, "unitPrice", +v || 0)} type="number" align="right" w={90} />
                  <td style={cost > 0 ? numCell : calcCell}>{cost > 0 ? fmt$(cost) : ""}</td>
                  <td style={sell > 0 ? { ...numCell, color:"#059669" } : calcCell}>{sell > 0 ? fmt$(sell) : ""}</td>
                  <Cell value={m.supplier} onChange={v => updMat(m.id, "supplier", v)} w={110} />
                  <td style={{ ...cellBase, textAlign: "center", width: 30 }}>
                    <button onClick={() => delMat(m.id)} style={delBtnSt}>×</button>
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={7} style={{ border: B, padding: "5px 10px", background: "#f5f7fa" }}>
                <button onClick={addMat} style={addRowSt}>+ Add Row</button>
              </td>
              <td style={totCell}>{fmt$(s.matCost)}</td>
              <td style={{ ...totCell, color: "#059669" }}>{fmt$(s.matSell)}</td>
              <td colSpan={2} style={{ border: B, background: "#f5f7fa" }}></td>
            </tr>
          </tbody>
        </table>

        {/* ── LABOUR — ELECTRICIAN ── */}
        <table style={{ ...tbl, marginTop: 12 }}>
          <tbody>
            <tr><td colSpan={8} style={sectionHdr}>
              LABOUR — ELECTRICIAN &nbsp;
              <span style={{ fontWeight:400, fontSize:11, opacity:0.7 }}>
                Regular: {fmt$(p.settings.electricianRate)}/hr &nbsp;|&nbsp; OT: {fmt$(p.settings.electricianRate * 1.5)}/hr &nbsp;|&nbsp; DT: {fmt$(p.settings.electricianRate * 2)}/hr
              </span>
            </td></tr>
            <tr>
              <th style={colHdr(30)}>#</th>
              <th style={{ ...colHdr(), minWidth: 280 }}>Description</th>
              <th style={colHdr(150)}>Time Type</th>
              <th style={colHdr(70)}>Hours</th>
              <th style={colHdr(90)}>Rate/hr</th>
              <th style={colHdr(95)}>Cost</th>
              <th style={colHdr(95)}>Sell</th>
              <th style={colHdr(30)}></th>
            </tr>
            {p.electricianLines.map((l, i) => {
              const rate = l.timeType === "1.5x Overtime" ? p.settings.electricianRate * 1.5
                : l.timeType === "Double Time" ? p.settings.electricianRate * 2 : p.settings.electricianRate;
              const intRate = l.timeType === "1.5x Overtime" ? p.settings.electricianInternalRate * 1.5
                : l.timeType === "Double Time" ? p.settings.electricianInternalRate * 2 : p.settings.electricianInternalRate;
              const sell = (l.hours || 0) * rate;
              const cost = (l.hours || 0) * intRate;
              return (
                <tr key={l.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                  <td style={rowNum}>{i + 1}</td>
                  <Cell value={l.description} onChange={v => updLabour("elec", l.id, "description", v)} />
                  <SelectCell value={l.timeType} onChange={v => updLabour("elec", l.id, "timeType", v)} options={TIME_TYPES} w={150} />
                  <Cell value={l.hours || ""} onChange={v => updLabour("elec", l.id, "hours", +v || 0)} type="number" align="right" w={70} />
                  <td style={calcCell}>{fmt$(rate)}</td>
                  <td style={cost > 0 ? numCell : calcCell}>{cost > 0 ? fmt$(cost) : ""}</td>
                  <td style={sell > 0 ? { ...numCell, color:"#059669" } : calcCell}>{sell > 0 ? fmt$(sell) : ""}</td>
                  <td style={{ ...cellBase, textAlign: "center", width: 30 }}>
                    <button onClick={() => delLabour("elec", l.id)} style={delBtnSt}>×</button>
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={3} style={{ border: B, padding: "5px 10px", background: "#f5f7fa" }}>
                <button onClick={() => addLabour("elec")} style={addRowSt}>+ Add Row</button>
              </td>
              <td style={totCell}>{s.elecHours} hrs</td>
              <td style={{ border: B, background: "#f5f7fa" }}></td>
              <td style={totCell}>{fmt$(s.elecCost)}</td>
              <td style={{ ...totCell, color:"#059669" }}>{fmt$(s.elecSell)}</td>
              <td style={{ border: B, background: "#f5f7fa" }}></td>
            </tr>
          </tbody>
        </table>

        {/* ── LABOUR — PROGRAMMER ── */}
        <table style={{ ...tbl, marginTop: 12 }}>
          <tbody>
            <tr><td colSpan={8} style={sectionHdr}>
              LABOUR — PROGRAMMER &nbsp;
              <span style={{ fontWeight:400, fontSize:11, opacity:0.7 }}>
                Regular: {fmt$(p.settings.programmerRate)}/hr &nbsp;|&nbsp; OT: {fmt$(p.settings.programmerRate * 1.5)}/hr &nbsp;|&nbsp; DT: {fmt$(p.settings.programmerRate * 2)}/hr
              </span>
            </td></tr>
            <tr>
              <th style={colHdr(30)}>#</th>
              <th style={{ ...colHdr(), minWidth: 280 }}>Description</th>
              <th style={colHdr(150)}>Time Type</th>
              <th style={colHdr(70)}>Hours</th>
              <th style={colHdr(90)}>Rate/hr</th>
              <th style={colHdr(95)}>Cost</th>
              <th style={colHdr(95)}>Sell</th>
              <th style={colHdr(30)}></th>
            </tr>
            {p.programmerLines.map((l, i) => {
              const rate = l.timeType === "1.5x Overtime" ? p.settings.programmerRate * 1.5
                : l.timeType === "Double Time" ? p.settings.programmerRate * 2 : p.settings.programmerRate;
              const intRate = l.timeType === "1.5x Overtime" ? p.settings.programmerInternalRate * 1.5
                : l.timeType === "Double Time" ? p.settings.programmerInternalRate * 2 : p.settings.programmerInternalRate;
              const sell = (l.hours || 0) * rate;
              const cost = (l.hours || 0) * intRate;
              return (
                <tr key={l.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                  <td style={rowNum}>{i + 1}</td>
                  <Cell value={l.description} onChange={v => updLabour("prog", l.id, "description", v)} />
                  <SelectCell value={l.timeType} onChange={v => updLabour("prog", l.id, "timeType", v)} options={TIME_TYPES} w={150} />
                  <Cell value={l.hours || ""} onChange={v => updLabour("prog", l.id, "hours", +v || 0)} type="number" align="right" w={70} />
                  <td style={calcCell}>{fmt$(rate)}</td>
                  <td style={cost > 0 ? numCell : calcCell}>{cost > 0 ? fmt$(cost) : ""}</td>
                  <td style={sell > 0 ? { ...numCell, color:"#059669" } : calcCell}>{sell > 0 ? fmt$(sell) : ""}</td>
                  <td style={{ ...cellBase, textAlign: "center", width: 30 }}>
                    <button onClick={() => delLabour("prog", l.id)} style={delBtnSt}>×</button>
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={3} style={{ border: B, padding: "5px 10px", background: "#f5f7fa" }}>
                <button onClick={() => addLabour("prog")} style={addRowSt}>+ Add Row</button>
              </td>
              <td style={totCell}>{s.progHours} hrs</td>
              <td style={{ border: B, background: "#f5f7fa" }}></td>
              <td style={totCell}>{fmt$(s.progCost)}</td>
              <td style={{ ...totCell, color:"#059669" }}>{fmt$(s.progSell)}</td>
              <td style={{ border: B, background: "#f5f7fa" }}></td>
            </tr>
          </tbody>
        </table>

        {/* ── OTHER COSTS ── */}
        <table style={{ ...tbl, marginTop: 12 }}>
          <tbody>
            <tr><td colSpan={7} style={sectionHdr}>OTHER COSTS</td></tr>
            <tr>
              <th style={colHdr(30)}>#</th>
              <th style={{ ...colHdr(), minWidth: 260 }}>Description</th>
              <th style={colHdr(110)}>Cost</th>
              <th style={colHdr(100)}>Markup %</th>
              <th style={colHdr(110)}>Sell Price</th>
              <th style={colHdr(30)}></th>
            </tr>
            {p.otherCosts.map((o, i) => {
              const markup = o.markup ?? p.settings.otherCostsMarkup;
              const sell = (o.cost || 0) * (1 + markup);
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                  <td style={rowNum}>{i + 1}</td>
                  <Cell value={o.description} onChange={v => updOther(i, "description", v)} />
                  <Cell value={o.cost || ""} onChange={v => updOther(i, "cost", +v || 0)} type="number" align="right" w={110} />
                  <td style={cellBase}>
                    <input type="number" step={0.1}
                      value={+(markup * 100).toFixed(1)}
                      onChange={e => updOther(i, "markup", +e.target.value / 100)}
                      style={{ ...cellInp, textAlign: "right" }} />
                  </td>
                  <td style={sell > 0 ? { ...numCell, color:"#059669" } : calcCell}>{sell > 0 ? fmt$(sell) : ""}</td>
                  <td style={{ ...cellBase, textAlign: "center", width: 30 }}>
                    <button onClick={() => delOther(i)} style={delBtnSt}>×</button>
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={2} style={{ border: B, padding: "5px 10px", background: "#f5f7fa" }}>
                <button onClick={addOther} style={addRowSt}>+ Add Row</button>
              </td>
              <td style={totCell}>{fmt$(s.otherCost)}</td>
              <td style={{ border: B, background: "#f5f7fa" }}></td>
              <td style={{ ...totCell, color:"#059669" }}>{fmt$(s.otherSell)}</td>
              <td style={{ border: B, background: "#f5f7fa" }}></td>
            </tr>
          </tbody>
        </table>

        {/* ── TRAVEL & SITE ── */}
        <table style={{ ...tbl, marginTop: 12, marginBottom: 0 }}>
          <tbody>
            <tr><td colSpan={8} style={sectionHdr}>TRAVEL & SITE</td></tr>
            <tr>
              <th style={colHdr()}>Workers</th>
              <th style={colHdr()}>Days On Site</th>
              <th style={colHdr()}>Travel Hrs/Trip</th>
              <th style={colHdr()}>KM/Day</th>
              <th style={colHdr()}>407 Charge ($)</th>
              <th style={colHdr()}>Total Travel Hrs</th>
              <th style={colHdr()}>Travel Sell</th>
            </tr>
            <tr style={{ background: "#fff" }}>
              <Cell value={p.travel.workers || ""} onChange={v => updTravel("workers", +v || 0)} type="number" align="right" />
              <Cell value={p.travel.days || ""} onChange={v => updTravel("days", +v || 0)} type="number" align="right" />
              <Cell value={p.travel.travelTimeHrs || ""} onChange={v => updTravel("travelTimeHrs", +v || 0)} type="number" align="right" />
              <Cell value={p.travel.kmPerDay || ""} onChange={v => updTravel("kmPerDay", +v || 0)} type="number" align="right" />
              <Cell value={p.travel.charge407 || ""} onChange={v => updTravel("charge407", +v || 0)} type="number" align="right" />
              <td style={numCell}>{s.totalTravelHrs} hrs</td>
              <td style={{ ...totCell, color:"#059669" }}>{fmt$(s.travelSell)}</td>
            </tr>
          </tbody>
        </table>

      </div>

      {/* ── Sticky bottom summary bar ── */}
      <SummaryBar s={s} />
    </div>
  );
}
