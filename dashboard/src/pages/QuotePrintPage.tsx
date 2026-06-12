import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { calcSectionTotals, calcSummary, migratePricing, PricingData } from "./QuotePricingTab";

const fmt$ = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  quoteDueBy?: string;
  expiration?: number;
  status?: string;
  pricing?: unknown;
}

export default function QuotePrintPage() {
  const { quoteId } = useParams<{ quoteId: string }>();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!quoteId) return;
    return onSnapshot(doc(db, "quotes", quoteId), snap => {
      if (snap.exists()) setQuote(snap.data() as Quote);
      setLoading(false);
    });
  }, [quoteId]);

  if (loading) return <div style={{ padding: 60, textAlign: "center", fontFamily: "Arial, sans-serif", color: "#6b7280" }}>Loading…</div>;
  if (!quote) return <div style={{ padding: 60, textAlign: "center", fontFamily: "Arial, sans-serif" }}>Quote not found.</div>;

  const pricing: PricingData = migratePricing((quote as any).pricing);
  const summary = calcSummary(pricing);
  const sectionTotals = pricing.sections.map(sec => ({ sec, t: calcSectionTotals(sec, pricing.settings) }));

  const today = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

  return (
    <>
      {/* Print button — hidden in print */}
      <div className="no-print" style={{ background: "#0d2e5e", padding: "12px 24px", display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 15, flex: 1 }}>Quote Preview — {quote.quoteNumber}</span>
        <button
          onClick={() => window.print()}
          style={{ background: "#1e7d3a", color: "#fff", border: "none", borderRadius: 8, padding: "9px 22px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
        >
          🖨 Print / Save as PDF
        </button>
        <button
          onClick={() => window.close()}
          style={{ background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          Close
        </button>
      </div>

      <div className="print-page" style={{ maxWidth: 900, margin: "0 auto", padding: "32px 40px", fontFamily: "Arial, sans-serif", color: "#111827", background: "#fff" }}>

        {/* Company Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 32, borderBottom: "3px solid #0d2e5e", paddingBottom: 20 }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 900, color: "#0d2e5e", letterSpacing: -0.5 }}>RBT Electrical &amp; Automation Services</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Professional Electrical &amp; Automation Solutions</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#0d2e5e" }}>QUOTE</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#374151" }}>#{quote.quoteNumber}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>Date: {today}</div>
            {quote.expiration && (
              <div style={{ fontSize: 11, color: "#6b7280" }}>Valid for {quote.expiration} days</div>
            )}
          </div>
        </div>

        {/* Quote title */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0d2e5e", marginBottom: 4 }}>{quote.title}</div>
        </div>

        {/* Bill to / Site / Contact block */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginBottom: 28 }}>
          <InfoBlock title="Bill To">
            <div style={{ fontWeight: 600 }}>{quote.billingCustomer || quote.customerName}</div>
            {quote.billingAddress && <div style={{ marginTop: 4, color: "#4b5563", fontSize: 12, whiteSpace: "pre-line" }}>{quote.billingAddress}</div>}
          </InfoBlock>
          <InfoBlock title="Site / Property">
            <div style={{ fontWeight: 600 }}>{quote.propertyName}</div>
            {quote.propertyAddress && <div style={{ marginTop: 4, color: "#4b5563", fontSize: 12, whiteSpace: "pre-line" }}>{quote.propertyAddress}</div>}
          </InfoBlock>
          <InfoBlock title="Contacts">
            {quote.companyRepresentative && (
              <div>
                <span style={{ fontWeight: 600 }}>{quote.companyRepresentative}</span>
                {quote.companyRepPhone && <div style={{ fontSize: 12, color: "#4b5563" }}>{quote.companyRepPhone}</div>}
                {quote.companyRepEmail && <div style={{ fontSize: 12, color: "#4b5563" }}>{quote.companyRepEmail}</div>}
              </div>
            )}
            {quote.soldBy && <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>Prepared by: {quote.soldBy}</div>}
            {quote.projectManager && <div style={{ fontSize: 12, color: "#6b7280" }}>Project Mgr: {quote.projectManager}</div>}
          </InfoBlock>
        </div>

        {/* Sections */}
        {pricing.sections.map((sec, i) => {
          const { t } = sectionTotals[i];
          const hasScopeText = sec.scopeOfWork && sec.scopeOfWork.trim().length > 0;
          return (
            <div key={sec.id} style={{ marginBottom: 28, pageBreakInside: "avoid" }}>
              {/* Section header */}
              <div style={{ background: "#0d2e5e", color: "#fff", padding: "8px 14px", borderRadius: "6px 6px 0 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.5, marginRight: 10 }}>Section {i + 1}</span>
                  <span style={{ fontSize: 14, fontWeight: 800 }}>{sec.name || `Section ${i + 1}`}</span>
                </div>
                {t.sectionSell > 0 && (
                  <div style={{ fontSize: 14, fontWeight: 800 }}>{fmt$(t.sectionSell)}</div>
                )}
              </div>

              {/* Scope of Work */}
              {hasScopeText && (
                <div style={{ border: "1px solid #e5e7eb", borderTop: "none", padding: "14px 16px", background: "#fafafa" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Scope of Work</div>
                  <div style={{ fontSize: 12, lineHeight: 1.8, color: "#374151", whiteSpace: "pre-wrap" }}>{sec.scopeOfWork}</div>
                </div>
              )}

              {/* Cost summary for section */}
              <div style={{ border: "1px solid #e5e7eb", borderTop: hasScopeText ? "none" : "none", borderRadius: hasScopeText ? "0 0 6px 6px" : "0 0 6px 6px", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <tbody>
                    {t.matSell > 0 && (
                      <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "7px 16px", color: "#4b5563" }}>Materials</td>
                        <td style={{ padding: "7px 16px", textAlign: "right", fontWeight: 600, color: "#111827" }}>{fmt$(t.matSell)}</td>
                      </tr>
                    )}
                    {t.elecSell > 0 && (
                      <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "7px 16px", color: "#4b5563" }}>Electrician Labour</td>
                        <td style={{ padding: "7px 16px", textAlign: "right", fontWeight: 600, color: "#111827" }}>{fmt$(t.elecSell)}</td>
                      </tr>
                    )}
                    {t.progSell > 0 && (
                      <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "7px 16px", color: "#4b5563" }}>Programming Labour</td>
                        <td style={{ padding: "7px 16px", textAlign: "right", fontWeight: 600, color: "#111827" }}>{fmt$(t.progSell)}</td>
                      </tr>
                    )}
                    {t.otherSell > 0 && (
                      <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "7px 16px", color: "#4b5563" }}>Other Costs</td>
                        <td style={{ padding: "7px 16px", textAlign: "right", fontWeight: 600, color: "#111827" }}>{fmt$(t.otherSell)}</td>
                      </tr>
                    )}
                    {t.travelSell > 0 && (
                      <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "7px 16px", color: "#4b5563" }}>Travel</td>
                        <td style={{ padding: "7px 16px", textAlign: "right", fontWeight: 600, color: "#111827" }}>{fmt$(t.travelSell)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {/* Grand Total Summary */}
        <div style={{ marginTop: 32, marginBottom: 24 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 700, color: "#374151", borderBottom: "2px solid #e5e7eb" }}>Section</th>
                <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 700, color: "#374151", borderBottom: "2px solid #e5e7eb" }}>Materials</th>
                <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 700, color: "#374151", borderBottom: "2px solid #e5e7eb" }}>Labour</th>
                <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 700, color: "#374151", borderBottom: "2px solid #e5e7eb" }}>Other</th>
                <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 700, color: "#374151", borderBottom: "2px solid #e5e7eb" }}>Section Total</th>
              </tr>
            </thead>
            <tbody>
              {sectionTotals.map(({ sec, t }) => (
                <tr key={sec.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px 16px", color: "#374151", fontWeight: 600 }}>{sec.name}</td>
                  <td style={{ padding: "8px 16px", textAlign: "right", color: "#4b5563" }}>{t.matSell > 0 ? fmt$(t.matSell) : "—"}</td>
                  <td style={{ padding: "8px 16px", textAlign: "right", color: "#4b5563" }}>{(t.elecSell + t.progSell) > 0 ? fmt$(t.elecSell + t.progSell) : "—"}</td>
                  <td style={{ padding: "8px 16px", textAlign: "right", color: "#4b5563" }}>{(t.otherSell + t.travelSell) > 0 ? fmt$(t.otherSell + t.travelSell) : "—"}</td>
                  <td style={{ padding: "8px 16px", textAlign: "right", fontWeight: 700, color: "#0d2e5e" }}>{t.sectionSell > 0 ? fmt$(t.sectionSell) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "#0d2e5e" }}>
                <td colSpan={4} style={{ padding: "12px 16px", fontWeight: 800, fontSize: 14, color: "#fff" }}>TOTAL</td>
                <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 900, fontSize: 16, color: "#fff" }}>{fmt$(summary.totalSell)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Terms */}
        <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid #e5e7eb", fontSize: 11, color: "#9ca3af", lineHeight: 1.7 }}>
          <div style={{ fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>Terms &amp; Conditions</div>
          <div>This quote is valid for {quote.expiration || 30} days from the date of issue. Prices are subject to change after this period. All work to be completed in a professional manner according to standard practices. Any alteration or deviation from the above specifications involving extra costs will be executed only upon written orders and will become an extra charge over and above the estimate.</div>
        </div>

        {/* Signature block */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, marginTop: 40 }}>
          <SigBlock label="Authorized Signature" />
          <SigBlock label="Customer Acceptance" />
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
          .print-page { max-width: 100% !important; padding: 20px !important; }
        }
      `}</style>
    </>
  );
}

function InfoBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: "#111827" }}>{children}</div>
    </div>
  );
}

function SigBlock({ label }: { label: string }) {
  return (
    <div>
      <div style={{ borderBottom: "1px solid #374151", height: 40, marginBottom: 6 }} />
      <div style={{ fontSize: 11, color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: 11, color: "#d1d5db", marginTop: 4 }}>Name: _________________________________ &nbsp; Date: ______________</div>
    </div>
  );
}
