import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  addDoc, collection, deleteDoc, doc,
  getDoc, onSnapshot, query, updateDoc, setDoc, where,
} from "firebase/firestore";
import { db } from "../firebase";
import { useIsAdmin } from "../hooks/useIsAdmin";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Customer {
  id?: string;
  name: string; code: string; status: "Active" | "Inactive";
  numberOfProperties: number; openJobs: number; openJobsValue: number;
  outstandingBalance: number; overdueBalance: number;
  lastPayment: number; lastPaymentDate: string;
  billingAddress: string; businessAddress: string;
  createdBy: string; createdOn: string; customerType: string;
  email: string; phone: string; tags: string; syncStatus: string;
}
interface Property {
  id?: string;
  name: string;
  status: string;
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
  id?: string; name: string; role: string; email: string; phone: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// ── Small building-block components ───────────────────────────────────────────
function SideLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>{children}</div>;
}
function SideSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <SideLabel>{label}</SideLabel>
      <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}
function InfoField({ label, children, span = 1 }: { label: string; children: React.ReactNode; span?: number }) {
  return (
    <div style={{ gridColumn: `span ${span}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: "#111827", fontWeight: 500 }}>{children}</div>
    </div>
  );
}
function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: "12px 18px", fontWeight: 600, fontSize: 14, cursor: "pointer",
      background: "none", border: "none",
      borderBottom: active ? "2px solid #1565c0" : "2px solid transparent",
      color: active ? "#1565c0" : "#6b7280", marginBottom: -1,
    }}>{label}</button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate      = useNavigate();
  const isAdmin       = useIsAdmin();

  const [customer,   setCustomer]   = useState<Customer | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [tab,        setTab]        = useState<"properties"|"contacts"|"notes">("properties");
  const [properties, setProperties] = useState<Property[]>([]);
  const [contacts,   setContacts]   = useState<Contact[]>([]);
  const [notes,      setNotes]      = useState("");
  const [notesSaved, setNotesSaved] = useState(false);

  // Edit modals
  const [editModal,    setEditModal]    = useState(false);
  const [propModal,    setPropModal]    = useState<Property | null | "new">(null);
  const [contactModal, setContactModal] = useState<Contact | null | "new">(null);

  // Load customer doc
  useEffect(() => {
    if (!customerId) return;
    getDoc(doc(db, "customers", customerId)).then(snap => {
      if (snap.exists()) setCustomer({ id: snap.id, ...snap.data() } as Customer);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [customerId]);

  // Properties — top-level collection filtered by customerId
  useEffect(() => {
    if (!customerId) return;
    return onSnapshot(
      query(collection(db, "properties"), where("customerId", "==", customerId)),
      snap => setProperties(snap.docs.map(d => ({ id: d.id, ...d.data() } as Property)))
    );
  }, [customerId]);

  // Contacts sub-collection
  useEffect(() => {
    if (!customerId) return;
    return onSnapshot(collection(db, "customers", customerId, "contacts"), snap => {
      setContacts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Contact)));
    });
  }, [customerId]);

  // Notes doc
  useEffect(() => {
    if (!customerId) return;
    getDoc(doc(db, "customers", customerId, "meta", "notes")).then(snap => {
      if (snap.exists()) setNotes(snap.data().text || "");
    }).catch(() => {});
  }, [customerId]);

  async function saveNotes() {
    if (!customerId) return;
    await setDoc(doc(db, "customers", customerId, "meta", "notes"), { text: notes });
    setNotesSaved(true); setTimeout(() => setNotesSaved(false), 2000);
  }

  async function saveCustomer(data: Partial<Customer>) {
    if (!customerId || !customer) return;
    await updateDoc(doc(db, "customers", customerId), data);
    setCustomer(c => c ? { ...c, ...data } : c);
    setEditModal(false);
  }

  async function saveProperty(data: Property) {
    if (!customerId || !customer) return;
    // Always write to top-level properties collection, stamping customerId + customerName
    const payload: Property = { ...data, customerId, customerName: customer.name };
    if (data.id) {
      const { id: _id, ...rest } = payload;
      await updateDoc(doc(db, "properties", data.id), rest);
    } else {
      await addDoc(collection(db, "properties"), payload);
    }
    setPropModal(null);
  }

  async function deleteProperty(id: string) {
    if (!confirm("Delete this property?")) return;
    await deleteDoc(doc(db, "properties", id));
  }

  async function saveContact(data: Contact) {
    if (!customerId) return;
    if (data.id) {
      const { id, ...rest } = data;
      await updateDoc(doc(db, "customers", customerId, "contacts", id), rest);
    } else {
      await addDoc(collection(db, "customers", customerId, "contacts"), data);
    }
    setContactModal(null);
  }

  async function deleteContact(id: string) {
    if (!customerId || !confirm("Delete this contact?")) return;
    await deleteDoc(doc(db, "customers", customerId, "contacts", id));
  }

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#9ca3af" }}>Loading…</div>;
  if (!customer) return (
    <div style={{ padding: 60, textAlign: "center" }}>
      <p style={{ color: "#9ca3af", marginBottom: 12 }}>Customer not found.</p>
      <button onClick={() => navigate("/customers")} style={btnS("#6b7280")}>← Back to Customers</button>
    </div>
  );

  const tc = customer.customerType ? (TYPE_COLORS[customer.customerType] || TYPE_COLORS.Other) : null;

  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb" }}>

      {/* ── Breadcrumb ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 0 0 0" }}>
        <div style={{ padding: "8px 24px", fontSize: 12, color: "#9ca3af" }}>
          <Link to="/customers" style={{ color: "#1565c0", textDecoration: "none", fontWeight: 500 }}>Customers</Link>
          <span style={{ margin: "0 6px" }}>/</span>
          <span>View customer</span>
        </div>

        {/* Customer name header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px 16px", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {/* Circle icon */}
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#1565c0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0d2e5e", margin: 0 }}>{customer.name}</h1>
            <span style={{ fontSize: 13, color: "#9ca3af", fontWeight: 500 }}>{customer.code}</span>
            <span style={{ background: "#dcfce7", color: "#166534", fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 99 }}>{customer.status}</span>
            {tc && <span style={{ ...tc, fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 99 }}>{customer.customerType}</span>}
          </div>
          {isAdmin && (
            <button onClick={() => setEditModal(true)} style={{ ...btnS("#1565c0"), fontSize: 13 }}>Edit</button>
          )}
        </div>
      </div>

      {/* ── Two-column body ── */}
      <div style={{ display: "flex", alignItems: "flex-start", minHeight: "calc(100vh - 140px)" }}>

        {/* ── Left sidebar ── */}
        <div style={{ width: 200, flexShrink: 0, borderRight: "1px solid #e5e7eb", padding: "24px 20px", background: "#fff", minHeight: "100%", alignSelf: "stretch" }}>
          <SideSection label="Billing Address">
            {customer.billingAddress
              ? customer.billingAddress.split(", ").map((line, i) => <div key={i}>{line}</div>)
              : <span style={{ color: "#d1d5db" }}>—</span>}
          </SideSection>

          <SideSection label="Business Address">
            {customer.businessAddress
              ? customer.businessAddress.split(", ").map((line, i) => <div key={i}>{line}</div>)
              : <span style={{ color: "#d1d5db" }}>—</span>}
          </SideSection>

          <SideSection label="No of Properties">
            <strong>{customer.numberOfProperties || properties.length || "—"}</strong>
          </SideSection>

          <SideSection label="Email Address">
            {customer.email
              ? <a href={`mailto:${customer.email}`} style={{ color: "#1565c0", textDecoration: "none", wordBreak: "break-all" }}>{customer.email}</a>
              : <span style={{ color: "#d1d5db" }}>—</span>}
          </SideSection>

          <SideSection label="Phone">
            {customer.phone
              ? <a href={`tel:${customer.phone}`} style={{ color: "#1565c0", textDecoration: "none" }}>{customer.phone}</a>
              : <span style={{ color: "#d1d5db" }}>—</span>}
          </SideSection>

          <SideSection label="Created By">
            {customer.createdBy || <span style={{ color: "#d1d5db" }}>—</span>}
          </SideSection>

          <SideSection label="Created On">
            {customer.createdOn || <span style={{ color: "#d1d5db" }}>—</span>}
          </SideSection>
        </div>

        {/* ── Main content ── */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Info grid */}
          <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "20px 28px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "16px 24px", marginBottom: 16 }}>
              <InfoField label="Credit Limit">
                {customer.outstandingBalance > 0 || customer.overdueBalance > 0 ? "—" : "—"}
              </InfoField>
              <InfoField label="Outstanding Balance">
                <span style={{ color: customer.outstandingBalance > 0 ? "#dc2626" : "#111827", fontWeight: customer.outstandingBalance > 0 ? 700 : 500 }}>
                  {fmt$(customer.outstandingBalance)}
                </span>
              </InfoField>
              <InfoField label="Overdue Balance">
                <span style={{ color: customer.overdueBalance > 0 ? "#dc2626" : "#111827", fontWeight: customer.overdueBalance > 0 ? 700 : 500 }}>
                  {fmt$(customer.overdueBalance)}
                </span>
              </InfoField>
              <InfoField label="Last Payment">
                {customer.lastPayment ? fmt$(customer.lastPayment) : "—"}
              </InfoField>
              <InfoField label="Last Payment Date">
                {customer.lastPaymentDate || "—"}
              </InfoField>
              <InfoField label="Open Jobs">
                <span style={{ fontWeight: customer.openJobs > 0 ? 700 : 400 }}>{customer.openJobs}</span>
              </InfoField>
              <InfoField label="Open Jobs Value">
                {customer.openJobsValue > 0 ? fmt$(customer.openJobsValue) : "—"}
              </InfoField>
            </div>

            {/* Sync status */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Sync Status:</span>
              <span style={{ background: "#dcfce7", color: "#166534", fontSize: 12, fontWeight: 600, padding: "2px 10px", borderRadius: 99 }}>
                {customer.syncStatus || "In Sync"}
              </span>
            </div>
          </div>

          {/* ── Tabs ── */}
          <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 28px", display: "flex", gap: 0 }}>
            <TabBtn label="Properties" active={tab === "properties"} onClick={() => setTab("properties")} />
            <TabBtn label="Contacts"   active={tab === "contacts"}   onClick={() => setTab("contacts")} />
            <TabBtn label="Notes"      active={tab === "notes"}      onClick={() => setTab("notes")} />
          </div>

          <div style={{ padding: "24px 28px" }}>

            {/* ── Properties tab ── */}
            {tab === "properties" && (
              <>
                {isAdmin && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
                    <button onClick={() => setPropModal("new")} style={{ ...btnS("#1565c0"), fontSize: 13 }}>+ Add Property</button>
                  </div>
                )}
                {properties.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af" }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>🏢</div>
                    <p style={{ fontSize: 14 }}>No properties yet.</p>
                    {isAdmin && <button onClick={() => setPropModal("new")} style={{ ...btnS("#1565c0"), fontSize: 13, marginTop: 8 }}>Add First Property</button>}
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                        <th style={th}>Name</th>
                        <th style={th}>Status</th>
                        <th style={th}>Type</th>
                        <th style={th}>Property Address</th>
                        <th style={{ ...th, textAlign: "center" as const }}>Open Jobs</th>
                        <th style={th}>Outstanding</th>
                        <th style={th}>Overdue</th>
                        <th style={{ ...th, width: 44 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {properties.map(p => (
                        <tr key={p.id} style={{ borderBottom: "1px solid #f3f4f6" }}
                            onMouseEnter={e => (e.currentTarget.style.background = "#f9fafb")}
                            onMouseLeave={e => (e.currentTarget.style.background = "")}>
                          <td style={{ ...td, color: "#1565c0", fontWeight: 600, cursor: "pointer" }} onClick={() => setPropModal(p)}>{p.name}</td>
                          <td style={td}>
                            <span style={{ background: p.status === "Active" ? "#dcfce7" : "#f3f4f6", color: p.status === "Active" ? "#166534" : "#6b7280", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99 }}>
                              {p.status || "Active"}
                            </span>
                          </td>
                          <td style={td}>{p.propertyType || "—"}</td>
                          <td style={{ ...td, maxWidth: 220 }}>
                            <span title={p.propertyAddress} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                              {p.propertyAddress || "—"}
                            </span>
                          </td>
                          <td style={{ ...td, textAlign: "center" as const, fontWeight: p.openJobs > 0 ? 700 : 400 }}>{p.openJobs ?? 0}</td>
                          <td style={{ ...td, color: p.outstandingBalance > 0 ? "#dc2626" : "#374151", fontWeight: p.outstandingBalance > 0 ? 600 : 400 }}>
                            {p.outstandingBalance > 0 ? fmt$(p.outstandingBalance) : "—"}
                          </td>
                          <td style={{ ...td, color: p.overdueBalance > 0 ? "#dc2626" : "#374151", fontWeight: p.overdueBalance > 0 ? 700 : 400 }}>
                            {p.overdueBalance > 0 ? fmt$(p.overdueBalance) : "—"}
                          </td>
                          <td style={td}>
                            {isAdmin && <button onClick={() => deleteProperty(p.id!)} style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 13 }}>✕</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            {/* ── Contacts tab ── */}
            {tab === "contacts" && (
              <>
                {isAdmin && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
                    <button onClick={() => setContactModal("new")} style={{ ...btnS("#1565c0"), fontSize: 13 }}>+ Add Contact</button>
                  </div>
                )}
                {contacts.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af" }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>👤</div>
                    <p style={{ fontSize: 14 }}>No contacts yet.</p>
                    {isAdmin && <button onClick={() => setContactModal("new")} style={{ ...btnS("#1565c0"), fontSize: 13, marginTop: 8 }}>Add First Contact</button>}
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                        <th style={th}>Name</th>
                        <th style={th}>Role</th>
                        <th style={th}>Email</th>
                        <th style={th}>Phone</th>
                        <th style={{ ...th, width: 60 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map(c => (
                        <tr key={c.id} style={{ borderBottom: "1px solid #f3f4f6" }}
                            onMouseEnter={e => (e.currentTarget.style.background = "#f9fafb")}
                            onMouseLeave={e => (e.currentTarget.style.background = "")}>
                          <td style={{ ...td, fontWeight: 600, cursor: "pointer", color: "#1565c0" }} onClick={() => setContactModal(c)}>{c.name}</td>
                          <td style={td}>{c.role || "—"}</td>
                          <td style={td}>
                            {c.email ? <a href={`mailto:${c.email}`} style={{ color: "#1565c0", textDecoration: "none" }}>{c.email}</a> : "—"}
                          </td>
                          <td style={td}>{c.phone || "—"}</td>
                          <td style={td}>
                            {isAdmin && <button onClick={() => deleteContact(c.id!)} style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 13 }}>✕</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            {/* ── Notes tab ── */}
            {tab === "notes" && (
              <div style={{ maxWidth: 640 }}>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Add notes about this customer…"
                  readOnly={!isAdmin}
                  style={{ width: "100%", minHeight: 160, padding: "12px 14px", border: "1px solid #d1d5db", borderRadius: 10, fontSize: 14, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" as const, color: "#374151", background: isAdmin ? "#fff" : "#f9fafb" }}
                />
                {isAdmin && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
                    <button onClick={saveNotes} style={btnS("#1565c0")}>Save Notes</button>
                    {notesSaved && <span style={{ fontSize: 13, color: "#059669", fontWeight: 600 }}>✅ Saved</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Edit Customer modal ── */}
      {editModal && customer && (
        <EditCustomerModal customer={customer} onSave={saveCustomer} onClose={() => setEditModal(false)} />
      )}

      {/* ── Property modal ── */}
      {propModal !== null && (
        <PropertyModal
          initial={propModal === "new" ? undefined : propModal}
          onSave={saveProperty}
          onClose={() => setPropModal(null)}
        />
      )}

      {/* ── Contact modal ── */}
      {contactModal !== null && (
        <ContactModal
          initial={contactModal === "new" ? undefined : contactModal}
          onSave={saveContact}
          onClose={() => setContactModal(null)}
        />
      )}
    </div>
  );
}

// ── Edit Customer modal ───────────────────────────────────────────────────────
function EditCustomerModal({ customer, onSave, onClose }:
  { customer: Customer; onSave: (d: Partial<Customer>) => Promise<void>; onClose: () => void }) {
  const [form, setForm] = useState({ ...customer });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Customer) => (v: string | number) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0d2e5e", marginBottom: 20 }}>Edit Customer</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Customer Name *</label><input style={inp} value={form.name} onChange={e => set("name")(e.target.value)} /></div>
          <div><label style={lbl}>Customer Code</label><input style={inp} value={form.code} onChange={e => set("code")(e.target.value)} /></div>
          <div><label style={lbl}>Customer Type</label>
            <select style={inp} value={form.customerType} onChange={e => set("customerType")(e.target.value)}>
              <option value="">— Select —</option>
              {["Industrial","Commercial","Institutional","Property Manager","Construction","Other"].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Status</label>
            <select style={inp} value={form.status} onChange={e => set("status")(e.target.value)}>
              <option>Active</option><option>Inactive</option>
            </select>
          </div>
          <div><label style={lbl}># Properties</label><input style={inp} type="number" min={0} value={form.numberOfProperties} onChange={e => set("numberOfProperties")(parseInt(e.target.value)||0)} /></div>
          <div><label style={lbl}>Email</label><input style={inp} type="email" value={form.email} onChange={e => set("email")(e.target.value)} /></div>
          <div><label style={lbl}>Phone</label><input style={inp} type="tel" value={form.phone} onChange={e => set("phone")(e.target.value)} /></div>
          <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Billing Address</label><textarea style={{ ...inp, resize: "vertical", minHeight: 56, fontFamily: "inherit" }} value={form.billingAddress} onChange={e => set("billingAddress")(e.target.value)} /></div>
          <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Business Address</label><textarea style={{ ...inp, resize: "vertical", minHeight: 48, fontFamily: "inherit" }} value={form.businessAddress} onChange={e => set("businessAddress")(e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button disabled={!form.name || saving} onClick={async () => { setSaving(true); await onSave(form); setSaving(false); }} style={{ ...btnS("#1565c0"), opacity: !form.name || saving ? 0.5 : 1 }}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={onClose} style={btnS("#6b7280")}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Property modal ────────────────────────────────────────────────────────────
function PropertyModal({ initial, onSave, onClose }:
  { initial?: Property; onSave: (d: Property) => Promise<void>; onClose: () => void }) {
  const blank: Property = {
    name: "", status: "Active", customerName: "", customerId: "",
    propertyType: "", openJobs: 0, openJobsValue: 0,
    outstandingBalance: 0, overdueBalance: 0,
    propertyAddress: "", accountNumber: "", billingAddress: "",
    billingCustomer: "", createdBy: "", createdOn: "", customerType: "", tags: "",
  };
  const [form, setForm] = useState<Property>({ ...blank, ...initial });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Property) => (v: string | number) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: "#0d2e5e", marginBottom: 18 }}>{initial?.id ? "Edit Property" : "Add Property"}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Property Name *</label><input style={inp} value={form.name} onChange={e => set("name")(e.target.value)} placeholder="e.g. Main Building" /></div>
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
          <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Property Address</label><textarea style={{ ...inp, minHeight: 48, resize: "vertical", fontFamily: "inherit" }} value={form.propertyAddress} onChange={e => set("propertyAddress")(e.target.value)} /></div>
          <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Billing Address</label><textarea style={{ ...inp, minHeight: 40, resize: "vertical", fontFamily: "inherit" }} value={form.billingAddress} onChange={e => set("billingAddress")(e.target.value)} /></div>
          <div><label style={lbl}>Account Number</label><input style={inp} value={form.accountNumber} onChange={e => set("accountNumber")(e.target.value)} /></div>
          <div><label style={lbl}>Created On</label><input style={inp} value={form.createdOn} onChange={e => set("createdOn")(e.target.value)} placeholder="Jan 1, 2026" /></div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button disabled={!form.name || saving} onClick={async () => { setSaving(true); await onSave(form); setSaving(false); }} style={{ ...btnS("#1565c0"), opacity: !form.name || saving ? 0.5 : 1 }}>
            {saving ? "Saving…" : "Save Property"}
          </button>
          <button onClick={onClose} style={btnS("#6b7280")}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Contact modal ─────────────────────────────────────────────────────────────
function ContactModal({ initial, onSave, onClose }:
  { initial?: Contact; onSave: (d: Contact) => Promise<void>; onClose: () => void }) {
  const blank: Contact = { name: "", role: "", email: "", phone: "" };
  const [form, setForm] = useState<Contact>({ ...blank, ...initial });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Contact) => (v: string) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 440, boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: "#0d2e5e", marginBottom: 18 }}>{initial ? "Edit Contact" : "Add Contact"}</h2>
        <div style={{ display: "grid", gap: 12 }}>
          <div><label style={lbl}>Name *</label><input style={inp} value={form.name} onChange={e => set("name")(e.target.value)} placeholder="Jane Smith" /></div>
          <div><label style={lbl}>Role / Title</label><input style={inp} value={form.role} onChange={e => set("role")(e.target.value)} placeholder="Plant Manager" /></div>
          <div><label style={lbl}>Email</label><input style={inp} type="email" value={form.email} onChange={e => set("email")(e.target.value)} placeholder="jane@company.com" /></div>
          <div><label style={lbl}>Phone</label><input style={inp} type="tel" value={form.phone} onChange={e => set("phone")(e.target.value)} placeholder="519-555-0100" /></div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button disabled={!form.name || saving} onClick={async () => { setSaving(true); await onSave(form); setSaving(false); }} style={{ ...btnS("#1565c0"), opacity: !form.name || saving ? 0.5 : 1 }}>
            {saving ? "Saving…" : "Save Contact"}
          </button>
          <button onClick={onClose} style={btnS("#6b7280")}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const btnS = (bg: string): React.CSSProperties => ({ background: bg, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" });
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 };
const inp: React.CSSProperties = { width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" as const };
const th: React.CSSProperties = { padding: "10px 14px", textAlign: "left" as const, fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" as const, letterSpacing: 0.4, whiteSpace: "nowrap" as const };
const td: React.CSSProperties = { padding: "11px 14px", fontSize: 13, color: "#374151", verticalAlign: "middle" as const };
