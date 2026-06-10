import { useEffect, useState } from "react";
import { arrayUnion, collection, doc, getDoc, getDocs, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { auth, db } from "../firebase";
import { Link, useParams } from "react-router-dom";

// ── Types ──────────────────────────────────────────────────────────────────────
interface POItem {
  id: string; name: string; description: string;
  fulfillmentStatus: string; quantityOrdered: number; quantityReceived: number;
  unitCost: number; totalCost: number; taxable: boolean;
  unitOfMeasure: string; costCode: string; jobCostType: string; revenueType: string;
}
interface Bill {
  id: string; billNumber: string; receiptNumber: string; vendor: string;
  dateIssued: string; createdBy: string; total: number;
}
interface PO {
  id: string; poNumber: string; status: string; fieldOrder: boolean; tags: string;
  vendor: string; vendorType: string;
  jobId: string; jobNumber: string;
  poType: string; poDate: string; assignTo: string; assignedTo: string;
  requiredBy: string; department: string; description: string;
  projectManager: string; taxRate: string; directPayerSalesTax: boolean; shipTo: string;
  items: POItem[]; bills: Bill[];
  subtotal: number; taxAmount: number; total: number;
  createdBy: string; createdAt: string;
}
interface VendorInfo { address?: string; city?: string; province?: string; postal?: string; phone?: string; email?: string; }

// ── Helpers ────────────────────────────────────────────────────────────────────
const PO_STATUSES = ["Open", "Pending", "Fulfilled", "Cancelled", "Draft"];
const STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  Fulfilled: { bg: "#dcfce7", color: "#166534", border: "#86efac" },
  Open:      { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd" },
  Pending:   { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" },
  Cancelled: { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5" },
  Draft:     { bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" },
};
function fmtC(n: number) { return `$${(n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function InfoLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: "#374151" }}>{children || "—"}</div>
    </div>
  );
}

function SideLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.5 }}>{children || "—"}</div>
    </div>
  );
}

// ── Add Item Row ───────────────────────────────────────────────────────────────
function AddItemRow({ poId, jobNumber }: { poId: string; jobNumber: string }) {
  const blank = { name: "", description: "", unitCost: "", quantity: "1", jobCostType: "Materials", unitOfMeasure: "ea" };
  const [open, setOpen] = useState(false);
  const [f, setF]       = useState(blank);
  const [saving, setSaving] = useState(false);
  const inp: React.CSSProperties = { width: "100%", padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 5, fontSize: 12, outline: "none" };

  async function submit() {
    if (!f.name.trim()) { alert("Item name is required."); return; }
    setSaving(true);
    try {
      const qty  = parseFloat(f.quantity) || 1;
      const cost = parseFloat(f.unitCost) || 0;
      const poSnap = await getDoc(doc(db, "purchaseOrders", poId));
      const existing: POItem[] = poSnap.data()?.items || [];
      const currentTotal = existing.reduce((s: number, i: POItem) => s + (i.totalCost || 0), 0);
      await updateDoc(doc(db, "purchaseOrders", poId), {
        items: arrayUnion({
          id: crypto.randomUUID(),
          name: f.name.trim(),
          description: f.description.trim(),
          fulfillmentStatus: "Pending",
          quantityOrdered: qty,
          quantityReceived: 0,
          unitCost: cost,
          totalCost: qty * cost,
          taxable: false,
          unitOfMeasure: f.unitOfMeasure,
          costCode: "",
          jobCostType: f.jobCostType,
          revenueType: "Materials",
        }),
        total: currentTotal + qty * cost,
        subtotal: currentTotal + qty * cost,
        createdBy: auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
      });
      setF(blank);
      setOpen(false);
    } catch(e) { console.error(e); alert("Failed to add item."); }
    setSaving(false);
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px dashed #d1d5db", borderRadius: 7, padding: "7px 14px", fontSize: 12, color: "#6b7280", cursor: "pointer", marginTop: 8 }}>
      + ADD PURCHASE ORDER ITEM
    </button>
  );

  return (
    <div style={{ background: "#f0f4ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: 14, marginTop: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 80px 100px 120px", gap: 8, marginBottom: 8 }}>
        <input style={inp} placeholder="Item name *" value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} />
        <input style={inp} placeholder="Description" value={f.description} onChange={e => setF(p => ({ ...p, description: e.target.value }))} />
        <select style={inp} value={f.jobCostType} onChange={e => setF(p => ({ ...p, jobCostType: e.target.value }))}>
          {["Materials","Labour","Subcontractor","Equipment","Other"].map(t => <option key={t}>{t}</option>)}
        </select>
        <input style={inp} placeholder="UOM" value={f.unitOfMeasure} onChange={e => setF(p => ({ ...p, unitOfMeasure: e.target.value }))} />
        <input style={inp} type="number" placeholder="Qty" value={f.quantity} onChange={e => setF(p => ({ ...p, quantity: e.target.value }))} />
        <input style={inp} type="number" placeholder="Unit Cost" value={f.unitCost} onChange={e => setF(p => ({ ...p, unitCost: e.target.value }))} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={submit} disabled={saving} style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, padding: "6px 18px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          {saving ? "Saving…" : "Add Item"}
        </button>
        <button onClick={() => { setOpen(false); setF(blank); }} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Add Bill Row ───────────────────────────────────────────────────────────────
function AddBillRow({ poId, vendor }: { poId: string; vendor: string }) {
  const blank = { billNumber: "", receiptNumber: "", vendor, dateIssued: new Date().toISOString().slice(0,10), total: "" };
  const [open, setOpen]     = useState(false);
  const [f, setF]           = useState(blank);
  const [saving, setSaving] = useState(false);
  const inp: React.CSSProperties = { width: "100%", padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 5, fontSize: 12, outline: "none" };

  async function submit() {
    setSaving(true);
    try {
      await updateDoc(doc(db, "purchaseOrders", poId), {
        bills: arrayUnion({
          id: crypto.randomUUID(),
          billNumber:    f.billNumber.trim(),
          receiptNumber: f.receiptNumber.trim(),
          vendor:        f.vendor.trim(),
          dateIssued:    f.dateIssued,
          total:         parseFloat(f.total) || 0,
          createdBy:     auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
        }),
      });
      setF(blank);
      setOpen(false);
    } catch(e) { console.error(e); alert("Failed to add bill."); }
    setSaving(false);
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px dashed #d1d5db", borderRadius: 7, padding: "7px 14px", fontSize: 12, color: "#6b7280", cursor: "pointer", marginTop: 8 }}>
      + ADD BILL
    </button>
  );

  return (
    <div style={{ background: "#f0f4ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: 14, marginTop: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 140px 120px", gap: 8, marginBottom: 8 }}>
        <input style={inp} placeholder="Bill #" value={f.billNumber} onChange={e => setF(p => ({ ...p, billNumber: e.target.value }))} />
        <input style={inp} placeholder="Receipt #" value={f.receiptNumber} onChange={e => setF(p => ({ ...p, receiptNumber: e.target.value }))} />
        <input style={inp} placeholder="Vendor" value={f.vendor} onChange={e => setF(p => ({ ...p, vendor: e.target.value }))} />
        <input style={{ ...inp, width: "auto" }} type="date" value={f.dateIssued} onChange={e => setF(p => ({ ...p, dateIssued: e.target.value }))} />
        <input style={inp} type="number" placeholder="Total" value={f.total} onChange={e => setF(p => ({ ...p, total: e.target.value }))} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={submit} disabled={saving} style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, padding: "6px 18px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          {saving ? "Saving…" : "Add Bill"}
        </button>
        <button onClick={() => { setOpen(false); setF(blank); }} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function PODetailPage() {
  const { poId } = useParams<{ poId: string }>();
  const [po, setPo]           = useState<PO | null>(null);
  const [vendorInfo, setVendorInfo] = useState<VendorInfo>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Order");

  useEffect(() => {
    if (!poId) return;
    const unsub = onSnapshot(doc(db, "purchaseOrders", poId), snap => {
      if (snap.exists()) {
        setPo({ id: snap.id, ...snap.data() } as PO);
      }
      setLoading(false);
    });
    return unsub;
  }, [poId]);

  useEffect(() => {
    if (!po?.vendor) return;
    getDocs(query(collection(db, "vendors"), where("name", "==", po.vendor))).then(snap => {
      if (!snap.empty) {
        const d = snap.docs[0].data();
        setVendorInfo({ address: d.address, city: d.city, province: d.province, postal: d.postal, phone: d.phone, email: d.email });
      }
    }).catch(() => {});
  }, [po?.vendor]);

  async function changeStatus(status: string) {
    if (!poId) return;
    await updateDoc(doc(db, "purchaseOrders", poId), { status }).catch(console.error);
  }

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#9ca3af" }}>Loading…</div>;
  if (!po)     return <div style={{ padding: 60, textAlign: "center", color: "#9ca3af" }}>Purchase order not found.</div>;

  const statusStyle = STATUS_COLORS[po.status] || STATUS_COLORS.Draft;
  const items: POItem[] = po.items || [];
  const bills: Bill[]   = po.bills  || [];

  const thStyle: React.CSSProperties = { padding: "9px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, textAlign: "left", whiteSpace: "nowrap", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" };
  const tdStyle: React.CSSProperties = { padding: "9px 12px", fontSize: 13, color: "#374151", verticalAlign: "middle", borderBottom: "1px solid #f3f4f6" };

  return (
    <div style={{ background: "#f9fafb", minHeight: "calc(100vh - 56px)", display: "flex", flexDirection: "column" }}>

      {/* ── Top bar ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* breadcrumb */}
          <span style={{ fontSize: 12, color: "#9ca3af" }}>
            <Link to="/operations/purchase-orders" style={{ color: "#6b7280", textDecoration: "none" }}>Procurement / Purchase Orders</Link>
            {po.jobId && (
              <> / <Link to={`/jobs/${po.jobId}`} style={{ color: "#6b7280", textDecoration: "none" }}>Job {po.jobNumber}</Link></>
            )}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>EDIT</button>
          <button style={{ background: "#1f2937", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>GENERATE PDF</button>
          <button style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>GENERATE RECEIPT</button>
        </div>
      </div>

      {/* ── PO title bar ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "12px 24px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>PO {po.poNumber}</span>
        {po.fieldOrder && (
          <span style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>Field Order</span>
        )}
        <span style={{ background: statusStyle.bg, color: statusStyle.color, border: `1px solid ${statusStyle.border}`, borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>{po.status}</span>
        <select
          value={po.status}
          onChange={e => changeStatus(e.target.value)}
          style={{ fontSize: 12, border: "1px solid #d1d5db", borderRadius: 6, padding: "4px 8px", outline: "none", cursor: "pointer", color: "#374151" }}
        >
          {PO_STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      {/* ── Body ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Left sidebar ── */}
        <div style={{ width: 200, minWidth: 200, background: "#fff", borderRight: "1px solid #e5e7eb", padding: "20px 16px", overflowY: "auto", flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Vendor Information</div>
          <SideLabel label="Vendor">{po.vendor}</SideLabel>
          {vendorInfo.address && (
            <SideLabel label="Bill To Address">
              {vendorInfo.address}
              {vendorInfo.city && <><br />{vendorInfo.city}{vendorInfo.province ? `, ${vendorInfo.province}` : ""} {vendorInfo.postal || ""}</>}
            </SideLabel>
          )}
          {vendorInfo.phone && <SideLabel label="Phone Number">{vendorInfo.phone}</SideLabel>}
          {vendorInfo.email && <SideLabel label="Email">{vendorInfo.email}</SideLabel>}

          <div style={{ borderTop: "1px solid #f3f4f6", margin: "18px 0 14px" }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginBottom: 14 }}>Shipping To Information</div>
          <SideLabel label="Ship To">{po.shipTo || "Job Site"}</SideLabel>
        </div>

        {/* ── Main content ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {/* PO Info grid */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "18px 20px", marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 16 }}>Purchase Order Information</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "16px 24px" }}>
              <InfoLabel label="Job / Project">
                {po.jobId ? <Link to={`/jobs/${po.jobId}`} style={{ color: "#1565c0", textDecoration: "none", fontWeight: 600 }}>{po.jobNumber || po.jobId}</Link> : "—"}
              </InfoLabel>
              <InfoLabel label="Custom PO Type">{po.poType}</InfoLabel>
              <InfoLabel label="Date of Purchase">{fmtDate(po.poDate)}</InfoLabel>
              <InfoLabel label="Required By">{po.requiredBy ? fmtDate(po.requiredBy) : "—"}</InfoLabel>
              <InfoLabel label="Department">{po.department}</InfoLabel>
              <InfoLabel label="Assigned To">{po.assignedTo || po.assignTo}</InfoLabel>
              <InfoLabel label="Description">{po.description}</InfoLabel>
              <InfoLabel label="Project Manager">{po.projectManager}</InfoLabel>
              <InfoLabel label="Direct Payer - Sales Tax">
                <input type="checkbox" checked={!!po.directPayerSalesTax} readOnly style={{ cursor: "default" }} />
              </InfoLabel>
              <InfoLabel label="Created By">{po.createdBy}</InfoLabel>
              <InfoLabel label="Created">{fmtDate(po.createdAt)}</InfoLabel>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #e5e7eb", marginBottom: 16 }}>
            {["Order", "Receipts", "Bills"].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{ background: "none", border: "none", borderBottom: activeTab === tab ? "2px solid #1565c0" : "2px solid transparent", marginBottom: -2, padding: "8px 18px", fontSize: 13, fontWeight: activeTab === tab ? 700 : 500, color: activeTab === tab ? "#1565c0" : "#6b7280", cursor: "pointer" }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* ── Order tab ── */}
          {activeTab === "Order" && (
            <div style={{ display: "flex", gap: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Line #</th>
                        <th style={thStyle}>Item Name</th>
                        <th style={thStyle}>Line Type</th>
                        <th style={thStyle}>Description</th>
                        <th style={thStyle}>UOM</th>
                        <th style={thStyle}>Taxable</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Unit Cost</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Qty Ordered</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Qty Received</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0 && (
                        <tr><td colSpan={10} style={{ padding: "32px 12px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>No Purchase Order Lines</td></tr>
                      )}
                      {items.map((item, i) => (
                        <tr key={item.id || i}>
                          <td style={tdStyle}>{i + 1}</td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{item.name || "—"}</td>
                          <td style={tdStyle}>{item.jobCostType || "—"}</td>
                          <td style={tdStyle}>{item.description || "—"}</td>
                          <td style={tdStyle}>{item.unitOfMeasure || "—"}</td>
                          <td style={{ ...tdStyle, textAlign: "center" }}>{item.taxable ? "Yes" : "No"}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{fmtC(item.unitCost)}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{item.quantityOrdered ?? "—"}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{item.quantityReceived ?? 0}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{fmtC(item.totalCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <AddItemRow poId={po.id} jobNumber={po.jobNumber} />
              </div>

              {/* Totals card */}
              <div style={{ width: 220, flexShrink: 0 }}>
                <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "16px 18px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 14 }}>Purchase Order Totals</div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
                    <span>Tax Rate</span><span>{po.taxRate || "None"}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
                    <span>Subtotal</span><span>{fmtC(po.subtotal || 0)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#6b7280", marginBottom: 14 }}>
                    <span>Tax Amount</span><span>{fmtC(po.taxAmount || 0)}</span>
                  </div>
                  <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12, display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 800, color: "#111827" }}>
                    <span>Total</span><span>{fmtC(po.total || 0)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Receipts tab ── */}
          {activeTab === "Receipts" && (
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Receipt #</th>
                    <th style={thStyle}>Bill #</th>
                    <th style={thStyle}>Vendor</th>
                    <th style={thStyle}>Date Issued</th>
                    <th style={thStyle}>Created By</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.filter(b => b.receiptNumber).length === 0 && (
                    <tr><td colSpan={6} style={{ padding: "32px 12px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>No receipts yet.</td></tr>
                  )}
                  {bills.filter(b => b.receiptNumber).map((b, i) => (
                    <tr key={b.id || i}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{b.receiptNumber || "—"}</td>
                      <td style={tdStyle}>{b.billNumber || "—"}</td>
                      <td style={tdStyle}>{b.vendor || "—"}</td>
                      <td style={tdStyle}>{fmtDate(b.dateIssued)}</td>
                      <td style={tdStyle}>{b.createdBy || "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{fmtC(b.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Bills tab ── */}
          {activeTab === "Bills" && (
            <>
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Bill #</th>
                      <th style={thStyle}>Receipt #</th>
                      <th style={thStyle}>Vendor</th>
                      <th style={thStyle}>Date Issued</th>
                      <th style={thStyle}>Created By</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.length === 0 && (
                      <tr><td colSpan={6} style={{ padding: "32px 12px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>No bills yet.</td></tr>
                    )}
                    {bills.map((b, i) => (
                      <tr key={b.id || i}>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{b.billNumber || "—"}</td>
                        <td style={tdStyle}>{b.receiptNumber || "—"}</td>
                        <td style={tdStyle}>{b.vendor || "—"}</td>
                        <td style={tdStyle}>{fmtDate(b.dateIssued)}</td>
                        <td style={tdStyle}>{b.createdBy || "—"}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{fmtC(b.total)}</td>
                      </tr>
                    ))}
                    {bills.length > 0 && (
                      <tr style={{ background: "#f9fafb", borderTop: "2px solid #e5e7eb" }}>
                        <td colSpan={5} style={{ padding: "10px 12px", fontWeight: 800, fontSize: 13 }}>Total</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 800, fontSize: 14 }}>{fmtC(bills.reduce((s, b) => s + (b.total || 0), 0))}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <AddBillRow poId={po.id} vendor={po.vendor} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
