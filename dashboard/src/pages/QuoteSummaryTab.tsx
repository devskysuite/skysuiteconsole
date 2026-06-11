import { calcSummary, PricingData } from "./QuotePricingTab";

function fmt$(n: number) { return "$" + (n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtPct(n: number) { return (n * 100).toFixed(2) + "%"; }

const thS: React.CSSProperties = { padding:"9px 14px", textAlign:"left" as const, fontSize:11, fontWeight:700, color:"#6b7280", textTransform:"uppercase" as const, letterSpacing:0.4, background:"#f9fafb", borderBottom:"1px solid #e5e7eb" };
const tdS: React.CSSProperties = { padding:"10px 14px", fontSize:13, color:"#374151", borderBottom:"1px solid #f3f4f6", verticalAlign:"middle" as const };
const tdR: React.CSSProperties = { ...tdS, textAlign:"right" as const, fontWeight:600 };

export default function QuoteSummaryTab({ pricing }: { pricing: PricingData }) {
  const s = calcSummary(pricing);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

      {/* JOB INFORMATION header strip */}
      <div style={{ background:"#fff", borderRadius:12, border:"1px solid #e5e7eb", overflow:"hidden" }}>
        <div style={{ background:"#0d2e5e", padding:"12px 20px" }}>
          <span style={{ fontSize:15, fontWeight:800, color:"#fff", letterSpacing:0.5 }}>RBT ELECTRICAL &amp; AUTOMATION — QUOTE SUMMARY</span>
        </div>
      </div>

      {/* MATERIALS */}
      <SummaryCard title="Materials">
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>
              <th style={thS}>Source</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Cost</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Markup</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Sell Price</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={tdS}>Materials Sheet</td>
              <td style={tdR}>{fmt$(s.matCost)}</td>
              <td style={{ ...tdR, color:"#6b7280" }}>{fmtPct(pricing.settings.materialMarkup)}</td>
              <td style={{ ...tdR, color:"#16a34a" }}>{fmt$(s.matSell)}</td>
            </tr>
            <tr style={{ background:"#f9fafb" }}>
              <td style={{ ...tdS, fontWeight:700 }}>Material Sub-Total</td>
              <td style={{ ...tdR, fontWeight:700 }}>{fmt$(s.matCost)}</td>
              <td style={{ ...tdR, color:"#6b7280" }}>{fmtPct(pricing.settings.materialMarkup)}</td>
              <td style={{ ...tdR, fontWeight:700, color:"#16a34a" }}>{fmt$(s.matSell)}</td>
            </tr>
          </tbody>
        </table>
      </SummaryCard>

      {/* OTHER COSTS */}
      <SummaryCard title="Other Costs">
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>
              <th style={thS}>Description</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Cost</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Markup</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Sell Price</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={tdS}>Other Costs (all sections)</td>
              <td style={tdR}>{s.otherCost > 0 ? fmt$(s.otherCost) : "—"}</td>
              <td style={{ ...tdR, color:"#6b7280" }}>{fmtPct(pricing.settings.otherCostsMarkup)}</td>
              <td style={{ ...tdR, color: s.otherSell > 0 ? "#16a34a" : "#9ca3af" }}>{s.otherSell > 0 ? fmt$(s.otherSell) : "—"}</td>
            </tr>
            <tr style={{ background:"#f9fafb" }}>
              <td style={{ ...tdS, fontWeight:700 }}>Other Costs Sub-Total</td>
              <td style={{ ...tdR, fontWeight:700 }}>{fmt$(s.otherCost)}</td>
              <td />
              <td style={{ ...tdR, fontWeight:700, color:"#16a34a" }}>{fmt$(s.otherSell)}</td>
            </tr>
          </tbody>
        </table>
      </SummaryCard>

      {/* LABOUR */}
      <SummaryCard title="Labour">
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>
              <th style={thS}>Description</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Hours</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Rate</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Sell Price</th>
            </tr>
          </thead>
          <tbody>
            {/* Electrician lines */}
            {s.elecLines.length > 0 && (
              <tr style={{ background:"#eff6ff" }}>
                <td colSpan={4} style={{ ...tdS, fontWeight:700, color:"#1e40af", fontSize:12 }}>⚡ Electrician</td>
              </tr>
            )}
            {s.elecLines.map(l => (
              <tr key={l.id}>
                <td style={{ ...tdS, paddingLeft:24 }}>{l.description || "—"} <span style={{ color:"#9ca3af", fontSize:11 }}>({l.timeType})</span></td>
                <td style={tdR}>{l.hours}</td>
                <td style={{ ...tdR, color:"#6b7280" }}>{fmt$(l.rate)}/hr</td>
                <td style={{ ...tdR, color:"#16a34a" }}>{fmt$(l.sell)}</td>
              </tr>
            ))}
            {s.elecHours > 0 && (
              <tr style={{ background:"#f0f9ff" }}>
                <td style={{ ...tdS, fontWeight:600, paddingLeft:24 }}>Electrician Sub-Total</td>
                <td style={{ ...tdR, fontWeight:600 }}>{s.elecHours}</td>
                <td />
                <td style={{ ...tdR, fontWeight:700, color:"#16a34a" }}>{fmt$(s.elecSell)}</td>
              </tr>
            )}

            {/* Programmer lines */}
            {s.progLines.length > 0 && (
              <tr style={{ background:"#f0fdf4" }}>
                <td colSpan={4} style={{ ...tdS, fontWeight:700, color:"#166534", fontSize:12 }}>💻 Programmer</td>
              </tr>
            )}
            {s.progLines.map(l => (
              <tr key={l.id}>
                <td style={{ ...tdS, paddingLeft:24 }}>{l.description || "—"} <span style={{ color:"#9ca3af", fontSize:11 }}>({l.timeType})</span></td>
                <td style={tdR}>{l.hours}</td>
                <td style={{ ...tdR, color:"#6b7280" }}>{fmt$(l.rate)}/hr</td>
                <td style={{ ...tdR, color:"#16a34a" }}>{fmt$(l.sell)}</td>
              </tr>
            ))}
            {s.progHours > 0 && (
              <tr style={{ background:"#f0fdf4" }}>
                <td style={{ ...tdS, fontWeight:600, paddingLeft:24 }}>Programmer Sub-Total</td>
                <td style={{ ...tdR, fontWeight:600 }}>{s.progHours}</td>
                <td />
                <td style={{ ...tdR, fontWeight:700, color:"#16a34a" }}>{fmt$(s.progSell)}</td>
              </tr>
            )}

            {/* Travel */}
            <tr>
              <td style={tdS}>Travel &amp; Site ({s.totalTravelHrs} hrs)</td>
              <td style={tdR}>{s.totalTravelHrs}</td>
              <td />
              <td style={{ ...tdR, color:"#16a34a" }}>{fmt$(s.travelSell)}</td>
            </tr>

            {/* Labour total */}
            <tr style={{ background:"#f9fafb" }}>
              <td style={{ ...tdS, fontWeight:700 }}>Labour Sub-Total</td>
              <td style={{ ...tdR, fontWeight:700 }}>{s.elecHours + s.progHours + s.totalTravelHrs}</td>
              <td />
              <td style={{ ...tdR, fontWeight:700, color:"#16a34a" }}>{fmt$(s.labourSell)}</td>
            </tr>
          </tbody>
        </table>
      </SummaryCard>

      {/* JOB TOTALS */}
      <SummaryCard title="Job Totals">
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>
              <th style={thS}>Description</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Sell Price</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style={tdS}>Materials</td><td style={tdR}>{fmt$(s.matSell)}</td></tr>
            <tr><td style={tdS}>Other Costs</td><td style={tdR}>{fmt$(s.otherSell)}</td></tr>
            <tr><td style={tdS}>Labour &amp; Travel</td><td style={tdR}>{fmt$(s.labourSell)}</td></tr>
            <tr style={{ background:"#0d2e5e" }}>
              <td style={{ ...tdS, fontWeight:800, color:"#fff", fontSize:14 }}>TOTAL JOB PRICE</td>
              <td style={{ ...tdR, fontWeight:800, color:"#fff", fontSize:16 }}>{fmt$(s.totalSell)}</td>
            </tr>
          </tbody>
        </table>
      </SummaryCard>

      {/* PROFIT ANALYSIS */}
      <SummaryCard title="Profit Analysis">
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>
              <th style={thS}>Description</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Your Cost</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Client Price</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Margin $</th>
              <th style={{ ...thS, textAlign:"right" as const }}>Margin %</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label:"Materials",          cost:s.matCost,   sell:s.matSell },
              { label:"Other Costs",        cost:s.otherCost, sell:s.otherSell },
              { label:"Electrician Labour", cost:s.elecCost,  sell:s.elecSell },
              { label:"Programmer Labour",  cost:s.progCost,  sell:s.progSell },
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
              <td />
              <td />
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
