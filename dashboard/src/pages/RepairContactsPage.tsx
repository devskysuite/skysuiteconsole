import { useEffect, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import { useCategories } from "../hooks/useCategories";
import { useToast } from "../components/Toast";
import Spinner from "../components/Spinner";
import { CONTACT_TYPES, type RepairContact, type ContactType } from "../hooks/useRepairContacts";

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

const DEFAULT_CONTACT = {
  header:     "Lift Repair Contact",
  company:    "Keegan",
  contact:    "Craig",
  phone:      "905-869-5438",
  address:    "",
  categories: [] as string[],
  order:      0,
};

/** Toggle a value in/out of a string array. */
function toggleItem(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
}

/** Collapsible category picker — defined outside parent so open state survives re-renders. */
function CategoryPicker({
  categories, selected, onChange,
}: { categories: string[]; selected: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false);
  if (categories.length === 0) return null;
  return (
    <div style={{ gridColumn: "1 / -1", marginTop: 14 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={styles.pickerToggle}
      >
        <span style={{ fontWeight: 700, fontSize: 13, color: "#333" }}>Categories</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {selected.length === 0 ? (
            <span style={{ fontSize: 12, color: "#aaa" }}>All equipment</span>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" }}>
              {selected.map((cat) => (
                <span key={cat} style={styles.catChip}>{cat}</span>
              ))}
            </div>
          )}
          <span style={{ fontSize: 11, color: "#999", transform: open ? "rotate(180deg)" : "none", display: "inline-block", transition: "transform 0.15s" }}>▼</span>
        </div>
      </button>
      {open && (
        <div style={styles.pickerPanel}>
          <p style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>Check the categories this contact should appear for. Leave all unchecked to show for every equipment type.</p>
          <div style={styles.checkboxRow}>
            {categories.map((cat) => (
              <label key={cat} style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={selected.includes(cat)}
                  onChange={() => onChange(toggleItem(selected, cat))}
                  style={{ marginRight: 5, accentColor: "#1e7d3a" }}
                />
                {cat}
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])} style={styles.clearBtn}>
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}


export default function RepairContactsPage() {
  const { confirm } = useToast();
  const categories = useCategories();

  const [contacts, setContacts] = useState<RepairContact[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [saving, setSaving]     = useState(false);

  // Add form
  const [addHeader,     setAddHeader]     = useState("");
  const [addCompany,    setAddCompany]    = useState("");
  const [addContact,    setAddContact]    = useState("");
  const [addPhone,      setAddPhone]      = useState("");
  const [addAddress,    setAddAddress]    = useState("");
  const [addNotes,      setAddNotes]      = useState("");
  const [addType,       setAddType]       = useState<ContactType>("Equipment Repair");
  const [addCategories, setAddCategories] = useState<string[]>([]);

  // Edit form
  const [editingId,      setEditingId]      = useState<string | null>(null);
  const [editHeader,     setEditHeader]     = useState("");
  const [editCompany,    setEditCompany]    = useState("");
  const [editContact,    setEditContact]    = useState("");
  const [editPhone,      setEditPhone]      = useState("");
  const [editAddress,    setEditAddress]    = useState("");
  const [editNotes,      setEditNotes]      = useState("");
  const [editType,       setEditType]       = useState<ContactType>("Equipment Repair");
  const [editCategories, setEditCategories] = useState<string[]>([]);

  async function load() {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "repairContacts"));
      if (snap.empty) {
        await addDoc(collection(db, "repairContacts"), {
          ...DEFAULT_CONTACT,
          createdAt: serverTimestamp(),
          createdByUid: auth.currentUser?.uid ?? "",
        });
        const seeded = await getDocs(collection(db, "repairContacts"));
        setContacts(seeded.docs.map((d) => ({ id: d.id, ...d.data() } as RepairContact)));
      } else {
        setContacts(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as RepairContact))
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        );
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function addNewContact() {
    if (!addHeader.trim()) { setError("Header is required."); return; }
    setSaving(true); setError("");
    try {
      await addDoc(collection(db, "repairContacts"), {
        header:      addHeader.trim(),
        company:     addCompany.trim(),
        contact:     addContact.trim(),
        phone:       addPhone.trim(),
        address:     addAddress.trim(),
        notes:       addNotes.trim(),
        contactType: addType,
        categories:  addCategories,
        order:       contacts.length,
        createdAt:   serverTimestamp(),
        createdByUid: auth.currentUser?.uid ?? "",
      });
      setAddHeader(""); setAddCompany(""); setAddContact("");
      setAddPhone(""); setAddAddress(""); setAddNotes("");
      setAddType("Equipment Repair"); setAddCategories([]);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Failed to add contact");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(c: RepairContact) {
    setEditingId(c.id);
    setEditHeader(c.header);
    setEditCompany(c.company ?? "");
    setEditContact(c.contact ?? "");
    setEditPhone(c.phone ?? "");
    setEditAddress(c.address ?? "");
    setEditNotes(c.notes ?? "");
    setEditType(c.contactType ?? "Equipment Repair");
    setEditCategories(c.categories ?? []);
    setError("");
  }

  async function saveEdit(id: string) {
    if (!editHeader.trim()) { setError("Header is required."); return; }
    setSaving(true); setError("");
    try {
      await updateDoc(doc(db, "repairContacts", id), {
        header:      editHeader.trim(),
        company:     editCompany.trim(),
        contact:     editContact.trim(),
        phone:       editPhone.trim(),
        address:     editAddress.trim(),
        notes:       editNotes.trim(),
        contactType: editType,
        categories:  editCategories,
      });
      setEditingId(null);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save contact");
    } finally {
      setSaving(false);
    }
  }

  async function deleteContact(id: string, header: string) {
    if (!await confirm(`Delete "${header}"?`)) return;
    try {
      await deleteDoc(doc(db, "repairContacts", id));
      setContacts((prev) => prev.filter((c) => c.id !== id));
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete contact");
    }
  }

  return (
    <div>
      <h1 style={styles.pageTitle}>Manage Contacts</h1>

      {/* ── Add Contact ── */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>Add Contact</h2>
        <div style={styles.formGrid}>
          <div>
            <label style={styles.label}>Header *</label>
            <input style={styles.input} value={addHeader}  onChange={(e) => setAddHeader(e.target.value)}  placeholder="e.g. Lift Repair Contact" />
          </div>
          <div>
            <label style={styles.label}>Type *</label>
            <select style={styles.input} value={addType} onChange={(e) => setAddType(e.target.value as ContactType)}>
              {CONTACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={styles.label}>Company</label>
            <input style={styles.input} value={addCompany} onChange={(e) => setAddCompany(e.target.value)} placeholder="e.g. Keegan" />
          </div>
          <div>
            <label style={styles.label}>Contact Person</label>
            <input style={styles.input} value={addContact} onChange={(e) => setAddContact(e.target.value)} placeholder="e.g. Craig" />
          </div>
          <div>
            <label style={styles.label}>Phone</label>
            <input style={styles.input} value={addPhone}   onChange={(e) => setAddPhone(e.target.value)}   placeholder="e.g. 905-869-5438" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={styles.label}>Address</label>
            <input style={styles.input} value={addAddress} onChange={(e) => setAddAddress(e.target.value)} placeholder="e.g. 123 Industrial Rd, Hamilton, ON" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={styles.label}>Notes</label>
            <textarea style={{ ...styles.input, minHeight: 60, resize: "vertical" as const }} value={addNotes} onChange={(e) => setAddNotes(e.target.value)} placeholder="Optional notes about this contact" />
          </div>
          <CategoryPicker categories={categories} selected={addCategories} onChange={setAddCategories} />
        </div>
        {error && <p style={styles.error}>{error}</p>}
        <button
          style={{ ...styles.btn, marginTop: 16 }}
          onClick={addNewContact}
          disabled={saving || !addHeader.trim()}
        >
          {saving ? "Adding…" : "+ Add Contact"}
        </button>
      </div>

      {/* ── Contact List ── */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>
          All Contacts
          {!loading && <span style={styles.countBadge}>{contacts.length}</span>}
        </h2>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>
        ) : contacts.length === 0 ? (
          <p style={{ color: "#aaa", fontSize: 14 }}>No contacts yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {contacts.map((c) => (
              <div key={c.id} style={styles.contactCard}>
                {editingId === c.id ? (
                  /* Edit mode */
                  <>
                    <div style={styles.formGrid}>
                      <div>
                        <label style={styles.label}>Header *</label>
                        <input style={styles.input} value={editHeader}  onChange={(e) => setEditHeader(e.target.value)} />
                      </div>
                      <div>
                        <label style={styles.label}>Type *</label>
                        <select style={styles.input} value={editType} onChange={(e) => setEditType(e.target.value as ContactType)}>
                          {CONTACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={styles.label}>Company</label>
                        <input style={styles.input} value={editCompany} onChange={(e) => setEditCompany(e.target.value)} />
                      </div>
                      <div>
                        <label style={styles.label}>Contact Person</label>
                        <input style={styles.input} value={editContact} onChange={(e) => setEditContact(e.target.value)} />
                      </div>
                      <div>
                        <label style={styles.label}>Phone</label>
                        <input style={styles.input} value={editPhone}   onChange={(e) => setEditPhone(e.target.value)} />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <label style={styles.label}>Address</label>
                        <input style={styles.input} value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="e.g. 123 Industrial Rd, Hamilton, ON" />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <label style={styles.label}>Notes</label>
                        <textarea style={{ ...styles.input, minHeight: 60, resize: "vertical" as const }} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Optional notes about this contact" />
                      </div>
                      <CategoryPicker categories={categories} selected={editCategories} onChange={setEditCategories} />
                    </div>
                    {error && <p style={styles.error}>{error}</p>}
                    <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                      <button style={styles.btn}        onClick={() => saveEdit(c.id)} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                      <button style={styles.btnOutline} onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  /* View mode */
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <p style={{ fontWeight: 800, fontSize: 14, color: "#111", margin: 0 }}>{c.header}</p>
                        <span style={styles.typeBadge}>{c.contactType ?? "Equipment Repair"}</span>
                      </div>
                      {c.company && <p style={styles.contactField}><strong>Company:</strong> {c.company}</p>}
                      {c.contact && <p style={styles.contactField}><strong>Contact:</strong> {c.contact}</p>}
                      {c.phone   && <p style={styles.contactField}><strong>Phone:</strong> {c.phone}</p>}
                      {c.address && (
                        <div style={{ margin: "3px 0" }}>
                          <p style={{ ...styles.contactField, margin: 0 }}><strong>Address:</strong> {c.address}</p>
                          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                            {isIOS && <a href={`https://maps.apple.com/?q=${encodeURIComponent(c.address)}`} target="_blank" rel="noreferrer" style={styles.mapLink}>Apple Maps</a>}
                            <a href={`https://maps.google.com/?q=${encodeURIComponent(c.address)}`} target="_blank" rel="noreferrer" style={styles.mapLink}>Google Maps</a>
                          </div>
                        </div>
                      )}
                      {(c.contactType ?? "Equipment Repair") === "Equipment Repair" && (
                        <>
                          {c.categories && c.categories.length > 0 ? (
                            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 5 }}>
                              {c.categories.map((cat) => (
                                <span key={cat} style={styles.catChip}>{cat}</span>
                              ))}
                            </div>
                          ) : (
                            <p style={{ fontSize: 12, color: "#aaa", marginTop: 6 }}>Shows for all equipment categories</p>
                          )}
                        </>
                      )}
                      {c.notes && (
                        <p style={{ fontSize: 13, color: "#555", marginTop: 8 }}><strong>Notes:</strong> {c.notes}</p>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <button style={styles.editBtn}   onClick={() => startEdit(c)}>✏ Edit</button>
                      <button style={styles.deleteBtn} onClick={() => deleteContact(c.id, c.header)}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageTitle:    { fontSize: 28, fontWeight: 900, color: "#1e7d3a", marginBottom: 24 },
  card:         { background: "#fff", borderRadius: 12, padding: 24, marginBottom: 20, boxShadow: "0 1px 6px rgba(0,0,0,0.06)", border: "1px solid #e5e5e5", maxWidth: 680 },
  sectionTitle: { fontSize: 16, fontWeight: 800, color: "#111", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 },
  formGrid:     { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" },
  label:        { display: "block", fontSize: 13, fontWeight: 700, color: "#333", marginTop: 12, marginBottom: 4 },
  input:        { width: "100%", border: "1px solid #ddd", borderRadius: 8, padding: "9px 12px", fontSize: 14, boxSizing: "border-box" as const },
  btn:          { background: "#1e7d3a", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  btnOutline:   { background: "#fff", color: "#1e7d3a", border: "1px solid #1e7d3a", borderRadius: 8, padding: "9px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  error:        { color: "#d32f2f", fontSize: 13, marginTop: 10 },
  contactCard:  { background: "#f8f9fa", borderRadius: 10, padding: "14px 16px", border: "1px solid #e5e5e5" },
  contactField: { fontSize: 13, color: "#555", margin: "3px 0" },
  editBtn:      { background: "none", border: "1px solid #ccc", borderRadius: 6, padding: "4px 12px", fontSize: 12, color: "#555", cursor: "pointer" },
  deleteBtn:    { background: "none", border: "1px solid #e53e3e", color: "#e53e3e", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  countBadge:   { background: "#eef2f7", color: "#1e7d3a", border: "1px solid #c5d3e8", borderRadius: 6, padding: "2px 8px", fontSize: 13 },
  checkboxRow:   { display: "flex", flexWrap: "wrap", gap: "8px 20px" },
  checkboxLabel: { display: "flex", alignItems: "center", fontSize: 13, color: "#333", cursor: "pointer", userSelect: "none" as const },
  catChip:       { background: "#eef2f7", color: "#1e7d3a", border: "1px solid #c5d3e8", borderRadius: 12, padding: "2px 10px", fontSize: 12, fontWeight: 600 },
  pickerToggle:  { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f8f9fa", border: "1px solid #e0e0e0", borderRadius: 8, padding: "9px 14px", cursor: "pointer", textAlign: "left" as const, gap: 12 },
  pickerPanel:   { background: "#f8f9fa", border: "1px solid #e0e0e0", borderTop: "none", borderRadius: "0 0 8px 8px", padding: "14px 14px 12px" },
  clearBtn:      { marginTop: 12, background: "none", border: "none", color: "#888", fontSize: 12, cursor: "pointer", padding: 0, textDecoration: "underline" },
  mapLink:       { fontSize: 12, color: "#1e7d3a", textDecoration: "none", fontWeight: 600, background: "#eef2f7", border: "1px solid #c5d3e8", borderRadius: 6, padding: "2px 8px" },
  typeBadge:     { fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: "#f0f4ff", color: "#336", border: "1px solid #c5d3e8" },
};
