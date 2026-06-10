import { useEffect, useState } from "react";
import { addDoc, collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "../firebase";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PricebookItem { name: string; description: string; unitCost: number; }

interface SelectedItem {
  id: string; name: string; description: string;
  unitCost: number; quantity: number; totalCost: number;
}

interface Props {
  jobId: string; jobNumber: string;
  department?: string; projectManager?: string;
  onClose: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const PO_TYPES     = ["Credit Card order","Inspection","On line order","Petty Cash","Subcontractor","Vendor delivery","Vendor Pickup"];
const VENDOR_TYPES = ["Supplier","Subcontractor","Other"];
const DEPARTMENTS  = ["Service","Electrical","Automation","Industrial","Commercial","HVAC","Maintenance","General","Construction","Other"];
const TAX_RATES    = ["None","GST (5%)","HST ON (13%)","HST BC (12%)","PST (7%)"];

// ── Shared styles ─────────────────────────────────────────────────────────────
const inp: React.CSSProperties  = { width:"100%", padding:"8px 10px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, outline:"none", boxSizing:"border-box" as const, background:"#fff" };
const lbl: React.CSSProperties  = { fontSize:11, fontWeight:700, color:"#6b7280", textTransform:"uppercase" as const, letterSpacing:0.4, marginBottom:4, display:"block" };
const req: React.CSSProperties  = { color:"#ef4444", fontSize:9, fontWeight:700, letterSpacing:0.3, marginLeft:4 };
const sect: React.CSSProperties = { background:"#fff", border:"1px solid #e5e7eb", borderRadius:10, padding:"20px 24px", marginBottom:16 };

function uid() { return Math.random().toString(36).slice(2,10); }
function fmtC(n: number) { return `$${n.toLocaleString("en-CA",{minimumFractionDigits:2,maximumFractionDigits:2})}`; }

// ── Field component ───────────────────────────────────────────────────────────
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={lbl}>{label}{required && <span style={req}>REQUIRED</span>}</label>
      {children}
    </div>
  );
}

// ── Section component ─────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={sect}>
      <div style={{ fontSize:14, fontWeight:800, color:"#111827", marginBottom:16 }}>{title}</div>
      {children}
    </div>
  );
}

// ── Step 1: General Info ──────────────────────────────────────────────────────
function Step1({ form, setForm, employees, vendors }: {
  form: any; setForm: any;
  employees: string[]; vendors: string[];
}) {
  const g2 = { display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 };
  const g4 = { display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:16 };
  const sel = { ...inp, appearance:"auto" as any };

  function set(k: string, v: any) { setForm((f: any) => ({...f, [k]: v})); }

  return (
    <div>
      <Section title="Vendor Info">
        <div style={g2}>
          <Field label="Vendor Type">
            <select style={sel} value={form.vendorType} onChange={e=>set("vendorType",e.target.value)}>
              {VENDOR_TYPES.map(t=><option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Vendor" required>
            <input style={{...inp, borderColor:form.vendorErr?"#ef4444":"#d1d5db"}} list="vendor-list"
              placeholder="Search vendor" value={form.vendor} onChange={e=>{set("vendor",e.target.value);set("vendorErr",false);}} />
            <datalist id="vendor-list">{vendors.map(v=><option key={v} value={v}/>)}</datalist>
            {form.vendorErr && <div style={{color:"#ef4444",fontSize:11,marginTop:2}}>Vendor is required</div>}
          </Field>
        </div>
      </Section>

      <Section title="General Information">
        <div style={{...g4, marginBottom:16}}>
          <Field label="PO Type" required>
            <select style={{...sel, borderColor:form.poTypeErr?"#ef4444":"#d1d5db"}} value={form.poType} onChange={e=>{set("poType",e.target.value);set("poTypeErr",false);}}>
              <option value="">— Select PO Type —</option>
              {PO_TYPES.map(t=><option key={t}>{t}</option>)}
            </select>
            {form.poTypeErr && <div style={{color:"#ef4444",fontSize:11,marginTop:2}}>Required</div>}
          </Field>
          <Field label="PO Date" required>
            <input type="date" style={inp} value={form.poDate} onChange={e=>set("poDate",e.target.value)} />
          </Field>
          <Field label="Assign To">
            <select style={sel} value={form.assignTo} onChange={e=>set("assignTo",e.target.value)}>
              <option value="">— Select Employee —</option>
              {employees.map(n=><option key={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Required By">
            <input type="date" style={inp} value={form.requiredBy} onChange={e=>set("requiredBy",e.target.value)} />
          </Field>
        </div>
        <div style={g2}>
          <Field label="Tags">
            <input style={inp} placeholder="Enter tags" value={form.tags} onChange={e=>set("tags",e.target.value)} />
          </Field>
          <Field label="Description">
            <input style={inp} placeholder="Enter description" value={form.description} onChange={e=>set("description",e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Job / Project Information">
        <div style={g2}>
          <Field label="Job / Project">
            <input style={{...inp, background:"#f9fafb", color:"#6b7280"}} value={form.jobNumber} readOnly />
          </Field>
          <Field label="Department" required>
            <select style={{...sel, borderColor:form.deptErr?"#ef4444":"#d1d5db"}} value={form.department} onChange={e=>{set("department",e.target.value);set("deptErr",false);}}>
              <option value="">— Select —</option>
              {DEPARTMENTS.map(d=><option key={d}>{d}</option>)}
            </select>
            {form.deptErr && <div style={{color:"#ef4444",fontSize:11,marginTop:2}}>Required</div>}
          </Field>
          <Field label="Project Manager">
            <select style={sel} value={form.projectManager} onChange={e=>set("projectManager",e.target.value)}>
              <option value="">— Select —</option>
              {employees.map(n=><option key={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="PO Number">
            <input style={inp} placeholder="e.g. 16226" value={form.poNumber} onChange={e=>set("poNumber",e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Tax Info">
        <div style={{display:"flex", gap:32, alignItems:"flex-start"}}>
          <div style={{width:220}}>
            <Field label="Tax Rate">
              <select style={sel} value={form.taxRate} onChange={e=>set("taxRate",e.target.value)}>
                {TAX_RATES.map(r=><option key={r}>{r}</option>)}
              </select>
            </Field>
          </div>
          <div style={{paddingTop:20, display:"flex", alignItems:"center", gap:10}}>
            <input type="checkbox" id="dps" checked={form.directPayerSalesTax} onChange={e=>set("directPayerSalesTax",e.target.checked)} />
            <label htmlFor="dps" style={{fontSize:13, fontWeight:600, cursor:"pointer", textTransform:"uppercase" as const, letterSpacing:0.4, fontSize:11, color:"#6b7280"}}>Direct Payer — Sales Tax</label>
          </div>
        </div>
      </Section>

      <Section title="Shipping Info">
        <div style={{width:"30%"}}>
          <Field label="Ship To">
            <input style={inp} placeholder="Select Shipping Location" value={form.shipTo} onChange={e=>set("shipTo",e.target.value)} />
          </Field>
        </div>
      </Section>
    </div>
  );
}

// ── Step 2: Add Items ─────────────────────────────────────────────────────────
function Step2({ selected, setSelected, taxRate }: {
  selected: SelectedItem[]; setSelected: React.Dispatch<React.SetStateAction<SelectedItem[]>>; taxRate: string;
}) {
  const [pbItems, setPbItems]   = useState<PricebookItem[]>([]);
  const [search, setSearch]     = useState("");

  useEffect(() => {
    getDocs(collection(db, "pricebooks")).then(snap => {
      const books = snap.docs.map(d => d.data() as any).sort((a,b)=>(b.year||0)-(a.year||0));
      if (books.length) setPbItems(books[0].items || []);
    }).catch(()=>{});
  }, []);

  const filtered = pbItems.filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()) || (i.description||"").toLowerCase().includes(search.toLowerCase()));

  function addItem(item: PricebookItem) {
    const exists = selected.find(s => s.name === item.name);
    if (exists) {
      setSelected(s => s.map(x => x.name===item.name ? {...x, quantity:x.quantity+1, totalCost:(x.quantity+1)*x.unitCost} : x));
    } else {
      setSelected(s => [...s, { id:uid(), name:item.name, description:item.description, unitCost:item.unitCost, quantity:1, totalCost:item.unitCost }]);
    }
  }

  function removeItem(id: string) { setSelected(s => s.filter(x => x.id !== id)); }
  function updateQty(id: string, qty: number) {
    setSelected(s => s.map(x => x.id===id ? {...x, quantity:qty, totalCost:qty*x.unitCost} : x));
  }

  const subtotal = selected.reduce((sum,i)=>sum+i.totalCost, 0);
  const taxPct = taxRate==="GST (5%)" ? 0.05 : taxRate==="HST ON (13%)" ? 0.13 : taxRate==="HST BC (12%)" ? 0.12 : taxRate==="PST (7%)" ? 0.07 : 0;
  const taxAmt = subtotal * taxPct;
  const total = subtotal + taxAmt;

  return (
    <div style={{ display:"flex", height:"calc(100vh - 200px)", gap:0 }}>

      {/* Left: Categories */}
      <div style={{ width:180, borderRight:"1px solid #e5e7eb", padding:"12px 16px", flexShrink:0, overflowY:"auto" }}>
        <input style={{...inp, marginBottom:10, fontSize:12}} placeholder="Categories" />
        <div style={{ display:"flex", gap:6, marginBottom:12 }}>
          <button style={{ fontSize:11, border:"1px solid #d1d5db", borderRadius:4, padding:"3px 8px", cursor:"pointer", background:"#fff" }}>Select All</button>
          <button style={{ fontSize:11, border:"1px solid #d1d5db", borderRadius:4, padding:"3px 8px", cursor:"pointer", background:"#fff" }}>Clear All</button>
        </div>
        <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, cursor:"pointer" }}>
          <input type="checkbox" defaultChecked /> Uncategorized
        </label>
      </div>

      {/* Center: Products */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ padding:"10px 14px", borderBottom:"1px solid #e5e7eb" }}>
          <div style={{ position:"relative" }}>
            <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"#9ca3af", fontSize:14 }}>🔍</span>
            <input style={{...inp, paddingLeft:32}} placeholder="Search Product" value={search} onChange={e=>setSearch(e.target.value)} />
            {search && <button onClick={()=>setSearch("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#9ca3af",fontSize:16}}>✕</button>}
          </div>
        </div>
        <div style={{ flex:1, overflowY:"auto" }}>
          {filtered.length === 0 && (
            <div style={{ padding:32, textAlign:"center", color:"#9ca3af", fontSize:13 }}>
              {pbItems.length === 0 ? "No pricebook loaded. Items can be added manually below." : "No products match your search."}
            </div>
          )}
          {filtered.map((item, i) => (
            <div key={i} onClick={()=>addItem(item)} style={{ padding:"12px 16px", borderBottom:"1px solid #f3f4f6", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}
              onMouseEnter={e=>(e.currentTarget.style.background="#f9fafb")} onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:"#111827" }}>{item.name}</div>
                <div style={{ fontSize:12, color:"#6b7280" }}>{item.description || item.name}</div>
                <div style={{ fontSize:11, color:"#9ca3af" }}>Uncategorized • Uncategorized</div>
              </div>
              {item.unitCost > 0 && <div style={{ fontSize:13, fontWeight:600, color:"#374151", whiteSpace:"nowrap", paddingLeft:16 }}>{fmtC(item.unitCost)}</div>}
            </div>
          ))}
          {/* Manual add row */}
          <ManualAddRow onAdd={item => setSelected(s => [...s, item])} />
        </div>
      </div>

      {/* Right: Selected Items */}
      <div style={{ width:340, borderLeft:"1px solid #e5e7eb", display:"flex", flexDirection:"column", flexShrink:0 }}>
        <div style={{ padding:"12px 16px", borderBottom:"1px solid #e5e7eb", fontSize:14, fontWeight:800, color:"#16a34a" }}>Selected Items</div>
        <div style={{ flex:1, overflowY:"auto" }}>
          {selected.length === 0 && <div style={{ padding:32, textAlign:"center", color:"#9ca3af", fontSize:13 }}>Click items to add them</div>}
          {selected.map(item => (
            <div key={item.id} style={{ padding:"10px 14px", borderBottom:"1px solid #f3f4f6", display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.name}</div>
                <div style={{ fontSize:12, color:"#6b7280" }}>{fmtC(item.unitCost)} × {item.quantity} = {fmtC(item.totalCost)}</div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <button onClick={()=>updateQty(item.id, Math.max(1, item.quantity-1))} style={{ width:22, height:22, borderRadius:4, border:"1px solid #d1d5db", background:"#fff", cursor:"pointer", fontSize:14, lineHeight:1 }}>−</button>
                <span style={{ fontSize:13, fontWeight:600, minWidth:20, textAlign:"center" }}>{item.quantity}</span>
                <button onClick={()=>updateQty(item.id, item.quantity+1)} style={{ width:22, height:22, borderRadius:4, border:"1px solid #d1d5db", background:"#fff", cursor:"pointer", fontSize:14, lineHeight:1 }}>+</button>
                <button onClick={()=>removeItem(item.id)} style={{ width:22, height:22, borderRadius:4, border:"none", background:"#fee2e2", color:"#991b1b", cursor:"pointer", fontSize:12, fontWeight:700 }}>✕</button>
              </div>
            </div>
          ))}
        </div>
        {/* Totals */}
        <div style={{ padding:"14px 16px", borderTop:"2px solid #e5e7eb", background:"#f9fafb" }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
            <span style={{ fontSize:13, fontWeight:700, color:"#16a34a" }}>Total Cost</span>
            <span style={{ fontSize:13, fontWeight:800, color:"#16a34a" }}>{fmtC(total)}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#6b7280", marginBottom:3 }}>
            <span>Tax Rate</span><span>{taxRate==="None"?"—":taxRate}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#6b7280", marginBottom:3 }}>
            <span>Subtotal</span><span>{fmtC(subtotal)}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#6b7280" }}>
            <span>Tax Amount</span><span>{taxAmt>0?fmtC(taxAmt):"$0.00"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ManualAddRow({ onAdd }: { onAdd: (item: SelectedItem) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  if (!open) return (
    <div onClick={()=>setOpen(true)} style={{ padding:"10px 16px", color:"#1565c0", fontSize:13, fontWeight:600, cursor:"pointer", borderTop:"1px dashed #e5e7eb" }}>
      + Add custom item
    </div>
  );
  return (
    <div style={{ padding:"10px 16px", borderTop:"1px dashed #e5e7eb", display:"flex", gap:8, alignItems:"center" }}>
      <input style={{...inp, flex:1}} placeholder="Item name" value={name} onChange={e=>setName(e.target.value)} />
      <input style={{...inp, width:90}} placeholder="Cost" value={cost} onChange={e=>setCost(e.target.value.replace(/[^0-9.]/g,""))} />
      <button onClick={()=>{ if(!name) return; const u=parseFloat(cost)||0; onAdd({id:uid(),name,description:"",unitCost:u,quantity:1,totalCost:u}); setName(""); setCost(""); setOpen(false); }}
        style={{background:"#16a34a",color:"#fff",border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>Add</button>
      <button onClick={()=>setOpen(false)} style={{background:"none",border:"1px solid #d1d5db",borderRadius:6,padding:"6px 10px",fontSize:12,cursor:"pointer"}}>✕</button>
    </div>
  );
}

// ── Step 3: Summary ───────────────────────────────────────────────────────────
function Step3({ form, selected }: { form: any; selected: SelectedItem[] }) {
  const subtotal = selected.reduce((s,i)=>s+i.totalCost, 0);
  const taxPct = form.taxRate==="GST (5%)" ? 0.05 : form.taxRate==="HST ON (13%)" ? 0.13 : form.taxRate==="HST BC (12%)" ? 0.12 : form.taxRate==="PST (7%)" ? 0.07 : 0;
  const taxAmt = subtotal * taxPct;
  const row = (label: string, value: string) => (
    <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f3f4f6"}}>
      <span style={{fontSize:13,color:"#6b7280",fontWeight:600}}>{label}</span>
      <span style={{fontSize:13,color:"#111827"}}>{value||"—"}</span>
    </div>
  );
  return (
    <div style={{maxWidth:800, margin:"0 auto", padding:"8px 0"}}>
      <div style={sect}>
        <div style={{fontSize:14,fontWeight:800,marginBottom:14}}>Vendor & PO Info</div>
        {row("PO Number",     form.poNumber)}
        {row("Vendor Type",   form.vendorType)}
        {row("Vendor",        form.vendor)}
        {row("PO Type",       form.poType)}
        {row("PO Date",       form.poDate)}
        {row("Assign To",     form.assignTo)}
        {row("Required By",   form.requiredBy)}
        {row("Department",    form.department)}
        {row("Project Manager", form.projectManager)}
        {row("Description",   form.description)}
        {row("Tax Rate",      form.taxRate)}
        {row("Ship To",       form.shipTo)}
      </div>
      <div style={sect}>
        <div style={{fontSize:14,fontWeight:800,marginBottom:14}}>Items ({selected.length})</div>
        {selected.length === 0 && <div style={{color:"#9ca3af",fontSize:13}}>No items added.</div>}
        {selected.map(item => (
          <div key={item.id} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #f3f4f6"}}>
            <span style={{fontSize:13}}>{item.name} × {item.quantity}</span>
            <span style={{fontSize:13,fontWeight:600}}>{fmtC(item.totalCost)}</span>
          </div>
        ))}
        <div style={{display:"flex",justifyContent:"space-between",marginTop:12,fontWeight:800,fontSize:14}}>
          <span>Total</span><span style={{color:"#16a34a"}}>{fmtC(subtotal+taxAmt)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Modal ─────────────────────────────────────────────────────────────────
export default function CreatePOModal({ jobId, jobNumber, department, projectManager, onClose }: Props) {
  const [step, setStep]       = useState(1);
  const [saving, setSaving]   = useState(false);
  const [selected, setSelected] = useState<SelectedItem[]>([]);
  const [employees, setEmployees] = useState<string[]>([]);
  const [vendors, setVendors]     = useState<string[]>([]);

  const [form, setForm] = useState({
    poNumber: "", vendorType: "Supplier", vendor: "", vendorErr: false,
    poType: "", poTypeErr: false, poDate: new Date().toISOString().slice(0,10),
    assignTo: "", requiredBy: "", tags: "", description: "",
    jobNumber, department: department||"", projectManager: projectManager||"", deptErr: false,
    taxRate: "None", directPayerSalesTax: false, shipTo: "",
  });

  useEffect(() => {
    getDocs(query(collection(db,"users"), where("showInDispatch","==",true))).then(snap=>{
      setEmployees(snap.docs.map(d=>(d.data().displayName as string)||"").filter(Boolean).sort());
    }).catch(()=>{});
    getDocs(collection(db,"vendors")).then(snap=>{
      setVendors(snap.docs.map(d=>(d.data().name as string)||"").filter(Boolean).sort());
    }).catch(()=>{});
  }, []);

  function validateStep1() {
    let ok = true;
    const updates: any = {};
    if (!form.vendor.trim()) { updates.vendorErr = true; ok = false; }
    if (!form.poType)        { updates.poTypeErr = true; ok = false; }
    if (!form.department)    { updates.deptErr   = true; ok = false; }
    if (!ok) setForm(f => ({...f, ...updates}));
    return ok;
  }

  async function save(status = "Open") {
    if (step === 1 && !validateStep1()) return;
    setSaving(true);
    try {
      const subtotal = selected.reduce((s,i)=>s+i.totalCost, 0);
      const taxPct = form.taxRate==="GST (5%)" ? 0.05 : form.taxRate==="HST ON (13%)" ? 0.13 : form.taxRate==="HST BC (12%)" ? 0.12 : form.taxRate==="PST (7%)" ? 0.07 : 0;
      const taxAmt = subtotal * taxPct;
      const total = subtotal + taxAmt;
      await addDoc(collection(db,"purchaseOrders"), {
        jobId, jobNumber,
        poNumber:           form.poNumber.trim() || `PO-${Date.now().toString(36).toUpperCase()}`,
        status,
        vendorType:         form.vendorType,
        vendor:             form.vendor.trim(),
        poType:             form.poType,
        poDate:             form.poDate,
        fieldOrder:         false,
        assignTo:           form.assignTo,
        assignedTo:         form.assignTo,
        requiredBy:         form.requiredBy,
        tags:               form.tags,
        description:        form.description,
        department:         form.department,
        projectManager:     form.projectManager,
        taxRate:            form.taxRate,
        directPayerSalesTax: form.directPayerSalesTax,
        shipTo:             form.shipTo,
        items: selected.map(i => ({
          id:                i.id,
          description:       i.name + (i.description ? ` — ${i.description}` : ""),
          fulfillmentStatus: "Pending",
          quantityOrdered:   i.quantity,
          quantityReceived:  0,
          unitCost:          i.unitCost,
          totalCost:         i.totalCost,
        })),
        bills:              [],
        subtotal,
        taxAmount:          taxAmt,
        total,
        createdBy:  auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
        createdAt:  new Date().toISOString().slice(0,10),
      });
      onClose();
    } catch(e) { console.error(e); setSaving(false); }
  }

  const STEPS = ["General Info","Add Items","Summary"];

  return (
    <div style={{ position:"fixed", inset:0, background:"#f9fafb", zIndex:2000, display:"flex", flexDirection:"column", overflow:"hidden" }}>

      {/* Header */}
      <div style={{ background:"#fff", borderBottom:"1px solid #e5e7eb", padding:"0 24px", height:56, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:18, color:"#6b7280", lineHeight:1 }}>✕</button>
          <span style={{ fontSize:16, fontWeight:800, color:"#111827" }}>Create Purchase Order</span>
        </div>
        <button onClick={()=>save("Draft")} disabled={saving} style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:6, padding:"8px 20px", fontSize:13, fontWeight:700, cursor:"pointer", opacity:saving?0.7:1 }}>
          {saving?"Saving…":"SAVE DRAFT"}
        </button>
      </div>

      {/* Content */}
      <div style={{ flex:1, overflowY: step===2?"hidden":"auto", padding: step===2?"0":"20px 32px" }}>
        {step===1 && <Step1 form={form} setForm={setForm} employees={employees} vendors={vendors} />}
        {step===2 && <Step2 selected={selected} setSelected={setSelected} taxRate={form.taxRate} />}
        {step===3 && <Step3 form={form} selected={selected} />}
      </div>

      {/* Footer */}
      <div style={{ background:"#fff", borderTop:"1px solid #e5e7eb", padding:"14px 32px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
        <button onClick={()=>setStep(s=>Math.max(1,s-1))} disabled={step===1}
          style={{ background:step===1?"#f3f4f6":"#1565c0", color:step===1?"#9ca3af":"#fff", border:"none", borderRadius:6, padding:"9px 20px", fontSize:13, fontWeight:700, cursor:step===1?"not-allowed":"pointer" }}>
          ← PREVIOUS STEP
        </button>

        {/* Step indicator */}
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {STEPS.map((label, i) => {
            const n = i+1;
            const done = n < step;
            const active = n === step;
            return (
              <div key={n} style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:26, height:26, borderRadius:"50%", background:done?"#16a34a":active?"#1565c0":"#e5e7eb", color:done||active?"#fff":"#9ca3af", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700 }}>
                    {done ? "✓" : n}
                  </div>
                  <span style={{ fontSize:13, fontWeight:active?700:400, color:active?"#111827":done?"#16a34a":"#9ca3af" }}>{label}</span>
                </div>
                {i < STEPS.length-1 && <span style={{ color:"#d1d5db", margin:"0 4px" }}>—</span>}
              </div>
            );
          })}
        </div>

        {step < 3 ? (
          <button onClick={()=>{ if(step===1 && !validateStep1()) return; setStep(s=>s+1); }}
            style={{ background:"#1565c0", color:"#fff", border:"none", borderRadius:6, padding:"9px 20px", fontSize:13, fontWeight:700, cursor:"pointer" }}>
            NEXT STEP →
          </button>
        ) : (
          <button onClick={()=>save("Open")} disabled={saving}
            style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:6, padding:"9px 24px", fontSize:13, fontWeight:700, cursor:"pointer", opacity:saving?0.7:1 }}>
            {saving?"Saving…":"SUBMIT PO"}
          </button>
        )}
      </div>
    </div>
  );
}
