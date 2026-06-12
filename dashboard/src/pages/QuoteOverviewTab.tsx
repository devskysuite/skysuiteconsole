import { useCallback, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import {
  blankSection,
  calcSectionTotals,
  calcSummary,
  DEFAULT_PRICING,
  LabourLine,
  MaterialLine,
  OtherCostLine,
  PricingData,
  PricingSettings,
  QuoteSection,
  TravelData,
  labourRate,
  labourInternalRate,
  migratePricing,
} from "./QuotePricingTab";

// ── Helpers ────────────────────────────────────────────────────────────────────
function rndId() { return Math.random().toString(36).slice(2, 10); }
function fmt$(n: number) {
  return "$" + (n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function blankMat(): MaterialLine {
  return { id: rndId(), qty: 0, unit: "ea", manufacturer: "", partNumber: "", description: "", unitPrice: 0, supplier: "" };
}
function blankLabour(): LabourLine {
  return { id: rndId(), hours: 0, description: "", timeType: "Regular Time" };
}

// Ensure each section has at least the template row counts
const MAT_ROWS  = 20;
const ELEC_ROWS = 10;
const PROG_ROWS = 10;

function padSection(sec: QuoteSection): QuoteSection {
  const materials        = sec.materials.length        >= MAT_ROWS  ? sec.materials        : [...sec.materials,        ...Array.from({ length: MAT_ROWS  - sec.materials.length },        blankMat)];
  const electricianLines = sec.electricianLines.length >= ELEC_ROWS ? sec.electricianLines : [...sec.electricianLines, ...Array.from({ length: ELEC_ROWS - sec.electricianLines.length }, blankLabour)];
  const programmerLines  = sec.programmerLines.length  >= PROG_ROWS ? sec.programmerLines  : [...sec.programmerLines,  ...Array.from({ length: PROG_ROWS  - sec.programmerLines.length  }, blankLabour)];
  return { ...sec, materials, electricianLines, programmerLines };
}

function initPricing(raw: PricingData): PricingData {
  const p = migratePricing(raw);
  return { ...p, sections: p.sections.map(padSection) };
}

// ── Cell Styles ────────────────────────────────────────────────────────────────
const B = "1px solid #d1d5db";
const cellBase: React.CSSProperties = { border: B, padding: 0, verticalAlign: "middle" };
const calcCell: React.CSSProperties = { border: B, background: "#f5f7fa", padding: "4px 8px", fontSize: 12, textAlign: "right", color: "#374151", fontWeight: 600, whiteSpace: "nowrap" };
const numCell: React.CSSProperties  = { ...calcCell, color: "#0d2e5e" };
const greenCell: React.CSSProperties = { ...numCell, color: "#059669" };
const totCell: React.CSSProperties  = { border: B, background: "#e8f0fe", padding: "5px 8px", fontSize: 12, textAlign: "right", fontWeight: 800, color: "#1e3a8a", whiteSpace: "nowrap" };
const rowNum: React.CSSProperties   = { border: B, background: "#f5f7fa", padding: "4px 6px", textAlign: "center", fontSize: 11, color: "#9ca3af", width: 30, minWidth: 30, userSelect: "none" };
const subHdr = (w?: number | string): React.CSSProperties => ({
  background: "#334155", color: "#cbd5e1", fontWeight: 700, fontSize: 11,
  padding: "5px 8px", textTransform: "uppercase", letterSpacing: 0.4,
  border: B, textAlign: "left", whiteSpace: "nowrap", width: w, minWidth: w,
});
const cellInp: React.CSSProperties = { width: "100%", height: "100%", padding: "4px 7px", border: "none", outline: "none", background: "transparent", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box", color: "#111827", WebkitTextFillColor: "#111827" };
const delBtnSt: React.CSSProperties = { background: "none", border: "none", color: "#ef4444", fontSize: 14, cursor: "pointer", padding: "0 4px", display: "block", margin: "0 auto" };
const addRowSt: React.CSSProperties = { background: "none", border: "1px dashed #94a3b8", color: "#64748b", borderRadius: 4, padding: "3px 14px", fontSize: 11, cursor: "pointer" };

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

function SelCell({ value, onChange, options, w }: { value: string; onChange: (v: string) => void; options: string[]; w?: number | string }) {
  return (
    <td style={{ ...cellBase, width: w, minWidth: w }}>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ ...cellInp, cursor: "pointer" }}>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
    </td>
  );
}

const TIME_TYPES = ["Regular Time", "1.5x Overtime", "Double Time"];

// ── Section tables ─────────────────────────────────────────────────────────────
function MaterialsTable({ sec, settings, onChange }: {
  sec: QuoteSection;
  settings: PricingSettings;
  onChange: (updated: QuoteSection) => void;
}) {
  const tbl: React.CSSProperties = { borderCollapse: "collapse", width: "100%", tableLayout: "auto" };

  function updMat(id: string, k: keyof MaterialLine, v: string | number) {
    onChange({ ...sec, materials: sec.materials.map(m => m.id === id ? { ...m, [k]: v } : m) });
  }
  function delMat(id: string) { onChange({ ...sec, materials: sec.materials.filter(m => m.id !== id) }); }
  function addMat() { onChange({ ...sec, materials: [...sec.materials, blankMat()] }); }

  const matCost = sec.materials.reduce((s, m) => s + (m.qty || 0) * (m.unitPrice || 0), 0);
  const matSell = matCost * (1 + settings.materialMarkup);

  return (
    <table style={tbl}>
      <tbody>
        <tr>
          <td colSpan={11} style={{ background: "#1e293b", color: "#94a3b8", fontWeight: 700, fontSize: 11, padding: "5px 12px", letterSpacing: 0.5, border: B, textTransform: "uppercase" }}>
            Materials &nbsp;<span style={{ opacity: 0.6, fontWeight: 400 }}>Markup {(settings.materialMarkup * 100).toFixed(0)}%</span>
          </td>
        </tr>
        <tr>
          <th style={subHdr(30)}>#</th>
          <th style={subHdr(52)}>Qty</th>
          <th style={subHdr(52)}>Unit</th>
          <th style={subHdr(110)}>Manufacturer</th>
          <th style={subHdr(100)}>Part #</th>
          <th style={{ ...subHdr(), minWidth: 220 }}>Description</th>
          <th style={subHdr(90)}>Unit Price</th>
          <th style={subHdr(95)}>Cost</th>
          <th style={subHdr(95)}>Sell</th>
          <th style={subHdr(110)}>Supplier</th>
          <th style={subHdr(30)}></th>
        </tr>
        {sec.materials.map((m, i) => {
          const cost = (m.qty || 0) * (m.unitPrice || 0);
          const sell = cost * (1 + settings.materialMarkup);
          return (
            <tr key={m.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
              <td style={rowNum}>{i + 1}</td>
              <Cell value={m.qty || ""} onChange={v => updMat(m.id, "qty", +v || 0)} type="number" align="right" w={52} />
              <Cell value={m.unit} onChange={v => updMat(m.id, "unit", v)} w={52} />
              <Cell value={m.manufacturer} onChange={v => updMat(m.id, "manufacturer", v)} w={110} />
              <Cell value={m.partNumber} onChange={v => updMat(m.id, "partNumber", v)} w={100} />
              <Cell value={m.description} onChange={v => updMat(m.id, "description", v)} />
              <Cell value={m.unitPrice || ""} onChange={v => updMat(m.id, "unitPrice", +v || 0)} type="number" align="right" w={90} />
              <td style={cost > 0 ? numCell : calcCell}>{cost > 0 ? fmt$(cost) : ""}</td>
              <td style={sell > 0 ? greenCell : calcCell}>{sell > 0 ? fmt$(sell) : ""}</td>
              <Cell value={m.supplier} onChange={v => updMat(m.id, "supplier", v)} w={110} />
              <td style={{ ...cellBase, textAlign: "center", width: 30 }}><button onClick={() => delMat(m.id)} style={delBtnSt}>×</button></td>
            </tr>
          );
        })}
        <tr>
          <td colSpan={7} style={{ border: B, padding: "5px 10px", background: "#f8fafc" }}>
            <button onClick={addMat} style={addRowSt}>+ Add Row</button>
          </td>
          <td style={totCell}>{matCost > 0 ? fmt$(matCost) : ""}</td>
          <td style={{ ...totCell, color: "#059669" }}>{matSell > 0 ? fmt$(matSell) : ""}</td>
          <td colSpan={2} style={{ border: B, background: "#f8fafc" }}></td>
        </tr>
      </tbody>
    </table>
  );
}

function LabourTable({ sec, role, settings, onChange }: {
  sec: QuoteSection;
  role: "elec" | "prog";
  settings: PricingSettings;
  onChange: (updated: QuoteSection) => void;
}) {
  const lines    = role === "elec" ? sec.electricianLines : sec.programmerLines;
  const lineKey  = role === "elec" ? "electricianLines" : "programmerLines";
  const baseRate = role === "elec" ? settings.electricianRate : settings.programmerRate;
  const label    = role === "elec" ? "Labour — Electrician" : "Labour — Programmer";
  const tbl: React.CSSProperties = { borderCollapse: "collapse", width: "100%", marginTop: 2 };

  function updLine(id: string, k: keyof LabourLine, v: string | number) {
    onChange({ ...sec, [lineKey]: lines.map(l => l.id === id ? { ...l, [k]: v } : l) });
  }
  function delLine(id: string) { onChange({ ...sec, [lineKey]: lines.filter(l => l.id !== id) }); }
  function addLine() { onChange({ ...sec, [lineKey]: [...lines, blankLabour()] }); }

  const totalHours = lines.reduce((s, l) => s + (l.hours || 0), 0);
  const totalSell  = lines.reduce((s, l) => s + (l.hours || 0) * labourRate(settings, role, l.timeType), 0);
  const totalCost  = lines.reduce((s, l) => s + (l.hours || 0) * labourInternalRate(settings, role, l.timeType), 0);

  return (
    <table style={tbl}>
      <tbody>
        <tr>
          <td colSpan={8} style={{ background: "#1e293b", color: "#94a3b8", fontWeight: 700, fontSize: 11, padding: "5px 12px", letterSpacing: 0.5, border: B, textTransform: "uppercase" }}>
            {label} &nbsp;
            <span style={{ opacity: 0.6, fontWeight: 400 }}>
              RT: {fmt$(baseRate)}/hr &nbsp;|&nbsp; OT: {fmt$(baseRate * 1.5)}/hr &nbsp;|&nbsp; DT: {fmt$(baseRate * 2)}/hr
            </span>
          </td>
        </tr>
        <tr>
          <th style={subHdr(30)}>#</th>
          <th style={{ ...subHdr(), minWidth: 260 }}>Description</th>
          <th style={subHdr(150)}>Time Type</th>
          <th style={subHdr(70)}>Hours</th>
          <th style={subHdr(90)}>Rate/hr</th>
          <th style={subHdr(95)}>Cost</th>
          <th style={subHdr(95)}>Sell</th>
          <th style={subHdr(30)}></th>
        </tr>
        {lines.map((l, i) => {
          const rate    = labourRate(settings, role, l.timeType);
          const intRate = labourInternalRate(settings, role, l.timeType);
          const sell    = (l.hours || 0) * rate;
          const cost    = (l.hours || 0) * intRate;
          return (
            <tr key={l.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
              <td style={rowNum}>{i + 1}</td>
              <Cell value={l.description} onChange={v => updLine(l.id, "description", v)} />
              <SelCell value={l.timeType} onChange={v => updLine(l.id, "timeType", v)} options={TIME_TYPES} w={150} />
              <Cell value={l.hours || ""} onChange={v => updLine(l.id, "hours", +v || 0)} type="number" align="right" w={70} />
              <td style={calcCell}>{fmt$(rate)}</td>
              <td style={cost > 0 ? numCell : calcCell}>{cost > 0 ? fmt$(cost) : ""}</td>
              <td style={sell > 0 ? greenCell : calcCell}>{sell > 0 ? fmt$(sell) : ""}</td>
              <td style={{ ...cellBase, textAlign: "center", width: 30 }}><button onClick={() => delLine(l.id)} style={delBtnSt}>×</button></td>
            </tr>
          );
        })}
        <tr>
          <td colSpan={3} style={{ border: B, padding: "5px 10px", background: "#f8fafc" }}>
            <button onClick={addLine} style={addRowSt}>+ Add Row</button>
          </td>
          <td style={totCell}>{totalHours > 0 ? `${totalHours} hrs` : ""}</td>
          <td style={{ border: B, background: "#f8fafc" }}></td>
          <td style={totCell}>{totalCost > 0 ? fmt$(totalCost) : ""}</td>
          <td style={{ ...totCell, color: "#059669" }}>{totalSell > 0 ? fmt$(totalSell) : ""}</td>
          <td style={{ border: B, background: "#f8fafc" }}></td>
        </tr>
      </tbody>
    </table>
  );
}

function OtherCostsTable({ sec, settings, onChange }: {
  sec: QuoteSection; settings: PricingSettings; onChange: (updated: QuoteSection) => void;
}) {
  const tbl: React.CSSProperties = { borderCollapse: "collapse", width: "100%", marginTop: 2 };

  function updOther(i: number, k: string, v: string | number) {
    const oc = [...sec.otherCosts]; oc[i] = { ...oc[i], [k]: v };
    onChange({ ...sec, otherCosts: oc });
  }
  function delOther(i: number) { onChange({ ...sec, otherCosts: sec.otherCosts.filter((_, idx) => idx !== i) }); }
  function addOther() { onChange({ ...sec, otherCosts: [...sec.otherCosts, { description: "", cost: 0, markup: settings.otherCostsMarkup }] }); }

  const totalCost = sec.otherCosts.reduce((s, o) => s + (o.cost || 0), 0);
  const totalSell = sec.otherCosts.reduce((s, o) => s + (o.cost || 0) * (1 + (o.markup ?? settings.otherCostsMarkup)), 0);

  return (
    <table style={tbl}>
      <tbody>
        <tr>
          <td colSpan={6} style={{ background: "#1e293b", color: "#94a3b8", fontWeight: 700, fontSize: 11, padding: "5px 12px", letterSpacing: 0.5, border: B, textTransform: "uppercase" }}>
            Other Costs
          </td>
        </tr>
        <tr>
          <th style={subHdr(30)}>#</th>
          <th style={{ ...subHdr(), minWidth: 240 }}>Description</th>
          <th style={subHdr(110)}>Cost</th>
          <th style={subHdr(100)}>Markup %</th>
          <th style={subHdr(110)}>Sell Price</th>
          <th style={subHdr(30)}></th>
        </tr>
        {sec.otherCosts.map((o, i) => {
          const markup = o.markup ?? settings.otherCostsMarkup;
          const sell   = (o.cost || 0) * (1 + markup);
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
              <td style={sell > 0 ? greenCell : calcCell}>{sell > 0 ? fmt$(sell) : ""}</td>
              <td style={{ ...cellBase, textAlign: "center", width: 30 }}><button onClick={() => delOther(i)} style={delBtnSt}>×</button></td>
            </tr>
          );
        })}
        <tr>
          <td colSpan={2} style={{ border: B, padding: "5px 10px", background: "#f8fafc" }}>
            <button onClick={addOther} style={addRowSt}>+ Add Row</button>
          </td>
          <td style={totCell}>{totalCost > 0 ? fmt$(totalCost) : ""}</td>
          <td style={{ border: B, background: "#f8fafc" }}></td>
          <td style={{ ...totCell, color: "#059669" }}>{totalSell > 0 ? fmt$(totalSell) : ""}</td>
          <td style={{ border: B, background: "#f8fafc" }}></td>
        </tr>
      </tbody>
    </table>
  );
}

function TravelTable({ sec, settings, onChange }: {
  sec: QuoteSection; settings: PricingSettings; onChange: (updated: QuoteSection) => void;
}) {
  function updT(k: keyof TravelData, v: number) { onChange({ ...sec, travel: { ...sec.travel, [k]: v } }); }
  const t = sec.travel;
  const totalHrs  = (t.workers || 1) * (t.days || 0) * (t.travelTimeHrs || 1);
  const travelSell = totalHrs * settings.travelRate + (t.kmPerDay || 0) * (t.days || 0) * settings.mileageRate + (t.charge407 || 0);

  return (
    <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 2 }}>
      <tbody>
        <tr>
          <td colSpan={7} style={{ background: "#1e293b", color: "#94a3b8", fontWeight: 700, fontSize: 11, padding: "5px 12px", letterSpacing: 0.5, border: B, textTransform: "uppercase" }}>
            Travel & Site
          </td>
        </tr>
        <tr>
          <th style={subHdr()}>Workers</th>
          <th style={subHdr()}>Days On Site</th>
          <th style={subHdr()}>Travel Hrs/Trip</th>
          <th style={subHdr()}>KM/Day</th>
          <th style={subHdr()}>407 Charge ($)</th>
          <th style={subHdr()}>Total Travel Hrs</th>
          <th style={subHdr()}>Travel Sell</th>
        </tr>
        <tr style={{ background: "#fff" }}>
          <Cell value={t.workers || ""} onChange={v => updT("workers", +v || 0)} type="number" align="right" />
          <Cell value={t.days || ""} onChange={v => updT("days", +v || 0)} type="number" align="right" />
          <Cell value={t.travelTimeHrs || ""} onChange={v => updT("travelTimeHrs", +v || 0)} type="number" align="right" />
          <Cell value={t.kmPerDay || ""} onChange={v => updT("kmPerDay", +v || 0)} type="number" align="right" />
          <Cell value={t.charge407 || ""} onChange={v => updT("charge407", +v || 0)} type="number" align="right" />
          <td style={totalHrs > 0 ? numCell : calcCell}>{totalHrs > 0 ? `${totalHrs} hrs` : ""}</td>
          <td style={travelSell > 0 ? { ...totCell, color: "#059669" } : totCell}>{travelSell > 0 ? fmt$(travelSell) : ""}</td>
        </tr>
      </tbody>
    </table>
  );
}

// ── Override panel ─────────────────────────────────────────────────────────────
function OverridePanel({ p, onChange }: { p: PricingData; onChange: (k: string, v: number) => void }) {
  const f = (label: string, key: string, isPct?: boolean) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        {!isPct && <span style={{ fontSize: 11, color: "#64748b" }}>$</span>}
        <input type="number" step="any"
          value={isPct ? +((p.settings as any)[key] * 100).toFixed(2) : (p.settings as any)[key]}
          onChange={e => onChange(key, isPct ? +e.target.value / 100 : +e.target.value)}
          style={{ width: 72, padding: "4px 6px", border: "1px solid #475569", borderRadius: 5, fontSize: 12, background: "#f8fafc", color: "#0f172a", textAlign: "right", outline: "none" }}
        />
        {isPct && <span style={{ fontSize: 11, color: "#64748b" }}>%</span>}
      </div>
    </div>
  );
  return (
    <div style={{ background: "#0f172a", padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 20, borderBottom: "1px solid #1e293b" }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 800, color: "#38bdf8", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>Labour Rates</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {f("Elec $/hr", "electricianRate")}
          {f("Prog $/hr", "programmerRate")}
          {f("Travel $/hr", "travelRate")}
          {f("Mileage $/km", "mileageRate")}
          {f("Elec Int. $/hr", "electricianInternalRate")}
          {f("Prog Int. $/hr", "programmerInternalRate")}
        </div>
      </div>
      <div style={{ width: 1, background: "#1e293b", alignSelf: "stretch" }} />
      <div>
        <div style={{ fontSize: 10, fontWeight: 800, color: "#38bdf8", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>Markups</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {f("Material", "materialMarkup", true)}
          {f("Other Costs", "otherCostsMarkup", true)}
          {f("Overhead", "overheadRate", true)}
          {f("Tax Rate", "taxRate", true)}
        </div>
      </div>
    </div>
  );
}

// ── Summary bar ────────────────────────────────────────────────────────────────
function SummaryBar({ p }: { p: PricingData }) {
  const s = calcSummary(p);
  const item = (label: string, value: string, accent?: boolean) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 16px", borderRight: "1px solid #1e3a6e" }}>
      <span style={{ fontSize: 10, color: "#93c5fd", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 900, color: accent ? "#22d3ee" : "#fff", marginTop: 1 }}>{value}</span>
    </div>
  );
  return (
    <div style={{ position: "sticky", bottom: 0, background: "#0d2e5e", display: "flex", alignItems: "center", padding: "8px 0", zIndex: 20, borderTop: "2px solid #1e40af", flexShrink: 0 }}>
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

// ── Section block ──────────────────────────────────────────────────────────────
function SectionBlock({ sec, idx, settings, collapsed, onToggle, onDelete, onRename, onChange }: {
  sec: QuoteSection;
  idx: number;
  settings: PricingSettings;
  collapsed: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onChange: (updated: QuoteSection) => void;
}) {
  const totals = calcSectionTotals(sec, settings);
  const hasData = totals.sectionSell > 0;

  return (
    <div style={{ marginBottom: 0 }}>
      {/* Section header row */}
      <div style={{
        background: "#0d2e5e",
        display: "flex", alignItems: "center", gap: 0,
        borderTop: idx > 0 ? "3px solid #1e40af" : undefined,
      }}>
        {/* Collapse toggle */}
        <button onClick={onToggle} style={{
          background: "none", border: "none", color: "#93c5fd",
          fontSize: 16, cursor: "pointer", padding: "10px 14px",
          lineHeight: 1, flexShrink: 0,
        }}>
          {collapsed ? "▶" : "▼"}
        </button>

        {/* Section label + editable name */}
        <span style={{ fontSize: 11, color: "#93c5fd", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, flexShrink: 0, paddingRight: 8 }}>
          Section {idx + 1}:
        </span>
        <input
          value={sec.name}
          onChange={e => onRename(e.target.value)}
          className="input-on-dark"
          style={{
            background: "transparent", border: "none", outline: "none",
            color: "#fff", fontSize: 14, fontWeight: 800, flex: 1,
            padding: "10px 0", cursor: "text",
          }}
          placeholder="Section name…"
        />

        {/* Section total */}
        {hasData && (
          <span style={{ fontSize: 13, fontWeight: 800, color: "#22d3ee", paddingRight: 16, flexShrink: 0 }}>
            {fmt$(totals.sectionSell)}
          </span>
        )}

        {/* Delete */}
        <button onClick={onDelete} style={{
          background: "none", border: "none", color: "#f87171",
          fontSize: 18, cursor: "pointer", padding: "10px 16px",
          lineHeight: 1, flexShrink: 0,
        }} title="Delete section">
          🗑
        </button>
      </div>

      {/* Section content */}
      {!collapsed && (
        <div>
          <MaterialsTable  sec={sec} settings={settings} onChange={onChange} />
          <LabourTable     sec={sec} role="elec" settings={settings} onChange={onChange} />
          <LabourTable     sec={sec} role="prog" settings={settings} onChange={onChange} />
          <OtherCostsTable sec={sec} settings={settings} onChange={onChange} />
          <TravelTable     sec={sec} settings={settings} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function QuoteOverviewTab({ quoteId, pricing: raw }: { quoteId: string; pricing: PricingData }) {
  const [p, setP] = useState<PricingData>(() => initPricing(raw));
  const [saving, setSaving] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const save = useCallback(async (data: PricingData) => {
    setSaving(true);
    try { await updateDoc(doc(db, "quotes", quoteId), { pricing: data }); } finally { setSaving(false); }
  }, [quoteId]);

  function upd(next: PricingData) { setP(next); save(next); }

  function updSettings(key: string, val: number) {
    upd({ ...p, settings: { ...p.settings, [key]: val } });
  }

  function updSection(id: string, updated: QuoteSection) {
    upd({ ...p, sections: p.sections.map(s => s.id === id ? updated : s) });
  }

  function renameSection(id: string, name: string) {
    setP(prev => ({ ...prev, sections: prev.sections.map(s => s.id === id ? { ...s, name } : s) }));
    // Debounce the save slightly for typing
    const next = { ...p, sections: p.sections.map(s => s.id === id ? { ...s, name } : s) };
    save(next);
  }

  function addSection() {
    const newSec = padSection(blankSection(`Section ${p.sections.length + 1}`));
    const next = { ...p, sections: [...p.sections, newSec] };
    upd(next);
    setCollapsed(prev => { const s = new Set(prev); s.delete(newSec.id); return s; });
    setToast(`Section ${next.sections.length} created`);
    setTimeout(() => setToast(null), 3000);
  }

  function deleteSection(id: string) {
    if (p.sections.length <= 1) { alert("A quote must have at least one section."); return; }
    if (!confirm("Delete this section and all its data?")) return;
    upd({ ...p, sections: p.sections.filter(s => s.id !== id) });
  }

  function toggleCollapse(id: string) {
    setCollapsed(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 160px)", overflow: "hidden" }}>

      {/* Override toggle bar */}
      <div style={{ background: "#0f172a", padding: "6px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, borderBottom: "1px solid #1e293b" }}>
        <button onClick={() => setOverrideOpen(x => !x)}
          style={{ background: "none", border: "1px solid #334155", borderRadius: 6, padding: "4px 14px", fontSize: 12, fontWeight: 700, color: "#38bdf8", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14, lineHeight: 1 }}>{overrideOpen ? "▲" : "▼"}</span>
          Override Rates &amp; Markups for This Quote
        </button>
        {saving && <span style={{ fontSize: 11, color: "#475569" }}>Saving…</span>}
      </div>
      {overrideOpen && <OverridePanel p={p} onChange={updSettings} />}

      {/* Scrollable spreadsheet area */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>

        {/* Add Section button at top */}
        <div style={{ background: "#f8fafc", padding: "8px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={addSection} style={{
            background: "#0d2e5e", color: "#fff", border: "none",
            borderRadius: 7, padding: "6px 18px", fontSize: 12, fontWeight: 700,
            cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
          }}>
            + Add Section
          </button>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>
            {p.sections.length} section{p.sections.length !== 1 ? "s" : ""} &nbsp;·&nbsp; Click a section header to collapse/expand
          </span>
          {p.sections.length > 1 && (
            <button
              onClick={() => {
                const allIds = p.sections.map(s => s.id);
                const allCollapsed = allIds.every(id => collapsed.has(id));
                setCollapsed(allCollapsed ? new Set() : new Set(allIds));
              }}
              style={{ marginLeft: "auto", background: "none", border: "1px solid #cbd5e1", borderRadius: 6, padding: "4px 12px", fontSize: 11, color: "#64748b", cursor: "pointer" }}
            >
              {p.sections.every(s => collapsed.has(s.id)) ? "Expand All" : "Collapse All"}
            </button>
          )}
        </div>

        {/* Sections */}
        {p.sections.map((sec, idx) => (
          <SectionBlock
            key={sec.id}
            sec={sec}
            idx={idx}
            settings={p.settings}
            collapsed={collapsed.has(sec.id)}
            onToggle={() => toggleCollapse(sec.id)}
            onDelete={() => deleteSection(sec.id)}
            onRename={name => renameSection(sec.id, name)}
            onChange={updated => updSection(sec.id, updated)}
          />
        ))}

        {/* Add Section button at bottom too */}
        <div style={{ padding: "12px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
          <button onClick={addSection} style={{
            background: "none", border: "2px dashed #94a3b8", color: "#64748b",
            borderRadius: 8, padding: "8px 24px", fontSize: 12, fontWeight: 700,
            cursor: "pointer", width: "100%",
          }}>
            + Add Section
          </button>
        </div>

      </div>

      {/* Sticky bottom summary bar */}
      <SummaryBar p={p} />

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
          background: "#0d2e5e", color: "#fff", borderRadius: 10,
          padding: "12px 24px", fontSize: 14, fontWeight: 700,
          boxShadow: "0 4px 20px rgba(0,0,0,0.25)", zIndex: 9999,
          display: "flex", alignItems: "center", gap: 10,
          animation: "fadeInUp 0.2s ease",
        }}>
          <span style={{ fontSize: 18 }}>✓</span>
          {toast}
        </div>
      )}
    </div>
  );
}
