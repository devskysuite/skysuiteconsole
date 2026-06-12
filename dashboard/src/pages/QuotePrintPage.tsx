import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { calcSectionTotals, calcSummary, labourRate, migratePricing, PricingData, QuoteSection } from "./QuotePricingTab";

const fmt$ = (n: number) =>
  n.toLocaleString("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Quote {
  quoteNumber: string;
  title: string;
  customerName?: string;
  propertyName?: string;
  propertyAddress?: string;
  billingCustomer?: string;
  billingAddress?: string;
  companyRepresentative?: string;
  companyRepPhone?: string;
  companyRepEmail?: string;
  soldBy?: string;
  projectManager?: string;
  expiration?: number;
  pricing?: unknown;
}

interface PrintOptions {
  showSectionName: boolean;
  showScopeText: boolean;
  showSectionSubtotal: boolean;
  showItemizedMaterials: boolean;
  showMaterialPricing: boolean;
  showMaterialQty: boolean;
  showMaterialsTotal: boolean;
  showItemizedLabour: boolean;
  showLabourPricing: boolean;
  showLabourQty: boolean;
  showLabourTotal: boolean;
  timeTypeRegular: boolean;
  timeTypeOvertime: boolean;
  timeTypeDouble: boolean;
  showOtherCosts: boolean;
  showTravel: boolean;
  showSummaryTable: boolean;
  showGrandTotal: boolean;
}

const DEFAULT_OPTIONS: PrintOptions = {
  showSectionName: true,
  showScopeText: true,
  showSectionSubtotal: true,
  showItemizedMaterials: true,
  showMaterialPricing: true,
  showMaterialQty: true,
  showMaterialsTotal: true,
  showItemizedLabour: true,
  showLabourPricing: true,
  showLabourQty: true,
  showLabourTotal: true,
  timeTypeRegular: true,
  timeTypeOvertime: true,
  timeTypeDouble: true,
  showOtherCosts: true,
  showTravel: true,
  showSummaryTable: true,
  showGrandTotal: true,
};

// ── Toggle ─────────────────────────────────────────────────────────────────────
function Toggle({ label, checked, onChange, indent = false, disabled = false }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; indent?: boolean; disabled?: boolean;
}) {
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", paddingLeft: indent ? 16 : 0, opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer" }}
    >
      <span style={{ fontSize: 13, color: "#374151", fontWeight: indent ? 400 : 500 }}>{label}</span>
      <div style={{ width: 38, height: 22, borderRadius: 11, position: "relative", flexShrink: 0, background: (checked && !disabled) ? "#1e7d3a" : "#d1d5db", transition: "background 0.15s" }}>
        <div style={{ position: "absolute", top: 3, left: checked ? 19 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
      </div>
    </div>
  );
}

function OptGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6, borderBottom: "1px solid #f3f4f6", paddingBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

// ── Row-based line items (no tables) ──────────────────────────────────────────
const HDR: React.CSSProperties = { display: "flex", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #e5e7eb", marginBottom: 2 };
const HDR_LABEL: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5 };
const ROW: React.CSSProperties = { display: "flex", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f3f4f6" };
const COL_DESC: React.CSSProperties = { flex: 1, fontSize: 12, color: "#374151" };
const COL_SM: React.CSSProperties = { width: 70, textAlign: "right" as const, fontSize: 12, color: "#374151", flexShrink: 0 };
const COL_AMT: React.CSSProperties = { width: 100, textAlign: "right" as const, fontSize: 12, fontWeight: 700, color: "#111827", flexShrink: 0 };
const SUB_ROW: React.CSSProperties = { display: "flex", justifyContent: "flex-end", padding: "6px 0", borderTop: "1px solid #e5e7eb", marginTop: 2 };

function GroupLabel({ label }: { label: string }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14, marginBottom: 4 }}>{label}</div>;
}

function SectionRows({ sec, pricing, opts }: { sec: QuoteSection; pricing: PricingData; opts: PrintOptions }) {
  const s = pricing.settings;
  const { elecLines, progLines } = calcSectionTotals(sec, s);

  const allowedTypes = new Set([
    opts.timeTypeRegular  && "Regular Time",
    opts.timeTypeOvertime && "1.5x Overtime",
    opts.timeTypeDouble   && "Double Time",
  ].filter(Boolean) as string[]);

  const mats  = sec.materials.filter(m => (m.qty || 0) > 0 || m.description.trim() || m.partNumber.trim());
  const elec  = elecLines.filter(l => ((l.hours || 0) > 0 || l.description.trim()) && allowedTypes.has(l.timeType));
  const prog  = progLines.filter(l => ((l.hours || 0) > 0 || l.description.trim()) && allowedTypes.has(l.timeType));
  const other = sec.otherCosts.filter(o => (o.cost || 0) > 0);
  const hasTrav = (sec.travel.days || 0) > 0 || (sec.travel.kmPerDay || 0) > 0;

  const showElec = opts.showItemizedLabour && elec.length > 0;
  const showProg = opts.showItemizedLabour && prog.length > 0;
  const showMat  = opts.showItemizedMaterials && mats.length > 0;
  const showOth  = opts.showOtherCosts && other.length > 0;
  const showTrav = opts.showTravel && hasTrav;

  if (!showElec && !showProg && !showMat && !showOth && !showTrav) return null;

  return (
    <div style={{ marginTop: 12 }}>

      {/* Electrician Labour */}
      {showElec && (
        <div>
          <GroupLabel label="Labour — Electrician" />
          <div style={HDR}>
            <span style={{ ...HDR_LABEL, flex: 1 }}>Description</span>
            <span style={{ ...HDR_LABEL, width: 100 }}>Time Type</span>
            {opts.showLabourQty     && <span style={{ ...HDR_LABEL, ...COL_SM }}>Hours</span>}
            {opts.showLabourPricing && <span style={{ ...HDR_LABEL, ...COL_SM }}>Unit Price</span>}
            {opts.showLabourPricing && <span style={{ ...HDR_LABEL, ...COL_AMT }}>Subtotal</span>}
          </div>
          {elec.map(l => (
            <div key={l.id} style={ROW}>
              <span style={COL_DESC}>{l.description || "—"}</span>
              <span style={{ width: 100, fontSize: 12, color: "#6b7280", flexShrink: 0 }}>{l.timeType}</span>
              {opts.showLabourQty     && <span style={COL_SM}>{l.hours || 0} hrs</span>}
              {opts.showLabourPricing && <span style={COL_SM}>{fmt$(labourRate(s, "elec", l.timeType))}</span>}
              {opts.showLabourPricing && <span style={COL_AMT}>{fmt$(l.sell)}</span>}
            </div>
          ))}
          {opts.showLabourTotal && opts.showLabourPricing && (
            <div style={SUB_ROW}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginRight: 8 }}>Electrician Labour Total</span>
              <span style={{ ...COL_AMT, width: "auto" }}>{fmt$(elec.reduce((a, l) => a + l.sell, 0))}</span>
            </div>
          )}
        </div>
      )}

      {/* Programming Labour */}
      {showProg && (
        <div>
          <GroupLabel label="Labour — Programming" />
          <div style={HDR}>
            <span style={{ ...HDR_LABEL, flex: 1 }}>Description</span>
            <span style={{ ...HDR_LABEL, width: 100 }}>Time Type</span>
            {opts.showLabourQty     && <span style={{ ...HDR_LABEL, ...COL_SM }}>Hours</span>}
            {opts.showLabourPricing && <span style={{ ...HDR_LABEL, ...COL_SM }}>Unit Price</span>}
            {opts.showLabourPricing && <span style={{ ...HDR_LABEL, ...COL_AMT }}>Subtotal</span>}
          </div>
          {prog.map(l => (
            <div key={l.id} style={ROW}>
              <span style={COL_DESC}>{l.description || "—"}</span>
              <span style={{ width: 100, fontSize: 12, color: "#6b7280", flexShrink: 0 }}>{l.timeType}</span>
              {opts.showLabourQty     && <span style={COL_SM}>{l.hours || 0} hrs</span>}
              {opts.showLabourPricing && <span style={COL_SM}>{fmt$(labourRate(s, "prog", l.timeType))}</span>}
              {opts.showLabourPricing && <span style={COL_AMT}>{fmt$(l.sell)}</span>}
            </div>
          ))}
          {opts.showLabourTotal && opts.showLabourPricing && (
            <div style={SUB_ROW}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginRight: 8 }}>Programming Labour Total</span>
              <span style={{ ...COL_AMT, width: "auto" }}>{fmt$(prog.reduce((a, l) => a + l.sell, 0))}</span>
            </div>
          )}
        </div>
      )}

      {/* Materials */}
      {showMat && (
        <div>
          <GroupLabel label="Materials" />
          <div style={HDR}>
            <span style={{ ...HDR_LABEL, flex: 1 }}>Description</span>
            <span style={{ ...HDR_LABEL, width: 140 }}>Part # / Manufacturer</span>
            {opts.showMaterialQty    && <span style={{ ...HDR_LABEL, ...COL_SM }}>Qty</span>}
            {opts.showMaterialPricing && <span style={{ ...HDR_LABEL, ...COL_SM }}>Unit Price</span>}
            {opts.showMaterialPricing && <span style={{ ...HDR_LABEL, ...COL_AMT }}>Subtotal</span>}
          </div>
          {mats.map(m => {
            const unitSell = (m.unitPrice || 0) * (1 + s.materialMarkup);
            const sell = (m.qty || 0) * unitSell;
            return (
              <div key={m.id} style={ROW}>
                <span style={COL_DESC}>{m.description || "—"}</span>
                <span style={{ width: 140, fontSize: 12, color: "#6b7280", flexShrink: 0 }}>{[m.partNumber, m.manufacturer].filter(Boolean).join(" · ") || "—"}</span>
                {opts.showMaterialQty     && <span style={COL_SM}>{m.qty || 0} {m.unit || "ea"}</span>}
                {opts.showMaterialPricing && <span style={COL_SM}>{fmt$(unitSell)}</span>}
                {opts.showMaterialPricing && <span style={COL_AMT}>{fmt$(sell)}</span>}
              </div>
            );
          })}
          {opts.showMaterialsTotal && opts.showMaterialPricing && (
            <div style={SUB_ROW}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginRight: 8 }}>Materials Total</span>
              <span style={{ ...COL_AMT, width: "auto" }}>{fmt$(mats.reduce((a, m) => a + (m.qty||0)*(m.unitPrice||0)*(1+s.materialMarkup), 0))}</span>
            </div>
          )}
        </div>
      )}

      {/* Other Costs */}
      {showOth && (
        <div>
          <GroupLabel label="Other Costs" />
          <div style={HDR}>
            <span style={{ ...HDR_LABEL, flex: 1 }}>Description</span>
            <span style={{ ...HDR_LABEL, ...COL_AMT }}>Subtotal</span>
          </div>
          {other.map((o, i) => (
            <div key={i} style={ROW}>
              <span style={COL_DESC}>{o.description}</span>
              <span style={COL_AMT}>{fmt$((o.cost||0)*(1+(o.markup??s.otherCostsMarkup)))}</span>
            </div>
          ))}
          <div style={SUB_ROW}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginRight: 8 }}>Other Costs Total</span>
            <span style={{ ...COL_AMT, width: "auto" }}>{fmt$(other.reduce((a,o)=>a+(o.cost||0)*(1+(o.markup??s.otherCostsMarkup)),0))}</span>
          </div>
        </div>
      )}

      {/* Travel */}
      {showTrav && (() => {
        const t = sec.travel;
        const hrs = (t.workers||1)*(t.days||0)*(t.travelTimeHrs||1);
        const timeSell = hrs * s.travelRate;
        const mileSell = (t.kmPerDay||0)*(t.days||0)*s.mileageRate;
        const c407 = t.charge407||0;
        const total = timeSell + mileSell + c407;
        return (
          <div>
            <GroupLabel label="Travel" />
            <div style={HDR}><span style={{ ...HDR_LABEL, flex: 1 }}>Description</span><span style={{ ...HDR_LABEL, ...COL_AMT }}>Subtotal</span></div>
            {timeSell > 0 && <div style={ROW}><span style={COL_DESC}>{t.workers} worker(s) × {t.days} day(s) × {t.travelTimeHrs} hr/day @ {fmt$(s.travelRate)}/hr</span><span style={COL_AMT}>{fmt$(timeSell)}</span></div>}
            {mileSell > 0 && <div style={ROW}><span style={COL_DESC}>{t.kmPerDay} km/day × {t.days} day(s) @ {fmt$(s.mileageRate)}/km</span><span style={COL_AMT}>{fmt$(mileSell)}</span></div>}
            {c407 > 0     && <div style={ROW}><span style={COL_DESC}>407 Charges</span><span style={COL_AMT}>{fmt$(c407)}</span></div>}
            <div style={SUB_ROW}><span style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginRight: 8 }}>Travel Total</span><span style={{ ...COL_AMT, width: "auto" }}>{fmt$(total)}</span></div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function QuotePrintPage() {
  const { quoteId } = useParams<{ quoteId: string }>();
  const [quote, setQuote]     = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [opts, setOpts]       = useState<PrintOptions>(DEFAULT_OPTIONS);
  const [optOpen, setOptOpen] = useState(true);

  useEffect(() => {
    if (!quoteId) return;
    return onSnapshot(
      doc(db, "quotes", quoteId),
      snap => { if (snap.exists()) setQuote(snap.data() as Quote); setLoading(false); },
      () => setLoading(false)
    );
  }, [quoteId]);

  function set<K extends keyof PrintOptions>(k: K) {
    return (v: PrintOptions[K]) => setOpts(o => ({ ...o, [k]: v }));
  }

  if (loading) return <div style={{ padding: 60, textAlign: "center", fontFamily: "Arial, sans-serif", color: "#6b7280" }}>Loading…</div>;
  if (!quote)  return <div style={{ padding: 60, textAlign: "center", fontFamily: "Arial, sans-serif" }}>Quote not found. Make sure you are logged in.</div>;

  const pricing       = migratePricing((quote as any).pricing);
  const summary       = calcSummary(pricing);
  const sectionTotals = pricing.sections.map(sec => ({ sec, t: calcSectionTotals(sec, pricing.settings) }));
  const today         = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div style={{ fontFamily: "Arial, sans-serif", color: "#111827", minHeight: "100vh", background: "#f0f2f5" }}>

      {/* Top bar */}
      <div className="no-print" style={{ background: "#0d2e5e", padding: "10px 20px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 14, flex: 1 }}>Quote {quote.quoteNumber} — Print Preview</span>
        <button onClick={() => setOptOpen(o => !o)} style={{ background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.35)", borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          ⚙ PDF Options {optOpen ? "▲" : "▼"}
        </button>
        <button onClick={() => window.print()} style={{ background: "#1e7d3a", color: "#fff", border: "none", borderRadius: 7, padding: "8px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          🖨 Print / Save as PDF
        </button>
        <button onClick={() => window.close()} style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 7, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          ✕ Close
        </button>
      </div>

      {/* PDF Options panel */}
      {optOpen && (
        <div className="no-print" style={{ background: "#fff", borderBottom: "2px solid #e5e7eb", padding: "16px 24px" }}>
          <div style={{ maxWidth: 960, margin: "0 auto" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#0d2e5e", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>PDF Options</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0 32px" }}>
              <OptGroup title="Sections">
                <Toggle label="Section Name"    checked={opts.showSectionName}     onChange={set("showSectionName")} />
                <Toggle label="Scope Text"      checked={opts.showScopeText}       onChange={set("showScopeText")} />
                <Toggle label="Section Total"   checked={opts.showSectionSubtotal} onChange={set("showSectionSubtotal")} />
              </OptGroup>
              <OptGroup title="Labour">
                <Toggle label="Show Total"      checked={opts.showLabourTotal}    onChange={set("showLabourTotal")} />
                <Toggle label="Show Itemized"   checked={opts.showItemizedLabour} onChange={set("showItemizedLabour")} />
                <Toggle label="Pricing"         checked={opts.showLabourPricing}  onChange={set("showLabourPricing")}  indent disabled={!opts.showItemizedLabour} />
                <Toggle label="Hours"           checked={opts.showLabourQty}      onChange={set("showLabourQty")}      indent disabled={!opts.showItemizedLabour} />
                <Toggle label="Regular Time"    checked={opts.timeTypeRegular}    onChange={set("timeTypeRegular")}    indent disabled={!opts.showItemizedLabour} />
                <Toggle label="1.5x Overtime"   checked={opts.timeTypeOvertime}   onChange={set("timeTypeOvertime")}   indent disabled={!opts.showItemizedLabour} />
                <Toggle label="Double Time"     checked={opts.timeTypeDouble}     onChange={set("timeTypeDouble")}     indent disabled={!opts.showItemizedLabour} />
              </OptGroup>
              <OptGroup title="Materials">
                <Toggle label="Show Total"          checked={opts.showMaterialsTotal}    onChange={set("showMaterialsTotal")} />
                <Toggle label="Show Itemized"       checked={opts.showItemizedMaterials} onChange={set("showItemizedMaterials")} />
                <Toggle label="Pricing"  checked={opts.showMaterialPricing} onChange={set("showMaterialPricing")} indent disabled={!opts.showItemizedMaterials} />
                <Toggle label="Quantity" checked={opts.showMaterialQty}     onChange={set("showMaterialQty")}     indent disabled={!opts.showItemizedMaterials} />
              </OptGroup>
              <OptGroup title="Other">
                <Toggle label="Other Costs" checked={opts.showOtherCosts} onChange={set("showOtherCosts")} />
                <Toggle label="Travel"      checked={opts.showTravel}     onChange={set("showTravel")} />
              </OptGroup>
              <OptGroup title="Totals">
                <Toggle label="Summary Table" checked={opts.showSummaryTable} onChange={set("showSummaryTable")} />
                <Toggle label="Grand Total"   checked={opts.showGrandTotal}   onChange={set("showGrandTotal")} />
              </OptGroup>
            </div>
          </div>
        </div>
      )}

      {/* Print document */}
      <div style={{ maxWidth: 960, margin: "24px auto", padding: "0 16px 40px" }}>
        <div className="print-page" style={{ background: "#fff", padding: "36px 44px", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>

          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "3px solid #0d2e5e", paddingBottom: 18, marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#0d2e5e" }}>RBT Electrical &amp; Automation Services</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3 }}>Professional Electrical &amp; Automation Solutions</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#0d2e5e" }}>QUOTE</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>#{quote.quoteNumber}</div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{today}</div>
              {quote.expiration && <div style={{ fontSize: 11, color: "#6b7280" }}>Valid {quote.expiration} days</div>}
            </div>
          </div>

          {/* Bill To / Site / Contacts */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 28 }}>
            <InfoBlock title="Bill To">
              <b>{quote.billingCustomer || quote.customerName}</b>
              {quote.billingAddress && <div style={{ color: "#4b5563", fontSize: 12, marginTop: 3, whiteSpace: "pre-line" }}>{quote.billingAddress}</div>}
            </InfoBlock>
            <InfoBlock title="Site / Property">
              <b>{quote.propertyName}</b>
              {quote.propertyAddress && <div style={{ color: "#4b5563", fontSize: 12, marginTop: 3, whiteSpace: "pre-line" }}>{quote.propertyAddress}</div>}
            </InfoBlock>
            <InfoBlock title="Contacts">
              {quote.companyRepresentative && <div><b>{quote.companyRepresentative}</b>{quote.companyRepPhone && <div style={{ fontSize: 12, color: "#4b5563" }}>{quote.companyRepPhone}</div>}{quote.companyRepEmail && <div style={{ fontSize: 12, color: "#4b5563" }}>{quote.companyRepEmail}</div>}</div>}
              {quote.soldBy         && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Prepared by: {quote.soldBy}</div>}
              {quote.projectManager && <div style={{ fontSize: 12, color: "#6b7280" }}>Project Mgr: {quote.projectManager}</div>}
            </InfoBlock>
          </div>

          {/* Sections */}
          {pricing.sections.map((sec, i) => {
            const { t } = sectionTotals[i];
            return (
              <div key={sec.id} style={{ marginBottom: 36, pageBreakInside: "avoid" }}>
                {/* Section title — blue bold + total, matching screenshot */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  {opts.showSectionName
                    ? <div style={{ fontSize: 15, fontWeight: 800, color: "#1e40af" }}>{sec.name || `Section ${i + 1}`}</div>
                    : <div style={{ fontSize: 13, color: "#6b7280" }}>Section {i + 1}</div>}
                  {opts.showSectionSubtotal && t.sectionSell > 0 && (
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#1e40af" }}>{fmt$(t.sectionSell)}</div>
                  )}
                </div>

                {/* Scope text */}
                {opts.showScopeText && sec.scopeOfWork?.trim() && (
                  <div style={{ fontSize: 12, lineHeight: 1.9, color: "#374151", marginBottom: 6, whiteSpace: "pre-wrap" }}>{sec.scopeOfWork}</div>
                )}

                <div style={{ borderBottom: "1px solid #e2e8f0", marginBottom: 8 }} />

                {/* Line items */}
                <SectionRows sec={sec} pricing={pricing} opts={opts} />
              </div>
            );
          })}

          {/* Summary */}
          {opts.showSummaryTable && (
            <div style={{ marginTop: 8, marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#0d2e5e", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Summary</div>
              <div style={{ border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", background: "#f1f5f9", padding: "7px 12px", borderBottom: "1px solid #e2e8f0" }}>
                  <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: "#374151" }}>Section</span>
                  <span style={{ width: 100, textAlign: "right" as const, fontSize: 11, fontWeight: 700, color: "#374151" }}>Materials</span>
                  <span style={{ width: 100, textAlign: "right" as const, fontSize: 11, fontWeight: 700, color: "#374151" }}>Labour</span>
                  <span style={{ width: 100, textAlign: "right" as const, fontSize: 11, fontWeight: 700, color: "#374151" }}>Other</span>
                  <span style={{ width: 110, textAlign: "right" as const, fontSize: 11, fontWeight: 700, color: "#374151" }}>Section Total</span>
                </div>
                {sectionTotals.map(({ sec, t }, i) => (
                  <div key={sec.id} style={{ display: "flex", padding: "7px 12px", background: i % 2 === 0 ? "#fff" : "#fafafa", borderBottom: "1px solid #f1f5f9" }}>
                    <span style={{ flex: 1, fontSize: 12, color: "#374151" }}>{sec.name}</span>
                    <span style={{ width: 100, textAlign: "right" as const, fontSize: 12, color: "#374151" }}>{t.matSell > 0 ? fmt$(t.matSell) : "—"}</span>
                    <span style={{ width: 100, textAlign: "right" as const, fontSize: 12, color: "#374151" }}>{(t.elecSell+t.progSell+t.travelSell)>0 ? fmt$(t.elecSell+t.progSell+t.travelSell) : "—"}</span>
                    <span style={{ width: 100, textAlign: "right" as const, fontSize: 12, color: "#374151" }}>{t.otherSell>0?fmt$(t.otherSell):"—"}</span>
                    <span style={{ width: 110, textAlign: "right" as const, fontSize: 12, fontWeight: 700, color: "#0d2e5e" }}>{t.sectionSell>0?fmt$(t.sectionSell):"—"}</span>
                  </div>
                ))}
                {opts.showGrandTotal && (
                  <div style={{ display: "flex", padding: "10px 12px", background: "#0d2e5e" }}>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "#fff" }}>TOTAL</span>
                    <span style={{ width: 100, textAlign: "right" as const, fontSize: 12, fontWeight: 700, color: "#fff" }}>{summary.matSell>0?fmt$(summary.matSell):"—"}</span>
                    <span style={{ width: 100, textAlign: "right" as const, fontSize: 12, fontWeight: 700, color: "#fff" }}>{(summary.elecSell+summary.progSell+summary.travelSell)>0?fmt$(summary.elecSell+summary.progSell+summary.travelSell):"—"}</span>
                    <span style={{ width: 100, textAlign: "right" as const, fontSize: 12, fontWeight: 700, color: "#fff" }}>{summary.otherSell>0?fmt$(summary.otherSell):"—"}</span>
                    <span style={{ width: 110, textAlign: "right" as const, fontSize: 15, fontWeight: 900, color: "#fff" }}>{fmt$(summary.totalSell)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Terms */}
          <div style={{ paddingTop: 14, borderTop: "1px solid #e5e7eb", fontSize: 11, color: "#9ca3af", lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, color: "#6b7280", marginBottom: 3 }}>Terms &amp; Conditions</div>
            <div>This quote is valid for {quote.expiration || 30} days from the date of issue. All work completed in a professional manner per standard practices. Any alterations involving extra costs require written orders and will be charged accordingly.</div>
          </div>

          {/* Signatures */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, marginTop: 36 }}>
            <SigBlock label="Authorized Signature" />
            <SigBlock label="Customer Acceptance" />
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; background: #fff; }
          .print-page { padding: 20px !important; box-shadow: none !important; }
        }
      `}</style>
    </div>
  );
}

function InfoBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>{title}</div>
      <div style={{ fontSize: 13, color: "#111827" }}>{children}</div>
    </div>
  );
}

function SigBlock({ label }: { label: string }) {
  return (
    <div>
      <div style={{ borderBottom: "1px solid #374151", height: 44, marginBottom: 6 }} />
      <div style={{ fontSize: 11, color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: 11, color: "#d1d5db", marginTop: 3 }}>Name: ___________________________ &nbsp; Date: ______________</div>
    </div>
  );
}
