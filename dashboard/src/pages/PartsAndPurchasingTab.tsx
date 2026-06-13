import { useEffect, useState } from "react";
import { arrayUnion, collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { auth, db } from "../firebase";
import { Link } from "react-router-dom";
import CreatePOModal from "./CreatePOModal";

// ── Types ─────────────────────────────────────────────────────────────────────
interface POItem {
  id: string;
  name?: string;
  description: string;
  fulfillmentStatus: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number;
  totalCost: number;
  taxable?: boolean;
}

interface Bill {
  id: string;
  billNumber: string;
  receiptNumber: string;
  vendor: string;
  dateIssued: string;
  createdBy: string;
  total: number;
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  fieldOrder: boolean;
  vendor: string;
  description: string;
  department: string;
  assignedTo: string;
  createdBy: string;
  createdAt: string;
  items: POItem[];
  bills: Bill[];
  total: number;
  taxRate?: string;
  subtotal?: number;
  taxAmount?: number;
}

interface Props { jobId: string; jobNumber: string; }

// ── Constants ─────────────────────────────────────────────────────────────────
const PO_STATUSES = ["Open","Pending","Fulfilled","Cancelled"];
const ITEM_STATUSES = ["Pending","Ordered","Fulfilled"];

const STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  Fulfilled:  { bg: "#dcfce7", color: "#166534", border: "#86efac" },
  Open:       { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd" },
  Pending:    { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" },
  Cancelled:  { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5" },
  Ordered:    { bg: "#e0f2fe", color: "#0369a1", border: "#7dd3fc" },
};

// ── Shared styles ──────────────────────────────────────────────────────────────
const th: React.CSSProperties = { padding: "9px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, textAlign: "left", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "9px 12px", fontSize: 13, color: "#374151", verticalAlign: "middle" };
const inp: React.CSSProperties = { width: "100%", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, outline: "none", boxSizing: "border-box" };

function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}
function fmtC(n: number) {
  return n > 0 ? `$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00";
}
function uid() { return Math.random().toString(36).slice(2); }

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] || { bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" };
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────
function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{title}</div>
      {action}
    </div>
  );
}

// ── Add Item Panel ─────────────────────────────────────────────────────────────
function AddItemRow({ poId, poVendor, onDone }: { poId: string; poVendor: string; onDone: () => void }) {
  const [f, setF] = useState({ description: "", quantityOrdered: "1", quantityReceived: "0", unitCost: "", totalCost: "", taxable: true });
  const [saving, setSaving] = useState(false);

  function recalc(qty: string, unit: string) {
    const q = parseFloat(qty) || 0;
    const u = parseFloat(unit) || 0;
    return String(q > 0 && u > 0 ? (q * u).toFixed(2) : "");
  }

  async function save() {
    if (!f.description.trim()) return;
    setSaving(true);
    const qty    = parseFloat(f.quantityOrdered) || 0;
    const qtyRec = parseFloat(f.quantityReceived) || 0;
    const newItem: POItem = {
      id: uid(),
      description:       f.description.trim(),
      fulfillmentStatus: qty > 0 && qty === qtyRec ? "Fulfilled" : "Pending",
      quantityOrdered:   qty,
      quantityReceived:  qtyRec,
      unitCost:          parseFloat(f.unitCost) || 0,
      totalCost:         parseFloat(f.totalCost) || 0,
      taxable:           f.taxable,
    };
    const ref  = doc(db, "purchaseOrders", poId);
    const snap = await getDoc(ref);
    const data = snap.data() as PurchaseOrder;
    const allItems = [...(data.items || []), newItem];
    const newSubtotal = allItems.reduce((s, i) => s + (i.totalCost || 0), 0);
    const taxPct = ({ "GST (5%)": 0.05, "HST ON (13%)": 0.13, "HST BC (12%)": 0.12, "PST (7%)": 0.07 } as Record<string,number>)[data.taxRate || ""] ?? 0;
    const newTaxAmt = allItems.filter(i => i.taxable).reduce((s, i) => s + (i.totalCost || 0), 0) * taxPct;
    const allFulfilled = allItems.length > 0 && allItems.every(i => i.fulfillmentStatus === "Fulfilled");
    const updates: Record<string, unknown> = { items: allItems, subtotal: newSubtotal, taxAmount: newTaxAmt, total: newSubtotal + newTaxAmt };
    if (allFulfilled) updates.status = "Fulfilled";
    await updateDoc(ref, updates);
    onDone();
  }

  return (
    <tr style={{ background: "#f0fdf4" }}>
      <td style={td}><input style={{ ...inp, width: 220 }} placeholder="Item description" value={f.description} onChange={e => setF(p => ({ ...p, description: e.target.value }))} /></td>
      <td style={td}>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={f.taxable} onChange={e => setF(p => ({ ...p, taxable: e.target.checked }))}
            style={{ width: 13, height: 13, accentColor: "#1565c0" }} />
          Taxable
        </label>
      </td>
      <td style={{ ...td, textAlign: "center" }}><input style={{ ...inp, width: 60, textAlign: "center" }} value={f.quantityOrdered} onChange={e => { const v = e.target.value; setF(p => ({ ...p, quantityOrdered: v, totalCost: recalc(v, p.unitCost) })); }} /></td>
      <td style={{ ...td, textAlign: "center" }}><input style={{ ...inp, width: 60, textAlign: "center" }} value={f.quantityReceived} onChange={e => setF(p => ({ ...p, quantityReceived: e.target.value }))} /></td>
      <td style={{ ...td, textAlign: "right" }}><input style={{ ...inp, width: 90, textAlign: "right" }} placeholder="0.00" value={f.unitCost} onChange={e => { const v = e.target.value; setF(p => ({ ...p, unitCost: v, totalCost: recalc(p.quantityOrdered, v) })); }} /></td>
      <td style={{ ...td, textAlign: "right" }}><input style={{ ...inp, width: 90, textAlign: "right" }} placeholder="0.00" value={f.totalCost} onChange={e => setF(p => ({ ...p, totalCost: e.target.value }))} /></td>
      <td style={td}>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={save} disabled={saving} style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{saving ? "…" : "Add"}</button>
          <button onClick={onDone} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>✕</button>
        </div>
      </td>
    </tr>
  );
}

// ── Add Bill Panel ─────────────────────────────────────────────────────────────
function AddBillRow({ poId, poNumber, poVendor, onDone }: { poId: string; poNumber: string; poVendor: string; onDone: () => void }) {
  const [f, setF] = useState({ billNumber: `${poNumber}-1`, receiptNumber: `${poNumber}-1`, vendor: poVendor, dateIssued: new Date().toISOString().slice(0, 10), total: "" });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!f.total) return;
    setSaving(true);
    const bill: Bill = {
      id: uid(),
      billNumber:   f.billNumber.trim(),
      receiptNumber: f.receiptNumber.trim(),
      vendor:       f.vendor.trim(),
      dateIssued:   f.dateIssued,
      createdBy:    auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
      total:        parseFloat(f.total) || 0,
    };
    await updateDoc(doc(db, "purchaseOrders", poId), { bills: arrayUnion(bill) });
    onDone();
  }

  return (
    <tr style={{ background: "#eff6ff" }}>
      <td style={td}><input style={{ ...inp, width: 120 }} value={f.billNumber} onChange={e => setF(p => ({ ...p, billNumber: e.target.value }))} /></td>
      <td style={td}><input style={{ ...inp, width: 120 }} value={f.receiptNumber} onChange={e => setF(p => ({ ...p, receiptNumber: e.target.value }))} /></td>
      <td style={td}><input style={{ ...inp, width: 160 }} value={f.vendor} onChange={e => setF(p => ({ ...p, vendor: e.target.value }))} /></td>
      <td style={td}><input type="date" style={{ ...inp, width: 140 }} value={f.dateIssued} onChange={e => setF(p => ({ ...p, dateIssued: e.target.value }))} /></td>
      <td style={{ ...td, textAlign: "right" }}><input style={{ ...inp, width: 100, textAlign: "right" }} placeholder="0.00" value={f.total} onChange={e => setF(p => ({ ...p, total: e.target.value }))} /></td>
      <td style={td}>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={save} disabled={saving || !f.total} style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{saving ? "…" : "Add"}</button>
          <button onClick={onDone} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>✕</button>
        </div>
      </td>
    </tr>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
interface VisitPart { id: string; description: string; qty: number; unitCost: number; notes: string; visitNumber: number; visitDate: string; visitId: string; }

export default function PartsAndPurchasingTab({ jobId, jobNumber }: Props) {
  const [pos, setPOs]         = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [visitParts, setVisitParts] = useState<VisitPart[]>([]);
  const [addPOOpen, setAddPOOpen]     = useState(false);
  const [expandedPO, setExpandedPO]   = useState<string | null>(null);
  const [addingItemTo, setAddingItemTo] = useState<string | null>(null);
  const [addingBillTo, setAddingBillTo] = useState<string | null>(null);
  const [quickVendor, setQuickVendor] = useState("");
  const [quickAdding, setQuickAdding] = useState(false);
  const [quickError, setQuickError]   = useState("");
  const [vendors, setVendors]         = useState<string[]>([]);

  useEffect(() => {
    getDocs(collection(db, "vendors"))
      .then(snap => setVendors(snap.docs.map(d => (d.data().name as string) || "").filter(Boolean).sort()))
      .catch(() => {});
  }, []);

  async function quickAddPO() {
    const vendor = quickVendor.trim();
    if (!vendor) { setQuickError("Pick a vendor first"); return; }
    setQuickAdding(true);
    setQuickError("");
    try {
      const settingsRef = doc(db, "settings", "poSettings");
      const settingsSnap = await getDoc(settingsRef);
      let assignedPoNumber = "";
      if (settingsSnap.exists() && settingsSnap.data()?.nextPoNumber) {
        const next = settingsSnap.data()!.nextPoNumber as number;
        assignedPoNumber = String(next);
        await updateDoc(settingsRef, { nextPoNumber: next + 1 });
      } else {
        assignedPoNumber = `PO-${Date.now().toString(36).toUpperCase()}`;
      }
      const today = new Date().toISOString().slice(0, 10);
      const newPoRef = doc(collection(db, "purchaseOrders"));
      await setDoc(newPoRef, {
        jobId, jobNumber,
        poNumber:    assignedPoNumber,
        status:      "Open",
        vendor:      vendor,
        vendorType:  "Supplier",
        poType:      "Credit Card order",
        poDate:      today,
        fieldOrder:  false,
        tags:        vendor,
        description: vendor,
        department:  "General",
        assignTo: "", assignedTo: "", requiredBy: "", projectManager: "",
        taxRate: "HST ON (13%)", directPayerSalesTax: false, shipTo: "",
        items: [], bills: [], subtotal: 0, taxAmount: 0, total: 0,
        createdBy: auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
        createdAt: today,
      });
      setQuickVendor("");
      window.location.href = `/purchase-orders/${newPoRef.id}`;
    } catch (e: any) {
      console.error("[quickAddPO]", e);
      setQuickError(e?.message || "Failed to create PO.");
      setQuickAdding(false);
    }
  }

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "purchaseOrders"), where("jobId", "==", jobId)),
      snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<PurchaseOrder, "id">) }));
        list.sort((a, b) => String(a.poNumber).localeCompare(String(b.poNumber)));
        setPOs(list);
        setLoading(false);
      },
      (err) => { console.error("PO query error:", err); setLoading(false); }
    );
    return unsub;
  }, [jobId]);

  useEffect(() => {
    getDocs(query(collection(db, "dispatchVisits"), where("jobId", "==", jobId))).then(snap => {
      const parts: VisitPart[] = [];
      for (const d of snap.docs) {
        const v = d.data() as any;
        for (const p of (v.parts || [])) {
          parts.push({ ...p, visitId: d.id, visitNumber: v.visitNumber || 0, visitDate: v.date || "" });
        }
      }
      parts.sort((a, b) => a.visitNumber - b.visitNumber);
      setVisitParts(parts);
    }).catch(err => console.error("Visit parts query error:", err));
  }, [jobId]);

  const allItems = pos.flatMap(po => (po.items || []).map((item, idx) => ({ ...item, poId: po.id, poNumber: po.poNumber, lineNumber: idx + 1, vendor: po.vendor || item.description })));
  const allBills = pos.flatMap(po => (po.bills || []).map(bill => ({ ...bill, poId: po.id, poNumber: po.poNumber })));
  const allInvoices     = allBills.filter(b => !!b.billNumber);
  const allPackingSlips = allBills.filter(b => !b.billNumber);
  const poGrandTotal        = pos.reduce((s, p) => s + (p.total || 0), 0);
  const itemGrandTotal      = allItems.reduce((s, i) => s + (i.totalCost || 0), 0);
  const invoiceGrandTotal   = allInvoices.reduce((s, b) => s + (b.total || 0), 0);
  const packingSlipTotal    = allPackingSlips.reduce((s, b) => s + (b.total || 0), 0);
  const visitPartsTotal     = visitParts.reduce((s, p) => s + (p.qty || 0) * (p.unitCost || 0), 0);

  async function changePOStatus(poId: string, status: string) {
    await updateDoc(doc(db, "purchaseOrders", poId), { status });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>

      {/* ── Purchase Orders ── */}
      <div>
        <SectionHead
          title="Purchase Orders"
          action={
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                list="quick-vendor-list"
                style={{ padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, outline: "none", width: 200 }}
                placeholder="Pick a vendor (credit card)…"
                value={quickVendor}
                onChange={e => { setQuickVendor(e.target.value); setQuickError(""); }}
                onKeyDown={e => { if (e.key === "Enter") quickAddPO(); }}
              />
              <datalist id="quick-vendor-list">{vendors.map(v => <option key={v} value={v} />)}</datalist>
              <button
                onClick={quickAddPO}
                disabled={quickAdding}
                style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: quickAdding ? "not-allowed" : "pointer", opacity: quickAdding ? 0.5 : 1, whiteSpace: "nowrap" }}
              >
                {quickAdding ? "Adding…" : "QUICK ADD"}
              </button>
              {quickError && <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 600 }}>{quickError}</span>}
              <button onClick={() => setAddPOOpen(true)} style={{ background: "#0d2e5e", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                + ADD PURCHASE ORDER
              </button>
            </div>
          }
        />
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <th style={th}>PO Number</th>
                <th style={th}>Status</th>
                <th style={th}>Field Order</th>
                <th style={th}>Vendor</th>
                <th style={th}>Description</th>
                <th style={th}>Department</th>
                <th style={th}>Assigned To</th>
                <th style={th}>Created By</th>
                <th style={th}>Date</th>
                <th style={{ ...th, textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10} style={{ padding: 32, textAlign: "center", color: "#9ca3af" }}>Loading…</td></tr>}
              {!loading && pos.length === 0 && <tr><td colSpan={10} style={{ padding: 32, textAlign: "center", color: "#9ca3af" }}>No purchase orders yet. Add one to get started.</td></tr>}
              {pos.map((po, i) => {
                const isExp = expandedPO === po.id;
                return [
                  <tr
                    key={po.id}
                    onClick={() => setExpandedPO(isExp ? null : po.id)}
                    style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer", background: isExp ? "#f0f4ff" : "transparent" }}
                  >
                    <td style={{ ...td, fontWeight: 700 }}>
                      <Link to={`/purchase-orders/${po.id}`} onClick={e => e.stopPropagation()} style={{ color: "#1565c0", textDecoration: "none" }}>{po.poNumber}</Link>
                    </td>
                    <td style={td}>
                      <StatusBadge status={po.status} />
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>{po.fieldOrder ? "Yes" : "No"}</td>
                    <td style={td}>{po.vendor || "—"}</td>
                    <td style={{ ...td, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{po.description || "—"}</td>
                    <td style={td}>{po.department || "—"}</td>
                    <td style={td}>{po.assignedTo || "—"}</td>
                    <td style={td}>{po.createdBy || "—"}</td>
                    <td style={td}>{fmtDate(po.createdAt)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtC(po.total || 0)}</td>
                  </tr>,

                  isExp && (
                    <tr key={po.id + "_exp"}>
                      <td colSpan={10} style={{ padding: 0, background: "#f8faff", borderBottom: "1px solid #e5e7eb" }}>
                        <div style={{ padding: "14px 18px" }}>

                          {/* Items sub-table */}
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Items</div>
                          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8, border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                            <thead>
                              <tr style={{ background: "#f3f4f6" }}>
                                <th style={th}>Item Description</th>
                                <th style={th}>Taxable</th>
                                <th style={{ ...th, textAlign: "center" }}>Qty Ordered</th>
                                <th style={{ ...th, textAlign: "center" }}>Qty Received</th>
                                <th style={{ ...th, textAlign: "right" }}>Unit Cost</th>
                                <th style={{ ...th, textAlign: "right" }}>Total Cost</th>
                                <th style={th}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {(po.items || []).length === 0 && addingItemTo !== po.id && (
                                <tr><td colSpan={7} style={{ padding: "10px 12px", color: "#9ca3af", fontSize: 12 }}>No items — add one below.</td></tr>
                              )}
                              {(po.items || []).map(item => (
                                <tr key={item.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                                  <td style={td}>{item.name || item.description || "—"}</td>
                                  <td style={td}>{item.taxable ? "Yes" : "No"}</td>
                                  <td style={{ ...td, textAlign: "center" }}>{item.quantityOrdered}</td>
                                  <td style={{ ...td, textAlign: "center" }}>{item.quantityReceived}</td>
                                  <td style={{ ...td, textAlign: "right" }}>{item.unitCost > 0 ? fmtC(item.unitCost) : "—"}</td>
                                  <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{fmtC(item.totalCost)}</td>
                                  <td style={td}></td>
                                </tr>
                              ))}
                              {addingItemTo === po.id && (
                                <AddItemRow poId={po.id} poVendor={po.vendor} onDone={() => setAddingItemTo(null)} />
                              )}
                            </tbody>
                          </table>
                          {addingItemTo !== po.id && (
                            <button onClick={() => setAddingItemTo(po.id)} style={{ fontSize: 12, color: "#1565c0", background: "none", border: "none", cursor: "pointer", fontWeight: 600, marginBottom: 16 }}>
                              + Add Item
                            </button>
                          )}

                          {/* Bills sub-table */}
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Bills</div>
                          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                            <thead>
                              <tr style={{ background: "#f3f4f6" }}>
                                <th style={th}>Bill #</th>
                                <th style={th}>Receipt #</th>
                                <th style={th}>Vendor</th>
                                <th style={th}>Date Issued</th>
                                <th style={{ ...th, textAlign: "right" }}>Total</th>
                                <th style={th}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {(po.bills || []).length === 0 && addingBillTo !== po.id && (
                                <tr><td colSpan={6} style={{ padding: "10px 12px", color: "#9ca3af", fontSize: 12 }}>No bills yet.</td></tr>
                              )}
                              {(po.bills || []).map(b => (
                                <tr key={b.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                                  <td style={td}>{b.billNumber || "—"}</td>
                                  <td style={td}>{b.receiptNumber || "—"}</td>
                                  <td style={td}>{b.vendor || "—"}</td>
                                  <td style={td}>{fmtDate(b.dateIssued)}</td>
                                  <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{fmtC(b.total)}</td>
                                  <td style={td}></td>
                                </tr>
                              ))}
                              {addingBillTo === po.id && (
                                <AddBillRow poId={po.id} poNumber={po.poNumber} poVendor={po.vendor} onDone={() => setAddingBillTo(null)} />
                              )}
                            </tbody>
                          </table>
                          {addingBillTo !== po.id && (
                            <button onClick={() => setAddingBillTo(po.id)} style={{ fontSize: 12, color: "#1565c0", background: "none", border: "none", cursor: "pointer", fontWeight: 600, marginTop: 8 }}>
                              + Add Bill
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
              {pos.length > 0 && (
                <tr style={{ background: "#f9fafb", borderTop: "2px solid #e5e7eb" }}>
                  <td colSpan={9} style={{ ...td, fontWeight: 800 }}>TOTAL</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, fontSize: 14 }}>{fmtC(poGrandTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Purchasing Items ── */}
      {allItems.length > 0 && (
        <div>
          <SectionHead title="Purchasing Items" />
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={th}>PO Number</th>
                  <th style={th}>Item Description</th>
                  <th style={th}>Vendor</th>
                  <th style={th}>Fulfillment Status</th>
                  <th style={{ ...th, textAlign: "center" }}>Qty Ordered</th>
                  <th style={{ ...th, textAlign: "center" }}>Qty Received</th>
                  <th style={{ ...th, textAlign: "right" }}>Total Cost</th>
                </tr>
              </thead>
              <tbody>
                {allItems.map((item, i) => (
                  <tr key={item.id + i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ ...td, fontWeight: 700 }}>
                      <Link to={`/purchase-orders/${item.poId}`} style={{ color: "#1565c0", textDecoration: "none" }}>{item.poNumber}-{(item as any).lineNumber}</Link>
                    </td>
                    <td style={td}>{item.name || item.description || "—"}</td>
                    <td style={td}>{item.vendor || "—"}</td>
                    <td style={td}><StatusBadge status={item.fulfillmentStatus} /></td>
                    <td style={{ ...td, textAlign: "center" }}>{item.quantityOrdered}</td>
                    <td style={{ ...td, textAlign: "center" }}>{item.quantityReceived}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{fmtC(item.totalCost)}</td>
                  </tr>
                ))}
                <tr style={{ background: "#f9fafb", borderTop: "2px solid #e5e7eb" }}>
                  <td colSpan={6} style={{ ...td, fontWeight: 800 }}>TOTAL</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, fontSize: 14 }}>{fmtC(itemGrandTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Invoices ── */}
      {allInvoices.length > 0 && (
        <div>
          <SectionHead title="Invoices" />
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={th}>Bill Number</th>
                  <th style={th}>Receipt Number</th>
                  <th style={th}>Vendor</th>
                  <th style={th}>PO Number</th>
                  <th style={th}>Date Issued</th>
                  <th style={th}>Created By</th>
                  <th style={{ ...th, textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {allInvoices.map((b, i) => (
                  <tr key={b.id + i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={td}>{b.billNumber || "—"}</td>
                    <td style={td}>{b.receiptNumber || "—"}</td>
                    <td style={td}>{b.vendor || "—"}</td>
                    <td style={{ ...td, fontWeight: 700 }}>
                      <Link to={`/purchase-orders/${b.poId}`} style={{ color: "#1565c0", textDecoration: "none" }}>{b.poNumber}</Link>
                    </td>
                    <td style={td}>{fmtDate(b.dateIssued)}</td>
                    <td style={td}>{b.createdBy || "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{fmtC(b.total)}</td>
                  </tr>
                ))}
                <tr style={{ background: "#f9fafb", borderTop: "2px solid #e5e7eb" }}>
                  <td colSpan={6} style={{ ...td, fontWeight: 800 }}>TOTAL</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, fontSize: 14 }}>{fmtC(invoiceGrandTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Packing Slips ── */}
      {allPackingSlips.length > 0 && (
        <div>
          <SectionHead title="Packing Slips" />
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={th}>Receipt Number</th>
                  <th style={th}>Vendor</th>
                  <th style={th}>PO Number</th>
                  <th style={th}>Date Issued</th>
                  <th style={th}>Created By</th>
                  <th style={{ ...th, textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {allPackingSlips.map((b, i) => (
                  <tr key={b.id + i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={td}>{b.receiptNumber || "—"}</td>
                    <td style={td}>{b.vendor || "—"}</td>
                    <td style={{ ...td, fontWeight: 700 }}>
                      <Link to={`/purchase-orders/${b.poId}`} style={{ color: "#1565c0", textDecoration: "none" }}>{b.poNumber}</Link>
                    </td>
                    <td style={td}>{fmtDate(b.dateIssued)}</td>
                    <td style={td}>{b.createdBy || "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{fmtC(b.total)}</td>
                  </tr>
                ))}
                <tr style={{ background: "#f9fafb", borderTop: "2px solid #e5e7eb" }}>
                  <td colSpan={5} style={{ ...td, fontWeight: 800 }}>TOTAL</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, fontSize: 14 }}>{fmtC(packingSlipTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Parts Used on Visits ── */}
      <div>
        <SectionHead title="Inventory" />
        {visitParts.length === 0 ? (
          <div style={{ color: "#9ca3af", fontSize: 13, fontStyle: "italic", padding: "10px 0" }}>No inventory recorded on visits for this job.</div>
        ) : (
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={th}>Visit #</th>
                  <th style={th}>Date</th>
                  <th style={th}>Description</th>
                  <th style={th}>Notes</th>
                  <th style={{ ...th, textAlign: "center" }}>Qty</th>
                  <th style={{ ...th, textAlign: "right" }}>Unit Cost</th>
                  <th style={{ ...th, textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {visitParts.map((p, i) => {
                  const total = (p.qty || 0) * (p.unitCost || 0);
                  return (
                    <tr key={p.id + i} style={{ borderBottom: i < visitParts.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                      <td style={{ ...td, fontWeight: 700, color: "#1565c0" }}>{p.visitNumber || "—"}</td>
                      <td style={td}>{p.visitDate ? fmtDate(p.visitDate) : "—"}</td>
                      <td style={td}>{p.description || "—"}</td>
                      <td style={{ ...td, color: "#6b7280" }}>{p.notes || "—"}</td>
                      <td style={{ ...td, textAlign: "center" }}>{p.qty}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmtC(p.unitCost || 0)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtC(total)}</td>
                    </tr>
                  );
                })}
                <tr style={{ background: "#f9fafb", borderTop: "2px solid #e5e7eb" }}>
                  <td colSpan={6} style={{ ...td, fontWeight: 800 }}>TOTAL</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, fontSize: 14 }}>{fmtC(visitPartsTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {addPOOpen && <CreatePOModal jobId={jobId} jobNumber={jobNumber} onClose={() => setAddPOOpen(false)} />}
    </div>
  );
}
