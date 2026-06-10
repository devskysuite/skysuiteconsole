import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useIsAdmin } from "../hooks/useIsAdmin";
import CreateJobModal from "./CreateJobModal";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Property {
  id?: string;
  name: string;
  status: "Active" | "Inactive";
  customerName: string;
  customerId?: string;
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt$(n: number): string {
  return "$" + (n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const TYPE_COLORS: Record<string, { background: string; color: string }> = {
  Industrial:          { background: "#dbeafe", color: "#1e40af" },
  Commercial:          { background: "#ede9fe", color: "#6d28d9" },
  Institutional:       { background: "#d1fae5", color: "#065f46" },
  "Property Manager":  { background: "#fef3c7", color: "#92400e" },
  Construction:        { background: "#fee2e2", color: "#991b1b" },
  Other:               { background: "#f3f4f6", color: "#374151" },
};

const ALL_TABS = ["Jobs & Visits", "Details", "Maintenance", "Projects", "Contacts", "Attachments", "Assets", "Tasks", "Quotes", "History"] as const;
type Tab = typeof ALL_TABS[number];

// ── Sidebar info row ──────────────────────────────────────────────────────────
function SideLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2, marginTop: 14 }}>{children}</div>;
}
function SideValue({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.5 }}>{children}</div>;
}

// ── Edit modal ────────────────────────────────────────────────────────────────
function EditModal({ property, onSave, onClose }:
  { property: Property; onSave: (data: Partial<Property>) => Promise<void>; onClose: () => void }) {
  const [form, setForm] = useState({ ...property });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Property) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 580, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0d2e5e", marginBottom: 20 }}>Edit Property</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={lbl}>Property Name *</label>
            <input style={inp} value={form.name} onChange={e => set("name")(e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Status</label>
            <select style={inp} value={form.status} onChange={e => set("status")(e.target.value)}>
              <option>Active</option><option>Inactive</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Property Type</label>
            <select style={inp} value={form.propertyType} onChange={e => set("propertyType")(e.target.value)}>
              <option value="">— Select —</option>
              {["Industrial","Commercial","Institutional","Property Manager","Construction","Other"].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={lbl}>Property Address</label>
            <textarea style={{ ...inp, resize: "vertical", minHeight: 56, fontFamily: "inherit" }} value={form.propertyAddress} onChange={e => set("propertyAddress")(e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Account Number</label>
            <input style={inp} value={form.accountNumber} onChange={e => set("accountNumber")(e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Billing Customer</label>
            <input style={inp} value={form.billingCustomer} onChange={e => set("billingCustomer")(e.target.value)} />
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={lbl}>Billing Address</label>
            <textarea style={{ ...inp, resize: "vertical", minHeight: 48, fontFamily: "inherit" }} value={form.billingAddress} onChange={e => set("billingAddress")(e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Tags</label>
            <input style={inp} value={form.tags} onChange={e => set("tags")(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button
            disabled={!form.name.trim() || saving}
            onClick={async () => { setSaving(true); await onSave(form); setSaving(false); }}
            style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: !form.name.trim() || saving ? 0.5 : 1 }}
          >{saving ? "Saving…" : "Save"}</button>
          <button onClick={onClose} style={{ background: "#6b7280", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 };
const inp: React.CSSProperties = { width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" as const };

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PropertyDetailPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]             = useState<Tab>("Jobs & Visits");
  const [editOpen, setEditOpen]   = useState(false);
  const [createJobOpen, setCreateJobOpen] = useState(false);

  useEffect(() => {
    if (!propertyId) return;
    getDoc(doc(db, "properties", propertyId))
      .then(snap => {
        if (snap.exists()) setProperty({ id: snap.id, ...snap.data() } as Property);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [propertyId]);

  async function saveEdit(data: Partial<Property>) {
    if (!propertyId) return;
    await updateDoc(doc(db, "properties", propertyId), data as Record<string, unknown>);
    setProperty(p => p ? { ...p, ...data } : p);
    setEditOpen(false);
  }

  if (loading) return (
    <div style={{ padding: 80, textAlign: "center", color: "#9ca3af", fontSize: 15 }}>Loading…</div>
  );
  if (!property) return (
    <div style={{ padding: 80, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🏠</div>
      <div style={{ color: "#374151", fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Property not found</div>
      <button onClick={() => navigate("/properties")} style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>← Back to Properties</button>
    </div>
  );

  const tc = property.propertyType ? (TYPE_COLORS[property.propertyType] || TYPE_COLORS.Other) : null;
  const mapsUrl = property.propertyAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(property.propertyAddress)}`
    : null;
  const billingMapsUrl = property.billingAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(property.billingAddress)}`
    : null;

  return (
    <div style={{ background: "#f0f2f5", minHeight: "100vh" }}>

      {/* Breadcrumb */}
      <div style={{ padding: "10px 24px", borderBottom: "1px solid #e5e7eb", background: "#fff", fontSize: 13, color: "#6b7280", display: "flex", alignItems: "center", gap: 6 }}>
        <Link to="/properties" style={{ color: "#1565c0", textDecoration: "none", fontWeight: 500 }}>Properties</Link>
        <span>/</span>
        <span>View Property</span>
      </div>

      {/* Body */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 0 }}>

        {/* ── Left sidebar ── */}
        <div style={{ width: 220, flexShrink: 0, background: "#fff", borderRight: "1px solid #e5e7eb", padding: "16px 16px 32px", minHeight: "calc(100vh - 133px)" }}>

          <SideLabel>Customer</SideLabel>
          <SideValue>
            {property.customerId
              ? <Link to={`/customers/${property.customerId}`} style={{ color: "#1565c0", textDecoration: "none", fontWeight: 600 }}>{property.customerName || "—"}</Link>
              : <span style={{ color: "#1565c0", fontWeight: 600 }}>{property.customerName || "—"}</span>}
          </SideValue>

          <SideLabel>Property</SideLabel>
          <SideValue>{property.name}</SideValue>

          <SideLabel>Property Address</SideLabel>
          <SideValue>{property.propertyAddress || "—"}</SideValue>

          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, fontSize: 12, color: "#1565c0", textDecoration: "none", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "4px 8px", width: "fit-content" }}>
              <span>📍</span> View on Maps
            </a>
          )}

          <div style={{ marginTop: 16, borderTop: "1px solid #e5e7eb", paddingTop: 4 }} />

          <SideLabel>Billing Customer</SideLabel>
          <SideValue>{property.billingCustomer || property.customerName || "—"}</SideValue>

          <SideLabel>Billing Address</SideLabel>
          <SideValue>{property.billingAddress || property.propertyAddress || "—"}</SideValue>

          {billingMapsUrl && billingMapsUrl !== mapsUrl && (
            <a href={billingMapsUrl} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, fontSize: 12, color: "#1565c0", textDecoration: "none", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "4px 8px", width: "fit-content" }}>
              <span>📍</span> View on Maps
            </a>
          )}

          <SideLabel>Account Number</SideLabel>
          <SideValue>{property.accountNumber || "—"}</SideValue>

          <SideLabel>Created By</SideLabel>
          <SideValue>{property.createdBy || "—"}</SideValue>

          <SideLabel>Created On</SideLabel>
          <SideValue>{property.createdOn || "—"}</SideValue>

          {property.tags && (
            <>
              <SideLabel>Tags</SideLabel>
              <SideValue>{property.tags}</SideValue>
            </>
          )}
        </div>

        {/* ── Main content ── */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Title bar */}
          <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>🏠</span>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0d2e5e", margin: 0 }}>
                Property: {property.name}
              </h1>
              {tc && (
                <span style={{ ...tc, fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 99, whiteSpace: "nowrap" }}>
                  {property.propertyType}
                </span>
              )}
              <span style={{ background: property.status === "Active" ? "#dcfce7" : "#f3f4f6", color: property.status === "Active" ? "#166534" : "#6b7280", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>
                {property.status}
              </span>
            </div>
            {isAdmin && (
              <button onClick={() => setEditOpen(true)} style={{ background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 8, padding: "7px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                EDIT
              </button>
            )}
          </div>

          {/* Stats strip */}
          <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "12px 24px", display: "flex", flexWrap: "wrap", gap: 32 }}>
            {[
              { label: "PROPERTY TYPE",     value: property.propertyType || "—" },
              { label: "OPEN JOBS",          value: String(property.openJobs ?? 0) },
              { label: "OPEN JOBS VALUE",    value: fmt$(property.openJobsValue) },
              { label: "OUTSTANDING",        value: fmt$(property.outstandingBalance), red: (property.outstandingBalance || 0) > 0 },
              { label: "OVERDUE",            value: fmt$(property.overdueBalance),    red: (property.overdueBalance    || 0) > 0 },
            ].map(({ label, value, red }) => (
              <div key={label}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: red ? "#dc2626" : "#0d2e5e" }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ background: "#fff", borderBottom: "2px solid #e5e7eb", display: "flex", overflowX: "auto", padding: "0 24px" }}>
            {ALL_TABS.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: "12px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer",
                background: "none", border: "none",
                borderBottom: tab === t ? "2px solid #1565c0" : "2px solid transparent",
                color: tab === t ? "#1565c0" : "#6b7280",
                marginBottom: -2, whiteSpace: "nowrap",
              }}>{t}</button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ padding: "24px" }}>

            {tab === "Jobs & Visits" && (
              <div>
                {/* Jobs section */}
                <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", marginBottom: 24, overflow: "hidden" }}>
                  <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: "#0d2e5e" }}>Jobs</span>
                      {["All", "Scheduled for today", "My jobs"].map((f, i) => (
                        <button key={f} style={{ padding: "4px 12px", fontSize: 12, fontWeight: 600, borderRadius: 99, cursor: "pointer", border: "1px solid " + (i === 0 ? "#1565c0" : "#d1d5db"), background: i === 0 ? "#1565c0" : "#fff", color: i === 0 ? "#fff" : "#374151" }}>{f}</button>
                      ))}
                    </div>
                    <button
                      onClick={() => setCreateJobOpen(true)}
                      style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                    >+ Create Job</button>
                  </div>
                  {/* Jobs table */}
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {["Job", "Visits", "Job Type", "Status", "Issue Description", "Tags", "Created On", "Outstanding Balance", "Overdue Balance", "Amount Quoted", "Age (Days)", "Project Manager"].map(h => (
                          <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td colSpan={12} style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: 14 }}>No jobs</td>
                      </tr>
                    </tbody>
                  </table>
                  <div style={{ padding: "10px 16px", fontSize: 12, color: "#9ca3af", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end" }}>Rows per page: 25 &nbsp;·&nbsp; 0–0 of 0</div>
                </div>

                {/* Current visits */}
                <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", marginBottom: 24, overflow: "hidden" }}>
                  <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e7eb" }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: "#0d2e5e" }}>Current visits for property</span>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {["Event type", "Job", "Status", "Date", "Description", "Assigned to"].map(h => (
                          <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td colSpan={6} style={{ padding: "30px 20px", textAlign: "center", color: "#9ca3af", fontSize: 14 }}>No upcoming visits</td></tr>
                    </tbody>
                  </table>
                  <div style={{ padding: "10px 16px", fontSize: 12, color: "#9ca3af", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end" }}>Rows per page: 25 &nbsp;·&nbsp; 0–0 of 0</div>
                </div>

                {/* Past visits */}
                <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", overflow: "hidden" }}>
                  <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e7eb" }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: "#0d2e5e" }}>Past visits for property</span>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {["Event type", "Job", "Status", "Date", "Description", "Assigned to"].map(h => (
                          <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td colSpan={6} style={{ padding: "30px 20px", textAlign: "center", color: "#9ca3af", fontSize: 14 }}>No past visits</td></tr>
                    </tbody>
                  </table>
                  <div style={{ padding: "10px 16px", fontSize: 12, color: "#9ca3af", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end" }}>Rows per page: 25 &nbsp;·&nbsp; 0–0 of 0</div>
                </div>
              </div>
            )}

            {tab === "Details" && (
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: 24 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
                  {[
                    { label: "Property Name",      value: property.name },
                    { label: "Status",             value: property.status },
                    { label: "Property Type",      value: property.propertyType || "—" },
                    { label: "Customer",           value: property.customerName || "—" },
                    { label: "Customer Type",      value: property.customerType || "—" },
                    { label: "Account Number",     value: property.accountNumber || "—" },
                    { label: "Open Jobs",          value: String(property.openJobs ?? 0) },
                    { label: "Open Jobs Value",    value: fmt$(property.openJobsValue) },
                    { label: "Outstanding Balance",value: fmt$(property.outstandingBalance) },
                    { label: "Overdue Balance",    value: fmt$(property.overdueBalance) },
                    { label: "Created By",         value: property.createdBy || "—" },
                    { label: "Created On",         value: property.createdOn || "—" },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 14, color: "#374151" }}>{value}</div>
                    </div>
                  ))}
                  <div style={{ gridColumn: "1/-1" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Property Address</div>
                    <div style={{ fontSize: 14, color: "#374151" }}>{property.propertyAddress || "—"}</div>
                  </div>
                  <div style={{ gridColumn: "1/-1" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Billing Address</div>
                    <div style={{ fontSize: 14, color: "#374151" }}>{property.billingAddress || "—"}</div>
                  </div>
                  {property.tags && (
                    <div style={{ gridColumn: "1/-1" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Tags</div>
                      <div style={{ fontSize: 14, color: "#374151" }}>{property.tags}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab !== "Jobs & Visits" && tab !== "Details" && (
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: "60px 24px", textAlign: "center", color: "#9ca3af", fontSize: 14 }}>
                {tab} — coming soon
              </div>
            )}
          </div>
        </div>
      </div>

      {editOpen && property && (
        <EditModal property={property} onSave={saveEdit} onClose={() => setEditOpen(false)} />
      )}

      {createJobOpen && (
        <CreateJobModal
          property={property}
          onClose={() => setCreateJobOpen(false)}
          onCreated={(_id, num) => {
            setProperty(p => p ? { ...p, openJobs: (p.openJobs || 0) + 1 } : p);
            alert(`Job ${num} created successfully.`);
          }}
        />
      )}
    </div>
  );
}
