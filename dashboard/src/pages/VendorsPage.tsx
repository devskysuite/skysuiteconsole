import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc,
  onSnapshot, setDoc, updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { useIsAdmin } from "../hooks/useIsAdmin";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Vendor {
  id?: string;
  name: string;
  vendorType: "Supplier" | "Subcontractor" | string;
  defaultContact: string;
  phone: string;
  email: string;
  city: string;
  stateProvince: string;
  addressLine1: string;
  addressLine2: string;
  zipPostal: string;
  notes: string;
  createdOn: string;
  status: "Active" | "Inactive" | string;
  syncStatus: string;
}

// ── CSV parser (handles quoted multiline) ─────────────────────────────────────
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

function csvRowToVendor(headers: string[], row: string[]): Omit<Vendor, "id"> | null {
  const g = (h: string) => (row[headers.indexOf(h)] ?? "").trim();
  const name = g("Vendor");
  if (!name) return null;
  return {
    name,
    vendorType:     g("Vendor Type") || "Supplier",
    defaultContact: g("Default Contact"),
    phone:          g("Phone"),
    email:          g("Email"),
    city:           g("City"),
    stateProvince:  g("State/Province"),
    addressLine1:   g("Address Line 1"),
    addressLine2:   g("Address Line 2"),
    zipPostal:      g("Zip/Postal Code"),
    notes:          g("Notes"),
    createdOn:      g("Created On"),
    status:         g("Status") || "Active",
    syncStatus:     g("Sync Status"),
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────
const TYPE_STYLE: Record<string, { background: string; color: string }> = {
  Supplier:      { background: "#dbeafe", color: "#1e40af" },
  Subcontractor: { background: "#ede9fe", color: "#6d28d9" },
};

function typeStyle(t: string) { return TYPE_STYLE[t] || { background: "#f3f4f6", color: "#374151" }; }

// ── Filter tab ────────────────────────────────────────────────────────────────
function FilterTab({ label, count, active, onClick }:
  { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "10px 18px", fontWeight: 600, fontSize: 14, cursor: "pointer",
      background: "none", border: "none",
      borderBottom: active ? "2px solid #1565c0" : "2px solid transparent",
      color: active ? "#1565c0" : "#6b7280", marginBottom: -2, whiteSpace: "nowrap",
    }}>
      {label}
      <span style={{
        fontSize: 11, borderRadius: 99, padding: "1px 6px", fontWeight: 700,
        background: active ? "#dbeafe" : "#f3f4f6",
        color: active ? "#1e40af" : "#6b7280",
      }}>{count}</span>
    </button>
  );
}

// ── Vendor row ────────────────────────────────────────────────────────────────
function VendorRow({ v, onEdit, onDelete, isAdmin }:
  { v: Vendor; onEdit: () => void; onDelete: () => void; isAdmin: boolean }) {
  const ts = typeStyle(v.vendorType);
  const fullAddr = [v.addressLine1, v.addressLine2, v.city, v.stateProvince, v.zipPostal].filter(Boolean).join(", ");
  return (
    <tr
      onClick={onEdit}
      style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}
      onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
      onMouseLeave={e => (e.currentTarget.style.background = "")}
    >
      {/* Name */}
      <td style={{ ...td, position: "sticky" as const, left: 0, background: "inherit", zIndex: 1, minWidth: 220, borderRight: "1px solid #f0f0f0" }}>
        <div style={{ fontWeight: 600, color: "#0d2e5e", fontSize: 13 }}>{v.name}</div>
      </td>
      {/* Type */}
      <td style={td}>
        <span style={{ ...ts, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>{v.vendorType || "—"}</span>
      </td>
      {/* Contact */}
      <td style={{ ...td, minWidth: 150, color: "#374151" }}>{v.defaultContact || <span style={{ color: "#d1d5db" }}>—</span>}</td>
      {/* Phone */}
      <td style={{ ...td, whiteSpace: "nowrap" as const }}>
        {v.phone
          ? <a href={`tel:${v.phone}`} onClick={e => e.stopPropagation()} style={{ color: "#1565c0", textDecoration: "none", fontSize: 13 }}>{v.phone}</a>
          : <span style={{ color: "#d1d5db" }}>—</span>}
      </td>
      {/* Email */}
      <td style={{ ...td, maxWidth: 220 }}>
        {v.email
          ? <a href={`mailto:${v.email}`} onClick={e => e.stopPropagation()} style={{ color: "#1565c0", textDecoration: "none", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, display: "block", maxWidth: 200 }}>{v.email}</a>
          : <span style={{ color: "#d1d5db" }}>—</span>}
      </td>
      {/* Address */}
      <td style={{ ...td, maxWidth: 260 }}>
        <span title={fullAddr} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, color: "#6b7280", fontSize: 12 }}>
          {fullAddr || <span style={{ color: "#d1d5db" }}>—</span>}
        </span>
      </td>
      {/* Notes */}
      <td style={{ ...td, maxWidth: 200 }}>
        {v.notes
          ? <span title={v.notes} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, color: "#6b7280", fontSize: 12 }}>{v.notes}</span>
          : <span style={{ color: "#d1d5db" }}>—</span>}
      </td>
      {/* Created On */}
      <td style={{ ...td, whiteSpace: "nowrap" as const, color: "#9ca3af", fontSize: 12 }}>{v.createdOn || "—"}</td>
      {/* Status */}
      <td style={td}>
        <span style={{ background: v.status === "Active" ? "#dcfce7" : "#f3f4f6", color: v.status === "Active" ? "#166534" : "#6b7280", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>
          {v.status}
        </span>
      </td>
      {/* Actions */}
      <td style={{ ...td, whiteSpace: "nowrap" as const }} onClick={e => e.stopPropagation()}>
        {isAdmin && (
          <button onClick={onDelete} title="Delete" style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 13, padding: "3px 7px", borderRadius: 6 }}>✕</button>
        )}
      </td>
    </tr>
  );
}

// ── Create / Edit modal ───────────────────────────────────────────────────────
function VendorModal({ title, initial, onSave, onClose }:
  { title: string; initial?: Vendor; onSave: (d: Omit<Vendor, "id">) => Promise<void>; onClose: () => void }) {
  const blank: Omit<Vendor, "id"> = {
    name: "", vendorType: "Supplier", defaultContact: "", phone: "", email: "",
    city: "", stateProvince: "", addressLine1: "", addressLine2: "", zipPostal: "",
    notes: "", createdOn: "", status: "Active", syncStatus: "",
  };
  const [form, setForm] = useState<Omit<Vendor, "id">>({ ...blank, ...initial });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0d2e5e", marginBottom: 20 }}>{title}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Vendor Name *</label><input style={inp} value={form.name} onChange={e => set("name")(e.target.value)} /></div>
          <div>
            <label style={lbl}>Vendor Type</label>
            <select style={inp} value={form.vendorType} onChange={e => set("vendorType")(e.target.value)}>
              <option>Supplier</option><option>Subcontractor</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Status</label>
            <select style={inp} value={form.status} onChange={e => set("status")(e.target.value)}>
              <option>Active</option><option>Inactive</option>
            </select>
          </div>
          <div><label style={lbl}>Default Contact</label><input style={inp} value={form.defaultContact} onChange={e => set("defaultContact")(e.target.value)} /></div>
          <div><label style={lbl}>Phone</label><input style={inp} value={form.phone} onChange={e => set("phone")(e.target.value)} /></div>
          <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Email</label><input style={inp} value={form.email} onChange={e => set("email")(e.target.value)} /></div>
          <div><label style={lbl}>Address Line 1</label><input style={inp} value={form.addressLine1} onChange={e => set("addressLine1")(e.target.value)} /></div>
          <div><label style={lbl}>Address Line 2</label><input style={inp} value={form.addressLine2} onChange={e => set("addressLine2")(e.target.value)} /></div>
          <div><label style={lbl}>City</label><input style={inp} value={form.city} onChange={e => set("city")(e.target.value)} /></div>
          <div><label style={lbl}>Province / State</label><input style={inp} value={form.stateProvince} onChange={e => set("stateProvince")(e.target.value)} /></div>
          <div><label style={lbl}>Postal / ZIP</label><input style={inp} value={form.zipPostal} onChange={e => set("zipPostal")(e.target.value)} /></div>
          <div><label style={lbl}>Created On</label><input style={inp} value={form.createdOn} onChange={e => set("createdOn")(e.target.value)} placeholder="Jan 1, 2026" /></div>
          <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Notes</label><textarea style={{ ...inp, minHeight: 64, resize: "vertical", fontFamily: "inherit" }} value={form.notes} onChange={e => set("notes")(e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button disabled={!form.name.trim() || saving} onClick={async () => { setSaving(true); await onSave(form); setSaving(false); }} style={{ ...btnS("#1565c0"), opacity: !form.name.trim() || saving ? 0.5 : 1 }}>
            {saving ? "Saving…" : "Save Vendor"}
          </button>
          <button onClick={onClose} style={btnS("#6b7280")}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

type PageSize = 25 | 50 | 100 | "all";
const PAGE_SIZES: PageSize[] = [25, 50, 100, "all"];

// ── Styles ────────────────────────────────────────────────────────────────────
const btnS  = (bg: string): React.CSSProperties => ({ background: bg, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" });
const pgBtn: React.CSSProperties = { padding: "4px 10px", fontSize: 12, fontWeight: 500, borderRadius: 6, cursor: "pointer", border: "1px solid #d1d5db", background: "#fff", color: "#374151" };
const lbl: React.CSSProperties  = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 };
const inp: React.CSSProperties  = { width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" as const };
const th: React.CSSProperties   = { padding: "10px 12px", textAlign: "left" as const, fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" as const, letterSpacing: 0.4, whiteSpace: "nowrap" as const, background: "#f9fafb", borderBottom: "2px solid #e5e7eb", position: "sticky" as const, top: 96, zIndex: 3 };
const td: React.CSSProperties   = { padding: "10px 12px", fontSize: 13, color: "#374151", verticalAlign: "middle" as const };

// ── Main page ─────────────────────────────────────────────────────────────────
export default function VendorsPage() {
  const isAdmin = useIsAdmin();
  const [vendors,      setVendors]      = useState<Vendor[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState("");
  const [filter,       setFilter]       = useState<"all"|"supplier"|"subcontractor">("all");
  const [pageSize,     setPageSize]     = useState<PageSize>(25);
  const [page,         setPage]         = useState(0);
  const [createModal,  setCreateModal]  = useState(false);
  const [editModal,    setEditModal]    = useState<Vendor | null>(null);
  const [importing,    setImporting]    = useState(false);
  const [importProg,   setImportProg]   = useState({ done: 0, total: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  // Real-time Firestore
  useEffect(() => {
    return onSnapshot(
      collection(db, "vendors"),
      snap => { setVendors(snap.docs.map(d => ({ id: d.id, ...d.data() } as Vendor))); setLoading(false); },
      () => setLoading(false)
    );
  }, []);

  // Filter + search
  const filtered = useMemo(() => {
    let list = [...vendors];
    if (filter === "supplier")      list = list.filter(v => v.vendorType === "Supplier");
    if (filter === "subcontractor") list = list.filter(v => v.vendorType === "Subcontractor");
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(v =>
        v.name.toLowerCase().includes(q) ||
        (v.defaultContact || "").toLowerCase().includes(q) ||
        (v.email || "").toLowerCase().includes(q) ||
        (v.city || "").toLowerCase().includes(q) ||
        (v.addressLine1 || "").toLowerCase().includes(q) ||
        (v.phone || "").toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [vendors, filter, search]);

  // Reset to page 0 whenever filter / search / pageSize changes
  useEffect(() => { setPage(0); }, [filter, search, pageSize]);

  const totalPages  = pageSize === "all" ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage    = Math.min(page, totalPages - 1);
  const paginated   = pageSize === "all" ? filtered : filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const rangeStart  = pageSize === "all" ? 1 : safePage * pageSize + 1;
  const rangeEnd    = pageSize === "all" ? filtered.length : Math.min(safePage * pageSize + pageSize, filtered.length);

  const cntSupplier      = useMemo(() => vendors.filter(v => v.vendorType === "Supplier").length,      [vendors]);
  const cntSubcontractor = useMemo(() => vendors.filter(v => v.vendorType === "Subcontractor").length, [vendors]);

  // ── CSV import ────────────────────────────────────────────────────────────
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (!rows.length) return;
      const headers  = rows[0].map(h => h.trim());
      const records  = rows.slice(1).map(r => csvRowToVendor(headers, r)).filter(Boolean) as Omit<Vendor, "id">[];
      setImportProg({ done: 0, total: records.length });
      for (let i = 0; i < records.length; i++) {
        const r  = records[i];
        const id = `v_${r.name.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60)}`;
        await setDoc(doc(db, "vendors", id), r, { merge: true });
        setImportProg({ done: i + 1, total: records.length });
      }
    } catch (err) { console.error("Vendor import failed:", err); }
    setImporting(false);
    e.target.value = "";
  }

  // ── Export CSV ────────────────────────────────────────────────────────────
  function exportCSV() {
    const hdrs = ["Vendor","Vendor Type","Default Contact","Phone","Email","City","State/Province","Address Line 1","Address Line 2","Zip/Postal Code","Notes","Created On","Status","Sync Status"];
    const esc  = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = filtered.map(v => [v.name,v.vendorType,v.defaultContact,v.phone,v.email,v.city,v.stateProvince,v.addressLine1,v.addressLine2,v.zipPostal,v.notes,v.createdOn,v.status,v.syncStatus].map(esc).join(","));
    const csv  = [hdrs.map(esc).join(","), ...rows].join("\r\n");
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "vendors_export.csv";
    a.click();
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  async function createVendor(data: Omit<Vendor, "id">) {
    await addDoc(collection(db, "vendors"), data);
    setCreateModal(false);
  }
  async function updateVendor(id: string, data: Omit<Vendor, "id">) {
    await updateDoc(doc(db, "vendors", id), { ...data });
    setEditModal(null);
  }
  async function deleteVendor(v: Vendor) {
    if (!confirm(`Delete "${v.name}"? This cannot be undone.`)) return;
    await deleteDoc(doc(db, "vendors", v.id!));
  }

  return (
    <div style={{ minHeight: "100vh", paddingBottom: 40 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "20px 24px 16px", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: "#9ca3af", fontWeight: 500, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Directory</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0d2e5e", margin: 0 }}>Vendors</h1>
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
          <button onClick={exportCSV} disabled={!filtered.length} style={{ ...btnS("#6b7280"), opacity: filtered.length ? 1 : 0.4 }}>↓ Export</button>
          {isAdmin && <button onClick={() => setCreateModal(true)} style={{ ...btnS("#1565c0"), fontWeight: 700 }}>+ Add Vendor</button>}
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", borderBottom: "2px solid #e5e7eb", padding: "0 24px", overflowX: "auto" }}>
        <FilterTab label="All Vendors"    count={vendors.length}    active={filter === "all"}           onClick={() => setFilter("all")} />
        <FilterTab label="Suppliers"      count={cntSupplier}       active={filter === "supplier"}      onClick={() => setFilter("supplier")} />
        <FilterTab label="Subcontractors" count={cntSubcontractor}  active={filter === "subcontractor"} onClick={() => setFilter("subcontractor")} />
      </div>

      {/* Search + rows-per-page */}
      <div style={{ padding: "12px 24px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 420 }}>
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#9ca3af", fontSize: 14, pointerEvents: "none" }}>🔍</span>
          <input
            type="text"
            placeholder="Search by name, contact, email, city, phone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", padding: "8px 12px 8px 34px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, boxSizing: "border-box" as const }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <span style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>Rows per page:</span>
          <div style={{ display: "flex", gap: 4 }}>
            {PAGE_SIZES.map(s => (
              <button key={String(s)} onClick={() => setPageSize(s)} style={{ padding: "4px 10px", fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: "pointer", border: "1px solid " + (pageSize === s ? "#1565c0" : "#d1d5db"), background: pageSize === s ? "#1565c0" : "#fff", color: pageSize === s ? "#fff" : "#374151" }}>
                {s === "all" ? "All" : s}
              </button>
            ))}
          </div>
        </div>
        <span style={{ fontSize: 13, color: "#9ca3af", whiteSpace: "nowrap" }}>
          {filtered.length.toLocaleString()} vendor{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto", borderTop: "1px solid #e5e7eb", background: "#fff" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 80, color: "#9ca3af" }}>Loading vendors…</div>
        ) : vendors.length === 0 ? (
          <div style={{ textAlign: "center", padding: 80 }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🏪</div>
            <h3 style={{ color: "#374151", marginBottom: 8, fontSize: 18, fontWeight: 700 }}>No vendors yet</h3>
            <p style={{ color: "#9ca3af", fontSize: 14, maxWidth: 380, margin: "0 auto 24px" }}>
              Import your BuildOps Vendors CSV export to populate the list, or add vendors manually.
            </p>
            {isAdmin && (
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button onClick={() => fileRef.current?.click()} style={btnS("#1565c0")}>↑ Import from CSV</button>
                <button onClick={() => setCreateModal(true)} style={btnS("#6b7280")}>+ Add Manually</button>
              </div>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>No vendors match your search or filter.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead>
              <tr>
                <th style={{ ...th, minWidth: 220, position: "sticky" as const, left: 0, top: 96, zIndex: 4, borderRight: "1px solid #e5e7eb" }}>Vendor</th>
                <th style={th}>Type</th>
                <th style={{ ...th, minWidth: 150 }}>Contact</th>
                <th style={{ ...th, minWidth: 130 }}>Phone</th>
                <th style={{ ...th, minWidth: 200 }}>Email</th>
                <th style={{ ...th, minWidth: 260 }}>Address</th>
                <th style={{ ...th, minWidth: 180 }}>Notes</th>
                <th style={th}>Created On</th>
                <th style={th}>Status</th>
                <th style={{ ...th, width: 44 }}></th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(v => (
                <VendorRow
                  key={v.id}
                  v={v}
                  onEdit={() => setEditModal(v)}
                  onDelete={() => deleteVendor(v)}
                  isAdmin={!!isAdmin}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination footer */}
      {filtered.length > 0 && pageSize !== "all" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", borderTop: "1px solid #e5e7eb", background: "#fafafa", flexWrap: "wrap", gap: 10 }}>
          <span style={{ fontSize: 13, color: "#6b7280" }}>
            Showing {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {filtered.length.toLocaleString()} vendor{filtered.length !== 1 ? "s" : ""}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => setPage(0)} disabled={safePage === 0} style={{ ...pgBtn, opacity: safePage === 0 ? 0.35 : 1 }} title="First">«</button>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0} style={{ ...pgBtn, opacity: safePage === 0 ? 0.35 : 1 }}>‹ Prev</button>
            {Array.from({ length: totalPages }, (_, i) => i).filter(i => Math.abs(i - safePage) <= 2).map(i => (
              <button key={i} onClick={() => setPage(i)} style={{ ...pgBtn, background: i === safePage ? "#1565c0" : "#fff", color: i === safePage ? "#fff" : "#374151", border: "1px solid " + (i === safePage ? "#1565c0" : "#d1d5db"), fontWeight: i === safePage ? 700 : 500, minWidth: 32 }}>{i + 1}</button>
            ))}
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1} style={{ ...pgBtn, opacity: safePage >= totalPages - 1 ? 0.35 : 1 }}>Next ›</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={safePage >= totalPages - 1} style={{ ...pgBtn, opacity: safePage >= totalPages - 1 ? 0.35 : 1 }} title="Last">»</button>
          </div>
        </div>
      )}

      {/* Modals */}
      {createModal && (
        <VendorModal title="Add Vendor" onSave={createVendor} onClose={() => setCreateModal(false)} />
      )}
      {editModal && (
        <VendorModal
          title={`Edit — ${editModal.name}`}
          initial={editModal}
          onSave={data => updateVendor(editModal.id!, data)}
          onClose={() => setEditModal(null)}
        />
      )}
    </div>
  );
}
