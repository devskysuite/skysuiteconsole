import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  addDoc, collection, deleteDoc, doc,
  onSnapshot, setDoc, updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { useIsAdmin } from "../hooks/useIsAdmin";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Customer {
  id?: string;
  name: string;
  code: string;
  status: "Active" | "Inactive";
  numberOfProperties: number;
  creditLimit: number;
  openJobs: number;
  openJobsValue: number;
  outstandingBalance: number;
  overdueBalance: number;
  lastPayment: number;
  lastPaymentDate: string;
  billingAddress: string;
  businessAddress: string;
  createdBy: string;
  createdOn: string;
  customerType: string;
  email: string;
  phone: string;
  tags: string;
  syncStatus: string;
}

// ── CSV parser (handles quoted multiline fields) ───────────────────────────────
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuote = false;
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
  return raw.replace(/\n/g, ", ").replace(/,\s*CA\s*$/, "").replace(/,\s*US\s*$/, "").trim().replace(/,\s*$/, "");
}

function csvRowToCustomer(headers: string[], row: string[]): Omit<Customer, "id"> | null {
  const g = (h: string) => (row[headers.indexOf(h)] ?? "").trim();
  const name = g("Customer");
  if (!name) return null;
  return {
    name,
    code: g("Customer Code"),
    status: (g("Status") || "Active") as "Active" | "Inactive",
    numberOfProperties: parseInt(g("Number of Properties")) || 0,
    creditLimit: parseMoney(g("Credit Limit")),
    openJobs: parseInt(g("Open Jobs")) || 0,
    openJobsValue: parseMoney(g("Open Jobs Value")),
    outstandingBalance: parseMoney(g("Outstanding Balance")),
    overdueBalance: parseMoney(g("Overdue Balance")),
    lastPayment: parseMoney(g("Last Payment")),
    lastPaymentDate: g("Last Payment Date"),
    billingAddress: cleanAddr(g("Billing Address")),
    businessAddress: cleanAddr(g("Business Address")),
    createdBy: g("Created By"),
    createdOn: g("Created On"),
    customerType: g("Customer Type"),
    email: g("Email"),
    phone: g("Phone"),
    tags: g("Tags"),
    syncStatus: g("Sync Status") || "In Sync",
  };
}

function fmt$(n: number): string {
  if (!n) return "$0.00";
  return "$" + n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Customer-type colour map ───────────────────────────────────────────────────
const TYPE_COLORS: Record<string, { background: string; color: string }> = {
  Industrial:           { background: "#dbeafe", color: "#1e40af" },
  Commercial:           { background: "#ede9fe", color: "#6d28d9" },
  Institutional:        { background: "#d1fae5", color: "#065f46" },
  "Property Manager":   { background: "#fef3c7", color: "#92400e" },
  Construction:         { background: "#fee2e2", color: "#991b1b" },
  Other:                { background: "#f3f4f6", color: "#374151" },
};

// ── Sub-components ────────────────────────────────────────────────────────────
function FilterTab({ label, count, active, dot, onClick }:
  { label: string; count: number; active: boolean; dot?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "10px 18px", fontWeight: 600, fontSize: 14, cursor: "pointer",
      background: "none", border: "none",
      borderBottom: active ? "2px solid #1565c0" : "2px solid transparent",
      color: active ? "#1565c0" : "#6b7280",
      marginBottom: -2, whiteSpace: "nowrap",
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

function CustomerRow({ c, onEdit, onDelete, isAdmin }:
  { c: Customer; onEdit: () => void; onDelete: () => void; isAdmin: boolean }) {
  const tc = c.customerType ? (TYPE_COLORS[c.customerType] || TYPE_COLORS.Other) : null;
  const navigate = useNavigate();
  return (
    <tr
      onClick={() => navigate(`/customers/${c.id}`)}
      style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer", transition: "background 0.1s" }}
      onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
      onMouseLeave={e => (e.currentTarget.style.background = "")}
    >
      {/* Customer name — sticky left */}
      <td style={{ ...td, position: "sticky" as const, left: 0, background: "inherit", zIndex: 1, minWidth: 220, borderRight: "1px solid #f0f0f0" }}>
        <div style={{ fontWeight: 600, color: "#0d2e5e", fontSize: 13 }}>{c.name}</div>
      </td>
      {/* Customer Code */}
      <td style={{ ...td, color: "#6b7280", fontSize: 12, whiteSpace: "nowrap" as const }}>{c.code ? `#${c.code}` : "—"}</td>
      {/* Status */}
      <td style={td}>
        <span style={{ background: "#dcfce7", color: "#166534", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>
          {c.status}
        </span>
      </td>
      {/* Number of Properties */}
      <td style={{ ...td, textAlign: "center" as const, color: "#6b7280" }}>{c.numberOfProperties || "—"}</td>
      {/* Credit Limit */}
      <td style={td}>{c.creditLimit ? fmt$(c.creditLimit) : "—"}</td>
      {/* Open Jobs */}
      <td style={{ ...td, textAlign: "center" as const, fontWeight: c.openJobs > 0 ? 700 : 400 }}>{c.openJobs}</td>
      {/* Open Jobs Value */}
      <td style={td}>{c.openJobsValue ? fmt$(c.openJobsValue) : "—"}</td>
      {/* Outstanding Balance */}
      <td style={{ ...td, color: c.outstandingBalance > 0 ? "#dc2626" : "#374151", fontWeight: c.outstandingBalance > 0 ? 600 : 400 }}>
        {fmt$(c.outstandingBalance)}
      </td>
      {/* Overdue Balance */}
      <td style={{ ...td, color: c.overdueBalance > 0 ? "#dc2626" : "#374151", fontWeight: c.overdueBalance > 0 ? 700 : 400 }}>
        {fmt$(c.overdueBalance)}
      </td>
      {/* Last Payment */}
      <td style={td}>{c.lastPayment ? fmt$(c.lastPayment) : "—"}</td>
      {/* Last Payment Date */}
      <td style={{ ...td, whiteSpace: "nowrap" as const, color: "#6b7280", fontSize: 12 }}>{c.lastPaymentDate || "—"}</td>
      {/* Billing Address */}
      <td style={{ ...td, maxWidth: 220 }}>
        <span title={c.billingAddress} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#6b7280", fontSize: 12 }}>
          {c.billingAddress || "—"}
        </span>
      </td>
      {/* Business Address */}
      <td style={{ ...td, maxWidth: 220 }}>
        <span title={c.businessAddress} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#6b7280", fontSize: 12 }}>
          {c.businessAddress || "—"}
        </span>
      </td>
      {/* Created By */}
      <td style={{ ...td, color: "#6b7280", fontSize: 12, whiteSpace: "nowrap" as const }}>{c.createdBy || "—"}</td>
      {/* Created On */}
      <td style={{ ...td, whiteSpace: "nowrap" as const, color: "#9ca3af", fontSize: 12 }}>{c.createdOn || "—"}</td>
      {/* Customer Type */}
      <td style={td}>
        {tc && (
          <span style={{ ...tc, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99, whiteSpace: "nowrap" as const }}>
            {c.customerType}
          </span>
        )}
      </td>
      {/* Email */}
      <td style={{ ...td, maxWidth: 190 }}>
        {c.email
          ? <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()}
              style={{ color: "#1565c0", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
              {c.email}
            </a>
          : <span style={{ color: "#d1d5db" }}>—</span>}
      </td>
      {/* Phone */}
      <td style={{ ...td, whiteSpace: "nowrap" as const, fontSize: 12, color: "#374151" }}>{c.phone || <span style={{ color: "#d1d5db" }}>—</span>}</td>
      {/* Tags */}
      <td style={{ ...td, fontSize: 12, color: "#6b7280" }}>{c.tags || "—"}</td>
      {/* Actions */}
      <td style={{ ...td, whiteSpace: "nowrap" as const }} onClick={e => e.stopPropagation()}>
        {isAdmin && (
          <button
            onClick={onDelete}
            title="Delete customer"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 13, padding: "3px 7px", borderRadius: 6, lineHeight: 1 }}
          >✕</button>
        )}
      </td>
      {/* Sync Status */}
      <td style={td}>
        <span style={{ background: "#dcfce7", color: "#166534", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99, whiteSpace: "nowrap" as const }}>
          {c.syncStatus || "In Sync"}
        </span>
      </td>
    </tr>
  );
}

// ── Customer modal (create / edit) ────────────────────────────────────────────
function CustomerModal({ title, initial, onSave, onClose }:
  { title: string; initial?: Customer; onSave: (d: Omit<Customer, "id">) => Promise<void>; onClose: () => void }) {
  const blank: Omit<Customer, "id"> = {
    name: "", code: "", status: "Active", numberOfProperties: 0,
    creditLimit: 0, openJobs: 0, openJobsValue: 0, outstandingBalance: 0, overdueBalance: 0,
    lastPayment: 0, lastPaymentDate: "", billingAddress: "", businessAddress: "",
    createdBy: "", createdOn: "", customerType: "", email: "", phone: "", tags: "", syncStatus: "In Sync",
  };
  const [form, setForm] = useState<Omit<Customer, "id">>({ ...blank, ...initial });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (v: string | number) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0d2e5e", marginBottom: 20 }}>{title}</h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={lbl}>Customer Name *</label>
            <input style={inp} value={form.name} onChange={e => set("name")(e.target.value)} placeholder="Company name" />
          </div>
          <div>
            <label style={lbl}>Customer Code</label>
            <input style={inp} value={form.code} onChange={e => set("code")(e.target.value)} placeholder="e.g. 1232" />
          </div>
          <div>
            <label style={lbl}>Customer Type</label>
            <select style={inp} value={form.customerType} onChange={e => set("customerType")(e.target.value)}>
              <option value="">— Select —</option>
              {["Industrial","Commercial","Institutional","Property Manager","Construction","Other"].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Status</label>
            <select style={inp} value={form.status} onChange={e => set("status")(e.target.value)}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </div>
          <div>
            <label style={lbl}># Properties</label>
            <input style={inp} type="number" min={0} value={form.numberOfProperties} onChange={e => set("numberOfProperties")(parseInt(e.target.value) || 0)} />
          </div>
          <div>
            <label style={lbl}>Email</label>
            <input style={inp} type="email" value={form.email} onChange={e => set("email")(e.target.value)} placeholder="contact@company.com" />
          </div>
          <div>
            <label style={lbl}>Phone</label>
            <input style={inp} type="tel" value={form.phone} onChange={e => set("phone")(e.target.value)} placeholder="519-555-0100" />
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={lbl}>Billing Address</label>
            <textarea style={{ ...inp, resize: "vertical", minHeight: 64, fontFamily: "inherit" }} value={form.billingAddress} onChange={e => set("billingAddress")(e.target.value)} placeholder="Street, City, Province  Postal Code" />
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={lbl}>Business Address <span style={{ fontWeight: 400, color: "#9ca3af" }}>(if different)</span></label>
            <textarea style={{ ...inp, resize: "vertical", minHeight: 48, fontFamily: "inherit" }} value={form.businessAddress} onChange={e => set("businessAddress")(e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Created By</label>
            <input style={inp} value={form.createdBy} onChange={e => set("createdBy")(e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Created On</label>
            <input style={inp} value={form.createdOn} onChange={e => set("createdOn")(e.target.value)} placeholder="Jan 1, 2026" />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button
            disabled={!form.name.trim() || saving}
            onClick={handleSave}
            style={{ ...btnS("#1565c0"), opacity: !form.name.trim() || saving ? 0.5 : 1 }}
          >
            {saving ? "Saving…" : "Save Customer"}
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
const btnS = (bg: string): React.CSSProperties => ({
  background: bg, color: "#fff", border: "none", borderRadius: 8,
  padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
});
const pgBtn: React.CSSProperties = { padding: "4px 10px", fontSize: 12, fontWeight: 500, borderRadius: 6, cursor: "pointer", border: "1px solid #d1d5db", background: "#fff", color: "#374151" };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 };
const inp: React.CSSProperties = { width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" as const };
const th: React.CSSProperties = {
  padding: "10px 12px", textAlign: "left" as const, fontSize: 11, fontWeight: 700,
  color: "#6b7280", textTransform: "uppercase" as const, letterSpacing: 0.4,
  whiteSpace: "nowrap" as const, background: "#f9fafb", borderBottom: "2px solid #e5e7eb",
  position: "sticky" as const, top: 0, zIndex: 3,
};
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13, color: "#374151", verticalAlign: "middle" as const };

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CustomersPage() {
  const isAdmin = useIsAdmin();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [filter, setFilter]       = useState<"all"|"warning"|"risk"|"hold">("all");
  const [pageSize, setPageSize]   = useState<PageSize>(25);
  const [page, setPage]           = useState(0);
  const [createModal, setCreateModal] = useState(false);
  const [importing, setImporting]     = useState(false);
  const [importProg, setImportProg]   = useState({ done: 0, total: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  // Real-time Firestore
  useEffect(() => {
    return onSnapshot(
      collection(db, "customers"),
      snap => { setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer))); setLoading(false); },
      () => setLoading(false)
    );
  }, []);

  // Filter + search
  const filtered = useMemo(() => {
    let list = [...customers];
    if (filter === "warning") list = list.filter(c => c.outstandingBalance > 0 && c.overdueBalance === 0);
    if (filter === "risk")    list = list.filter(c => c.overdueBalance > 0 && c.overdueBalance < 50000);
    if (filter === "hold")    list = list.filter(c => c.overdueBalance >= 50000);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.code.includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.phone || "").includes(q) ||
        (c.customerType || "").toLowerCase().includes(q) ||
        (c.billingAddress || "").toLowerCase().includes(q)
      );
    }
    // Sort descending by customer code (newest first)
    return list.sort((a, b) => parseInt(b.code || "0") - parseInt(a.code || "0"));
  }, [customers, filter, search]);

  // Reset to page 0 whenever filter / search / pageSize changes
  useEffect(() => { setPage(0); }, [filter, search, pageSize]);

  const totalPages  = pageSize === "all" ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage    = Math.min(page, totalPages - 1);
  const paginated   = pageSize === "all" ? filtered : filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const rangeStart  = pageSize === "all" ? 1 : safePage * pageSize + 1;
  const rangeEnd    = pageSize === "all" ? filtered.length : Math.min(safePage * pageSize + pageSize, filtered.length);

  const cntWarning = useMemo(() => customers.filter(c => c.outstandingBalance > 0 && c.overdueBalance === 0).length, [customers]);
  const cntRisk    = useMemo(() => customers.filter(c => c.overdueBalance > 0 && c.overdueBalance < 50000).length, [customers]);
  const cntHold    = useMemo(() => customers.filter(c => c.overdueBalance >= 50000).length, [customers]);

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
      const records = rows.slice(1).map(r => csvRowToCustomer(headers, r)).filter(Boolean) as Omit<Customer, "id">[];
      setImportProg({ done: 0, total: records.length });
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        // Use code as stable doc ID so re-importing the same CSV is idempotent
        await setDoc(doc(db, "customers", `c${r.code || Date.now()}`), r, { merge: true });
        setImportProg({ done: i + 1, total: records.length });
      }
    } catch (err) { console.error("CSV import failed:", err); }
    setImporting(false);
    e.target.value = "";
  }

  // ── Export CSV ────────────────────────────────────────────────────────────
  function exportCSV() {
    const hdrs = ["Customer","Customer Code","Status","Number of Properties","Credit Limit","Open Jobs","Open Jobs Value","Outstanding Balance","Overdue Balance","Last Payment","Last Payment Date","Billing Address","Business Address","Created By","Created On","Customer Type","Email","Phone","Tags","Sync Status"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = filtered.map(c => [c.name,c.code,c.status,c.numberOfProperties,c.creditLimit,c.openJobs,c.openJobsValue,c.outstandingBalance,c.overdueBalance,c.lastPayment,c.lastPaymentDate,c.billingAddress,c.businessAddress,c.createdBy,c.createdOn,c.customerType,c.email,c.phone,c.tags,c.syncStatus].map(esc).join(","));
    const csv = [hdrs.map(esc).join(","), ...rows].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "customers_export.csv";
    a.click();
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  async function createCustomer(data: Omit<Customer, "id">) {
    await addDoc(collection(db, "customers"), data);
    setCreateModal(false);
  }
  async function deleteCustomer(c: Customer) {
    if (!confirm(`Delete "${c.name}"? This cannot be undone.`)) return;
    await deleteDoc(doc(db, "customers", c.id!));
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: "calc(100vh - 96px)", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "20px 24px 16px", marginBottom: 0, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: "#9ca3af", fontWeight: 500, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Directory</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0d2e5e", margin: 0 }}>Customers</h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {isAdmin && (
            <>
              <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleImport} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={importing}
                style={{ ...btnS("#6b7280"), display: "flex", alignItems: "center", gap: 6 }}
              >
                {importing
                  ? `Importing… ${importProg.done}/${importProg.total}`
                  : "↑ Import CSV"}
              </button>
            </>
          )}
          <button onClick={exportCSV} disabled={!filtered.length} style={{ ...btnS("#6b7280"), opacity: filtered.length ? 1 : 0.4 }}>
            ↓ Export
          </button>
          {isAdmin && (
            <button onClick={() => setCreateModal(true)} style={{ ...btnS("#1565c0"), fontWeight: 700 }}>
              + Create Customer
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ flexShrink: 0, display: "flex", borderBottom: "2px solid #e5e7eb", marginBottom: 0, overflowX: "auto", padding: "0 24px" }}>
        <FilterTab label="All Customers" count={customers.length} active={filter === "all"}                   onClick={() => setFilter("all")} />
        <FilterTab label="Credit Warning" count={cntWarning}      active={filter === "warning"} dot="#f59e0b" onClick={() => setFilter("warning")} />
        <FilterTab label="Credit Risk"    count={cntRisk}          active={filter === "risk"}    dot="#f97316" onClick={() => setFilter("risk")} />
        <FilterTab label="Credit Hold"    count={cntHold}          active={filter === "hold"}    dot="#ef4444" onClick={() => setFilter("hold")} />
      </div>

      {/* Search + rows-per-page */}
      <div style={{ flexShrink: 0, padding: "12px 24px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 420 }}>
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#9ca3af", fontSize: 14, pointerEvents: "none" }}>🔍</span>
          <input
            type="text"
            placeholder="Search by name, code, email, phone, type, city…"
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
          {filtered.length.toLocaleString()} customer{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: "auto", borderTop: "1px solid #e5e7eb", background: "#fff" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 80, color: "#9ca3af" }}>Loading customers…</div>

        ) : customers.length === 0 ? (
          <div style={{ textAlign: "center", padding: 80 }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🏢</div>
            <h3 style={{ color: "#374151", marginBottom: 8, fontSize: 18, fontWeight: 700 }}>No customers yet</h3>
            <p style={{ color: "#9ca3af", fontSize: 14, maxWidth: 380, margin: "0 auto 24px" }}>
              Import your BuildOps customer export (CSV) to populate the database, or create customers one at a time.
            </p>
            {isAdmin && (
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button onClick={() => fileRef.current?.click()} style={btnS("#1565c0")}>↑ Import from CSV</button>
                <button onClick={() => setCreateModal(true)} style={btnS("#6b7280")}>+ Create Manually</button>
              </div>
            )}
          </div>

        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>
            No customers match your search or filter.
          </div>

        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 2400 }}>
            <thead>
              <tr>
                <th style={{ ...th, minWidth: 220, position: "sticky" as const, left: 0, top: 0, zIndex: 4, borderRight: "1px solid #e5e7eb" }}>Customer</th>
                <th style={{ ...th, minWidth: 120 }}>Customer Code</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: "center" as const }}>Number of Properties</th>
                <th style={th}>Credit Limit</th>
                <th style={{ ...th, textAlign: "center" as const }}>Open Jobs</th>
                <th style={th}>Open Jobs Value</th>
                <th style={th}>Outstanding Balance</th>
                <th style={th}>Overdue Balance</th>
                <th style={th}>Last Payment</th>
                <th style={{ ...th, minWidth: 130 }}>Last Payment Date</th>
                <th style={{ ...th, minWidth: 220 }}>Billing Address</th>
                <th style={{ ...th, minWidth: 220 }}>Business Address</th>
                <th style={th}>Created By</th>
                <th style={th}>Created On</th>
                <th style={th}>Customer Type</th>
                <th style={{ ...th, minWidth: 190 }}>Email</th>
                <th style={{ ...th, minWidth: 130 }}>Phone</th>
                <th style={th}>Tags</th>
                <th style={{ ...th, width: 44 }}></th>
                <th style={th}>Sync Status</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(c => (
                <CustomerRow
                  key={c.id}
                  c={c}
                  onEdit={() => {}}
                  onDelete={() => deleteCustomer(c)}
                  isAdmin={!!isAdmin}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination footer */}
      {filtered.length > 0 && pageSize !== "all" && (
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", borderTop: "1px solid #e5e7eb", background: "#fafafa", flexWrap: "wrap", gap: 10 }}>
          <span style={{ fontSize: 13, color: "#6b7280" }}>
            Showing {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {filtered.length.toLocaleString()} customer{filtered.length !== 1 ? "s" : ""}
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
        <CustomerModal title="Create Customer" onSave={createCustomer} onClose={() => setCreateModal(false)} />
      )}
    </div>
  );
}
