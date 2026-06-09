import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  addDoc, collection, deleteDoc, doc,
  getDocs, onSnapshot, setDoc, updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { useIsAdmin } from "../hooks/useIsAdmin";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Property {
  id?: string;
  name: string;
  status: "Active" | "Inactive";
  customerName: string;
  customerId?: string;   // Firestore doc ID of the linked customer
  propertyType: string;
  openJobs: number;
  openJobsValue: number;
  outstandingBalance: number;
  overdueBalance: number;
  propertyAddress: string;
  accountNumber: string;
  billingAddress: string;
  billingCustomer: string;
  createdBy: string;
  createdOn: string;
  customerType: string;
  tags: string;
}

// ── CSV parser (handles quoted multiline fields) ───────────────────────────────
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], nx = text[i + 1];
    if (inQuote) {
      if (ch === '"' && nx === '"') { field += '"'; i++; }
      else if (ch === '"') inQuote = false;
      else field += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ',') { row.push(field); field = ""; }
      else if (ch === '\n' || (ch === '\r' && nx === '\n')) {
        if (ch === '\r') i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += ch;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseMoney(s: string): number {
  return parseFloat(s.replace(/[$,]/g, "")) || 0;
}

function cleanAddr(raw: string): string {
  return raw.replace(/\n/g, ", ").replace(/,?\s*CA\s*$/, "").replace(/,?\s*US\s*$/, "").trim().replace(/,\s*$/, "");
}

function csvRowToProperty(headers: string[], row: string[]): Omit<Property, "id"> | null {
  const g = (h: string) => (row[headers.indexOf(h)] ?? "").trim();
  const name = g("Property");
  if (!name) return null;
  return {
    name,
    status: (g("Status") || "Active") as "Active" | "Inactive",
    customerName: g("Customer"),
    propertyType: g("Property Type"),
    openJobs: parseInt(g("Open Jobs")) || 0,
    openJobsValue: parseMoney(g("Open Jobs Value")),
    outstandingBalance: parseMoney(g("Outstanding Balance")),
    overdueBalance: parseMoney(g("Overdue Balance")),
    propertyAddress: cleanAddr(g("Property Address")),
    accountNumber: g("Account Number"),
    billingAddress: cleanAddr(g("Billing Address")),
    billingCustomer: g("Billing Customer"),
    createdBy: g("Created By"),
    createdOn: g("Created On"),
    customerType: g("Customer Type"),
    tags: g("Tags"),
  };
}

function fmt$(n: number): string {
  if (!n) return "$0.00";
  return "$" + n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const TYPE_COLORS: Record<string, { background: string; color: string }> = {
  Industrial:           { background: "#dbeafe", color: "#1e40af" },
  Commercial:           { background: "#ede9fe", color: "#6d28d9" },
  Institutional:        { background: "#d1fae5", color: "#065f46" },
  "Property Manager":   { background: "#fef3c7", color: "#92400e" },
  Construction:         { background: "#fee2e2", color: "#991b1b" },
  Other:                { background: "#f3f4f6", color: "#374151" },
};

// ── Filter tab ────────────────────────────────────────────────────────────────
function FilterTab({ label, count, active, dot, onClick }:
  { label: string; count: number; active: boolean; dot?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "10px 18px", fontWeight: 600, fontSize: 14, cursor: "pointer",
      background: "none", border: "none",
      borderBottom: active ? "2px solid #1565c0" : "2px solid transparent",
      color: active ? "#1565c0" : "#6b7280", marginBottom: -2, whiteSpace: "nowrap",
    }}>
      {dot && <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />}
      {label}
      <span style={{
        fontSize: 11, borderRadius: 99, padding: "1px 6px", fontWeight: 700,
        background: active ? "#dbeafe" : "#f3f4f6",
        color: active ? "#1e40af" : "#6b7280",
      }}>{count}</span>
    </button>
  );
}

// ── Property row ──────────────────────────────────────────────────────────────
function PropertyRow({ p, onEdit, onDelete, isAdmin }:
  { p: Property; onEdit: () => void; onDelete: () => void; isAdmin: boolean }) {
  const navigate = useNavigate();
  const tc = p.propertyType ? (TYPE_COLORS[p.propertyType] || TYPE_COLORS.Other) : null;
  return (
    <tr
      onClick={onEdit}
      style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}
      onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
      onMouseLeave={e => (e.currentTarget.style.background = "")}
    >
      {/* Property name — sticky */}
      <td style={{ ...td, position: "sticky" as const, left: 0, background: "inherit", zIndex: 1, minWidth: 200, borderRight: "1px solid #f0f0f0" }}>
        <div style={{ fontWeight: 600, color: "#0d2e5e", fontSize: 13 }}>{p.name}</div>
      </td>
      {/* Status */}
      <td style={td}>
        <span style={{ background: p.status === "Active" ? "#dcfce7" : "#f3f4f6", color: p.status === "Active" ? "#166534" : "#6b7280", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>
          {p.status}
        </span>
      </td>
      {/* Customer — direct link if customerId is set, search fallback otherwise */}
      <td style={{ ...td, minWidth: 180 }}>
        {p.customerName
          ? <span
              onClick={e => {
                e.stopPropagation();
                if (p.customerId) navigate(`/customers/${p.customerId}`);
                else navigate(`/customers?search=${encodeURIComponent(p.customerName)}`);
              }}
              title={p.customerId ? "View customer" : "Search for customer (not yet linked)"}
              style={{ color: p.customerId ? "#1565c0" : "#f59e0b", fontWeight: 500, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
              {p.customerName}
              {!p.customerId && <span title="Not linked — run Link Customers to fix" style={{ fontSize: 10 }}>⚠</span>}
            </span>
          : <span style={{ color: "#d1d5db" }}>—</span>}
      </td>
      {/* Property type */}
      <td style={td}>
        {tc
          ? <span style={{ ...tc, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99, whiteSpace: "nowrap" }}>{p.propertyType}</span>
          : <span style={{ color: "#d1d5db" }}>—</span>}
      </td>
      {/* Open Jobs */}
      <td style={{ ...td, textAlign: "center" as const, fontWeight: p.openJobs > 0 ? 700 : 400 }}>{p.openJobs || "—"}</td>
      {/* Open Jobs Value */}
      <td style={{ ...td, color: p.openJobsValue > 0 ? "#374151" : "#9ca3af", fontWeight: p.openJobsValue > 0 ? 500 : 400 }}>
        {p.openJobsValue > 0 ? fmt$(p.openJobsValue) : "—"}
      </td>
      {/* Outstanding Balance */}
      <td style={{ ...td, color: p.outstandingBalance > 0 ? "#dc2626" : "#374151", fontWeight: p.outstandingBalance > 0 ? 600 : 400 }}>
        {p.outstandingBalance > 0 ? fmt$(p.outstandingBalance) : "—"}
      </td>
      {/* Overdue Balance */}
      <td style={{ ...td, color: p.overdueBalance > 0 ? "#dc2626" : "#374151", fontWeight: p.overdueBalance > 0 ? 700 : 400 }}>
        {p.overdueBalance > 0 ? fmt$(p.overdueBalance) : "—"}
      </td>
      {/* Property Address */}
      <td style={{ ...td, minWidth: 220 }}>
        <span title={p.propertyAddress} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#6b7280", fontSize: 12, maxWidth: 220 }}>
          {p.propertyAddress || "—"}
        </span>
      </td>
      {/* Account Number */}
      <td style={{ ...td, whiteSpace: "nowrap", color: "#6b7280", fontSize: 12 }}>{p.accountNumber || "—"}</td>
      {/* Billing Address */}
      <td style={{ ...td, minWidth: 180 }}>
        <span title={p.billingAddress} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#6b7280", fontSize: 12, maxWidth: 180 }}>
          {p.billingAddress || "—"}
        </span>
      </td>
      {/* Billing Customer */}
      <td style={{ ...td, whiteSpace: "nowrap", fontSize: 12, color: "#374151" }}>{p.billingCustomer || "—"}</td>
      {/* Created By */}
      <td style={{ ...td, whiteSpace: "nowrap", color: "#9ca3af", fontSize: 12 }}>{p.createdBy || "—"}</td>
      {/* Created On */}
      <td style={{ ...td, whiteSpace: "nowrap", color: "#9ca3af", fontSize: 12 }}>{p.createdOn || "—"}</td>
      {/* Customer Type */}
      <td style={td}>
        {p.customerType
          ? <span style={{ ...(TYPE_COLORS[p.customerType] || TYPE_COLORS.Other), fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99, whiteSpace: "nowrap" as const }}>{p.customerType}</span>
          : <span style={{ color: "#d1d5db" }}>—</span>}
      </td>
      {/* Tags */}
      <td style={{ ...td, maxWidth: 160 }}>
        <span title={p.tags} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#6b7280", fontSize: 12 }}>
          {p.tags || "—"}
        </span>
      </td>
      {/* Actions */}
      <td style={{ ...td, whiteSpace: "nowrap" }} onClick={e => e.stopPropagation()}>
        {isAdmin && (
          <button onClick={onDelete} title="Delete" style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 13, padding: "3px 7px", borderRadius: 6 }}>✕</button>
        )}
      </td>
    </tr>
  );
}

// ── Create / Edit modal ───────────────────────────────────────────────────────
function PropertyModal({ title, initial, onSave, onClose }:
  { title: string; initial?: Property; onSave: (d: Omit<Property, "id">) => Promise<void>; onClose: () => void }) {
  const blank: Omit<Property, "id"> = {
    name: "", status: "Active", customerName: "", propertyType: "", openJobs: 0,
    openJobsValue: 0, outstandingBalance: 0, overdueBalance: 0, propertyAddress: "",
    accountNumber: "", billingAddress: "", billingCustomer: "", createdBy: "",
    createdOn: "", customerType: "", tags: "",
  };
  const [form, setForm] = useState<Omit<Property, "id">>({ ...blank, ...initial });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (v: string | number) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0d2e5e", marginBottom: 20 }}>{title}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Property Name *</label><input style={inp} value={form.name} onChange={e => set("name")(e.target.value)} /></div>
          <div><label style={lbl}>Status</label>
            <select style={inp} value={form.status} onChange={e => set("status")(e.target.value)}>
              <option>Active</option><option>Inactive</option>
            </select>
          </div>
          <div><label style={lbl}>Property Type</label>
            <select style={inp} value={form.propertyType} onChange={e => set("propertyType")(e.target.value)}>
              <option value="">— Select —</option>
              {["Industrial","Commercial","Institutional","Property Manager","Construction","Other"].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Customer</label><input style={inp} value={form.customerName} onChange={e => set("customerName")(e.target.value)} placeholder="Customer name" /></div>
          <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Property Address</label><textarea style={{ ...inp, resize: "vertical", minHeight: 56, fontFamily: "inherit" }} value={form.propertyAddress} onChange={e => set("propertyAddress")(e.target.value)} /></div>
          <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Billing Address</label><textarea style={{ ...inp, resize: "vertical", minHeight: 48, fontFamily: "inherit" }} value={form.billingAddress} onChange={e => set("billingAddress")(e.target.value)} /></div>
          <div><label style={lbl}>Account Number</label><input style={inp} value={form.accountNumber} onChange={e => set("accountNumber")(e.target.value)} /></div>
          <div><label style={lbl}>Customer Type</label>
            <select style={inp} value={form.customerType} onChange={e => set("customerType")(e.target.value)}>
              <option value="">— Select —</option>
              {["Industrial","Commercial","Institutional","Property Manager","Construction","Other"].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Created By</label><input style={inp} value={form.createdBy} onChange={e => set("createdBy")(e.target.value)} /></div>
          <div><label style={lbl}>Created On</label><input style={inp} value={form.createdOn} onChange={e => set("createdOn")(e.target.value)} placeholder="Jan 1, 2026" /></div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button disabled={!form.name.trim() || saving} onClick={async () => { setSaving(true); await onSave(form); setSaving(false); }} style={{ ...btnS("#1565c0"), opacity: !form.name.trim() || saving ? 0.5 : 1 }}>
            {saving ? "Saving…" : "Save Property"}
          </button>
          <button onClick={onClose} style={btnS("#6b7280")}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const btnS  = (bg: string): React.CSSProperties => ({ background: bg, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" });
const pgBtn: React.CSSProperties = { padding: "4px 10px", fontSize: 12, fontWeight: 500, borderRadius: 6, cursor: "pointer", border: "1px solid #d1d5db", background: "#fff", color: "#374151" };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 };
const inp: React.CSSProperties = { width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" as const };
// top:0 — sticky is relative to the inner scroll container, not the viewport
const th: React.CSSProperties = { padding: "10px 12px", textAlign: "left" as const, fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" as const, letterSpacing: 0.4, whiteSpace: "nowrap" as const, background: "#f9fafb", borderBottom: "2px solid #e5e7eb", position: "sticky" as const, top: 0, zIndex: 3 };
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13, color: "#374151", verticalAlign: "middle" as const };

type PageSize = 25 | 50 | 100 | "all";
const PAGE_SIZES: PageSize[] = [25, 50, 100, "all"];

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PropertiesPage() {
  const isAdmin = useIsAdmin();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [filter, setFilter]         = useState<"all"|"outstanding"|"overdue">("all");
  const [pageSize, setPageSize]     = useState<PageSize>(25);
  const [page, setPage]             = useState(0);
  const [createModal, setCreateModal] = useState(false);
  const [editModal, setEditModal]     = useState<Property | null>(null);
  const [importing, setImporting]     = useState(false);
  const [importProg, setImportProg]   = useState({ done: 0, total: 0 });
  const [linking,   setLinking]       = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Real-time Firestore
  useEffect(() => {
    return onSnapshot(
      collection(db, "properties"),
      snap => { setProperties(snap.docs.map(d => ({ id: d.id, ...d.data() } as Property))); setLoading(false); },
      () => setLoading(false)
    );
  }, []);

  // Filter + search
  const filtered = useMemo(() => {
    let list = [...properties];
    if (filter === "outstanding") list = list.filter(p => p.outstandingBalance > 0);
    if (filter === "overdue")     list = list.filter(p => p.overdueBalance > 0);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.customerName || "").toLowerCase().includes(q) ||
        (p.propertyAddress || "").toLowerCase().includes(q) ||
        (p.propertyType || "").toLowerCase().includes(q) ||
        (p.billingCustomer || "").toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [properties, filter, search]);

  // Reset to page 0 whenever filter / search / pageSize changes
  useEffect(() => { setPage(0); }, [filter, search, pageSize]);

  const totalPages  = pageSize === "all" ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage    = Math.min(page, totalPages - 1);
  const paginated   = pageSize === "all"
    ? filtered
    : filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const rangeStart  = pageSize === "all" ? 1 : safePage * pageSize + 1;
  const rangeEnd    = pageSize === "all" ? filtered.length : Math.min(safePage * pageSize + pageSize, filtered.length);

  const cntOutstanding = useMemo(() => properties.filter(p => p.outstandingBalance > 0).length, [properties]);
  const cntOverdue     = useMemo(() => properties.filter(p => p.overdueBalance > 0).length, [properties]);

  // ── CSV import ────────────────────────────────────────────────────────────
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (!rows.length) return;
      const headers = rows[0].map(h => h.trim());
      const records = rows.slice(1).map(r => csvRowToProperty(headers, r)).filter(Boolean) as Omit<Property, "id">[];
      setImportProg({ done: 0, total: records.length });
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        // Use sanitised property name + customer as stable doc ID
        const docId = `p_${(r.name + "_" + r.customerName).replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60)}`;
        await setDoc(doc(db, "properties", docId), r, { merge: true });
        setImportProg({ done: i + 1, total: records.length });
      }
    } catch (err) { console.error("Import failed:", err); }
    setImporting(false);
    e.target.value = "";
  }

  // ── Link properties → customers by name matching ─────────────────────────
  async function linkCustomers() {
    setLinking(true);
    try {
      // Build a lowercase-name → customerId map from all customers
      const custSnap = await getDocs(collection(db, "customers"));
      const nameMap = new Map<string, string>();
      custSnap.docs.forEach(d => {
        const name = (d.data().name || "").trim().toLowerCase();
        if (name) nameMap.set(name, d.id);
      });

      // For every property with a customerName but no customerId, try to match
      const propSnap = await getDocs(collection(db, "properties"));
      let linked = 0;
      for (const d of propSnap.docs) {
        const data = d.data();
        const cName = (data.customerName || "").trim().toLowerCase();
        if (!data.customerId && cName) {
          const cId = nameMap.get(cName);
          if (cId) {
            await updateDoc(doc(db, "properties", d.id), { customerId: cId });
            linked++;
          }
        }
      }
      alert(`Done — linked ${linked} propert${linked !== 1 ? "ies" : "y"} to customers.`);
    } catch (err) {
      console.error("Linking failed:", err);
      alert("Linking failed — see console.");
    }
    setLinking(false);
  }

  // ── Export CSV ────────────────────────────────────────────────────────────
  function exportCSV() {
    const hdrs = ["Property","Status","Customer","Property Type","Open Jobs","Open Jobs Value","Outstanding Balance","Overdue Balance","Property Address","Account Number","Billing Address","Billing Customer","Created By","Created On","Customer Type","Tags"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = filtered.map(p => [p.name,p.status,p.customerName,p.propertyType,p.openJobs,p.openJobsValue,p.outstandingBalance,p.overdueBalance,p.propertyAddress,p.accountNumber,p.billingAddress,p.billingCustomer,p.createdBy,p.createdOn,p.customerType,p.tags].map(esc).join(","));
    const csv = [hdrs.map(esc).join(","), ...rows].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "properties_export.csv";
    a.click();
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  async function createProperty(data: Omit<Property, "id">) {
    await addDoc(collection(db, "properties"), data);
    setCreateModal(false);
  }
  async function updateProperty(id: string, data: Omit<Property, "id">) {
    await updateDoc(doc(db, "properties", id), { ...data });
    setEditModal(null);
  }
  async function deleteProperty(p: Property) {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    await deleteDoc(doc(db, "properties", p.id!));
  }

  return (
    // flex:1 fills the height-constrained flex-column wrapper provided by AppLayout.
    // The table wrapper (flex:1 inside) becomes the scroll container for both axes,
    // which lets position:sticky top:0 work reliably on the <th> elements.
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>

      {/* Header */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "20px 24px 16px", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: "#9ca3af", fontWeight: 500, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Directory</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0d2e5e", margin: 0 }}>Properties</h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {isAdmin && (
            <>
              <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleImport} />
              <button onClick={() => fileRef.current?.click()} disabled={importing} style={btnS("#6b7280")}>
                {importing ? `Importing… ${importProg.done}/${importProg.total}` : "↑ Import CSV"}
              </button>
            </>
          )}
          {isAdmin && (
            <button onClick={linkCustomers} disabled={linking} title="Match property customerName to Firestore customers and stamp customerId" style={{ ...btnS("#059669"), opacity: linking ? 0.6 : 1 }}>
              {linking ? "Linking…" : "🔗 Link Customers"}
            </button>
          )}
          <button onClick={exportCSV} disabled={!filtered.length} style={{ ...btnS("#6b7280"), opacity: filtered.length ? 1 : 0.4 }}>↓ Export</button>
          {isAdmin && <button onClick={() => setCreateModal(true)} style={{ ...btnS("#1565c0"), fontWeight: 700 }}>+ Add Property</button>}
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ flexShrink: 0, display: "flex", borderBottom: "2px solid #e5e7eb", padding: "0 24px", overflowX: "auto" }}>
        <FilterTab label="All Properties"  count={properties.length}  active={filter === "all"}         onClick={() => setFilter("all")} />
        <FilterTab label="Outstanding"     count={cntOutstanding}     active={filter === "outstanding"} dot="#f59e0b" onClick={() => setFilter("outstanding")} />
        <FilterTab label="Overdue"         count={cntOverdue}         active={filter === "overdue"}     dot="#ef4444" onClick={() => setFilter("overdue")} />
      </div>

      {/* Search + rows-per-page */}
      <div style={{ flexShrink: 0, padding: "12px 24px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 420 }}>
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#9ca3af", fontSize: 14, pointerEvents: "none" }}>🔍</span>
          <input
            type="text"
            placeholder="Search by property name, customer, address, type…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", padding: "8px 12px 8px 34px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, boxSizing: "border-box" as const }}
          />
        </div>
        {/* Rows per page */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <span style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>Rows per page:</span>
          <div style={{ display: "flex", gap: 4 }}>
            {PAGE_SIZES.map(s => (
              <button
                key={String(s)}
                onClick={() => setPageSize(s)}
                style={{
                  padding: "4px 10px", fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: "pointer",
                  border: "1px solid " + (pageSize === s ? "#1565c0" : "#d1d5db"),
                  background: pageSize === s ? "#1565c0" : "#fff",
                  color: pageSize === s ? "#fff" : "#374151",
                }}
              >
                {s === "all" ? "All" : s}
              </button>
            ))}
          </div>
        </div>
        <span style={{ fontSize: 13, color: "#9ca3af", whiteSpace: "nowrap" }}>
          {filtered.length.toLocaleString()} propert{filtered.length !== 1 ? "ies" : "y"}
        </span>
      </div>

      {/* Table — flex:1 fills remaining height; overflow:auto handles both axes.
           Sticky headers use top:0 (relative to THIS scroll container, not the viewport). */}
      <div style={{ flex: 1, overflow: "auto", minHeight: 0, borderTop: "1px solid #e5e7eb", background: "#fff" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 80, color: "#9ca3af" }}>Loading properties…</div>
        ) : properties.length === 0 ? (
          <div style={{ textAlign: "center", padding: 80 }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🏗️</div>
            <h3 style={{ color: "#374151", marginBottom: 8, fontSize: 18, fontWeight: 700 }}>No properties yet</h3>
            <p style={{ color: "#9ca3af", fontSize: 14, maxWidth: 380, margin: "0 auto 24px" }}>
              Import your BuildOps Properties export (CSV) to populate the list, or add properties manually.
            </p>
            {isAdmin && (
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button onClick={() => fileRef.current?.click()} style={btnS("#1565c0")}>↑ Import from CSV</button>
                <button onClick={() => setCreateModal(true)} style={btnS("#6b7280")}>+ Add Manually</button>
              </div>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>No properties match your search or filter.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 2100 }}>
            <thead>
              <tr>
                <th style={{ ...th, minWidth: 200, position: "sticky" as const, left: 0, top: 0, zIndex: 4, borderRight: "1px solid #e5e7eb" }}>Property</th>
                <th style={th}>Status</th>
                <th style={{ ...th, minWidth: 180 }}>Customer</th>
                <th style={{ ...th, minWidth: 120 }}>Property Type</th>
                <th style={{ ...th, textAlign: "center" as const }}>Open Jobs</th>
                <th style={{ ...th, minWidth: 120 }}>Open Jobs Value</th>
                <th style={{ ...th, minWidth: 130 }}>Outstanding Balance</th>
                <th style={{ ...th, minWidth: 120 }}>Overdue Balance</th>
                <th style={{ ...th, minWidth: 220 }}>Property Address</th>
                <th style={{ ...th, minWidth: 110 }}>Account Number</th>
                <th style={{ ...th, minWidth: 180 }}>Billing Address</th>
                <th style={{ ...th, minWidth: 160 }}>Billing Customer</th>
                <th style={{ ...th, minWidth: 100 }}>Created By</th>
                <th style={{ ...th, minWidth: 100 }}>Created On</th>
                <th style={{ ...th, minWidth: 120 }}>Customer Type</th>
                <th style={{ ...th, minWidth: 140 }}>Tags</th>
                <th style={{ ...th, width: 44 }}></th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(p => (
                <PropertyRow
                  key={p.id}
                  p={p}
                  onEdit={() => setEditModal(p)}
                  onDelete={() => deleteProperty(p)}
                  isAdmin={!!isAdmin}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination footer — flexShrink:0 keeps it anchored at the bottom */}
      {filtered.length > 0 && pageSize !== "all" && (
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", borderTop: "1px solid #e5e7eb", background: "#fafafa", flexWrap: "wrap", gap: 10 }}>
          <span style={{ fontSize: 13, color: "#6b7280" }}>
            Showing {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {filtered.length.toLocaleString()} propert{filtered.length !== 1 ? "ies" : "y"}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => setPage(0)}
              disabled={safePage === 0}
              style={{ ...pgBtn, opacity: safePage === 0 ? 0.35 : 1 }}
              title="First page"
            >«</button>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={safePage === 0}
              style={{ ...pgBtn, opacity: safePage === 0 ? 0.35 : 1 }}
            >‹ Prev</button>
            {/* page number pills */}
            {Array.from({ length: totalPages }, (_, i) => i)
              .filter(i => Math.abs(i - safePage) <= 2)
              .map(i => (
                <button
                  key={i}
                  onClick={() => setPage(i)}
                  style={{
                    ...pgBtn,
                    background: i === safePage ? "#1565c0" : "#fff",
                    color:      i === safePage ? "#fff"    : "#374151",
                    border:     "1px solid " + (i === safePage ? "#1565c0" : "#d1d5db"),
                    fontWeight: i === safePage ? 700 : 500,
                    minWidth: 32,
                  }}
                >{i + 1}</button>
              ))}
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              style={{ ...pgBtn, opacity: safePage >= totalPages - 1 ? 0.35 : 1 }}
            >Next ›</button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={safePage >= totalPages - 1}
              style={{ ...pgBtn, opacity: safePage >= totalPages - 1 ? 0.35 : 1 }}
              title="Last page"
            >»</button>
          </div>
        </div>
      )}

      {/* Modals */}
      {createModal && (
        <PropertyModal title="Add Property" onSave={createProperty} onClose={() => setCreateModal(false)} />
      )}
      {editModal && (
        <PropertyModal
          title={`Edit — ${editModal.name}`}
          initial={editModal}
          onSave={data => updateProperty(editModal.id!, data)}
          onClose={() => setEditModal(null)}
        />
      )}
    </div>
  );
}
