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

// ── Table styles ───────────────────────────────────────────────────────────────
const THEAD_STYLE: React.CSSProperties = { background: "#f1f5f9" };
const TH: React.CSSProperties = { padding: "8px 12px", textAlign: "left", fontWeight: 700, fontSize: 11, color: "#374151", borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap" };
const TH_R: React.CSSProperties = { ...TH, textAlign: "right" };
const TD: React.CSSProperties = { padding: "7px 12px", fontSize: 12, color: "#374151", borderBottom: "1px solid #f1f5f9" };
const TD_R: React.CSSProperties = { ...TD, textAlign: "right" };
const TD_BOLD: React.CSSProperties = { ...TD_R, fontWeight: 700, color: "#111827" };
const TFOOT_TD: React.CSSProperties = { padding: "8px 12px", fontWeight: 700, fontSize: 12, background: "#f8fafc", borderTop: "2px solid #e2e8f0", textAlign: "right" as const };

// ── Line item tables ───────────────────────────────────────────────────────────
function SectionTables({ sec, pricing, opts }: { sec: QuoteSection; pricing: PricingData; opts: PrintOptions }) {
  const s = pricing.settings;
  const { elecLines, progLines } = calcSectionTotals(sec, s);

  const mats  = sec.materials.filter(m => (m.qty || 0) > 0 || m.description.trim() || m.partNumber.trim());
  const elec  = elecLines.filter(l => (l.hours || 0) > 0 || l.description.trim());
  const prog  = progLines.filter(l => (l.hours || 0) > 0 || l.description.trim());
  const other = sec.otherCosts.filter(o => (o.cost || 0) > 0);
  const hasTrav = (sec.travel.days || 0) > 0 || (sec.travel.kmPerDay || 0) > 0;

  const showMat  = opts.showItemizedMaterials && mats.length > 0;
  const showElec = opts.showItemizedLabour && elec.length > 0;
  const showProg = opts.showItemizedLabour && prog.length > 0;
  const showOth  = opts.showOtherCosts && other.length > 0;
  const showTrav = opts.showTravel && hasTrav;

  if (!showMat && !showElec && !showProg && !showOth && !showTrav) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>

      {/* Labour — electrician */}
      {showElec && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Labour — Electrician</div>
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e2e8f0" }}>
            <thead style={THEAD_STYLE}>
              <tr>
                <th style={TH}>Description</th>
                <th style={TH}>Time Type</th>
                {opts.showLabourQty     && <th style={{ ...TH_R, width: 70 }}>Hours</th>}
                {opts.showLabourPricing && <th style={{ ...TH_R, width: 90 }}>Unit Price</th>}
                {opts.showLabourPricing && <th style={{ ...TH_R, width: 100 }}>Subtotal</th>}
              </tr>
            </thead>
            <tbody>
              {elec.map((l, i) => (
                <tr key={l.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={TD}>{l.description || "—"}</td>
                  <td style={TD}>{l.timeType}</td>
                  {opts.showLabourQty     && <td style={TD_R}>{l.hours || 0}</td>}
                  {opts.showLabourPricing && <td style={TD_R}>{fmt$(labourRate(s, "elec", l.timeType))}</td>}
                  {opts.showLabourPricing && <td style={TD_BOLD}>{fmt$(l.sell)}</td>}
                </tr>
              ))}
            </tbody>
            {opts.showLabourTotal && opts.showLabourPricing && (
              <tfoot>
                <tr>
                  <td colSpan={opts.showLabourQty ? 4 : 3} style={{ ...TFOOT_TD, textAlign: "left" }}>Electrician Labour Total</td>
                  <td style={TFOOT_TD}>{fmt$(elec.reduce((a, l) => a + l.sell, 0))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Labour — programmer */}
      {showProg && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Labour — Programming</div>
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e2e8f0" }}>
            <thead style={THEAD_STYLE}>
              <tr>
                <th style={TH}>Description</th>
                <th style={TH}>Time Type</th>
                {opts.showLabourQty     && <th style={{ ...TH_R, width: 70 }}>Hours</th>}
                {opts.showLabourPricing && <th style={{ ...TH_R, width: 90 }}>Unit Price</th>}
                {opts.showLabourPricing && <th style={{ ...TH_R, width: 100 }}>Subtotal</th>}
              </tr>
            </thead>
            <tbody>
              {prog.map((l, i) => (
                <tr key={l.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={TD}>{l.description || "—"}</td>
                  <td style={TD}>{l.timeType}</td>
                  {opts.showLabourQty     && <td style={TD_R}>{l.hours || 0}</td>}
                  {opts.showLabourPricing && <td style={TD_R}>{fmt$(labourRate(s, "prog", l.timeType))}</td>}
                  {opts.showLabourPricing && <td style={TD_BOLD}>{fmt$(l.sell)}</td>}
                </tr>
              ))}
            </tbody>
            {opts.showLabourTotal && opts.showLabourPricing && (
              <tfoot>
                <tr>
                  <td colSpan={opts.showLabourQty ? 4 : 3} style={{ ...TFOOT_TD, textAlign: "left" }}>Programming Labour Total</td>
                  <td style={TFOOT_TD}>{fmt$(prog.reduce((a, l) => a + l.sell, 0))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Materials */}
      {showMat && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Materials</div>
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e2e8f0" }}>
            <thead style={THEAD_STYLE}>
              <tr>
                <th style={TH}>Description</th>
                <th style={TH}>Part #</th>
                <th style={TH}>Manufacturer</th>
                {opts.showMaterialQty    && <th style={{ ...TH_R, width: 55 }}>Qty</th>}
                {opts.showMaterialQty    && <th style={{ ...TH_R, width: 50 }}>Unit</th>}
                {opts.showMaterialPricing && <th style={{ ...TH_R, width: 90 }}>Unit Cost</th>}
                {opts.showMaterialPricing && <th style={{ ...TH_R, width: 55 }}>Markup</th>}
                {opts.showMaterialPricing && <th style={{ ...TH_R, width: 100 }}>Subtotal</th>}
              </tr>
            </thead>
            <tbody>
              {mats.map((m, i) => {
                const sell = (m.qty || 0) * (m.unitPrice || 0) * (1 + s.materialMarkup);
                return (
                  <tr key={m.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={TD}>{m.description || "—"}</td>
                    <td style={TD}>{m.partNumber || "—"}</td>
                    <td style={TD}>{m.manufacturer || "—"}</td>
                    {opts.showMaterialQty    && <td style={TD_R}>{m.qty || 0}</td>}
                    {opts.showMaterialQty    && <td style={TD_R}>{m.unit || "ea"}</td>}
                    {opts.showMaterialPricing && <td style={TD_R}>{fmt$(m.unitPrice || 0)}</td>}
                    {opts.showMaterialPricing && <td style={TD_R}>{Math.round(s.materialMarkup * 100)}%</td>}
                    {opts.showMaterialPricing && <td style={TD_BOLD}>{fmt$(sell)}</td>}
                  </tr>
                );
              })}
            </tbody>
            {opts.showMaterialsTotal && opts.showMaterialPricing && (
              <tfoot>
                <tr>
                  <td colSpan={opts.showMaterialQty ? 7 : 5} style={{ ...TFOOT_TD, textAlign: "left" }}>Materials Total</td>
                  <td style={TFOOT_TD}>{fmt$(mats.reduce((a, m) => a + (m.qty||0)*(m.unitPrice||0)*(1+s.materialMarkup), 0))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Other Costs */}
      {showOth && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Other Costs</div>
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e2e8f0" }}>
            <thead style={THEAD_STYLE}>
              <tr>
                <th style={TH}>Description</th>
                <th style={{ ...TH_R, width: 90 }}>Unit Cost</th>
                <th style={{ ...TH_R, width: 65 }}>Markup</th>
                <th style={{ ...TH_R, width: 100 }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {other.map((o, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={TD}>{o.description}</td>
                  <td style={TD_R}>{fmt$(o.cost || 0)}</td>
                  <td style={TD_R}>{Math.round((o.markup ?? s.otherCostsMarkup) * 100)}%</td>
                  <td style={TD_BOLD}>{fmt$((o.cost||0)*(1+(o.markup??s.otherCostsMarkup)))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ ...TFOOT_TD, textAlign: "left" }}>Other Costs Total</td>
                <td style={TFOOT_TD}>{fmt$(other.reduce((a,o) => a+(o.cost||0)*(1+(o.markup??s.otherCostsMarkup)),0))}</td>
              </tr>
            </tfoot>
          </table>
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
            <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Travel</div>
            <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e2e8f0" }}>
              <thead style={THEAD_STYLE}><tr><th style={TH}>Description</th><th style={{ ...TH_R, width: 100 }}>Subtotal</th></tr></thead>
              <tbody>
                {timeSell > 0 && <tr><td style={TD}>{t.workers} worker(s) × {t.days} day(s) × {t.travelTimeHrs} hr/day @ {fmt$(s.travelRate)}/hr</td><td style={TD_BOLD}>{fmt$(timeSell)}</td></tr>}
                {mileSell > 0 && <tr style={{background:"#fafafa"}}><td style={TD}>{t.kmPerDay} km/day × {t.days} day(s) @ {fmt$(s.mileageRate)}/km</td><td style={TD_BOLD}>{fmt$(mileSell)}</td></tr>}
                {c407 > 0     && <tr><td style={TD}>407 Charges</td><td style={TD_BOLD}>{fmt$(c407)}</td></tr>}
              </tbody>
              <tfoot><tr><td style={{ ...TFOOT_TD, textAlign:"left" }}>Travel Total</td><td style={TFOOT_TD}>{fmt$(total)}</td></tr></tfoot>
            </table>
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
    const unsub = onSnapshot(
      doc(db, "quotes", quoteId),
      snap => { if (snap.exists()) setQuote(snap.data() as Quote); setLoading(false); },
      () => setLoading(false)
    );
    return unsub;
  }, [quoteId]);

  function set<K extends keyof PrintOptions>(k: K) {
    return (v: PrintOptions[K]) => setOpts(o => ({ ...o, [k]: v }));
  }

  if (loading) return <div style={{ padding: 60, textAlign: "center", fontFamily: "Arial, sans-serif", color: "#6b7280" }}>Loading…</div>;
  if (!quote)  return <div style={{ padding: 60, textAlign: "center", fontFamily: "Arial, sans-serif" }}>Quote not found or access denied. Make sure you are logged in.</div>;

  const pricing       = migratePricing((quote as any).pricing);
  const summary       = calcSummary(pricing);
  const sectionTotals = pricing.sections.map(sec => ({ sec, t: calcSectionTotals(sec, pricing.settings) }));
  const today         = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div style={{ fontFamily: "Arial, sans-serif", color: "#111827", minHeight: "100vh", background: "#f0f2f5" }}>

      {/* ── Top action bar ── */}
      <div className="no-print" style={{ background: "#0d2e5e", padding: "10px 20px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 14, flex: 1 }}>Quote {quote.quoteNumber} — Print Preview</span>
        <button
          onClick={() => setOptOpen(o => !o)}
          style={{ background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.35)", borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          ⚙ PDF Options {optOpen ? "▲" : "▼"}
        </button>
        <button
          onClick={() => window.print()}
          style={{ background: "#1e7d3a", color: "#fff", border: "none", borderRadius: 7, padding: "8px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
        >
          🖨 Print / Save as PDF
        </button>
        <button
          onClick={() => window.close()}
          style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 7, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          ✕ Close
        </button>
      </div>

      {/* ── PDF Options panel (collapsible) ── */}
      {optOpen && (
        <div className="no-print" style={{ background: "#fff", borderBottom: "2px solid #e5e7eb", padding: "16px 24px" }}>
          <div style={{ maxWidth: 900, margin: "0 auto" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0d2e5e", marginBottom: 14, textTransform: "uppercase", letterSpacing: 0.5 }}>PDF Options — toggle what appears in the printed document</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0 32px" }}>

              <OptGroup title="Sections">
                <Toggle label="Section Name"     checked={opts.showSectionName}     onChange={set("showSectionName")} />
                <Toggle label="Scope Text"        checked={opts.showScopeText}       onChange={set("showScopeText")} />
                <Toggle label="Section Subtotal"  checked={opts.showSectionSubtotal} onChange={set("showSectionSubtotal")} />
              </OptGroup>

              <OptGroup title="Labour">
                <Toggle label="Show Labour Total"    checked={opts.showLabourTotal}    onChange={set("showLabourTotal")} />
                <Toggle label="Show Itemized Labour" checked={opts.showItemizedLabour} onChange={set("showItemizedLabour")} />
                <Toggle label="Show Pricing" checked={opts.showLabourPricing} onChange={set("showLabourPricing")} indent disabled={!opts.showItemizedLabour} />
                <Toggle label="Show Hours"   checked={opts.showLabourQty}     onChange={set("showLabourQty")}     indent disabled={!opts.showItemizedLabour} />
              </OptGroup>

              <OptGroup title="Materials">
                <Toggle label="Show Items Total"    checked={opts.showMaterialsTotal}    onChange={set("showMaterialsTotal")} />
                <Toggle label="Show Itemized Items" checked={opts.showItemizedMaterials} onChange={set("showItemizedMaterials")} />
                <Toggle label="Show Pricing"  checked={opts.showMaterialPricing} onChange={set("showMaterialPricing")} indent disabled={!opts.showItemizedMaterials} />
                <Toggle label="Show Quantity" checked={opts.showMaterialQty}     onChange={set("showMaterialQty")}     indent disabled={!opts.showItemizedMaterials} />
              </OptGroup>

              <OptGroup title="Other">
                <Toggle label="Show Other Costs" checked={opts.showOtherCosts} onChange={set("showOtherCosts")} />
                <Toggle label="Show Travel"      checked={opts.showTravel}     onChange={set("showTravel")} />
              </OptGroup>

              <OptGroup title="Totals">
                <Toggle label="Summary Table" checked={opts.showSummaryTable} onChange={set("showSummaryTable")} />
                <Toggle label="Grand Total"   checked={opts.showGrandTotal}   onChange={set("showGrandTotal")} />
              </OptGroup>

            </div>
          </div>
        </div>
      )}

      {/* ── Print document ── */}
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

          {/* Title */}
          <div style={{ fontSize: 17, fontWeight: 800, color: "#0d2e5e", marginBottom: 18 }}>{quote.title}</div>

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
              <div key={sec.id} style={{ marginBottom: 32, pageBreakInside: "avoid" }}>
                {/* Section title bar — matches the ServiceTitan style: blue bold title + total */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "2px solid #1e40af", paddingBottom: 6, marginBottom: 10 }}>
                  {opts.showSectionName
                    ? <div style={{ fontSize: 15, fontWeight: 800, color: "#1e40af" }}>{sec.name || `Section ${i + 1}`}</div>
                    : <div style={{ fontSize: 13, fontWeight: 700, color: "#6b7280" }}>Section {i + 1}</div>}
                  {opts.showSectionSubtotal && t.sectionSell > 0 && (
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#1e40af" }}>{fmt$(t.sectionSell)}</div>
                  )}
                </div>

                {/* Scope text */}
                {opts.showScopeText && sec.scopeOfWork?.trim() && (
                  <div style={{ fontSize: 12, lineHeight: 1.85, color: "#374151", marginBottom: 14, whiteSpace: "pre-wrap" }}>{sec.scopeOfWork}</div>
                )}

                {/* Line item tables */}
                <SectionTables sec={sec} pricing={pricing} opts={opts} />
              </div>
            );
          })}

          {/* Summary table */}
          {opts.showSummaryTable && (
            <div style={{ marginTop: 16, marginBottom: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#0d2e5e", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Summary</div>
              <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e2e8f0", fontSize: 12 }}>
                <thead style={THEAD_STYLE}>
                  <tr>
                    <th style={TH}>Section</th>
                    <th style={TH_R}>Materials</th>
                    <th style={TH_R}>Labour</th>
                    <th style={TH_R}>Other</th>
                    <th style={TH_R}>Section Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sectionTotals.map(({ sec, t }, i) => (
                    <tr key={sec.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                      <td style={TD}>{sec.name}</td>
                      <td style={TD_R}>{t.matSell > 0 ? fmt$(t.matSell) : "—"}</td>
                      <td style={TD_R}>{(t.elecSell+t.progSell+t.travelSell)>0 ? fmt$(t.elecSell+t.progSell+t.travelSell) : "—"}</td>
                      <td style={TD_R}>{t.otherSell > 0 ? fmt$(t.otherSell) : "—"}</td>
                      <td style={{ ...TD_BOLD, color: "#0d2e5e" }}>{t.sectionSell > 0 ? fmt$(t.sectionSell) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                {opts.showGrandTotal && (
                  <tfoot>
                    <tr style={{ background: "#0d2e5e" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 800, color: "#fff", fontSize: 13 }}>TOTAL</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#fff", fontWeight: 700 }}>{summary.matSell>0?fmt$(summary.matSell):"—"}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#fff", fontWeight: 700 }}>{(summary.elecSell+summary.progSell+summary.travelSell)>0?fmt$(summary.elecSell+summary.progSell+summary.travelSell):"—"}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#fff", fontWeight: 700 }}>{summary.otherSell>0?fmt$(summary.otherSell):"—"}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 900, fontSize: 15, color: "#fff" }}>{fmt$(summary.totalSell)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
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
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; }
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
