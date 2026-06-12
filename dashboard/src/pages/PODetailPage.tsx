import { useEffect, useRef, useState } from "react";
import { arrayUnion, collection, doc, getDoc, getDocs, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { auth, db } from "../firebase";
import { Link, useParams } from "react-router-dom";
import ImportBillModal from "./ImportBillModal";

// ── Types ──────────────────────────────────────────────────────────────────────
interface POItem {
  id: string; name: string; description: string;
  fulfillmentStatus: string; quantityOrdered: number; quantityReceived: number;
  unitCost: number; totalCost: number; taxable: boolean;
  unitOfMeasure: string; costCode: string; jobCostType: string; revenueType: string;
}
interface Bill {
  id: string; billNumber: string; receiptNumber: string; vendor: string;
  dateIssued: string; createdBy: string; total: number; pdfUrl?: string;
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

// ── Constants ─────────────────────────────────────────────────────────────────
const PO_TYPES       = ["Credit Card order","Inspection","On line order","Petty Cash","Subcontractor","Vendor delivery","Vendor Pickup"];
const DEPARTMENTS    = ["Service","Electrical","Automation","Industrial","Commercial","HVAC","Maintenance","General","Construction","Other"];
const TAX_RATES      = ["None","GST (5%)","HST ON (13%)","HST BC (12%)","PST (7%)"];

// ── Helpers ────────────────────────────────────────────────────────────────────
const PO_STATUSES = ["Open", "Pending", "Cancelled", "Draft"];
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

// ── Edit Item Modal ────────────────────────────────────────────────────────────
const COST_TYPES  = ["Materials", "Labour", "Subcontractor", "Equipment", "Other"];
const COST_CODES  = ["Materials", "Labour", "Subcontractor", "Equipment", "Other"];
const REV_TYPES   = ["Materials", "Labour", "Subcontractor", "Equipment", "Other"];

function EditItemModal({
  item, poId, jobNumber, departments, onClose,
}: {
  item: POItem; poId: string; jobNumber: string; departments: string[]; onClose: () => void;
}) {
  const [f, setF] = useState({
    name:             item.name || "",
    description:      item.description || "",
    department:       item.costCode || "Materials",
    costCode:         item.costCode || "Materials",
    jobCostType:      item.jobCostType || "Materials",
    revenueType:      item.revenueType || "Materials",
    unitCost:         String(item.unitCost ?? 0),
    quantity:         String(item.quantityOrdered ?? 1),
    quantityReceived: String(item.quantityReceived ?? 0),
    unitOfMeasure:    item.unitOfMeasure || "",
    taxable:          !!item.taxable,
  });
  const [saving, setSaving] = useState(false);

  const qty     = parseFloat(f.quantity) || 0;
  const qtyRec  = parseFloat(f.quantityReceived) || 0;
  const cost    = parseFloat(f.unitCost) || 0;
  const total   = qty * cost;

  const inp: React.CSSProperties = {
    width: "100%", padding: "8px 10px", border: "1px solid #d1d5db",
    borderRadius: 6, fontSize: 13, outline: "none", boxSizing: "border-box" as const,
  };
  const label: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase",
    letterSpacing: 0.6, marginBottom: 4, display: "block",
  };

  async function save() {
    if (!f.name.trim()) { alert("Product name is required."); return; }
    setSaving(true);
    try {
      const poSnap = await getDoc(doc(db, "purchaseOrders", poId));
      const existing: POItem[] = poSnap.data()?.items || [];
      const updated = existing.map(i =>
        i.id === item.id
          ? { ...i, name: f.name.trim(), description: f.description.trim(),
              costCode: f.costCode, jobCostType: f.jobCostType, revenueType: f.revenueType,
              unitCost: cost, quantityOrdered: qty, quantityReceived: qtyRec,
              fulfillmentStatus: qty > 0 && qty === qtyRec ? "Fulfilled" : "Pending",
              totalCost: total, unitOfMeasure: f.unitOfMeasure, taxable: f.taxable }
          : i
      );
      const newSubtotal = updated.reduce((s, i) => s + (i.totalCost || 0), 0);
      const poTaxPct = ({ "GST (5%)": 0.05, "HST ON (13%)": 0.13, "HST BC (12%)": 0.12, "PST (7%)": 0.07 } as Record<string,number>)[poSnap.data()?.taxRate || ""] ?? 0;
      const newTaxAmt = updated.filter(i => i.taxable).reduce((s, i) => s + (i.totalCost || 0), 0) * poTaxPct;
      const allFulfilled = updated.length > 0 && updated.every(i => i.fulfillmentStatus === "Fulfilled");
      const updates: Record<string, unknown> = { items: updated, subtotal: newSubtotal, taxAmount: newTaxAmt, total: newSubtotal + newTaxAmt };
      if (allFulfilled) updates.status = "Fulfilled";
      await updateDoc(doc(db, "purchaseOrders", poId), updates);
      onClose();
    } catch (e) { console.error(e); alert("Failed to save item."); }
    setSaving(false);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "#fff", borderRadius: 12, width: 560, maxWidth: "95vw",
        maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#111827" }}>Edit Purchase Order Item</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280", lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Product */}
          <div>
            <span style={label}>Product</span>
            <input style={inp} value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Purchased Materials — enter description here" />
          </div>

          {/* Description */}
          <div>
            <span style={label}>Description</span>
            <textarea style={{ ...inp, height: 72, resize: "vertical" }} value={f.description}
              onChange={e => setF(p => ({ ...p, description: e.target.value }))} />
          </div>

          {/* Job / Department row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <span style={label}>Job / Project</span>
              <input style={{ ...inp, background: "#f9fafb", color: "#6b7280" }} value={jobNumber} readOnly />
            </div>
            <div>
              <span style={label}>Department <span style={{ color: "#ef4444" }}>REQUIRED</span></span>
              <select style={inp} value={f.department} onChange={e => setF(p => ({ ...p, department: e.target.value }))}>
                {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
          </div>

          {/* Cost Code / Job Cost Type / Revenue Type */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <span style={label}>Cost Code</span>
              <select style={inp} value={f.costCode} onChange={e => setF(p => ({ ...p, costCode: e.target.value }))}>
                {COST_CODES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <span style={label}>Job Cost Type</span>
              <select style={inp} value={f.jobCostType} onChange={e => setF(p => ({ ...p, jobCostType: e.target.value }))}>
                {COST_TYPES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <span style={label}>Revenue Type</span>
              <select style={inp} value={f.revenueType} onChange={e => setF(p => ({ ...p, revenueType: e.target.value }))}>
                {REV_TYPES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Unit Cost / Qty Ordered / Qty Received / UOM */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
            <div>
              <span style={label}>Unit Cost</span>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#6b7280", fontSize: 13 }}>$</span>
                <input style={{ ...inp, paddingLeft: 22 }} type="number" min={0} step={0.01}
                  value={f.unitCost} onChange={e => setF(p => ({ ...p, unitCost: e.target.value }))} />
              </div>
            </div>
            <div>
              <span style={label}>Qty Ordered</span>
              <input style={inp} type="number" min={0} value={f.quantity}
                onChange={e => setF(p => ({ ...p, quantity: e.target.value }))} />
            </div>
            <div>
              <span style={label}>Qty Received</span>
              <input style={inp} type="number" min={0} value={f.quantityReceived}
                onChange={e => setF(p => ({ ...p, quantityReceived: e.target.value }))} />
            </div>
            <div>
              <span style={label}>Unit of Measure</span>
              <input style={inp} value={f.unitOfMeasure}
                onChange={e => setF(p => ({ ...p, unitOfMeasure: e.target.value }))} />
            </div>
          </div>

          {/* Taxable */}
          <div>
            <span style={label}>Taxable</span>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={f.taxable} onChange={e => setF(p => ({ ...p, taxable: e.target.checked }))}
                style={{ width: 16, height: 16, accentColor: "#1565c0" }} />
              <span style={{ fontSize: 13, color: "#374151" }}>Taxable</span>
            </label>
          </div>

          {/* Total Cost */}
          <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 14, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6 }}>Total Cost</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>
              ${total.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "0 22px 22px" }}>
          <button onClick={save} disabled={saving} style={{
            width: "100%", background: saving ? "#86efac" : "#16a34a", color: "#fff",
            border: "none", borderRadius: 8, padding: "13px 0", fontSize: 14,
            fontWeight: 800, cursor: "pointer", letterSpacing: 0.5,
          }}>
            {saving ? "SAVING…" : "SAVE"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add Item Row ───────────────────────────────────────────────────────────────
function AddItemRow({ poId, jobNumber }: { poId: string; jobNumber: string }) {
  const blank = { name: "", description: "", unitCost: "", quantity: "1", jobCostType: "Materials", unitOfMeasure: "ea", taxable: true };
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
      const poData = poSnap.data();
      const existing: POItem[] = poData?.items || [];
      const newItem = {
        id: crypto.randomUUID(),
        name: f.name.trim(),
        description: f.description.trim(),
        fulfillmentStatus: "Pending",
        quantityOrdered: qty,
        quantityReceived: 0,
        unitCost: cost,
        totalCost: qty * cost,
        taxable: f.taxable,
        unitOfMeasure: f.unitOfMeasure,
        costCode: "",
        jobCostType: f.jobCostType,
        revenueType: "Materials",
      };
      const allItems = [...existing, newItem];
      const newSubtotal = allItems.reduce((s, i) => s + (i.totalCost || 0), 0);
      const poTaxPct = ({ "GST (5%)": 0.05, "HST ON (13%)": 0.13, "HST BC (12%)": 0.12, "PST (7%)": 0.07 } as Record<string,number>)[poData?.taxRate || ""] ?? 0;
      const newTaxAmt = allItems.filter(i => i.taxable).reduce((s, i) => s + (i.totalCost || 0), 0) * poTaxPct;
      const allFulfilled = allItems.length > 0 && allItems.every(i => i.fulfillmentStatus === "Fulfilled");
      const updates: Record<string, unknown> = {
        items: allItems, subtotal: newSubtotal, taxAmount: newTaxAmt, total: newSubtotal + newTaxAmt,
        createdBy: auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
      };
      if (allFulfilled) updates.status = "Fulfilled";
      await updateDoc(doc(db, "purchaseOrders", poId), updates);
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
      <div style={{ marginBottom: 8 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#374151", cursor: "pointer" }}>
          <input type="checkbox" checked={f.taxable} onChange={e => setF(p => ({ ...p, taxable: e.target.checked }))}
            style={{ width: 14, height: 14, accentColor: "#1565c0" }} />
          Taxable
        </label>
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState<Partial<PO>>({});
  const [saving, setSaving]   = useState(false);
  const [vendors, setVendors]     = useState<string[]>([]);
  const [employees, setEmployees] = useState<string[]>([]);
  const [editingItem, setEditingItem] = useState<POItem | null>(null);
  const [showImport, setShowImport] = useState(false);
  const firstEditField = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    getDocs(collection(db, "vendors")).then(s => setVendors(s.docs.map(d => (d.data().name as string) || "").filter(Boolean).sort())).catch(() => {});
    getDocs(query(collection(db, "users"), where("showInDispatch", "==", true))).then(s => setEmployees(s.docs.map(d => (d.data().displayName as string) || "").filter(Boolean).sort())).catch(() => {});
  }, []);

  function startEdit() {
    if (!po) return;
    setDraft({ ...po });
    setEditing(true);
    setTimeout(() => firstEditField.current?.focus(), 50);
  }

  function cancelEdit() { setEditing(false); setDraft({}); }

  async function saveEdit() {
    if (!poId || !po) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "purchaseOrders", poId), {
        vendor:              draft.vendor      ?? po.vendor,
        vendorType:          draft.vendorType  ?? po.vendorType,
        poType:              draft.poType      ?? po.poType,
        poDate:              draft.poDate      ?? po.poDate,
        requiredBy:          draft.requiredBy  ?? po.requiredBy,
        department:          draft.department  ?? po.department,
        assignedTo:          draft.assignedTo  ?? po.assignedTo,
        assignTo:            draft.assignedTo  ?? po.assignedTo,
        description:         draft.description ?? po.description,
        projectManager:      draft.projectManager ?? po.projectManager,
        taxRate:             draft.taxRate     ?? po.taxRate,
        directPayerSalesTax: draft.directPayerSalesTax ?? po.directPayerSalesTax,
        shipTo:              draft.shipTo      ?? po.shipTo,
        fieldOrder:          draft.fieldOrder  ?? po.fieldOrder,
        tags:                draft.tags        ?? po.tags,
      });
      setEditing(false);
      setDraft({});
    } catch (e) { console.error(e); alert("Failed to save changes."); }
    setSaving(false);
  }

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
      {editingItem && (
        <EditItemModal
          item={editingItem}
          poId={po.id}
          jobNumber={po.jobNumber}
          departments={DEPARTMENTS}
          onClose={() => setEditingItem(null)}
        />
      )}
      {showImport && (
        <ImportBillModal
          poId={po.id}
          poNumber={po.poNumber}
          vendor={po.vendor}
          onClose={() => setShowImport(false)}
        />
      )}

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
          {editing ? (
            <>
              <button onClick={cancelEdit} style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>CANCEL</button>
              <button onClick={saveEdit} disabled={saving} style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{saving ? "SAVING…" : "SAVE CHANGES"}</button>
            </>
          ) : (
            <>
              <button onClick={startEdit} style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>EDIT</button>
              <button style={{ background: "#1f2937", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>GENERATE PDF</button>
              <button style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>GENERATE RECEIPT</button>
            </>
          )}
        </div>
      </div>

      {/* ── PO title bar ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "12px 24px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>PO {po.poNumber}</span>
        {po.fieldOrder && (
          <span style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>Field Order</span>
        )}
        <span style={{ background: statusStyle.bg, color: statusStyle.color, border: `1px solid ${statusStyle.border}`, borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>{po.status}</span>
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
          <div style={{ background: editing ? "#eff6ff" : "#fff", border: `1px solid ${editing ? "#bfdbfe" : "#e5e7eb"}`, borderRadius: 10, padding: "18px 20px", marginBottom: 20, transition: "background 0.15s" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 16 }}>
              Purchase Order Information {editing && <span style={{ fontSize: 11, color: "#1565c0", fontWeight: 400, marginLeft: 8 }}>— editing</span>}
            </div>
            {(() => {
              const ei: React.CSSProperties = { width: "100%", padding: "6px 8px", border: "1px solid #93c5fd", borderRadius: 5, fontSize: 13, outline: "none", background: "#fff", boxSizing: "border-box" as const };
              const d = draft as any;
              const set = (k: string, v: any) => setDraft(p => ({ ...p, [k]: v }));
              if (editing) return (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "14px 20px" }}>
                  <div><div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>Vendor</div>
                    <select style={ei} value={d.vendor ?? po.vendor} onChange={e => set("vendor", e.target.value)}>
                      {vendors.includes(po.vendor) ? null : <option value={po.vendor}>{po.vendor}</option>}
                      {vendors.map(v => <option key={v}>{v}</option>)}
                    </select>
                  </div>
                  <div><div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>Custom PO Type</div>
                    <select style={ei} value={d.poType ?? po.poType} onChange={e => set("poType", e.target.value)}>
                      {PO_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div><div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>Date of Purchase</div>
                    <input ref={firstEditField} style={ei} type="date" value={d.poDate ?? po.poDate} onChange={e => set("poDate", e.target.value)} />
                  </div>
                  <div><div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>Required By</div>
                    <input style={ei} type="date" value={d.requiredBy ?? po.requiredBy ?? ""} onChange={e => set("requiredBy", e.target.value)} />
                  </div>
                  <div><div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>Department</div>
                    <select style={ei} value={d.department ?? po.department} onChange={e => set("department", e.target.value)}>
                      {DEPARTMENTS.map(dep => <option key={dep}>{dep}</option>)}
                    </select>
                  </div>
                  <div><div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>Assigned To</div>
                    <select style={ei} value={d.assignedTo ?? po.assignedTo ?? po.assignTo ?? ""} onChange={e => set("assignedTo", e.target.value)}>
                      <option value="">— None —</option>
                      {employees.map(e => <option key={e}>{e}</option>)}
                    </select>
                  </div>
                  <div style={{ gridColumn: "span 2" }}><div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>Description</div>
                    <input style={ei} value={d.description ?? po.description ?? ""} onChange={e => set("description", e.target.value)} />
                  </div>
                  <div><div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>Project Manager</div>
                    <select style={ei} value={d.projectManager ?? po.projectManager ?? ""} onChange={e => set("projectManager", e.target.value)}>
                      <option value="">— None —</option>
                      {employees.map(e => <option key={e}>{e}</option>)}
                    </select>
                  </div>
                  <div><div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>Tax Rate</div>
                    <select style={ei} value={d.taxRate ?? po.taxRate ?? "None"} onChange={e => set("taxRate", e.target.value)}>
                      {TAX_RATES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div><div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>Ship To</div>
                    <input style={ei} value={d.shipTo ?? po.shipTo ?? ""} onChange={e => set("shipTo", e.target.value)} />
                  </div>
                  <div><div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>Tags</div>
                    <input style={ei} value={d.tags ?? po.tags ?? ""} onChange={e => set("tags", e.target.value)} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                      <input type="checkbox" checked={!!(d.fieldOrder ?? po.fieldOrder)} onChange={e => set("fieldOrder", e.target.checked)} />
                      Field Order
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                      <input type="checkbox" checked={!!(d.directPayerSalesTax ?? po.directPayerSalesTax)} onChange={e => set("directPayerSalesTax", e.target.checked)} />
                      Direct Payer Sales Tax
                    </label>
                  </div>
                </div>
              );
              return (
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
              );
            })()}
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
                        <th style={thStyle}></th>
                        <th style={thStyle}>Line #</th>
                        <th style={thStyle}>Item Name</th>
                        <th style={thStyle}>Line Type</th>
                        <th style={thStyle}>Description</th>
                        <th style={thStyle}>UOM</th>
                        <th style={thStyle}>Taxable</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Unit Cost</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Qty Ordered</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Qty Received</th>
                        <th style={thStyle}>Status</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0 && (
                        <tr><td colSpan={12} style={{ padding: "32px 12px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>No Purchase Order Lines</td></tr>
                      )}
                      {items.map((item, i) => (
                        <tr key={item.id || i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <td style={{ ...tdStyle, width: 36, padding: "6px 8px" }}>
                            <button
                              onClick={() => setEditingItem(item)}
                              title="Edit item"
                              style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 5, padding: "3px 8px", fontSize: 11, fontWeight: 700, color: "#6b7280", cursor: "pointer" }}
                            >Edit</button>
                          </td>
                          <td style={{ ...tdStyle, fontWeight: 600, color: "#374151" }}>{po.poNumber}-{i + 1}</td>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{item.name || "—"}</td>
                          <td style={tdStyle}>{item.jobCostType || "—"}</td>
                          <td style={tdStyle}>{item.description || "—"}</td>
                          <td style={tdStyle}>{item.unitOfMeasure || "—"}</td>
                          <td style={{ ...tdStyle, textAlign: "center" }}>{item.taxable ? "Yes" : "No"}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{fmtC(item.unitCost)}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{item.quantityOrdered ?? "—"}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{item.quantityReceived ?? 0}</td>
                          <td style={tdStyle}>{(() => {
                            const fulfilled = (item.quantityOrdered ?? 0) > 0 && item.quantityOrdered === item.quantityReceived;
                            return <span style={{ background: fulfilled ? "#dcfce7" : "#f3f4f6", color: fulfilled ? "#166534" : "#6b7280", borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 700 }}>{fulfilled ? "Fulfilled" : "Pending"}</span>;
                          })()}</td>
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
                      <td style={tdStyle}>
                        {b.pdfUrl ? (
                          <a href={b.pdfUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#1565c0", textDecoration: "none", fontWeight: 700 }}>{b.billNumber || "—"}</a>
                        ) : (b.billNumber || "—")}
                      </td>
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
                        <td style={{ ...tdStyle, fontWeight: 600 }}>
                          {b.pdfUrl ? (
                            <a href={b.pdfUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#1565c0", textDecoration: "none", fontWeight: 700 }}>{b.billNumber || "—"}</a>
                          ) : (b.billNumber || "—")}
                        </td>
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
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <AddBillRow poId={po.id} vendor={po.vendor} />
                <button
                  onClick={() => setShowImport(true)}
                  style={{ display: "flex", alignItems: "center", gap: 6, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: "#1565c0", cursor: "pointer" }}
                >
                  📄 IMPORT INVOICE PDF
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
