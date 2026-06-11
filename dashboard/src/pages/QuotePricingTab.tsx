import { useCallback, useState } from "react";
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

export interface QuoteSection {
  id: string;
  name: string;
  materials: MaterialLine[];
  electricianLines: LabourLine[];
  programmerLines: LabourLine[];
  otherCosts: OtherCostLine[];
  travel: TravelData;
}

export interface PricingData {
  settings: PricingSettings;
  sections: QuoteSection[];
}

// ── Defaults ───────────────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS: PricingSettings = {
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
};

const DEFAULT_OTHER_COSTS: OtherCostLine[] = [
  { description: "Rental Equipment", cost: 0, markup: 0.20 },
  { description: "ESA",             cost: 0, markup: 0.20 },
  { description: "Panel ESA",       cost: 0, markup: 0.20 },
  { description: "Sub-Contract",    cost: 0, markup: 0.20 },
  { description: "Other",           cost: 0, markup: 0.20 },
];

const DEFAULT_TRAVEL: TravelData = { workers: 1, hoursPerDay: 8, days: 0, travelTimeHrs: 1, kmPerDay: 0, charge407: 0 };

function rndId() { return Math.random().toString(36).slice(2, 10); }

export function blankSection(name: string, matRows = 20, elecRows = 10, progRows = 10): QuoteSection {
  return {
    id: rndId(),
    name,
    materials: Array.from({ length: matRows }, () => ({
      id: rndId(), qty: 0, unit: "ea", manufacturer: "", partNumber: "", description: "", unitPrice: 0, supplier: "",
    })),
    electricianLines: Array.from({ length: elecRows }, () => ({
      id: rndId(), hours: 0, description: "", timeType: "Regular Time" as const,
    })),
    programmerLines: Array.from({ length: progRows }, () => ({
      id: rndId(), hours: 0, description: "", timeType: "Regular Time" as const,
    })),
    otherCosts: DEFAULT_OTHER_COSTS.map(o => ({ ...o })),
    travel: { ...DEFAULT_TRAVEL },
  };
}

export const DEFAULT_PRICING: PricingData = {
  settings: { ...DEFAULT_SETTINGS },
  sections: [blankSection("Section 1")],
};

// Migration: convert old flat-array format to sectioned format
export function migratePricing(raw: any): PricingData {
  const settings: PricingSettings = { ...DEFAULT_SETTINGS, ...(raw?.settings || {}) };

  // Already has sections → use as-is
  if (Array.isArray(raw?.sections) && raw.sections.length > 0) {
    return { settings, sections: raw.sections };
  }

  // Old flat-array format → wrap in one section
  const sec: QuoteSection = {
    id: "default",
    name: "Section 1",
    materials:        Array.isArray(raw?.materials)        ? raw.materials        : [],
    electricianLines: Array.isArray(raw?.electricianLines) ? raw.electricianLines : [],
    programmerLines:  Array.isArray(raw?.programmerLines)  ? raw.programmerLines  : [],
    otherCosts:       Array.isArray(raw?.otherCosts)       ? raw.otherCosts       : DEFAULT_OTHER_COSTS.map(o => ({ ...o })),
    travel:           raw?.travel || { ...DEFAULT_TRAVEL },
  };
  return { settings, sections: [sec] };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
export function labourRate(s: PricingSettings, role: "elec" | "prog", type: LabourLine["timeType"]) {
  const base = role === "elec" ? s.electricianRate : s.programmerRate;
  if (type === "1.5x Overtime") return base * 1.5;
  if (type === "Double Time")   return base * 2;
  return base;
}
export function labourInternalRate(s: PricingSettings, role: "elec" | "prog", type: LabourLine["timeType"]) {
  const base = role === "elec" ? s.electricianInternalRate : s.programmerInternalRate;
  if (type === "1.5x Overtime") return base * 1.5;
  if (type === "Double Time")   return base * 2;
  return base;
}

function fmt$(n: number) { return "$" + (n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtPct(n: number) { return ((n || 0) * 100).toFixed(1) + "%"; }

// ── Section-level totals ───────────────────────────────────────────────────────
export function calcSectionTotals(sec: QuoteSection, s: PricingSettings) {
  const matCost = sec.materials.reduce((sum, m) => sum + (m.qty || 0) * (m.unitPrice || 0), 0);
  const matSell = matCost * (1 + s.materialMarkup);

  const otherCost = sec.otherCosts.reduce((sum, o) => sum + (o.cost || 0), 0);
  const otherSell = sec.otherCosts.reduce((sum, o) => sum + (o.cost || 0) * (1 + (o.markup ?? s.otherCostsMarkup)), 0);

  const elecLines = sec.electricianLines.map(l => ({
    ...l,
    rate: labourRate(s, "elec", l.timeType),
    internalRate: labourInternalRate(s, "elec", l.timeType),
    sell: (l.hours || 0) * labourRate(s, "elec", l.timeType),
    cost: (l.hours || 0) * labourInternalRate(s, "elec", l.timeType),
  }));
  const elecSell  = elecLines.reduce((sum, l) => sum + l.sell, 0);
  const elecCost  = elecLines.reduce((sum, l) => sum + l.cost, 0);
  const elecHours = sec.electricianLines.reduce((sum, l) => sum + (l.hours || 0), 0);

  const progLines = sec.programmerLines.map(l => ({
    ...l,
    rate: labourRate(s, "prog", l.timeType),
    internalRate: labourInternalRate(s, "prog", l.timeType),
    sell: (l.hours || 0) * labourRate(s, "prog", l.timeType),
    cost: (l.hours || 0) * labourInternalRate(s, "prog", l.timeType),
  }));
  const progSell  = progLines.reduce((sum, l) => sum + l.sell, 0);
  const progCost  = progLines.reduce((sum, l) => sum + l.cost, 0);
  const progHours = sec.programmerLines.reduce((sum, l) => sum + (l.hours || 0), 0);

  const totalTravelHrs = (sec.travel.workers || 1) * (sec.travel.days || 0) * (sec.travel.travelTimeHrs || 1);
  const travelSell = totalTravelHrs * s.travelRate + (sec.travel.kmPerDay || 0) * (sec.travel.days || 0) * s.mileageRate + (sec.travel.charge407 || 0);
  const travelCost = totalTravelHrs * s.electricianInternalRate + (sec.travel.kmPerDay || 0) * (sec.travel.days || 0) * s.mileageRate + (sec.travel.charge407 || 0);

  const labourSell = elecSell + progSell + travelSell;
  const labourCost = elecCost + progCost + travelCost;
  const sectionSell = matSell + otherSell + labourSell;
  const sectionCost = matCost + otherCost + labourCost;

  return { matCost, matSell, otherCost, otherSell, elecSell, elecCost, elecHours, progSell, progCost, progHours, travelSell, travelCost, totalTravelHrs, labourSell, labourCost, sectionSell, sectionCost, elecLines, progLines };
}

// ── Aggregate summary across all sections (same shape for QuoteSummaryTab) ─────
export function calcSummary(p: PricingData) {
  const s = p.settings;
  const all = (p.sections || []).map(sec => calcSectionTotals(sec, s));

  const sum = <K extends string>(key: K) => all.reduce((t, a) => t + ((a as any)[key] || 0), 0);

  const matCost        = sum("matCost");
  const matSell        = sum("matSell");
  const otherCost      = sum("otherCost");
  const otherSell      = sum("otherSell");
  const elecSell       = sum("elecSell");
  const elecCost       = sum("elecCost");
  const elecHours      = sum("elecHours");
  const progSell       = sum("progSell");
  const progCost       = sum("progCost");
  const progHours      = sum("progHours");
  const travelSell     = sum("travelSell");
  const travelCost     = sum("travelCost");
  const totalTravelHrs = sum("totalTravelHrs");
  const labourSell     = sum("labourSell");
  const labourCost     = sum("labourCost");
  const totalSell      = matSell + otherSell + labourSell;
  const totalCost      = matCost + otherCost + labourCost;
  const overhead       = labourSell * s.overheadRate;
  const netProfit      = totalSell - totalCost - overhead;
  const netMarginPct   = totalSell > 0 ? netProfit / totalSell : 0;
  const afterTaxProfit = netProfit * (1 - s.taxRate);
  const afterTaxPct    = totalSell > 0 ? afterTaxProfit / totalSell : 0;
  const elecLines      = all.flatMap(a => a.elecLines);
  const progLines      = all.flatMap(a => a.progLines);

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

// ── Component (legacy — Pricing tab removed, kept for type safety) ──────────────
export default function QuotePricingTab({ quoteId, pricing: init }: { quoteId: string; pricing: PricingData }) {
  const [p, setP] = useState<PricingData>(init);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async (data: PricingData) => {
    setSaving(true);
    await updateDoc(doc(db, "quotes", quoteId), { pricing: data });
    setSaving(false);
  }, [quoteId]);

  const sum = calcSummary(p);

  return (
    <div style={{ padding:24, background:"#f9fafb", borderRadius:12, border:"1px solid #e5e7eb" }}>
      <div style={{ fontSize:13, color:"#6b7280" }}>Use the Overview tab to edit pricing. This tab is kept for compatibility.</div>
      {saving && <div style={{ fontSize:12, color:"#9ca3af", marginTop:8 }}>Saving…</div>}
      <div style={{ marginTop:12, fontSize:14, fontWeight:700 }}>Total: {fmt$(sum.totalSell)}</div>
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
