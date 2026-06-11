import { calcSectionTotals, calcSummary, PricingData } from "./QuotePricingTab";

function fmt$(n: number) { return "$" + (n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtPct(n: number) { return (n * 100).toFixed(2) + "%"; }

const thS: React.CSSProperties = { padding:"9px 14px", textAlign:"left" as const, fontSize:11, fontWeight:700, color:"#6b7280", textTransform:"uppercase" as const, letterSpacing:0.4, background:"#f9fafb", borderBottom:"1px solid #e5e7eb" };
const tdS: React.CSSProperties = { padding:"10px 14px", fontSize:13, color:"#374151", borderBottom:"1px solid #f3f4f6", verticalAlign:"middle" as const };
const tdR: React.CSSProperties = { ...tdS, textAlign:"right" as const, fontWeight:600 };
const secHdr: React.CSSProperties = { background:"#0d2e5e", color:"#fff", fontWeight:800, fontSize:12, padding:"7px 14px", letterSpacing:0.4 };

export default function QuoteSummaryTab({ pricing }: { pricing: PricingData }) {
  const s = calcSummary(pricing);
  const sections = pricing.sections || [];
  const sectionTotals = sections.map(sec => ({ sec, t: calcSectionTotals(sec, pricing.settings) }));

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

      {/* Header */}
      <div style={{ background:"#fff", borderRadius:12, border:"1px solid #e5e7eb", overflow:"hidden" }}>
        <div style={{ background:"#0d2e5e", padding:"12px 20px" }}>
          <span style={{ fontSize:15, fontWeight:800, color:"#fff", letterSpacing:0.5 }}>RBT ELECTRICAL &amp; AUTOMATION — QUOTE SUMMARY</span>
        </div>
      </div>

      {/* Per-section breakdown */}
      <SummaryCard title="Section Breakdown">
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>
              <th style={thS}>Section</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Materials</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Elec Labour</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Prog Labour</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Other Costs</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Travel</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Section Total</th>
            </tr>
          </thead>
          <tbody>
            {sectionTotals.map(({ sec, t }, i) => (
              <tr key={sec.id} style={{ background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                <td style={tdS}>{sec.name || `Section ${i + 1}`}</td>
                <td style={tdR}>{t.matSell > 0 ? fmt$(t.matSell) : "—"}</td>
                <td style={tdR}>{t.elecSell > 0 ? fmt$(t.elecSell) : "—"}</td>
                <td style={tdR}>{t.progSell > 0 ? fmt$(t.progSell) : "—"}</td>
                <td style={tdR}>{t.otherSell > 0 ? fmt$(t.otherSell) : "—"}</td>
                <td style={tdR}>{t.travelSell > 0 ? fmt$(t.travelSell) : "—"}</td>
                <td style={{ ...tdR, fontWeight:800, color:"#0d2e5e" }}>{t.sectionSell > 0 ? fmt$(t.sectionSell) : "—"}</td>
              </tr>
            ))}
            <tr style={{ background:"#0d2e5e" }}>
              <td style={{ ...tdS, fontWeight:800, color:"#fff" }}>TOTAL</td>
              <td style={{ ...tdR, color:"#fff" }}>{fmt$(s.matSell)}</td>
              <td style={{ ...tdR, color:"#fff" }}>{fmt$(s.elecSell)}</td>
              <td style={{ ...tdR, color:"#fff" }}>{fmt$(s.progSell)}</td>
              <td style={{ ...tdR, color:"#fff" }}>{fmt$(s.otherSell)}</td>
              <td style={{ ...tdR, color:"#fff" }}>{fmt$(s.travelSell)}</td>
              <td style={{ ...tdR, fontWeight:900, color:"#22d3ee", fontSize:14 }}>{fmt$(s.totalSell)}</td>
            </tr>
          </tbody>
        </table>
      </SummaryCard>

      {/* Profit Analysis */}
      <SummaryCard title="Profit Analysis">
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>
              <th style={thS}>Category</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Your Cost</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Client Price</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Margin $</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Margin %</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label:"Materials",          cost:s.matCost,    sell:s.matSell },
              { label:"Other Costs",        cost:s.otherCost,  sell:s.otherSell },
              { label:"Electrician Labour", cost:s.elecCost,   sell:s.elecSell },
              { label:"Programmer Labour",  cost:s.progCost,   sell:s.progSell },
              { label:"Travel & Site",      cost:s.travelCost, sell:s.travelSell },
            ].map(({ label, cost, sell }) => {
              const margin = sell - cost;
              const pct = sell > 0 ? margin / sell : 0;
              return (
                <tr key={label}>
                  <td style={tdS}>{label}</td>
                  <td style={tdR}>{cost > 0 ? fmt$(cost) : "—"}</td>
                  <td style={tdR}>{sell > 0 ? fmt$(sell) : "—"}</td>
                  <td style={{ ...tdR, color: margin > 0 ? "#16a34a" : "#6b7280" }}>{sell > 0 ? fmt$(margin) : "—"}</td>
                  <td style={{ ...tdR, color: margin > 0 ? "#16a34a" : "#6b7280" }}>{sell > 0 ? fmtPct(pct) : "—"}</td>
                </tr>
              );
            })}
            {s.overhead > 0 && (
              <tr>
                <td style={tdS}>Overhead (labour sell × rate)</td>
                <td style={tdR}>{fmt$(s.overhead)}</td>
                <td style={{ ...tdR, color:"#9ca3af" }}>—</td>
                <td style={{ ...tdR, color:"#9ca3af" }}>—</td>
                <td style={tdR}>{fmtPct(pricing.settings.overheadRate)}</td>
              </tr>
            )}
            <tr style={{ background:"#f9fafb", borderTop:"2px solid #e5e7eb" }}>
              <td style={{ ...tdS, fontWeight:700 }}>NET PROFIT</td>
              <td style={{ ...tdR, fontWeight:700 }}>{fmt$(s.totalCost)}</td>
              <td style={{ ...tdR, fontWeight:700 }}>{fmt$(s.totalSell)}</td>
              <td style={{ ...tdR, fontWeight:700, color:"#16a34a" }}>{fmt$(s.netProfit)}</td>
              <td style={{ ...tdR, fontWeight:700, color:"#16a34a" }}>{fmtPct(s.netMarginPct)}</td>
            </tr>
            <tr>
              <td style={tdS}>After-Tax Profit (tax rate: {fmtPct(pricing.settings.taxRate)})</td>
              <td /><td />
              <td style={{ ...tdR, color:"#374151" }}>{fmt$(s.afterTaxProfit)}</td>
              <td style={{ ...tdR, color:"#374151" }}>{fmtPct(s.afterTaxPct)}</td>
            </tr>
          </tbody>
        </table>
      </SummaryCard>

    </div>
  );
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background:"#fff", borderRadius:12, border:"1px solid #e5e7eb", overflow:"hidden" }}>
      <div style={{ padding:"10px 16px", borderBottom:"1px solid #e5e7eb", background:"#f9fafb" }}>
        <span style={{ fontSize:13, fontWeight:700, color:"#374151", textTransform:"uppercase", letterSpacing:0.5 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}
