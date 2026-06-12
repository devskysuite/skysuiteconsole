import { useEffect, useState } from "react";
import { addDoc, collection, getDocs, getDoc, query, runTransaction, doc, where } from "firebase/firestore";
import { db, auth } from "../firebase";

function resolveDefaultPricebook(books: { name: string; year?: number | null; isDefault?: boolean }[]): string {
  const cy = new Date().getFullYear();
  return (books.find(b => b.year === cy) || books.find(b => b.isDefault) || books[0])?.name || "";
}

// ── Constants ──────────────────────────────────────────────────────────────────
const DEPARTMENTS = ["Automation and Controls","Electrical","Panel Build","Programming","Bucket Truck","Service"];
const JOB_TYPES   = ["Service","Project","Quote","Emergency","Warranty"];
const STATUSES    = ["Draft","Ready","Sent To Customer","Accepted","Rejected","Expired"];

interface QuoteForm {
  title: string;
  issueDescription: string;
  versionTitle: string;
  projectManager: string;
  accountManager: string;
  soldBy: string;
  department: string;
  customerPONumber: string;
  pricebook: string;
  quoteDueBy: string;
  expiration: number;
  jobType: string;
  internalNotes: string;
  status: string;
  propertyRepresentative: string;
  companyRepresentative: string;
  companyRepPhone: string;
  companyRepEmail: string;
}

interface Props {
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  customerId?: string;
  customerName: string;
  billingCustomer?: string;
  billingAddress?: string;
  onClose: () => void;
  onCreated: (quoteId: string, quoteNumber: string) => void;
}

export default function CreateQuoteModal({
  propertyId, propertyName, propertyAddress,
  customerId, customerName, billingCustomer, billingAddress,
  onClose, onCreated,
}: Props) {
  const blank: QuoteForm = {
    title: "", issueDescription: "", versionTitle: "",
    projectManager: "", accountManager: "", soldBy: "",
    department: "", customerPONumber: "",
    pricebook: "", quoteDueBy: "",
    expiration: 30, jobType: "", internalNotes: "",
    status: "Draft",
    propertyRepresentative: "", companyRepresentative: "",
    companyRepPhone: "", companyRepEmail: "",
  };

  const [form, setForm] = useState<QuoteForm>(blank);
  const [users, setUsers] = useState<string[]>([]);
  const [pricebooks, setPricebooks] = useState<{ id: string; name: string }[]>([]);
  const [propContacts, setPropContacts] = useState<{ id: string; name: string; phone?: string; email?: string }[]>([]);
  const [authorizedContacts, setAuthorizedContacts] = useState<{ id: string; name: string; phone?: string; email?: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const set = <K extends keyof QuoteForm>(k: K) => (v: QuoteForm[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    // Load users for PM / Sold By
    getDocs(collection(db, "users")).then(snap => {
      const names = snap.docs.map(d => d.data().displayName as string).filter(Boolean).sort();
      setUsers(names);
    });

    // Load pricebooks, then resolve customer's pricebook or current-year default
    getDocs(collection(db, "pricebooks")).then(async snap => {
      const list = snap.docs.map(d => ({ id: d.id, name: d.data().name as string, year: d.data().year as number | null, isDefault: d.data().isDefault as boolean }));
      setPricebooks(list);
      let customerPricebook = "";
      if (customerId) {
        const cSnap = await getDoc(doc(db, "customers", customerId));
        customerPricebook = (cSnap.data()?.pricebook as string) || "";
      }
      const fallback = resolveDefaultPricebook(list);
      setForm(f => ({ ...f, pricebook: customerPricebook || fallback }));
    }).catch(() => {});

    // Load property contacts (property reps)
    if (propertyId) {
      getDocs(collection(db, "properties", propertyId, "contacts")).then(snap => {
        setPropContacts(snap.docs.map(d => {
          const data = d.data();
          return { id: d.id, name: data.name as string, phone: data.mobilePhone as string, email: data.email as string };
        }));
      });
    }

    // Load authorized contacts from property + customer (company rep)
    async function loadAuthorized() {
      const all: { id: string; name: string; phone?: string; email?: string }[] = [];
      if (propertyId) {
        const snap = await getDocs(collection(db, "properties", propertyId, "contacts"));
        snap.docs.forEach(d => {
          const data = d.data();
          if (data.authorized) all.push({ id: d.id, name: data.name as string, phone: (data.mobilePhone || data.phone) as string, email: data.email as string });
        });
      }
      if (customerId) {
        const snap = await getDocs(collection(db, "customers", customerId, "contacts"));
        snap.docs.forEach(d => {
          const data = d.data();
          all.push({ id: d.id, name: data.name as string, phone: (data.mobilePhone || data.phone) as string, email: data.email as string });
        });
      }
      setAuthorizedContacts(all);
    }
    loadAuthorized();

    // Default sold by / PM to current user
    const name = auth.currentUser?.displayName || "";
    if (name) setForm(f => ({ ...f, soldBy: name, projectManager: name }));
  }, [propertyId, customerId]);

  // When company rep changes, fill phone/email
  function handleCompanyRepChange(name: string) {
    const c = authorizedContacts.find(a => a.name === name);
    setForm(f => ({ ...f, companyRepresentative: name, companyRepPhone: c?.phone || "", companyRepEmail: c?.email || "" }));
  }

  async function generate() {
    const missing: string[] = [];
    if (!form.title.trim()) missing.push("Quote Title");
    if (!form.department) missing.push("Department");
    if (!form.quoteDueBy) missing.push("Quote Due By");
    if (missing.length) { setSaveError(`Required: ${missing.join(", ")}`); return; }
    setSaveError("");
    setSaving(true);
    try {
      const year = new Date().getFullYear().toString().slice(-2);
      let next = 1;
      await runTransaction(db, async tx => {
        const counterRef = doc(db, "counters", "quotes");
        const counterSnap = await tx.get(counterRef);
        next = counterSnap.exists() ? (counterSnap.data().next as number) : 1;
        tx.set(counterRef, { next: next + 1 }, { merge: true });
      });
      const quoteNumber = `Q${year}-${String(next).padStart(4, "0")}`;
      const ref = await addDoc(collection(db, "quotes"), {
        quoteNumber,
        version: 1,
        ...form,
        propertyId,
        propertyName,
        propertyAddress,
        customerId: customerId || "",
        customerName,
        billingCustomer: billingCustomer || customerName,
        billingAddress: billingAddress || "",
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser?.displayName || auth.currentUser?.email || "",
        emailsSent: 0, emailsDelivered: 0, quotesRead: 0, emailsBounced: 0,
        tags: [],
      });
      onCreated(ref.id, quoteNumber);
    } catch (e: any) {
      console.error(e);
      const msg = e?.code === "permission-denied"
        ? "Permission denied — check Firestore rules for the quotes/counters collections."
        : (e?.message || String(e));
      setSaveError(`Failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, width:"100%", maxWidth:760, maxHeight:"92vh", overflowY:"auto", boxShadow:"0 12px 48px rgba(0,0,0,0.25)" }}>

        {/* Header */}
        <div style={{ padding:"20px 28px 0", borderBottom:"1px solid #e5e7eb", paddingBottom:16, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontSize:18, fontWeight:800, color:"#0d2e5e" }}>New Quote</div>
            <div style={{ fontSize:12, color:"#9ca3af", marginTop:2 }}>{propertyName} · {customerName}</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:24, cursor:"pointer", color:"#9ca3af", lineHeight:1 }}>×</button>
        </div>

        <div style={{ display:"flex", gap:0 }}>

          {/* Left — form */}
          <div style={{ flex:1, padding:"20px 28px 28px", minWidth:0 }}>
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

              <Field label="Quote Title" required>
                <input style={inp} value={form.title} onChange={e=>set("title")(e.target.value)} placeholder="e.g. Price to wire Line 1 and Line 3" />
              </Field>

              <Field label="Issue Description">
                <textarea rows={3} style={{ ...inp, resize:"vertical", fontFamily:"inherit" }} value={form.issueDescription} onChange={e=>set("issueDescription")(e.target.value)} placeholder="Enter the issue that needs to be addressed." />
              </Field>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                <Field label="Version Title">
                  <input style={inp} value={form.versionTitle} onChange={e=>set("versionTitle")(e.target.value)} />
                </Field>
                <Field label="Project Manager">
                  <select style={inp} value={form.projectManager} onChange={e=>set("projectManager")(e.target.value)}>
                    <option value="">— Select —</option>
                    {users.map(u=><option key={u}>{u}</option>)}
                  </select>
                </Field>
                <Field label="Account Manager">
                  <select style={inp} value={form.accountManager} onChange={e=>set("accountManager")(e.target.value)}>
                    <option value="">— Select —</option>
                    {users.map(u=><option key={u}>{u}</option>)}
                  </select>
                </Field>
                <Field label="Sold By">
                  <select style={inp} value={form.soldBy} onChange={e=>set("soldBy")(e.target.value)}>
                    <option value="">— Select —</option>
                    {users.map(u=><option key={u}>{u}</option>)}
                  </select>
                </Field>
                <Field label="Department" required>
                  <select style={inp} value={form.department} onChange={e=>set("department")(e.target.value)}>
                    <option value="">— Select —</option>
                    {DEPARTMENTS.map(d=><option key={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="Customer PO Number">
                  <input style={inp} value={form.customerPONumber} onChange={e=>set("customerPONumber")(e.target.value)} />
                </Field>
                <Field label="Pricebook" required>
                  <select style={inp} value={form.pricebook} onChange={e=>set("pricebook")(e.target.value)}>
                    <option value="">— Select —</option>
                    {pricebooks.map(p=><option key={p.id} value={p.name}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select style={inp} value={form.status} onChange={e=>set("status")(e.target.value)}>
                    {STATUSES.map(s=><option key={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Quote Due By" required>
                  <input type="date" style={inp} value={form.quoteDueBy} onChange={e=>set("quoteDueBy")(e.target.value)} />
                </Field>
                <Field label="Expiration (Days After Receiving)" required>
                  <input type="number" style={inp} min={1} value={form.expiration} onChange={e=>set("expiration")(Number(e.target.value))} />
                </Field>
                <Field label="Job Type">
                  <select style={inp} value={form.jobType} onChange={e=>set("jobType")(e.target.value)}>
                    <option value="">— Select —</option>
                    {JOB_TYPES.map(j=><option key={j}>{j}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Internal Notes">
                <textarea rows={3} style={{ ...inp, resize:"vertical", fontFamily:"inherit" }} value={form.internalNotes} onChange={e=>set("internalNotes")(e.target.value)} placeholder="Enter notes for your team." />
              </Field>
            </div>
          </div>

          {/* Right — sidebar */}
          <div style={{ width:240, flexShrink:0, borderLeft:"1px solid #e5e7eb", padding:"20px 20px 28px", display:"flex", flexDirection:"column", gap:18 }}>

            <SideSection label="PROPERTY">
              <div style={{ fontSize:13, fontWeight:600, color:"#1565c0" }}>{propertyName}</div>
              <div style={{ fontSize:12, color:"#6b7280", marginTop:2 }}>{propertyAddress}</div>
            </SideSection>

            <SideSection label="BILLING CUSTOMER">
              <div style={{ fontSize:13, fontWeight:600, color:"#374151" }}>{billingCustomer || customerName}</div>
              {billingAddress && <div style={{ fontSize:12, color:"#6b7280", marginTop:2 }}>{billingAddress}</div>}
            </SideSection>

            <SideSection label="CUSTOMER">
              <div style={{ fontSize:13, fontWeight:600, color:"#1565c0" }}>{customerName}</div>
            </SideSection>

            <SideSection label="PROPERTY REPRESENTATIVE">
              <select style={{ ...inp, fontSize:12 }} value={form.propertyRepresentative} onChange={e=>set("propertyRepresentative")(e.target.value)}>
                <option value="">— Select —</option>
                {propContacts.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </SideSection>

            <SideSection label="COMPANY REPRESENTATIVE / ORDERED BY">
              <select style={{ ...inp, fontSize:12 }} value={form.companyRepresentative} onChange={e=>handleCompanyRepChange(e.target.value)}>
                <option value="">— Select —</option>
                {authorizedContacts.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              {form.companyRepPhone && <div style={{ fontSize:11, color:"#6b7280", marginTop:4 }}>{form.companyRepPhone}</div>}
              {form.companyRepEmail && <div style={{ fontSize:11, color:"#6b7280" }}>{form.companyRepEmail}</div>}
            </SideSection>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding:"14px 28px", borderTop:"1px solid #e5e7eb" }}>
          {saveError && (
            <div style={{ color:"#dc2626", fontSize:12, fontWeight:600, marginBottom:10, background:"#fef2f2", border:"1px solid #fecaca", borderRadius:6, padding:"7px 12px" }}>
              {saveError}
            </div>
          )}
          <div style={{ display:"flex", gap:10 }}>
            <button
              disabled={saving}
              onClick={generate}
              style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:8, padding:"9px 22px", fontSize:14, fontWeight:700, cursor:"pointer", opacity:saving?0.5:1 }}
            >{saving ? "Creating…" : "Create Quote"}</button>
            <button onClick={onClose} style={{ background:"#6b7280", color:"#fff", border:"none", borderRadius:8, padding:"9px 18px", fontSize:14, fontWeight:600, cursor:"pointer" }}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display:"block", fontSize:11, fontWeight:700, color:"#6b7280", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 }}>
        {label}{required && <span style={{ color:"#dc2626", marginLeft:3 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function SideSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", letterSpacing:0.6, marginBottom:6 }}>{label}</div>
      {children}
    </div>
  );
}

const inp: React.CSSProperties = { width:"100%", padding:"8px 10px", border:"1px solid #d1d5db", borderRadius:7, fontSize:13, boxSizing:"border-box" as const, outline:"none" };
