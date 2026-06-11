import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, getDocs, getDoc, limit, onSnapshot, query, updateDoc, where } from "firebase/firestore";
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

interface Contact {
  id?: string; name: string; role: string; email: string;
  landline?: string; mobilePhone?: string; phone?: string;
  preferSMS?: boolean; bestContact?: string; notes?: string;
  authorized?: boolean;
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
const btnS = (bg: string): React.CSSProperties => ({ background: bg, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" });
const cTh: React.CSSProperties = { padding: "10px 14px", textAlign: "left" as const, fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" as const, letterSpacing: 0.4, whiteSpace: "nowrap" as const };
const cTd: React.CSSProperties = { padding: "11px 14px", fontSize: 13, color: "#374151", verticalAlign: "middle" as const };

// ── Property Contact modal ─────────────────────────────────────────────────────
function PropertyContactModal({ initial, onSave, onClose }:
  { initial?: Contact; onSave: (d: Contact) => Promise<void>; onClose: () => void }) {
  const blank: Contact = { name: "", role: "", email: "", landline: "", mobilePhone: "", preferSMS: false, bestContact: "", notes: "", authorized: false };
  const [form, setForm] = useState<Contact>({ ...blank, ...initial });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Contact) => (v: string | boolean) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background:"#fff", borderRadius:12, padding:28, width:"100%", maxWidth:520, maxHeight:"90vh", overflow:"auto", boxShadow:"0 8px 40px rgba(0,0,0,0.2)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <h2 style={{ fontSize:16, fontWeight:800, color:"#111827", margin:0 }}>{initial ? "Edit Representative" : "Add Representative"}</h2>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:"#6b7280", lineHeight:1 }}>×</button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"14px 20px" }}>
          <div style={{ gridColumn:"1/-1" }}><label style={lbl}>Name *</label><input style={inp} value={form.name} onChange={e=>set("name")(e.target.value)} placeholder="Jane Smith" /></div>
          <div><label style={lbl}>Role / Title</label><input style={inp} value={form.role||""} onChange={e=>set("role")(e.target.value)} placeholder="Plant Manager" /></div>
          <div><label style={lbl}>Email</label><input style={inp} type="email" value={form.email||""} onChange={e=>set("email")(e.target.value)} placeholder="jane@company.com" /></div>
          <div><label style={lbl}>Landline</label><input style={inp} type="tel" value={form.landline||""} onChange={e=>set("landline")(e.target.value)} placeholder="519-555-0100" /></div>
          <div><label style={lbl}>Mobile Phone</label><input style={inp} type="tel" value={form.mobilePhone||""} onChange={e=>set("mobilePhone")(e.target.value)} placeholder="519-555-0200" /></div>
          <div><label style={lbl}>Best Contact</label>
            <select style={inp} value={form.bestContact||""} onChange={e=>set("bestContact")(e.target.value)}>
              <option value="">— Select —</option>
              {["Email","Cell phone","Landline","SMS"].map(o=><option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10, paddingTop:20 }}>
            <input type="checkbox" id="pPrefSMS" checked={!!form.preferSMS} onChange={e=>set("preferSMS")(e.target.checked)} style={{ width:16, height:16, cursor:"pointer" }}/>
            <label htmlFor="pPrefSMS" style={{ fontSize:13, fontWeight:600, color:"#374151", cursor:"pointer" }}>Prefer SMS</label>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10, paddingTop:20 }}>
            <input type="checkbox" id="pAuthorized" checked={!!form.authorized} onChange={e=>set("authorized")(e.target.checked)} style={{ width:16, height:16, cursor:"pointer" }}/>
            <label htmlFor="pAuthorized" style={{ fontSize:13, fontWeight:600, color:"#374151", cursor:"pointer" }}>Authorized (can approve &amp; receive quotes)</label>
          </div>
          <div style={{ gridColumn:"1/-1" }}><label style={lbl}>Notes</label><textarea rows={3} style={{ ...inp, resize:"vertical", fontFamily:"inherit" }} value={form.notes||""} onChange={e=>set("notes")(e.target.value)} placeholder="Any notes about this contact…" /></div>
        </div>
        <div style={{ display:"flex", gap:10, marginTop:22 }}>
          <button disabled={!form.name||saving} onClick={async()=>{setSaving(true);await onSave(form);setSaving(false);}} style={{ ...btnS("#111827"), opacity:!form.name||saving?0.5:1 }}>
            {saving ? "Saving…" : "Save Contact"}
          </button>
          <button onClick={onClose} style={btnS("#6b7280")}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

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
  const [jobs, setJobs]           = useState<any[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [customerContacts, setCustomerContacts] = useState<Contact[]>([]);
  const [propertyContacts, setPropertyContacts] = useState<Contact[]>([]);
  const [contactMenu,  setContactMenu]  = useState<string | null>(null);
  const [contactModal, setContactModal] = useState<Contact | null | "new">(null);

  useEffect(() => {
    if (!propertyId) return;
    getDoc(doc(db, "properties", propertyId))
      .then(snap => {
        if (snap.exists()) setProperty({ id: snap.id, ...snap.data() } as Property);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [propertyId]);

  useEffect(() => {
    if (!propertyId) return;
    return onSnapshot(
      query(collection(db, "jobs"), where("propertyId", "==", propertyId)),
      snap => {
        const list = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a: any, b: any) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        setJobs(list);
        setJobsLoading(false);
      },
      () => setJobsLoading(false)
    );
  }, [propertyId]);

  useEffect(() => {
    if (!property) return;
    let unsub: (() => void) | undefined;

    async function setup() {
      let cid = property!.customerId;
      if (!cid && property!.customerName) {
        const snap = await getDocs(query(
          collection(db, "customers"),
          where("customerName", "==", property!.customerName),
          limit(1)
        ));
        if (!snap.empty) cid = snap.docs[0].id;
      }
      if (!cid) return;
      unsub = onSnapshot(
        collection(db, "customers", cid, "contacts"),
        s => setCustomerContacts(s.docs.map(d => ({ id: d.id, ...d.data() } as Contact)))
      );
    }

    setup();
    return () => unsub?.();
  }, [property?.customerId, property?.customerName]);

  useEffect(() => {
    if (!propertyId) return;
    return onSnapshot(
      collection(db, "properties", propertyId, "contacts"),
      snap => setPropertyContacts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Contact)))
    );
  }, [propertyId]);

  async function savePropertyContact(data: Contact) {
    if (!propertyId) return;
    if (data.id) {
      const { id, ...rest } = data;
      await updateDoc(doc(db, "properties", propertyId, "contacts", id), rest as Record<string, unknown>);
    } else {
      await addDoc(collection(db, "properties", propertyId, "contacts"), data);
    }
    setContactModal(null);
  }

  async function deletePropertyContact(id: string) {
    if (!propertyId) return;
    await deleteDoc(doc(db, "properties", propertyId, "contacts", id));
  }

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
                        {["Job", "Visits", "Job Type", "Status", "Issue Description", "Created On", "Amount Quoted", "Age (Days)", "Project Manager"].map(h => (
                          <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {jobsLoading ? (
                        <tr><td colSpan={9} style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: 14 }}>Loading…</td></tr>
                      ) : jobs.length === 0 ? (
                        <tr><td colSpan={9} style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: 14 }}>No jobs</td></tr>
                      ) : jobs.map((job: any) => {
                        const age = job.createdAt
                          ? Math.floor((Date.now() - new Date(job.createdAt).getTime()) / 86_400_000)
                          : "—";
                        const createdOn = job.createdAt
                          ? new Date(job.createdAt).toLocaleDateString("en-CA")
                          : "—";
                        const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
                          Open:       { bg: "#dbeafe", color: "#1e40af" },
                          "In Progress": { bg: "#fef3c7", color: "#92400e" },
                          Completed:  { bg: "#dcfce7", color: "#166534" },
                          Cancelled:  { bg: "#f3f4f6", color: "#6b7280" },
                        };
                        const sc = STATUS_COLORS[job.status] || { bg: "#f3f4f6", color: "#6b7280" };
                        return (
                          <tr key={job.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                            <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                              <Link to={`/jobs/${job.id}`} style={{ fontSize: 13, fontWeight: 700, color: "#1565c0", textDecoration: "none" }}>{job.jobNumber || "—"}</Link>
                            </td>
                            <td style={{ padding: "10px 14px", fontSize: 13, color: "#6b7280" }}>—</td>
                            <td style={{ padding: "10px 14px", fontSize: 13, color: "#374151" }}>{job.jobType || "—"}</td>
                            <td style={{ padding: "10px 14px" }}>
                              <span style={{ background: sc.bg, color: sc.color, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>{job.status || "—"}</span>
                            </td>
                            <td style={{ padding: "10px 14px", fontSize: 13, color: "#374151", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.issueDescription || "—"}</td>
                            <td style={{ padding: "10px 14px", fontSize: 13, color: "#374151", whiteSpace: "nowrap" }}>{createdOn}</td>
                            <td style={{ padding: "10px 14px", fontSize: 13, color: "#374151", whiteSpace: "nowrap" }}>{job.quoteSubtotal ? fmt$(job.quoteSubtotal) : "—"}</td>
                            <td style={{ padding: "10px 14px", fontSize: 13, color: "#374151" }}>{age}</td>
                            <td style={{ padding: "10px 14px", fontSize: 13, color: "#374151" }}>{job.projectManager || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{ padding: "10px 16px", fontSize: 12, color: "#9ca3af", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end" }}>
                    {jobs.length} job{jobs.length !== 1 ? "s" : ""}
                  </div>
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

            {tab === "Contacts" && (
              <div onClick={() => setContactMenu(null)}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                  <div style={{ fontSize:15, fontWeight:700, color:"#111827" }}>Representatives</div>
                  {isAdmin && (
                    <button onClick={() => setContactModal("new")} style={{ background:"#111827", color:"#fff", border:"none", borderRadius:6, padding:"8px 18px", fontSize:13, fontWeight:700, cursor:"pointer" }}>+ ADD</button>
                  )}
                </div>
                {customerContacts.length === 0 && propertyContacts.length === 0 ? (
                  <div style={{ textAlign:"center", padding:"40px 0", color:"#9ca3af" }}>
                    <p style={{ fontSize:14 }}>No representatives yet.</p>
                    {isAdmin && <button onClick={() => setContactModal("new")} style={{ ...btnS("#1565c0"), fontSize:13, marginTop:8 }}>Add First Contact</button>}
                  </div>
                ) : (
                  <>
                    <div style={{ border:"1px solid #e5e7eb", borderRadius:8, overflow:"auto" }}>
                      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                        <thead>
                          <tr style={{ background:"#f9fafb", borderBottom:"2px solid #e5e7eb" }}>
                            <th style={cTh}>Name</th>
                            <th style={cTh}>Role</th>
                            <th style={cTh}>Email</th>
                            <th style={cTh}>Landline</th>
                            <th style={cTh}>Mobile phone</th>
                            <th style={cTh}>Prefer SMS</th>
                            <th style={cTh}>Best contact</th>
                            <th style={cTh}>Notes</th>
                            <th style={{ ...cTh, width:40 }}></th>
                          </tr>
                        </thead>
                        <tbody style={{ background:"#fff" }}>
                          {customerContacts.map(c => (
                            <tr key={"cust-" + c.id} style={{ borderBottom:"1px solid #f3f4f6", background:"#fafbff" }}>
                              <td style={{ ...cTd, fontWeight:600 }}>
                                {c.name}
                                <span style={{ marginLeft:6, fontSize:10, fontWeight:700, background:"#eff6ff", color:"#1d4ed8", borderRadius:99, padding:"1px 7px", whiteSpace:"nowrap" as const }}>
                                  {property.customerName || "Customer"}
                                </span>
                              </td>
                              <td style={cTd}>{c.role || "—"}</td>
                              <td style={cTd}>{c.email ? <a href={`mailto:${c.email}`} style={{ color:"#1565c0", textDecoration:"none" }}>{c.email}</a> : "—"}</td>
                              <td style={cTd}>{c.landline || "—"}</td>
                              <td style={cTd}>{c.mobilePhone || c.phone || "—"}</td>
                              <td style={cTd}>{c.preferSMS ? "Yes" : "No"}</td>
                              <td style={cTd}>{c.bestContact || "—"}</td>
                              <td style={cTd}>{c.notes ? (c.notes.length > 30 ? c.notes.slice(0,30)+"…" : c.notes) : "—"}</td>
                              <td style={cTd} />
                            </tr>
                          ))}
                          {propertyContacts.map(c => (
                            <tr key={"prop-" + c.id} style={{ borderBottom:"1px solid #f3f4f6" }}
                                onMouseEnter={e => (e.currentTarget.style.background="#f9fafb")}
                                onMouseLeave={e => (e.currentTarget.style.background="")}>
                              <td style={{ ...cTd, fontWeight:600 }}>{c.name}</td>
                              <td style={cTd}>{c.role || "—"}</td>
                              <td style={cTd}>{c.email ? <a href={`mailto:${c.email}`} style={{ color:"#1565c0", textDecoration:"none" }}>{c.email}</a> : "—"}</td>
                              <td style={cTd}>{c.landline || "—"}</td>
                              <td style={cTd}>{c.mobilePhone || c.phone || "—"}</td>
                              <td style={cTd}>{c.preferSMS ? "Yes" : "No"}</td>
                              <td style={cTd}>{c.bestContact || "—"}</td>
                              <td style={cTd}>
                                {c.notes
                                  ? <span style={{ color:"#1565c0", fontSize:12, cursor:"pointer" }} onClick={e=>{e.stopPropagation();setContactModal(c);}}>{c.notes.length > 30 ? c.notes.slice(0,30)+"…" : c.notes}</span>
                                  : isAdmin
                                    ? <span style={{ color:"#1565c0", fontSize:12, cursor:"pointer" }} onClick={e=>{e.stopPropagation();setContactModal(c);}}>Add note</span>
                                    : "—"
                                }
                              </td>
                              <td style={{ ...cTd, position:"relative" as const }}>
                                <button
                                  onClick={e=>{e.stopPropagation();setContactMenu(contactMenu===c.id?null:c.id!);}}
                                  style={{ background:"none", border:"none", cursor:"pointer", fontSize:18, color:"#6b7280", padding:"2px 6px", borderRadius:4, lineHeight:1 }}
                                >⋮</button>
                                {contactMenu===c.id && (
                                  <div style={{ position:"absolute" as const, right:8, top:36, background:"#fff", border:"1px solid #e5e7eb", borderRadius:8, boxShadow:"0 4px 16px rgba(0,0,0,0.12)", zIndex:50, minWidth:120 }}>
                                    <button onClick={e=>{e.stopPropagation();setContactModal(c);setContactMenu(null);}} style={{ display:"block", width:"100%", textAlign:"left" as const, padding:"9px 14px", background:"none", border:"none", fontSize:13, cursor:"pointer", color:"#374151" }}>Edit</button>
                                    {isAdmin && <button onClick={e=>{e.stopPropagation();deletePropertyContact(c.id!);setContactMenu(null);}} style={{ display:"block", width:"100%", textAlign:"left" as const, padding:"9px 14px", background:"none", border:"none", fontSize:13, cursor:"pointer", color:"#dc2626" }}>Delete</button>}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ display:"flex", justifyContent:"flex-end", marginTop:8, fontSize:12, color:"#6b7280" }}>
                      1–{customerContacts.length + propertyContacts.length} of {customerContacts.length + propertyContacts.length} rows
                    </div>
                  </>
                )}
              </div>
            )}

            {tab !== "Jobs & Visits" && tab !== "Details" && tab !== "Contacts" && (
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

      {contactModal !== null && (
        <PropertyContactModal
          initial={contactModal === "new" ? undefined : contactModal}
          onSave={savePropertyContact}
          onClose={() => setContactModal(null)}
        />
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
