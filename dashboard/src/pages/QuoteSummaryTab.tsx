import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { calcSectionTotals, calcSummary, PricingData } from "./QuotePricingTab";

function fmt$(n: number) { return "$" + (n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtPct(n: number) { return (n * 100).toFixed(2) + "%"; }

const thS: React.CSSProperties = { padding:"9px 14px", textAlign:"left" as const, fontSize:11, fontWeight:700, color:"#6b7280", textTransform:"uppercase" as const, letterSpacing:0.4, background:"#f9fafb", borderBottom:"1px solid #e5e7eb" };
const tdS: React.CSSProperties = { padding:"10px 14px", fontSize:13, color:"#374151", borderBottom:"1px solid #f3f4f6", verticalAlign:"middle" as const };
const tdR: React.CSSProperties = { ...tdS, textAlign:"right" as const, fontWeight:600 };

export default function QuoteSummaryTab({ pricing, customerId }: { pricing: PricingData; customerId?: string }) {
  const s = calcSummary(pricing);

  const [taxRate, setTaxRate] = useState<number>(0);
  useEffect(() => {
    if (!customerId) return;
    getDoc(doc(db, "customers", customerId)).then(snap => {
      const taxCode: string = (snap.data() as any)?.taxCode || "";
      const match = taxCode.match(/\((\d+(?:\.\d+)?)%\)/);
      if (match) setTaxRate(parseFloat(match[1]) / 100);
    });
  }, [customerId]);

  const taxAmt = s.totalSell * taxRate;
  const grandTotal = s.totalSell + taxAmt;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

      {/* Header */}
      <div style={{ background:"#fff", borderRadius:12, border:"1px solid #e5e7eb", overflow:"hidden" }}>
        <div style={{ background:"#0d2e5e", padding:"12px 20px" }}>
          <span style={{ fontSize:15, fontWeight:800, color:"#fff", letterSpacing:0.5 }}>RBT ELECTRICAL &amp; AUTOMATION — QUOTE SUMMARY</span>
        </div>
      </div>

      {/* Totals */}
      <div style={{ background:"#fff", borderRadius:12, border:"1px solid #e5e7eb", overflow:"hidden" }}>
        <div style={{ padding:"10px 16px", borderBottom:"1px solid #e5e7eb", background:"#f9fafb" }}>
          <span style={{ fontSize:13, fontWeight:700, color:"#374151", textTransform:"uppercase", letterSpacing:0.5 }}>Quote Totals</span>
        </div>
        <div style={{ padding:"20px 24px", display:"flex", flexDirection:"column", alignItems:"flex-end" }}>
          {/* Per-section lines */}
          {(pricing.sections || []).map((sec, i) => {
            const { sectionSell } = calcSectionTotals(sec, pricing.settings);
            return (
              <div key={sec.id} style={{ display:"flex", alignItems:"center", padding:"6px 0", width:"100%", justifyContent:"space-between", borderTop:"1px solid #f3f4f6" }}>
                <span style={{ fontSize:13, fontWeight:500, color:"#6b7280" }}>{sec.name || `Section ${i + 1}`}</span>
                <span style={{ fontSize:13, fontWeight:600, color:"#374151", minWidth:120, textAlign:"right" }}>{fmt$(sectionSell)}</span>
              </div>
            );
          })}
          {/* Subtotal / Tax / Grand Total */}
          {[
            { label:"Taxable Subtotal", value:fmt$(s.totalSell), bold:false, border:"2px solid #e5e7eb" as const },
            { label:`Tax${taxRate > 0 ? ` (${(taxRate * 100).toFixed(0)}%)` : " — Exempt"}`, value:fmt$(taxAmt), bold:false, border:"1px solid #f3f4f6" as const },
            { label:"Grand Total", value:fmt$(grandTotal), bold:true, border:"2px solid #0d2e5e" as const },
          ].map(({ label, value, bold, border }) => (
            <div key={label} style={{ display:"flex", alignItems:"center", gap:24, padding:"8px 0", width:"100%", justifyContent:"flex-end", borderTop:border }}>
              <span style={{ fontSize:13, fontWeight: bold ? 800 : 600, color: bold ? "#0d2e5e" : "#374151" }}>{label}</span>
              <span style={{ fontSize: bold ? 15 : 13, fontWeight: bold ? 900 : 600, color: bold ? "#0d2e5e" : "#374151", minWidth:120, textAlign:"right" }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

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
