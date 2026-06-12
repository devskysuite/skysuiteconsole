import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDocs, onSnapshot, updateDoc } from "firebase/firestore";
import { db, auth } from "../firebase";
import { useIsAdmin } from "../hooks/useIsAdmin";
import QuotePricingTab, { migratePricing, PricingData } from "./QuotePricingTab";
import QuoteSummaryTab from "./QuoteSummaryTab";
import QuoteOverviewTab from "./QuoteOverviewTab";
import QuoteScopeTab from "./QuoteScopeTab";

// ── Constants ──────────────────────────────────────────────────────────────────
const DEPARTMENTS = ["Automation and Controls","Electrical","Panel Build","Programming","Bucket Truck","Service"];
const JOB_TYPES   = ["Service","Project","Quote","Emergency","Warranty"];
const STATUSES    = ["Draft","Ready","Sent To Customer","Accepted","Rejected","Expired"];
const REVIEW_STATUSES = ["No Review Needed","Pending Review","Approved"];

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  "Draft":             { bg: "#f3f4f6", color: "#374151" },
  "Ready":             { bg: "#dbeafe", color: "#1e40af" },
  "Sent To Customer":  { bg: "#fef3c7", color: "#92400e" },
  "Accepted":          { bg: "#dcfce7", color: "#166534" },
  "Rejected":          { bg: "#fee2e2", color: "#991b1b" },
  "Expired":           { bg: "#f3f4f6", color: "#9ca3af" },
};

interface Quote {
  id?: string;
  quoteNumber: string;
  title: string;
  issueDescription?: string;
  versionTitle?: string;
  version?: number;
  status: string;
  reviewStatus?: string;
  projectManager?: string;
  accountManager?: string;
  soldBy?: string;
  department?: string;
  customerPONumber?: string;
  pricebook?: string;
  quoteDueBy?: string;
  expiration?: number;
  jobType?: string;
  internalNotes?: string;
  customerId?: string;
  customerName?: string;
  propertyId?: string;
  propertyName?: string;
  propertyAddress?: string;
  billingCustomer?: string;
  billingAddress?: string;
  propertyRepresentative?: string;
  companyRepresentative?: string;
  companyRepPhone?: string;
  companyRepEmail?: string;
  tags?: string[];
  createdAt?: string;
  createdBy?: string;
  emailsSent?: number;
  emailsDelivered?: number;
  quotesRead?: number;
  emailsBounced?: number;
}

const ALL_TABS = ["Info", "Overview", "Summary", "Scope of Work", "Recommendations", "Forms & Attachments", "Email History", "Activity"] as const;
type Tab = typeof ALL_TABS[number];

// ── Styles ─────────────────────────────────────────────────────────────────────
const lbl: React.CSSProperties = { display:"block", fontSize:11, fontWeight:700, color:"#6b7280", textTransform:"uppercase", letterSpacing:0.5, marginBottom:4 };
const inp: React.CSSProperties = { width:"100%", padding:"8px 12px", border:"1px solid #d1d5db", borderRadius:7, fontSize:13, boxSizing:"border-box" as const };
const sideHd: React.CSSProperties = { fontSize:10, fontWeight:700, color:"#6b7280", textTransform:"uppercase", letterSpacing:0.6, marginBottom:6 };

export default function QuoteDetailPage() {
  const { quoteId } = useParams<{ quoteId: string }>();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();

  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("Info");
  const [users, setUsers] = useState<string[]>([]);
  const [pricebooks, setPricebooks] = useState<{ id: string; name: string }[]>([]);
  const [propContacts, setPropContacts] = useState<{ id: string; name: string; phone?: string; email?: string }[]>([]);
  const [authorizedContacts, setAuthorizedContacts] = useState<{ id: string; name: string; phone?: string; email?: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<Quote>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!quoteId) return;
    return onSnapshot(doc(db, "quotes", quoteId), snap => {
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() } as Quote;
        setQuote(data);
        setForm(data);
      }
      setLoading(false);
    });
  }, [quoteId]);

  useEffect(() => {
    getDocs(collection(db, "users")).then(snap => {
      setUsers(snap.docs.map(d => d.data().displayName as string).filter(Boolean).sort());
    });
    getDocs(collection(db, "pricebooks")).then(snap => {
      setPricebooks(snap.docs.map(d => ({ id: d.id, name: d.data().name as string })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!quote?.propertyId) return;
    getDocs(collection(db, "properties", quote.propertyId, "contacts")).then(snap => {
      setPropContacts(snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, name: data.name as string, phone: data.mobilePhone as string, email: data.email as string };
      }));
    });

    async function loadAuth() {
      const all: typeof authorizedContacts = [];
      const pSnap = await getDocs(collection(db, "properties", quote!.propertyId!, "contacts"));
      pSnap.docs.forEach(d => {
        const data = d.data();
        if (data.authorized) all.push({ id: d.id, name: data.name as string, phone: (data.mobilePhone || data.phone) as string, email: data.email as string });
      });
      if (quote?.customerId) {
        const cSnap = await getDocs(collection(db, "customers", quote.customerId, "contacts"));
        cSnap.docs.forEach(d => {
          const data = d.data();
          all.push({ id: d.id, name: data.name as string, phone: (data.mobilePhone || data.phone) as string, email: data.email as string });
        });
      }
      setAuthorizedContacts(all);
    }
    loadAuth();
  }, [quote?.propertyId, quote?.customerId]);

  const set = <K extends keyof Quote>(k: K) => (v: Quote[K]) => {
    setForm(f => ({ ...f, [k]: v }));
    setDirty(true);
  };

  async function save() {
    if (!quoteId) return;
    setSaving(true);
    await updateDoc(doc(db, "quotes", quoteId), form as Record<string, unknown>);
    setSaving(false);
    setDirty(false);
  }

  async function changeStatus(s: string) {
    if (!quoteId) return;
    await updateDoc(doc(db, "quotes", quoteId), { status: s });
  }

  function handleCompanyRepChange(name: string) {
    const c = authorizedContacts.find(a => a.name === name);
    setForm(f => ({ ...f, companyRepresentative: name, companyRepPhone: c?.phone || "", companyRepEmail: c?.email || "" }));
    setDirty(true);
  }

  if (loading) return <div style={{ padding:80, textAlign:"center", color:"#9ca3af" }}>Loading…</div>;
  if (!quote) return (
    <div style={{ padding:80, textAlign:"center" }}>
      <div style={{ fontSize:48, marginBottom:12 }}>📄</div>
      <div style={{ color:"#374151", fontWeight:700, fontSize:18, marginBottom:8 }}>Quote not found</div>
      <button onClick={() => navigate(-1)} style={{ background:"#1565c0", color:"#fff", border:"none", borderRadius:8, padding:"8px 18px", fontSize:13, fontWeight:600, cursor:"pointer" }}>← Go Back</button>
    </div>
  );

  const sc = STATUS_COLORS[quote.status] || STATUS_COLORS["Draft"];

  return (
    <div style={{ background:"#f0f2f5", minHeight:"100vh" }}>

      {/* Breadcrumb */}
      <div style={{ padding:"10px 24px", borderBottom:"1px solid #e5e7eb", background:"#fff", fontSize:13, color:"#6b7280", display:"flex", alignItems:"center", gap:6 }}>
        {quote.customerId
          ? <Link to={`/customers/${quote.customerId}`} style={{ color:"#1565c0", textDecoration:"none", fontWeight:500 }}>{quote.customerName}</Link>
          : <span>{quote.customerName}</span>}
        <span>/</span>
        {quote.propertyId
          ? <Link to={`/properties/${quote.propertyId}`} style={{ color:"#1565c0", textDecoration:"none", fontWeight:500 }}>{quote.propertyName}</Link>
          : <span>{quote.propertyName}</span>}
        <span>/</span>
        <span>Quote {quote.quoteNumber}</span>
      </div>

      {/* Top bar */}
      <div style={{ background:"#fff", borderBottom:"1px solid #e5e7eb", padding:"12px 24px" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap", marginBottom:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
            <span style={{ fontSize:18, fontWeight:800, color:"#0d2e5e", whiteSpace:"nowrap" }}>
              Quote: {quote.quoteNumber}
            </span>
            <span style={{ fontSize:14, color:"#374151", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              — {quote.title}
            </span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
            {/* Status badge + dropdown */}
            <div style={{ position:"relative" as const }}>
              <select
                value={quote.status}
                onChange={e => changeStatus(e.target.value)}
                style={{ background: sc.bg, color: sc.color, border:"none", borderRadius:99, padding:"4px 10px", fontSize:12, fontWeight:700, cursor:"pointer", appearance:"auto" }}
              >
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <select
              value={form.reviewStatus || "No Review Needed"}
              onChange={e => { set("reviewStatus")(e.target.value); }}
              style={{ border:"1px solid #d1d5db", borderRadius:7, padding:"5px 10px", fontSize:12, color:"#374151", cursor:"pointer" }}
            >
              {REVIEW_STATUSES.map(r => <option key={r}>{r}</option>)}
            </select>
            <span style={{ background:"#eff6ff", color:"#1565c0", fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:6, whiteSpace:"nowrap" as const }}>
              Version {quote.version || 1} · Primary
            </span>
            <a
              href={`/quotes/${quoteId}/print`}
              target="_blank"
              rel="noreferrer"
              style={{ background:"#1e7d3a", color:"#fff", textDecoration:"none", borderRadius:7, padding:"6px 14px", fontSize:13, fontWeight:700, display:"flex", alignItems:"center", gap:6, whiteSpace:"nowrap" as const }}
            >
              🖨 Generate PDF
            </a>
            {dirty && (
              <button onClick={save} disabled={saving} style={{ background:"#1565c0", color:"#fff", border:"none", borderRadius:7, padding:"6px 16px", fontSize:13, fontWeight:700, cursor:"pointer", opacity:saving?0.6:1 }}>
                {saving ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </div>

        {/* Email status strip */}
        <div style={{ fontSize:12, color:"#6b7280", display:"flex", gap:12 }}>
          <span>Email Status:</span>
          <span>{quote.emailsSent ?? 0} Sent</span>
          <span>|</span>
          <span>{quote.emailsDelivered ?? 0} Delivered</span>
          <span>|</span>
          <span>{quote.quotesRead ?? 0} Quote Read</span>
          <span>|</span>
          <span style={{ color:(quote.emailsBounced||0) > 0 ? "#dc2626" : "#6b7280", fontWeight:(quote.emailsBounced||0)>0?700:400 }}>
            {quote.emailsBounced ?? 0} Bounced
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:"#fff", borderBottom:"2px solid #e5e7eb", display:"flex", overflowX:"auto", padding:"0 24px" }}>
        {ALL_TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding:"11px 16px", fontWeight:600, fontSize:13, cursor:"pointer",
            background:"none", border:"none",
            borderBottom: tab===t ? "2px solid #1565c0" : "2px solid transparent",
            color: tab===t ? "#1565c0" : "#6b7280",
            marginBottom:-2, whiteSpace:"nowrap",
          }}>{t}</button>
        ))}
      </div>

      {/* Body */}
      {tab === "Info" && (
        <div style={{ display:"flex", alignItems:"flex-start", gap:0, padding:24 }}>

          {/* Left — form */}
          <div style={{ flex:1, minWidth:0, background:"#fff", borderRadius:12, border:"1px solid #e5e7eb", padding:24 }}>
            <div style={{ display:"flex", flexDirection:"column", gap:18 }}>

              <div>
                <label style={lbl}>Quote Title</label>
                <input style={inp} value={form.title||""} onChange={e=>set("title")(e.target.value)} />
              </div>

              <div>
                <label style={lbl}>Issue Description</label>
                <textarea rows={4} style={{ ...inp, resize:"vertical", fontFamily:"inherit" }} value={form.issueDescription||""} onChange={e=>set("issueDescription")(e.target.value)} placeholder="Enter the issue that needs to be addressed." />
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                <div>
                  <label style={lbl}>Version Title</label>
                  <input style={inp} value={form.versionTitle||""} onChange={e=>set("versionTitle")(e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Project Manager</label>
                  <select style={inp} value={form.projectManager||""} onChange={e=>set("projectManager")(e.target.value)}>
                    <option value="">— Select —</option>
                    {users.map(u=><option key={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Account Manager</label>
                  <select style={inp} value={form.accountManager||""} onChange={e=>set("accountManager")(e.target.value)}>
                    <option value="">— Select —</option>
                    {users.map(u=><option key={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Sold By</label>
                  <select style={inp} value={form.soldBy||""} onChange={e=>set("soldBy")(e.target.value)}>
                    <option value="">— Select —</option>
                    {users.map(u=><option key={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Department <span style={{ color:"#dc2626" }}>*</span></label>
                  <select style={inp} value={form.department||""} onChange={e=>set("department")(e.target.value)}>
                    <option value="">— Select —</option>
                    {DEPARTMENTS.map(d=><option key={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Customer PO Number</label>
                  <input style={inp} value={form.customerPONumber||""} onChange={e=>set("customerPONumber")(e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Pricebook <span style={{ color:"#dc2626" }}>*</span></label>
                  <select style={inp} value={form.pricebook||""} onChange={e=>set("pricebook")(e.target.value)}>
                    <option value="">— Select —</option>
                    {pricebooks.map(p=><option key={p.id} value={p.name}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Status</label>
                  <select style={inp} value={form.status||"Draft"} onChange={e=>set("status")(e.target.value)}>
                    {STATUSES.map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Quote Due By <span style={{ color:"#dc2626" }}>*</span></label>
                  <input type="date" style={inp} value={form.quoteDueBy||""} onChange={e=>set("quoteDueBy")(e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Expiration (Days After Receiving) <span style={{ color:"#dc2626" }}>*</span></label>
                  <input type="number" style={inp} min={1} value={form.expiration||30} onChange={e=>set("expiration")(Number(e.target.value))} />
                </div>
                <div>
                  <label style={lbl}>Job Type</label>
                  <select style={inp} value={form.jobType||""} onChange={e=>set("jobType")(e.target.value)}>
                    <option value="">— Select —</option>
                    {JOB_TYPES.map(j=><option key={j}>{j}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label style={lbl}>Internal Notes</label>
                <textarea rows={4} style={{ ...inp, resize:"vertical", fontFamily:"inherit" }} value={form.internalNotes||""} onChange={e=>set("internalNotes")(e.target.value)} placeholder="Enter notes for your team." />
              </div>

              {dirty && (
                <div style={{ display:"flex", gap:10 }}>
                  <button onClick={save} disabled={saving} style={{ background:"#1565c0", color:"#fff", border:"none", borderRadius:8, padding:"9px 22px", fontSize:14, fontWeight:700, cursor:"pointer", opacity:saving?0.6:1 }}>
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                  <button onClick={() => { setForm(quote); setDirty(false); }} style={{ background:"#6b7280", color:"#fff", border:"none", borderRadius:8, padding:"9px 18px", fontSize:14, fontWeight:600, cursor:"pointer" }}>
                    Discard
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right sidebar */}
          <div style={{ width:260, flexShrink:0, marginLeft:20, display:"flex", flexDirection:"column", gap:16 }}>

            {/* Property */}
            <SideCard>
              <div style={sideHd}>PROPERTY</div>
              {quote.propertyId
                ? <Link to={`/properties/${quote.propertyId}`} style={{ fontSize:14, fontWeight:600, color:"#1565c0", textDecoration:"none" }}>{quote.propertyName}</Link>
                : <div style={{ fontSize:14, fontWeight:600, color:"#374151" }}>{quote.propertyName}</div>}
              {quote.propertyAddress && <div style={{ fontSize:12, color:"#6b7280", marginTop:4, lineHeight:1.5 }}>{quote.propertyAddress}</div>}
            </SideCard>

            {/* Billing Customer */}
            <SideCard>
              <div style={sideHd}>BILLING CUSTOMER</div>
              <div style={{ fontSize:14, fontWeight:600, color:"#374151" }}>{quote.billingCustomer || quote.customerName}</div>
              {quote.billingAddress && (
                <div style={{ fontSize:12, color:"#6b7280", marginTop:4, lineHeight:1.5 }}>
                  Bill To: {quote.billingCustomer || quote.customerName}<br/>
                  {quote.billingAddress}
                </div>
              )}
            </SideCard>

            {/* Customer */}
            <SideCard>
              <div style={sideHd}>CUSTOMER</div>
              {quote.customerId
                ? <Link to={`/customers/${quote.customerId}`} style={{ fontSize:14, fontWeight:600, color:"#1565c0", textDecoration:"none" }}>{quote.customerName}</Link>
                : <div style={{ fontSize:14, fontWeight:600, color:"#374151" }}>{quote.customerName}</div>}
            </SideCard>

            {/* Property Representative */}
            <SideCard>
              <div style={sideHd}>PROPERTY REPRESENTATIVE</div>
              <select
                style={{ ...inp, fontSize:12 }}
                value={form.propertyRepresentative||""}
                onChange={e=>{set("propertyRepresentative")(e.target.value);}}
              >
                <option value=""></option>
                {propContacts.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </SideCard>

            {/* Company Representative */}
            <SideCard>
              <div style={sideHd}>COMPANY REPRESENTATIVE / ORDERED BY</div>
              <select
                style={{ ...inp, fontSize:12 }}
                value={form.companyRepresentative||""}
                onChange={e=>handleCompanyRepChange(e.target.value)}
              >
                <option value=""></option>
                {authorizedContacts.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              {(form.companyRepPhone || form.companyRepEmail) && (
                <div style={{ marginTop:6, fontSize:12, color:"#6b7280", lineHeight:1.6 }}>
                  {form.companyRepPhone && <div>{form.companyRepPhone}</div>}
                  {form.companyRepEmail && <div>{form.companyRepEmail}</div>}
                </div>
              )}
            </SideCard>
          </div>
        </div>
      )}

      {tab === "Overview" && (
        <QuoteOverviewTab
          quoteId={quoteId!}
          pricing={migratePricing((quote as any).pricing)}
        />
      )}

      {tab === "Summary" && (
        <div style={{ padding:24 }}>
          <QuoteSummaryTab
            pricing={migratePricing((quote as any).pricing)}
          />
        </div>
      )}

      {tab === "Scope of Work" && (
        <QuoteScopeTab
          quoteId={quoteId!}
          pricing={migratePricing((quote as any).pricing)}
        />
      )}

      {tab !== "Info" && tab !== "Overview" && tab !== "Summary" && tab !== "Scope of Work" && (
        <div style={{ margin:24, background:"#fff", borderRadius:12, border:"1px solid #e5e7eb", padding:"60px 24px", textAlign:"center", color:"#9ca3af", fontSize:14 }}>
          {tab} — coming soon
        </div>
      )}
    </div>
  );
}

function SideCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background:"#fff", borderRadius:10, border:"1px solid #e5e7eb", padding:"14px 16px" }}>
      {children}
    </div>
  );
}
