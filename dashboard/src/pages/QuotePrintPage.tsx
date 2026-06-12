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

// ── Toggle component ───────────────────────────────────────────────────────────
function Toggle({ label, checked, onChange, indent = false, disabled = false }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; indent?: boolean; disabled?: boolean;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: `5px ${indent ? "0 5px 20px" : "0"}`, opacity: disabled ? 0.4 : 1, cursor: disabled ? "not-allowed" : "pointer" }}>
      <span style={{ fontSize: 12, color: indent ? "#6b7280" : "#374151", fontWeight: indent ? 400 : 500, paddingLeft: indent ? 14 : 0 }}>{label}</span>
      <div
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: 36, height: 20, borderRadius: 10, position: "relative", flexShrink: 0, cursor: disabled ? "not-allowed" : "pointer",
          background: checked && !disabled ? "#1e7d3a" : "#d1d5db", transition: "background 0.2s",
        }}
      >
        <div style={{
          position: "absolute", top: 2, left: checked ? 18 : 2, width: 16, height: 16,
          borderRadius: "50%", background: "#fff", transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }} />
      </div>
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

// ── Table styles ───────────────────────────────────────────────────────────────
const TH: React.CSSProperties = { padding: "7px 10px", textAlign: "left", fontWeight: 700, fontSize: 11, color: "#fff", background: "#1e3a5f", whiteSpace: "nowrap" };
const TH_R: React.CSSProperties = { ...TH, textAlign: "right" };
const TD: React.CSSProperties = { padding: "6px 10px", fontSize: 12, color: "#374151", borderBottom: "1px solid #f1f5f9" };
const TD_R: React.CSSProperties = { ...TD, textAlign: "right" };
const TD_BOLD: React.CSSProperties = { ...TD_R, fontWeight: 700, color: "#111827" };

// ── Per-section line item tables ───────────────────────────────────────────────
function SectionLineItems({ sec, pricing, opts }: { sec: QuoteSection; pricing: PricingData; opts: PrintOptions }) {
  const s = pricing.settings;
  const { elecLines, progLines } = calcSectionTotals(sec, s);

  const mats   = sec.materials.filter(m => (m.qty || 0) > 0 || m.description.trim() || m.partNumber.trim());
  const elec   = elecLines.filter(l => (l.hours || 0) > 0 || l.description.trim());
  const prog   = progLines.filter(l => (l.hours || 0) > 0 || l.description.trim());
  const other  = sec.otherCosts.filter(o => (o.cost || 0) > 0);
  const hasTravel = (sec.travel.days || 0) > 0 || (sec.travel.kmPerDay || 0) > 0;

  const showMat   = opts.showItemizedMaterials && mats.length > 0;
  const showElec  = opts.showItemizedLabour && elec.length > 0;
  const showProg  = opts.showItemizedLabour && prog.length > 0;
  const showOther = opts.showOtherCosts && other.length > 0;
  const showTrav  = opts.showTravel && hasTravel;

  if (!showMat && !showElec && !showProg && !showOther && !showTrav) return null;

  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Materials */}
      {showMat && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#0d2e5e", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Materials</div>
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e5e7eb" }}>
            <thead>
              <tr>
                <th style={TH}>Description</th>
                <th style={TH}>Part #</th>
                <th style={TH}>Manufacturer</th>
                <th style={TH}>Supplier</th>
                {opts.showMaterialQty    && <th style={{ ...TH_R, width: 50 }}>Qty</th>}
                {opts.showMaterialQty    && <th style={{ ...TH_R, width: 50 }}>Unit</th>}
                {opts.showMaterialPricing && <th style={{ ...TH_R, width: 88 }}>Unit Price</th>}
                {opts.showMaterialPricing && <th style={{ ...TH_R, width: 92 }}>Extended</th>}
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
                    <td style={TD}>{m.supplier || "—"}</td>
                    {opts.showMaterialQty    && <td style={TD_R}>{m.qty || 0}</td>}
                    {opts.showMaterialQty    && <td style={TD_R}>{m.unit || "ea"}</td>}
                    {opts.showMaterialPricing && <td style={TD_R}>{fmt$(m.unitPrice || 0)}</td>}
                    {opts.showMaterialPricing && <td style={TD_BOLD}>{fmt$(sell)}</td>}
                  </tr>
                );
              })}
            </tbody>
            {opts.showMaterialsTotal && opts.showMaterialPricing && (
              <tfoot>
                <tr style={{ background: "#f8fafc" }}>
                  <td colSpan={opts.showMaterialQty ? 6 : 4} style={{ ...TD, fontWeight: 700 }}>Materials Total</td>
                  <td colSpan={2} style={TD_BOLD}>{fmt$(mats.reduce((sum, m) => sum + (m.qty||0)*(m.unitPrice||0)*(1+s.materialMarkup), 0))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Electrician Labour */}
      {showElec && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#0d2e5e", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Electrician Labour</div>
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e5e7eb" }}>
            <thead>
              <tr>
                <th style={TH}>Description</th>
                <th style={{ ...TH, width: 120 }}>Time Type</th>
                {opts.showLabourQty     && <th style={{ ...TH_R, width: 65 }}>Hours</th>}
                {opts.showLabourPricing && <th style={{ ...TH_R, width: 88 }}>Rate/hr</th>}
                {opts.showLabourPricing && <th style={{ ...TH_R, width: 92 }}>Amount</th>}
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
                <tr style={{ background: "#f8fafc" }}>
                  <td colSpan={opts.showLabourQty ? 3 : 2} style={{ ...TD, fontWeight: 700 }}>Electrician Labour Total</td>
                  <td colSpan={2} style={TD_BOLD}>{fmt$(elec.reduce((s, l) => s + l.sell, 0))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Programmer Labour */}
      {showProg && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#0d2e5e", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Programming Labour</div>
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e5e7eb" }}>
            <thead>
              <tr>
                <th style={TH}>Description</th>
                <th style={{ ...TH, width: 120 }}>Time Type</th>
                {opts.showLabourQty     && <th style={{ ...TH_R, width: 65 }}>Hours</th>}
                {opts.showLabourPricing && <th style={{ ...TH_R, width: 88 }}>Rate/hr</th>}
                {opts.showLabourPricing && <th style={{ ...TH_R, width: 92 }}>Amount</th>}
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
                <tr style={{ background: "#f8fafc" }}>
                  <td colSpan={opts.showLabourQty ? 3 : 2} style={{ ...TD, fontWeight: 700 }}>Programming Labour Total</td>
                  <td colSpan={2} style={TD_BOLD}>{fmt$(prog.reduce((s, l) => s + l.sell, 0))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Other Costs */}
      {showOther && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#0d2e5e", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Other Costs</div>
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e5e7eb" }}>
            <thead><tr><th style={TH}>Description</th><th style={{ ...TH_R, width: 92 }}>Amount</th></tr></thead>
            <tbody>
              {other.map((o, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={TD}>{o.description}</td>
                  <td style={TD_BOLD}>{fmt$((o.cost||0)*(1+(o.markup??s.otherCostsMarkup)))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "#f8fafc" }}>
                <td style={{ ...TD, fontWeight: 700 }}>Other Costs Total</td>
                <td style={TD_BOLD}>{fmt$(other.reduce((sum, o) => sum + (o.cost||0)*(1+(o.markup??s.otherCostsMarkup)), 0))}</td>
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
        return (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#0d2e5e", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Travel</div>
            <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e5e7eb" }}>
              <tbody>
                {timeSell > 0 && <tr style={{ background: "#fff" }}><td style={TD}>{t.workers} worker(s) × {t.days} day(s) × {t.travelTimeHrs} hr/day @ {fmt$(s.travelRate)}/hr</td><td style={TD_BOLD}>{fmt$(timeSell)}</td></tr>}
                {mileSell > 0 && <tr style={{ background: "#fafafa" }}><td style={TD}>{t.kmPerDay} km/day × {t.days} day(s) @ {fmt$(s.mileageRate)}/km</td><td style={TD_BOLD}>{fmt$(mileSell)}</td></tr>}
                {c407 > 0     && <tr style={{ background: "#fff" }}><td style={TD}>407 Charges</td><td style={TD_BOLD}>{fmt$(c407)}</td></tr>}
              </tbody>
              <tfoot>
                <tr style={{ background: "#f8fafc" }}>
                  <td style={{ ...TD, fontWeight: 700 }}>Travel Total</td>
                  <td style={TD_BOLD}>{fmt$(timeSell + mileSell + c407)}</td>
                </tr>
              </tfoot>
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
  const [quote, setQuote]   = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [opts, setOpts]     = useState<PrintOptions>(DEFAULT_OPTIONS);

  useEffect(() => {
    if (!quoteId) return;
    return onSnapshot(doc(db, "quotes", quoteId), snap => {
      if (snap.exists()) setQuote(snap.data() as Quote);
      setLoading(false);
    });
  }, [quoteId]);

  function set<K extends keyof PrintOptions>(k: K) {
    return (v: PrintOptions[K]) => setOpts(o => ({ ...o, [k]: v }));
  }

  if (loading) return <div style={{ padding: 60, textAlign: "center", fontFamily: "Arial, sans-serif", color: "#6b7280" }}>Loading…</div>;
  if (!quote)  return <div style={{ padding: 60, textAlign: "center", fontFamily: "Arial, sans-serif" }}>Quote not found.</div>;

  const pricing      = migratePricing((quote as any).pricing);
  const summary      = calcSummary(pricing);
  const sectionTotals = pricing.sections.map(sec => ({ sec, t: calcSectionTotals(sec, pricing.settings) }));
  const today        = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

  return (
    <>
      {/* ── Top bar (no-print) ── */}
      <div className="no-print" style={{ background: "#0d2e5e", padding: "12px 24px", display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 15, flex: 1 }}>Quote Preview — {quote.quoteNumber}</span>
        <button onClick={() => window.print()} style={{ background: "#1e7d3a", color: "#fff", border: "none", borderRadius: 8, padding: "9px 22px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          🖨 Print / Save as PDF
        </button>
        <button onClick={() => window.close()} style={{ background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          Close
        </button>
      </div>

      {/* ── Layout: settings panel + print area ── */}
      <div style={{ display: "flex", alignItems: "flex-start", minHeight: "100vh", background: "#f0f2f5" }}>

        {/* Settings sidebar (no-print) */}
        <div className="no-print" style={{ width: 260, flexShrink: 0, background: "#fff", borderRight: "1px solid #e5e7eb", padding: "20px 18px", minHeight: "100vh", overflowY: "auto" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#0d2e5e", marginBottom: 18 }}>PDF Options</div>

          <Section title="Sections">
            <Toggle label="Show Section Name"        checked={opts.showSectionName}     onChange={set("showSectionName")} />
            <Toggle label="Show Section Description" checked={opts.showScopeText}       onChange={set("showScopeText")} />
            <Toggle label="Show Section Subtotal"    checked={opts.showSectionSubtotal} onChange={set("showSectionSubtotal")} />
          </Section>

          <Section title="Labour">
            <Toggle label="Show Labour Total"    checked={opts.showLabourTotal}     onChange={set("showLabourTotal")} />
            <Toggle label="Show Itemized Labour" checked={opts.showItemizedLabour}  onChange={set("showItemizedLabour")} />
            <Toggle label="Show Pricing" checked={opts.showLabourPricing} onChange={set("showLabourPricing")} indent disabled={!opts.showItemizedLabour} />
            <Toggle label="Show Quantity" checked={opts.showLabourQty}    onChange={set("showLabourQty")}     indent disabled={!opts.showItemizedLabour} />
          </Section>

          <Section title="Items (Materials)">
            <Toggle label="Show Items Total"    checked={opts.showMaterialsTotal}    onChange={set("showMaterialsTotal")} />
            <Toggle label="Show Itemized Items" checked={opts.showItemizedMaterials} onChange={set("showItemizedMaterials")} />
            <Toggle label="Show Pricing"  checked={opts.showMaterialPricing} onChange={set("showMaterialPricing")} indent disabled={!opts.showItemizedMaterials} />
            <Toggle label="Show Quantity" checked={opts.showMaterialQty}     onChange={set("showMaterialQty")}     indent disabled={!opts.showItemizedMaterials} />
          </Section>

          <Section title="Other">
            <Toggle label="Show Other Costs" checked={opts.showOtherCosts} onChange={set("showOtherCosts")} />
            <Toggle label="Show Travel"      checked={opts.showTravel}     onChange={set("showTravel")} />
          </Section>

          <Section title="Totals &amp; Subtotals">
            <Toggle label="Show Summary Table" checked={opts.showSummaryTable} onChange={set("showSummaryTable")} />
            <Toggle label="Show Total"         checked={opts.showGrandTotal}   onChange={set("showGrandTotal")} />
          </Section>
        </div>

        {/* Print content */}
        <div style={{ flex: 1, padding: "24px 16px", display: "flex", justifyContent: "center" }}>
          <div className="print-page" style={{ width: 960, background: "#fff", padding: "32px 40px", fontFamily: "Arial, sans-serif", color: "#111827", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, borderBottom: "3px solid #0d2e5e", paddingBottom: 18 }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#0d2e5e", letterSpacing: -0.5 }}>RBT Electrical &amp; Automation Services</div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3 }}>Professional Electrical &amp; Automation Solutions</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#0d2e5e" }}>QUOTE</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#374151" }}>#{quote.quoteNumber}</div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>Date: {today}</div>
                {quote.expiration && <div style={{ fontSize: 11, color: "#6b7280" }}>Valid for {quote.expiration} days</div>}
              </div>
            </div>

            {/* Title */}
            <div style={{ fontSize: 17, fontWeight: 800, color: "#0d2e5e", marginBottom: 20 }}>{quote.title}</div>

            {/* Bill To / Site / Contacts */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 28 }}>
              <InfoBlock title="Bill To">
                <div style={{ fontWeight: 600 }}>{quote.billingCustomer || quote.customerName}</div>
                {quote.billingAddress && <div style={{ marginTop: 3, color: "#4b5563", fontSize: 12, whiteSpace: "pre-line" }}>{quote.billingAddress}</div>}
              </InfoBlock>
              <InfoBlock title="Site / Property">
                <div style={{ fontWeight: 600 }}>{quote.propertyName}</div>
                {quote.propertyAddress && <div style={{ marginTop: 3, color: "#4b5563", fontSize: 12, whiteSpace: "pre-line" }}>{quote.propertyAddress}</div>}
              </InfoBlock>
              <InfoBlock title="Contacts">
                {quote.companyRepresentative && (
                  <div>
                    <span style={{ fontWeight: 600 }}>{quote.companyRepresentative}</span>
                    {quote.companyRepPhone && <div style={{ fontSize: 12, color: "#4b5563" }}>{quote.companyRepPhone}</div>}
                    {quote.companyRepEmail && <div style={{ fontSize: 12, color: "#4b5563" }}>{quote.companyRepEmail}</div>}
                  </div>
                )}
                {quote.soldBy        && <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>Prepared by: {quote.soldBy}</div>}
                {quote.projectManager && <div style={{ fontSize: 12, color: "#6b7280" }}>Project Mgr: {quote.projectManager}</div>}
              </InfoBlock>
            </div>

            {/* Sections */}
            {pricing.sections.map((sec, i) => {
              const { t } = sectionTotals[i];
              return (
                <div key={sec.id} style={{ marginBottom: 28, pageBreakInside: "avoid" }}>
                  {/* Section header */}
                  <div style={{ background: "#0d2e5e", color: "#fff", padding: "9px 14px", borderRadius: "6px 6px 0 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.5, marginRight: 10 }}>Section {i + 1}</span>
                      {opts.showSectionName && <span style={{ fontSize: 14, fontWeight: 800 }}>{sec.name || `Section ${i + 1}`}</span>}
                    </div>
                    {opts.showSectionSubtotal && t.sectionSell > 0 && (
                      <div style={{ fontSize: 14, fontWeight: 800 }}>{fmt$(t.sectionSell)}</div>
                    )}
                  </div>

                  <div style={{ border: "1px solid #e5e7eb", borderTop: "none", borderRadius: "0 0 6px 6px", overflow: "hidden", padding: "14px 16px" }}>
                    {opts.showScopeText && sec.scopeOfWork?.trim() && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Scope of Work</div>
                        <div style={{ fontSize: 12, lineHeight: 1.8, color: "#374151", whiteSpace: "pre-wrap" }}>{sec.scopeOfWork}</div>
                      </div>
                    )}
                    <SectionLineItems sec={sec} pricing={pricing} opts={opts} />
                  </div>
                </div>
              );
            })}

            {/* Summary table */}
            {opts.showSummaryTable && (
              <div style={{ marginTop: 8, marginBottom: 28 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0d2e5e", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Summary</div>
                <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e5e7eb", fontSize: 12 }}>
                  <thead>
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
                        <td style={TD_R}>{(t.elecSell + t.progSell + t.travelSell) > 0 ? fmt$(t.elecSell + t.progSell + t.travelSell) : "—"}</td>
                        <td style={TD_R}>{t.otherSell > 0 ? fmt$(t.otherSell) : "—"}</td>
                        <td style={{ ...TD_BOLD, color: "#0d2e5e" }}>{t.sectionSell > 0 ? fmt$(t.sectionSell) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  {opts.showGrandTotal && (
                    <tfoot>
                      <tr style={{ background: "#0d2e5e" }}>
                        <td style={{ padding: "11px 10px", fontWeight: 800, fontSize: 13, color: "#fff" }}>TOTAL</td>
                        <td style={{ padding: "11px 10px", textAlign: "right", color: "#fff", fontWeight: 700 }}>{summary.matSell > 0 ? fmt$(summary.matSell) : "—"}</td>
                        <td style={{ padding: "11px 10px", textAlign: "right", color: "#fff", fontWeight: 700 }}>{(summary.elecSell + summary.progSell + summary.travelSell) > 0 ? fmt$(summary.elecSell + summary.progSell + summary.travelSell) : "—"}</td>
                        <td style={{ padding: "11px 10px", textAlign: "right", color: "#fff", fontWeight: 700 }}>{summary.otherSell > 0 ? fmt$(summary.otherSell) : "—"}</td>
                        <td style={{ padding: "11px 10px", textAlign: "right", fontWeight: 900, fontSize: 15, color: "#fff" }}>{fmt$(summary.totalSell)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}

            {/* Terms */}
            <div style={{ marginTop: 24, paddingTop: 14, borderTop: "1px solid #e5e7eb", fontSize: 11, color: "#9ca3af", lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>Terms &amp; Conditions</div>
              <div>This quote is valid for {quote.expiration || 30} days from the date of issue. Prices are subject to change after this period. All work to be completed in a professional manner according to standard practices. Any alteration or deviation from the above specifications involving extra costs will be executed only upon written orders and will become an extra charge over and above the estimate.</div>
            </div>

            {/* Signatures */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, marginTop: 36 }}>
              <SigBlock label="Authorized Signature" />
              <SigBlock label="Customer Acceptance" />
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; background: #fff; }
          .print-page { width: 100% !important; max-width: 100% !important; padding: 20px !important; box-shadow: none !important; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; }
        }
      `}</style>
    </>
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
      <div style={{ borderBottom: "1px solid #374151", height: 40, marginBottom: 6 }} />
      <div style={{ fontSize: 11, color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: 11, color: "#d1d5db", marginTop: 4 }}>Name: ___________________________ &nbsp; Date: ______________</div>
    </div>
  );
}
