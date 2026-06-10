import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";
import { Link } from "react-router-dom";

interface BillEntry {
  id: string;
  billNumber: string;
  receiptNumber: string;
  vendor: string;
  dateIssued: string;
  createdBy: string;
  total: number;
  poNumber: string;
  poId: string;
  jobId: string;
  jobNumber: string;
}

function fmtC(n: number) { return `$${(n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

const th: React.CSSProperties = { padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "11px 14px", fontSize: 13, color: "#374151", verticalAlign: "middle" };

export default function OperationsReceiptsBillsPage() {
  const [bills, setBills]     = useState<BillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "purchaseOrders"), orderBy("createdAt", "desc")),
      snap => {
        const all: BillEntry[] = [];
        for (const d of snap.docs) {
          const po = d.data() as any;
          for (const b of (po.bills || [])) {
            all.push({
              ...b,
              poId: d.id,
              poNumber: po.poNumber,
              jobId: po.jobId || "",
              jobNumber: po.jobNumber || "",
            });
          }
        }
        setBills(all);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  const filtered = bills.filter(b => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (b.billNumber || "").toLowerCase().includes(q) ||
      (b.receiptNumber || "").toLowerCase().includes(q) ||
      (b.vendor || "").toLowerCase().includes(q) ||
      (b.poNumber || "").toLowerCase().includes(q) ||
      (b.jobNumber || "").toLowerCase().includes(q)
    );
  });

  const grandTotal = filtered.reduce((s, b) => s + (b.total || 0), 0);

  return (
    <div style={{ background: "#f9fafb", minHeight: "calc(100vh - 96px)", padding: "28px 32px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>Receipts & Bills</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{filtered.length} bills — {fmtC(grandTotal)} total</div>
          </div>
          <input
            style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 14px", fontSize: 13, outline: "none", width: 280 }}
            placeholder="Search bill #, vendor, PO…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <th style={th}>Bill #</th>
                <th style={th}>Receipt #</th>
                <th style={th}>Vendor</th>
                <th style={th}>PO Number</th>
                <th style={th}>Job</th>
                <th style={th}>Date Issued</th>
                <th style={th}>Created By</th>
                <th style={{ ...th, textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Loading…</td></tr>}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>No bills found.</td></tr>
              )}
              {filtered.map((b, i) => (
                <tr key={b.id + i} style={{ borderBottom: i < filtered.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                  <td style={{ ...td, fontWeight: 600 }}>{b.billNumber || "—"}</td>
                  <td style={td}>{b.receiptNumber || "—"}</td>
                  <td style={td}>{b.vendor || "—"}</td>
                  <td style={{ ...td, color: "#1565c0", fontWeight: 700 }}>{b.poNumber || "—"}</td>
                  <td style={td}>
                    {b.jobId ? (
                      <Link to={`/jobs/${b.jobId}`} style={{ color: "#1565c0", textDecoration: "none", fontWeight: 600 }}>{b.jobNumber || b.jobId}</Link>
                    ) : b.jobNumber || "—"}
                  </td>
                  <td style={td}>{fmtDate(b.dateIssued)}</td>
                  <td style={td}>{b.createdBy || "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtC(b.total)}</td>
                </tr>
              ))}
              {filtered.length > 0 && (
                <tr style={{ background: "#f9fafb", borderTop: "2px solid #e5e7eb" }}>
                  <td colSpan={7} style={{ ...td, fontWeight: 800 }}>TOTAL</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, fontSize: 14 }}>{fmtC(grandTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
