import { useState, useCallback } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface PricingSettings {
  electricianRate: number;
  programmerRate: number;
  electricianInternalRate: number;
  programmerInternalRate: number;
  materialMarkup: number;
  otherCostsMarkup: number;
  overheadRate: number;
  taxRate: number;
  travelRate: number;
  mileageRate: number;
  charge407: number;
  hoursPerDay: number;
}

export interface MaterialLine {
  id: string;
  qty: number;
  unit: string;
  manufacturer: string;
  partNumber: string;
  description: string;
  unitPrice: number;
  supplier: string;
}

export interface OtherCostLine {
  description: string;
  cost: number;
  markup: number;
}

export interface LabourLine {
  id: string;
  hours: number;
  description: string;
  timeType: "Regular Time" | "1.5x Overtime" | "Double Time";
}

export interface TravelData {
  workers: number;
  hoursPerDay: number;
  days: number;
  travelTimeHrs: number;
  kmPerDay: number;
  charge407: number;
}

export interface PricingData {
  settings: PricingSettings;
  materials: MaterialLine[];
  otherCosts: OtherCostLine[];
  electricianLines: LabourLine[];
  programmerLines: LabourLine[];
  travel: TravelData;
}

export const DEFAULT_PRICING: PricingData = {
  settings: {
    electricianRate: 95,
    programmerRate: 125,
    electricianInternalRate: 47.7,
    programmerInternalRate: 57.7,
    materialMarkup: 0.38,
    otherCostsMarkup: 0.20,
    overheadRate: 0,
    taxRate: 0.265,
    travelRate: 95,
    mileageRate: 0.5,
    charge407: 0,
    hoursPerDay: 8,
  },
  materials: [],
  otherCosts: [
    { description: "Rental Equipment", cost: 0, markup: 0.20 },
    { description: "ESA",             cost: 0, markup: 0.20 },
    { description: "Panel ESA",       cost: 0, markup: 0.20 },
    { description: "Sub-Contract",    cost: 0, markup: 0.20 },
    { description: "Other",           cost: 0, markup: 0.20 },
  ],
  electricianLines: [],
  programmerLines: [],
  travel: { workers: 1, hoursPerDay: 8, days: 0, travelTimeHrs: 1, kmPerDay: 0, charge407: 0 },
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }
function fmt$(n: number) { return "$" + (n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtPct(n: number) { return ((n || 0) * 100).toFixed(1) + "%"; }

function labourRate(s: PricingSettings, role: "elec" | "prog", type: LabourLine["timeType"]) {
  const base = role === "elec" ? s.electricianRate : s.programmerRate;
  if (type === "1.5x Overtime") return base * 1.5;
  if (type === "Double Time")   return base * 2;
  return base;
}
function labourInternalRate(s: PricingSettings, role: "elec" | "prog", type: LabourLine["timeType"]) {
  const base = role === "elec" ? s.electricianInternalRate : s.programmerInternalRate;
  if (type === "1.5x Overtime") return base * 1.5;
  if (type === "Double Time")   return base * 2;
  return base;
}

export function calcSummary(p: PricingData) {
  const s = p.settings;

  // Materials
  const matCost = p.materials.reduce((sum, m) => sum + (m.qty || 0) * (m.unitPrice || 0), 0);
  const matSell = matCost * (1 + s.materialMarkup);

  // Other costs
  const otherCost = p.otherCosts.reduce((sum, o) => sum + (o.cost || 0), 0);
  const otherSell = p.otherCosts.reduce((sum, o) => sum + (o.cost || 0) * (1 + (o.markup || s.otherCostsMarkup)), 0);

  // Electrician
  const elecLines = p.electricianLines.map(l => ({
    ...l,
    rate: labourRate(s, "elec", l.timeType),
    internalRate: labourInternalRate(s, "elec", l.timeType),
    sell: (l.hours || 0) * labourRate(s, "elec", l.timeType),
    cost: (l.hours || 0) * labourInternalRate(s, "elec", l.timeType),
  }));
  const elecSell = elecLines.reduce((sum, l) => sum + l.sell, 0);
  const elecCost = elecLines.reduce((sum, l) => sum + l.cost, 0);
  const elecHours = p.electricianLines.reduce((sum, l) => sum + (l.hours || 0), 0);

  const progLines = p.programmerLines.map(l => ({
    ...l,
    rate: labourRate(s, "prog", l.timeType),
    internalRate: labourInternalRate(s, "prog", l.timeType),
    sell: (l.hours || 0) * labourRate(s, "prog", l.timeType),
    cost: (l.hours || 0) * labourInternalRate(s, "prog", l.timeType),
  }));
  const progSell = progLines.reduce((sum, l) => sum + l.sell, 0);
  const progCost = progLines.reduce((sum, l) => sum + l.cost, 0);
  const progHours = p.programmerLines.reduce((sum, l) => sum + (l.hours || 0), 0);

  // Travel
  const totalTravelHrs = (p.travel.workers || 1) * (p.travel.days || 0) * (p.travel.travelTimeHrs || 1);
  const travelSell = totalTravelHrs * s.travelRate + (p.travel.kmPerDay || 0) * (p.travel.days || 0) * s.mileageRate + (p.travel.charge407 || 0);
  const travelCost = totalTravelHrs * s.electricianInternalRate + (p.travel.kmPerDay || 0) * (p.travel.days || 0) * s.mileageRate + (p.travel.charge407 || 0);

  const labourSell = elecSell + progSell + travelSell;
  const labourCost = elecCost + progCost + travelCost;
  const totalSell = matSell + otherSell + labourSell;
  const totalCost = matCost + otherCost + labourCost;
  const overhead = labourSell * s.overheadRate;
  const netProfit = totalSell - totalCost - overhead;
  const netMarginPct = totalSell > 0 ? netProfit / totalSell : 0;
  const afterTaxProfit = netProfit * (1 - s.taxRate);
  const afterTaxPct = totalSell > 0 ? afterTaxProfit / totalSell : 0;

  return { matCost, matSell, otherCost, otherSell, elecSell, elecCost, elecHours, progSell, progCost, progHours, travelSell, travelCost, totalTravelHrs, labourSell, labourCost, totalSell, totalCost, overhead, netProfit, netMarginPct, afterTaxProfit, afterTaxPct, elecLines, progLines };
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const inp: React.CSSProperties = { padding:"6px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:12, boxSizing:"border-box" as const, width:"100%" };
const sHd: React.CSSProperties = { fontSize:11, fontWeight:700, color:"#6b7280", textTransform:"uppercase", letterSpacing:0.5 };
const secHd: React.CSSProperties = { fontSize:14, fontWeight:800, color:"#0d2e5e", marginBottom:10, marginTop:0 };
const thSt: React.CSSProperties = { padding:"7px 10px", textAlign:"left" as const, fontSize:11, fontWeight:700, color:"#6b7280", textTransform:"uppercase" as const, letterSpacing:0.4, background:"#f9fafb", borderBottom:"1px solid #e5e7eb", whiteSpace:"nowrap" as const };
const tdSt: React.CSSProperties = { padding:"5px 8px", fontSize:12, verticalAlign:"middle" as const, borderBottom:"1px solid #f3f4f6" };
const delBtn: React.CSSProperties = { background:"none", border:"none", color:"#ef4444", fontSize:16, cursor:"pointer", padding:"0 4px", lineHeight:1 };
const addBtn: React.CSSProperties = { background:"none", border:"1px dashed #d1d5db", color:"#6b7280", borderRadius:6, padding:"4px 12px", fontSize:12, cursor:"pointer" };

// ── Component ──────────────────────────────────────────────────────────────────
export default function QuotePricingTab({ quoteId, pricing: init }: { quoteId: string; pricing: PricingData }) {
  const [p, setP] = useState<PricingData>(init);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const save = useCallback(async (data: PricingData) => {
    setSaving(true);
    await updateDoc(doc(db, "quotes", quoteId), { pricing: data });
    setSaving(false);
  }, [quoteId]);

  function upd(next: PricingData) { setP(next); save(next); }
  function updSettings(k: keyof PricingSettings, v: number) {
    const next = { ...p, settings: { ...p.settings, [k]: v } };
    upd(next);
  }

  // ── Materials ──────────────────────────────────────────────────────────────
  function addMat() {
    upd({ ...p, materials: [...p.materials, { id: uid(), qty: 0, unit: "ea", manufacturer: "", partNumber: "", description: "", unitPrice: 0, supplier: "" }] });
  }
  function updMat(id: string, k: keyof MaterialLine, v: string | number) {
    upd({ ...p, materials: p.materials.map(m => m.id === id ? { ...m, [k]: v } : m) });
  }
  function delMat(id: string) { upd({ ...p, materials: p.materials.filter(m => m.id !== id) }); }

  // ── Other Costs ────────────────────────────────────────────────────────────
  function updOther(i: number, k: keyof OtherCostLine, v: string | number) {
    const oc = [...p.otherCosts];
    oc[i] = { ...oc[i], [k]: v };
    upd({ ...p, otherCosts: oc });
  }
  function addOther() {
    upd({ ...p, otherCosts: [...p.otherCosts, { description: "", cost: 0, markup: p.settings.otherCostsMarkup }] });
  }
  function delOther(i: number) { upd({ ...p, otherCosts: p.otherCosts.filter((_, idx) => idx !== i) }); }

  // ── Labour ─────────────────────────────────────────────────────────────────
  function addLabour(role: "elec" | "prog") {
    const line: LabourLine = { id: uid(), hours: 0, description: "", timeType: "Regular Time" };
    upd(role === "elec"
      ? { ...p, electricianLines: [...p.electricianLines, line] }
      : { ...p, programmerLines: [...p.programmerLines, line] });
  }
  function updLabour(role: "elec" | "prog", id: string, k: keyof LabourLine, v: string | number) {
    const key = role === "elec" ? "electricianLines" : "programmerLines";
    upd({ ...p, [key]: p[key].map((l: LabourLine) => l.id === id ? { ...l, [k]: v } : l) });
  }
  function delLabour(role: "elec" | "prog", id: string) {
    const key = role === "elec" ? "electricianLines" : "programmerLines";
    upd({ ...p, [key]: p[key].filter((l: LabourLine) => l.id !== id) });
  }

  // ── Travel ─────────────────────────────────────────────────────────────────
  function updTravel(k: keyof TravelData, v: number) {
    upd({ ...p, travel: { ...p.travel, [k]: v } });
  }

  const sum = calcSummary(p);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

      {/* Header row */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <h2 style={{ margin:0, fontSize:16, fontWeight:800, color:"#0d2e5e" }}>Pricing</h2>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {saving && <span style={{ fontSize:12, color:"#9ca3af" }}>Saving…</span>}
          <button onClick={() => setSettingsOpen(x => !x)} style={{ background:"#f3f4f6", color:"#374151", border:"1px solid #d1d5db", borderRadius:7, padding:"6px 14px", fontSize:12, fontWeight:600, cursor:"pointer" }}>
            ⚙ Rates & Markups
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {settingsOpen && (
        <div style={{ background:"#f9fafb", borderRadius:10, border:"1px solid #e5e7eb", padding:16 }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#111827", marginBottom:12 }}>Rates & Markups</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
            {([
              ["Electrician Rate ($/hr)", "electricianRate"],
              ["Programmer Rate ($/hr)", "programmerRate"],
              ["Elec. Internal Cost ($/hr)", "electricianInternalRate"],
              ["Prog. Internal Cost ($/hr)", "programmerInternalRate"],
              ["Material Markup (%)", "materialMarkup", true],
              ["Other Costs Markup (%)", "otherCostsMarkup", true],
              ["Overhead Rate (%)", "overheadRate", true],
              ["Tax Rate (%)", "taxRate", true],
              ["Travel Rate ($/hr)", "travelRate"],
              ["Mileage ($/km)", "mileageRate"],
              ["407 Daily Charge ($)", "charge407"],
            ] as [string, keyof PricingSettings, boolean?][]).map(([label, key, isPct]) => (
              <div key={key}>
                <div style={sHd}>{label}</div>
                <input
                  type="number" style={{ ...inp, marginTop:4 }} step={isPct ? 0.01 : 1}
                  value={isPct ? +(p.settings[key] * 100).toFixed(2) : p.settings[key]}
                  onChange={e => updSettings(key, isPct ? +e.target.value / 100 : +e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MATERIALS ── */}
      <Section title="Materials">
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr>
                <th style={{ ...thSt, width:60 }}>QTY</th>
                <th style={{ ...thSt, width:60 }}>Unit</th>
                <th style={{ ...thSt, width:100 }}>Manufacturer</th>
                <th style={{ ...thSt, width:110 }}>Part #</th>
                <th style={thSt}>Description</th>
                <th style={{ ...thSt, width:100 }}>Unit Price</th>
                <th style={{ ...thSt, width:110 }}>Ext. Price</th>
                <th style={{ ...thSt, width:120 }}>Supplier</th>
                <th style={{ ...thSt, width:32 }}></th>
              </tr>
            </thead>
            <tbody style={{ background:"#fff" }}>
              {p.materials.map(m => {
                const ext = (m.qty || 0) * (m.unitPrice || 0);
                return (
                  <tr key={m.id}>
                    <td style={tdSt}><input type="number" style={inp} value={m.qty || ""} onChange={e => updMat(m.id, "qty", +e.target.value)} /></td>
                    <td style={tdSt}><input style={inp} value={m.unit} onChange={e => updMat(m.id, "unit", e.target.value)} /></td>
                    <td style={tdSt}><input style={inp} value={m.manufacturer} onChange={e => updMat(m.id, "manufacturer", e.target.value)} /></td>
                    <td style={tdSt}><input style={inp} value={m.partNumber} onChange={e => updMat(m.id, "partNumber", e.target.value)} /></td>
                    <td style={tdSt}><input style={{ ...inp, minWidth:180 }} value={m.description} onChange={e => updMat(m.id, "description", e.target.value)} placeholder="Description" /></td>
                    <td style={tdSt}><input type="number" style={inp} value={m.unitPrice || ""} onChange={e => updMat(m.id, "unitPrice", +e.target.value)} /></td>
                    <td style={{ ...tdSt, fontWeight:600, color:"#374151" }}>{fmt$(ext)}</td>
                    <td style={tdSt}><input style={inp} value={m.supplier} onChange={e => updMat(m.id, "supplier", e.target.value)} /></td>
                    <td style={tdSt}><button onClick={() => delMat(m.id)} style={delBtn}>×</button></td>
                  </tr>
                );
              })}
              {p.materials.length === 0 && (
                <tr><td colSpan={9} style={{ padding:"20px", textAlign:"center", color:"#9ca3af", fontSize:13 }}>No materials yet. Add a row below.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ background:"#f9fafb", borderTop:"2px solid #e5e7eb" }}>
                <td colSpan={5} style={{ padding:"8px 10px", fontSize:12, fontWeight:700, color:"#374151" }}>
                  <button onClick={addMat} style={addBtn}>+ Add Row</button>
                </td>
                <td style={{ padding:"8px 10px", fontSize:11, color:"#6b7280", fontWeight:600 }}>Markup: {fmtPct(p.settings.materialMarkup)}</td>
                <td colSpan={2} style={{ padding:"8px 10px", fontSize:12, fontWeight:700 }}>
                  <div>Cost: {fmt$(sum.matCost)}</div>
                  <div style={{ color:"#16a34a" }}>Sell: {fmt$(sum.matSell)}</div>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      {/* ── OTHER COSTS ── */}
      <Section title="Other Costs">
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
          <thead>
            <tr>
              <th style={thSt}>Description</th>
              <th style={{ ...thSt, width:140 }}>Cost</th>
              <th style={{ ...thSt, width:120 }}>Markup %</th>
              <th style={{ ...thSt, width:130 }}>Sell Price</th>
              <th style={{ ...thSt, width:32 }}></th>
            </tr>
          </thead>
          <tbody style={{ background:"#fff" }}>
            {p.otherCosts.map((o, i) => {
              const sell = (o.cost || 0) * (1 + (o.markup ?? p.settings.otherCostsMarkup));
              return (
                <tr key={i}>
                  <td style={tdSt}><input style={inp} value={o.description} onChange={e => updOther(i, "description", e.target.value)} /></td>
                  <td style={tdSt}><input type="number" style={inp} value={o.cost || ""} onChange={e => updOther(i, "cost", +e.target.value)} /></td>
                  <td style={tdSt}><input type="number" style={inp} step={0.01} value={+((o.markup ?? p.settings.otherCostsMarkup) * 100).toFixed(1)} onChange={e => updOther(i, "markup", +e.target.value / 100)} /></td>
                  <td style={{ ...tdSt, fontWeight:600, color:"#374151" }}>{fmt$(sell)}</td>
                  <td style={tdSt}><button onClick={() => delOther(i)} style={delBtn}>×</button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background:"#f9fafb", borderTop:"2px solid #e5e7eb" }}>
              <td style={{ padding:"8px 10px" }}><button onClick={addOther} style={addBtn}>+ Add Row</button></td>
              <td style={{ padding:"8px 10px", fontSize:12, fontWeight:700 }}>Cost: {fmt$(sum.otherCost)}</td>
              <td />
              <td style={{ padding:"8px 10px", fontSize:12, fontWeight:700, color:"#16a34a" }}>Sell: {fmt$(sum.otherSell)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </Section>

      {/* ── LABOUR ── */}
      <Section title="Labour — Electrician">
        <LabourTable
          lines={p.electricianLines}
          role="elec"
          settings={p.settings}
          onAdd={() => addLabour("elec")}
          onUpd={(id, k, v) => updLabour("elec", id, k, v)}
          onDel={id => delLabour("elec", id)}
          totalSell={sum.elecSell}
          totalHours={sum.elecHours}
          totalCost={sum.elecCost}
        />
      </Section>

      <Section title="Labour — Programmer">
        <LabourTable
          lines={p.programmerLines}
          role="prog"
          settings={p.settings}
          onAdd={() => addLabour("prog")}
          onUpd={(id, k, v) => updLabour("prog", id, k, v)}
          onDel={id => delLabour("prog", id)}
          totalSell={sum.progSell}
          totalHours={sum.progHours}
          totalCost={sum.progCost}
        />
      </Section>

      {/* ── TRAVEL & SITE ── */}
      <Section title="Travel & Site">
        <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:12, marginBottom:12 }}>
          {([
            ["Workers", "workers"],
            ["Hours on Site / Day", "hoursPerDay"],
            ["Days of Travel", "days"],
            ["Travel Time / Day (hrs)", "travelTimeHrs"],
            ["KM / Day", "kmPerDay"],
            ["407 Daily Charge ($)", "charge407"],
          ] as [string, keyof TravelData][]).map(([label, key]) => (
            <div key={key}>
              <div style={sHd}>{label}</div>
              <input type="number" style={{ ...inp, marginTop:4 }} value={p.travel[key] || ""} onChange={e => updTravel(key, +e.target.value)} />
            </div>
          ))}
        </div>
        <div style={{ background:"#f9fafb", borderRadius:8, padding:"10px 14px", fontSize:12, display:"flex", gap:24 }}>
          <span>Total Travel Hours: <strong>{sum.totalTravelHrs}</strong></span>
          <span>Travel Sell: <strong style={{ color:"#16a34a" }}>{fmt$(sum.travelSell)}</strong></span>
          <span>Travel Cost: <strong>{fmt$(sum.travelCost)}</strong></span>
        </div>
      </Section>

      {/* ── SUMMARY STRIP ── */}
      <div style={{ background:"#0d2e5e", borderRadius:12, padding:"16px 20px", color:"#fff" }}>
        <div style={{ fontSize:13, fontWeight:700, marginBottom:10, opacity:0.8 }}>TOTAL JOB PRICE</div>
        <div style={{ display:"flex", gap:32, flexWrap:"wrap" }}>
          <SumItem label="Materials" value={fmt$(sum.matSell)} />
          <SumItem label="Other Costs" value={fmt$(sum.otherSell)} />
          <SumItem label="Labour & Travel" value={fmt$(sum.labourSell)} />
          <div style={{ borderLeft:"1px solid rgba(255,255,255,0.2)", paddingLeft:32 }}>
            <div style={{ fontSize:10, opacity:0.7, textTransform:"uppercase", letterSpacing:0.5 }}>Total</div>
            <div style={{ fontSize:22, fontWeight:800 }}>{fmt$(sum.totalSell)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background:"#fff", borderRadius:12, border:"1px solid #e5e7eb", overflow:"hidden" }}>
      <div style={{ padding:"12px 16px", borderBottom:"1px solid #e5e7eb", background:"#f9fafb" }}>
        <span style={secHd}>{title}</span>
      </div>
      <div style={{ padding:16 }}>{children}</div>
    </div>
  );
}

function SumItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize:10, opacity:0.7, textTransform:"uppercase", letterSpacing:0.5 }}>{label}</div>
      <div style={{ fontSize:16, fontWeight:700 }}>{value}</div>
    </div>
  );
}

function LabourTable({ lines, role, settings, onAdd, onUpd, onDel, totalSell, totalHours, totalCost }: {
  lines: LabourLine[]; role: "elec" | "prog"; settings: PricingSettings;
  onAdd: () => void; onUpd: (id: string, k: keyof LabourLine, v: string | number) => void; onDel: (id: string) => void;
  totalSell: number; totalHours: number; totalCost: number;
}) {
  const fmt$ = (n: number) => "$" + (n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
      <thead>
        <tr>
          <th style={{ ...thSt, width:80 }}>Hours</th>
          <th style={thSt}>Description</th>
          <th style={{ ...thSt, width:150 }}>Time Type</th>
          <th style={{ ...thSt, width:100 }}>Rate ($/hr)</th>
          <th style={{ ...thSt, width:110 }}>Total Sell</th>
          <th style={{ ...thSt, width:32 }}></th>
        </tr>
      </thead>
      <tbody style={{ background:"#fff" }}>
        {lines.map(l => {
          const rate = labourRate(settings, role, l.timeType);
          const sell = (l.hours || 0) * rate;
          return (
            <tr key={l.id}>
              <td style={tdSt}><input type="number" style={inp} value={l.hours || ""} onChange={e => onUpd(l.id, "hours", +e.target.value)} /></td>
              <td style={tdSt}><input style={{ ...inp, minWidth:180 }} value={l.description} onChange={e => onUpd(l.id, "description", e.target.value)} placeholder="Task description" /></td>
              <td style={tdSt}>
                <select style={inp} value={l.timeType} onChange={e => onUpd(l.id, "timeType", e.target.value)}>
                  <option>Regular Time</option>
                  <option>1.5x Overtime</option>
                  <option>Double Time</option>
                </select>
              </td>
              <td style={{ ...tdSt, color:"#6b7280" }}>{fmt$(rate)}</td>
              <td style={{ ...tdSt, fontWeight:600 }}>{fmt$(sell)}</td>
              <td style={tdSt}><button onClick={() => onDel(l.id)} style={delBtn}>×</button></td>
            </tr>
          );
        })}
        {lines.length === 0 && (
          <tr><td colSpan={6} style={{ padding:"20px", textAlign:"center", color:"#9ca3af" }}>No lines yet.</td></tr>
        )}
      </tbody>
      <tfoot>
        <tr style={{ background:"#f9fafb", borderTop:"2px solid #e5e7eb" }}>
          <td style={{ padding:"8px 10px", fontWeight:700, fontSize:12 }}>{totalHours} hrs</td>
          <td style={{ padding:"8px 10px" }}><button onClick={onAdd} style={addBtn}>+ Add Row</button></td>
          <td />
          <td />
          <td style={{ padding:"8px 10px", fontSize:12, fontWeight:700 }}>
            <div>Sell: <span style={{ color:"#16a34a" }}>{fmt$(totalSell)}</span></div>
            <div style={{ fontSize:11, color:"#9ca3af" }}>Cost: {fmt$(totalCost)}</div>
          </td>
          <td />
        </tr>
      </tfoot>
    </table>
  );
}
