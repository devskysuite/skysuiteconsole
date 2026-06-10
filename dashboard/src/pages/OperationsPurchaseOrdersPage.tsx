import { useEffect, useState } from "react";
import { collection, doc, getDoc, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Link } from "react-router-dom";

interface PO {
  id: string;
  poNumber: string;
  jobNumber: string;
  jobId: string;
  status: string;
  vendor: string;
  description: string;
  department: string;
  assignedTo: string;
  createdBy: string;
  createdAt: string;
  total: number;
}

const STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  Fulfilled:  { bg: "#dcfce7", color: "#166534", border: "#86efac" },
  Open:       { bg: "#dbeafe", color: "#1e40af", border: "#93c5fd" },
  Pending:    { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" },
  Cancelled:  { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5" },
  Draft:      { bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] || { bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" };
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
      {status}
    </span>
  );
}

function fmtC(n: number) { return `$${(n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

const th: React.CSSProperties = { padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "left", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "11px 14px", fontSize: 13, color: "#374151", verticalAlign: "middle" };

function PONumberSettings() {
  const [nextPoNumber, setNextPoNumber] = useState<string>("");
  const [loaded, setLoaded]   = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState("");
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    getDoc(doc(db, "settings", "poSettings")).then(snap => {
      const val = snap.exists() ? String(snap.data().nextPoNumber ?? "") : "";
      setNextPoNumber(val);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  async function handleSave() {
    const n = parseInt(draft, 10);
    if (isNaN(n) || n < 1) { alert("Enter a valid positive number."); return; }
    setSaving(true);
    try {
      await setDoc(doc(db, "settings", "poSettings"), { nextPoNumber: n }, { merge: true });
      setNextPoNumber(String(n));
      setEditing(false);
    } catch(e) { console.error(e); alert("Failed to save."); }
    setSaving(false);
  }

  return (
    <div style={{ marginTop: 28, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "18px 22px", display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>PO Number Counter</div>
        {!loaded ? (
          <div style={{ fontSize: 13, color: "#9ca3af" }}>Loading…</div>
        ) : editing ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              autoFocus
              type="number"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              style={{ border: "1px solid #93c5fd", borderRadius: 6, padding: "6px 10px", fontSize: 14, fontWeight: 700, width: 120, outline: "none" }}
              placeholder="e.g. 16920"
              onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
            />
            <button onClick={handleSave} disabled={saving} style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setEditing(false)} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: nextPoNumber ? "#111827" : "#9ca3af" }}>
              {nextPoNumber || "Not set — auto-numbering disabled"}
            </span>
            <button onClick={() => { setDraft(nextPoNumber); setEditing(true); }} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "5px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#374151" }}>
              Edit
            </button>
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, color: "#9ca3af", maxWidth: 320, lineHeight: 1.5 }}>
        When set, new POs auto-assign this number and increment it. Leave unset to enter PO numbers manually. Set this to your next PO number when you're ready to switch over.
      </div>
    </div>
  );
}

export default function OperationsPurchaseOrdersPage() {
  const [pos, setPos]         = useState<PO[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "purchaseOrders"), orderBy("createdAt", "desc")),
      snap => {
        setPos(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<PO, "id">) })));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  const statuses = ["All", ...Array.from(new Set(pos.map(p => p.status).filter(Boolean)))];

  const filtered = pos.filter(p => {
    if (statusFilter !== "All" && p.status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(p.poNumber).includes(q) ||
      (p.vendor || "").toLowerCase().includes(q) ||
      (p.jobNumber || "").toLowerCase().includes(q) ||
      (p.department || "").toLowerCase().includes(q)
    );
  });

  const grandTotal = filtered.reduce((s, p) => s + (p.total || 0), 0);

  return (
    <div style={{ background: "#f9fafb", minHeight: "calc(100vh - 96px)", padding: "28px 32px" }}>
      <div style={{ maxWidth: 1300, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>Purchase Orders</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{filtered.length} of {pos.length} POs — {fmtC(grandTotal)} total</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none" }}
            >
              {statuses.map(s => <option key={s}>{s}</option>)}
            </select>
            <input
              style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 14px", fontSize: 13, outline: "none", width: 260 }}
              placeholder="Search PO #, vendor, job…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <th style={th}>PO Number</th>
                <th style={th}>Job</th>
                <th style={th}>Status</th>
                <th style={th}>Vendor</th>
                <th style={th}>Department</th>
                <th style={th}>Assigned To</th>
                <th style={th}>Created By</th>
                <th style={th}>Date</th>
                <th style={{ ...th, textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Loading…</td></tr>}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>No purchase orders found.</td></tr>
              )}
              {filtered.map((po, i) => (
                <tr key={po.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                  <td style={{ ...td, fontWeight: 700 }}>
                    <Link to={`/purchase-orders/${po.id}`} style={{ color: "#1565c0", textDecoration: "none" }}>{po.poNumber}</Link>
                  </td>
                  <td style={td}>
                    {po.jobId ? (
                      <Link to={`/jobs/${po.jobId}`} style={{ color: "#1565c0", textDecoration: "none", fontWeight: 600 }}>{po.jobNumber || po.jobId}</Link>
                    ) : po.jobNumber || "—"}
                  </td>
                  <td style={td}><StatusBadge status={po.status} /></td>
                  <td style={td}>{po.vendor || "—"}</td>
                  <td style={td}>{po.department || "—"}</td>
                  <td style={td}>{po.assignedTo || "—"}</td>
                  <td style={td}>{po.createdBy || "—"}</td>
                  <td style={td}>{fmtDate(po.createdAt)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtC(po.total)}</td>
                </tr>
              ))}
              {filtered.length > 0 && (
                <tr style={{ background: "#f9fafb", borderTop: "2px solid #e5e7eb" }}>
                  <td colSpan={8} style={{ ...td, fontWeight: 800 }}>TOTAL</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, fontSize: 14 }}>{fmtC(grandTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <PONumberSettings />
      </div>
    </div>
  );
}
