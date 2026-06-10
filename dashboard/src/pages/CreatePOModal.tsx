import { useEffect, useState } from "react";
import { addDoc, collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "../firebase";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PricebookItem { name: string; description: string; unitCost: number; taxable?: boolean; }

interface SelectedItem {
  id: string; name: string; description: string;
  unitCost: number; quantity: number; totalCost: number;
  taxable: boolean; unitOfMeasure: string; costCode: string;
  jobCostType: string; revenueType: string;
}

interface Props {
  jobId: string; jobNumber: string;
  department?: string; projectManager?: string;
  onClose: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const PO_TYPES       = ["Credit Card order","Inspection","On line order","Petty Cash","Subcontractor","Vendor delivery","Vendor Pickup"];
const VENDOR_TYPES   = ["Supplier","Subcontractor","Other"];
const DEPARTMENTS    = ["Service","Electrical","Automation","Industrial","Commercial","HVAC","Maintenance","General","Construction","Other"];
const TAX_RATES      = ["None","GST (5%)","HST ON (13%)","HST BC (12%)","PST (7%)"];
const JOB_COST_TYPES = ["Materials","Labour","Subcontractor","Equipment","Other"];
const REVENUE_TYPES  = ["Materials","Labour","Subcontractor","Equipment","Other"];

// ── Shared styles ─────────────────────────────────────────────────────────────
const inp: React.CSSProperties  = { width:"100%", padding:"8px 10px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, outline:"none", boxSizing:"border-box" as const, background:"#fff" };
const lbl: React.CSSProperties  = { fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase" as const, letterSpacing:0.6, marginBottom:3, display:"block" };
const req: React.CSSProperties  = { color:"#ef4444", fontSize:9, fontWeight:700, letterSpacing:0.3, marginLeft:4 };
const sect: React.CSSProperties = { background:"#fff", border:"1px solid #e5e7eb", borderRadius:10, padding:"20px 24px", marginBottom:14 };

function uid() { return Math.random().toString(36).slice(2,10); }
function fmtC(n: number) { return `$${(n||0).toLocaleString("en-CA",{minimumFractionDigits:2,maximumFractionDigits:2})}`; }

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={lbl}>{label}{required && <span style={req}>REQUIRED</span>}</label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={sect}>
      <div style={{ fontSize:13, fontWeight:800, color:"#111827", marginBottom:14, textTransform:"uppercase" as const, letterSpacing:0.4 }}>{title}</div>
      {children}
    </div>
  );
}

// ── Step 1: General Info ──────────────────────────────────────────────────────
function Step1({ form, setForm, employees, vendors }: { form: any; setForm: any; employees: string[]; vendors: string[] }) {
  const g2 = { display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 };
  const g4 = { display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:14 };
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
              placeholder="Search vendor" value={form.vendor}
              onChange={e=>{set("vendor",e.target.value);set("vendorErr",false);}} />
            <datalist id="vendor-list">{vendors.map(v=><option key={v} value={v}/>)}</datalist>
            {form.vendorErr && <div style={{color:"#ef4444",fontSize:11,marginTop:2}}>Vendor is required</div>}
          </Field>
        </div>
      </Section>

      <Section title="General Information">
        <div style={{...g4, marginBottom:14}}>
          <Field label="PO Type" required>
            <select style={{...sel, borderColor:form.poTypeErr?"#ef4444":"#d1d5db"}} value={form.poType}
              onChange={e=>{set("poType",e.target.value);set("poTypeErr",false);}}>
              <option value="">— Select PO Type —</option>
              {PO_TYPES.map(t=><option key={t}>{t}</option>)}
            </select>
            {form.poTypeErr && <div style={{color:"#ef4444",fontSize:11,marginTop:2}}>Required</div>}
          </Field>
          <Field label="PO Date">
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
            <select style={{...sel, borderColor:form.deptErr?"#ef4444":"#d1d5db"}} value={form.department}
              onChange={e=>{set("department",e.target.value);set("deptErr",false);}}>
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
          <div style={{paddingTop:18, display:"flex", alignItems:"center", gap:8}}>
            <input type="checkbox" id="dps" checked={form.directPayerSalesTax} onChange={e=>set("directPayerSalesTax",e.target.checked)} style={{width:14,height:14}} />
            <label htmlFor="dps" style={{fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase" as const,letterSpacing:0.4,cursor:"pointer"}}>Direct Payer — Sales Tax</label>
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

// ── Item Config Panel ─────────────────────────────────────────────────────────
function ItemConfigPanel({ item, jobNumber, onChange, onRemove }: {
  item: SelectedItem; jobNumber: string;
  onChange: (updated: SelectedItem) => void;
  onRemove: () => void;
}) {
  function set(k: keyof SelectedItem, v: any) {
    const updated = { ...item, [k]: v };
    if (k === "quantity" || k === "unitCost") {
      const qty = k==="quantity" ? (parseFloat(String(v))||0) : item.quantity;
      const uc  = k==="unitCost"  ? (parseFloat(String(v))||0) : item.unitCost;
      updated.totalCost = parseFloat((qty * uc).toFixed(2));
    }
    onChange(updated);
  }

  return (
    <div style={{ display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"12px 16px", borderBottom:"1px solid #e5e7eb", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontSize:13, fontWeight:800, color:"#111827", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1, paddingRight:8 }}>{item.name}</div>
        <button onClick={onRemove} style={{ background:"none", border:"none", color:"#9ca3af", fontSize:18, cursor:"pointer", lineHeight:1, flexShrink:0 }}>✕</button>
      </div>
      <div style={{ padding:"14px 16px" }}>
        {/* Description */}
        <div style={{ marginBottom:12 }}>
          <label style={lbl}>Description</label>
          <textarea style={{ ...inp, resize:"vertical" as const, minHeight:52, fontSize:12 }}
            value={item.description} placeholder="Enter description"
            onChange={e=>set("description",e.target.value)} />
        </div>
        {/* Job + UoM */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
          <div>
            <label style={lbl}>Job / Project</label>
            <input style={{...inp, background:"#f9fafb", color:"#6b7280", fontSize:12}} value={jobNumber} readOnly />
          </div>
          <div>
            <label style={lbl}>Unit of Measure</label>
            <input style={{...inp, fontSize:12}} placeholder="e.g. each, hr, ft" value={item.unitOfMeasure} onChange={e=>set("unitOfMeasure",e.target.value)} />
          </div>
        </div>
        {/* Qty / Unit Cost / Total / Taxable */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr auto", gap:10, marginBottom:12, alignItems:"end" }}>
          <div>
            <label style={lbl}>Quantity</label>
            <input style={{...inp, fontSize:12}} inputMode="decimal" value={item.quantity}
              onChange={e=>set("quantity", e.target.value.replace(/[^0-9.]/g,""))} />
          </div>
          <div>
            <label style={lbl}>Unit Cost</label>
            <div style={{ position:"relative" }}>
              <span style={{ position:"absolute", left:8, top:"50%", transform:"translateY(-50%)", color:"#9ca3af", fontSize:12, pointerEvents:"none" }}>$</span>
              <input style={{...inp, fontSize:12, paddingLeft:18}} inputMode="decimal"
                value={item.unitCost} onChange={e=>set("unitCost", e.target.value.replace(/[^0-9.]/g,""))} />
            </div>
          </div>
          <div>
            <label style={lbl}>Total Cost</label>
            <div style={{ position:"relative" }}>
              <span style={{ position:"absolute", left:8, top:"50%", transform:"translateY(-50%)", color:"#9ca3af", fontSize:12, pointerEvents:"none" }}>$</span>
              <input style={{...inp, fontSize:12, paddingLeft:18, background:"#f9fafb"}}
                value={fmtC(item.totalCost).replace("$","")} readOnly />
            </div>
          </div>
          <div style={{ paddingBottom:2 }}>
            <label style={lbl}>Taxable</label>
            <div style={{ height:36, display:"flex", alignItems:"center" }}>
              <input type="checkbox" checked={item.taxable} onChange={e=>set("taxable",e.target.checked)} style={{width:16,height:16}} />
            </div>
          </div>
        </div>
        {/* Cost Code / Job Cost Type / Revenue Type */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
          <div>
            <label style={lbl}>Cost Code</label>
            <input style={{...inp, fontSize:12}} placeholder="Select cost code" value={item.costCode} onChange={e=>set("costCode",e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Job Cost Type</label>
            <select style={{...inp, fontSize:12, appearance:"auto" as any}} value={item.jobCostType} onChange={e=>set("jobCostType",e.target.value)}>
              {JOB_COST_TYPES.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Revenue Type</label>
            <select style={{...inp, fontSize:12, appearance:"auto" as any}} value={item.revenueType} onChange={e=>set("revenueType",e.target.value)}>
              {REVENUE_TYPES.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Add Items ─────────────────────────────────────────────────────────
function Step2({ selected, setSelected, taxRate, jobNumber }: {
  selected: SelectedItem[]; setSelected: React.Dispatch<React.SetStateAction<SelectedItem[]>>;
  taxRate: string; jobNumber: string;
}) {
  const [pbItems, setPbItems]  = useState<PricebookItem[]>([]);
  const [search, setSearch]    = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    getDocs(collection(db, "pricebooks")).then(snap => {
      const books = snap.docs.map(d => d.data() as any).sort((a,b)=>(b.year||0)-(a.year||0));
      if (books.length) setPbItems(books[0].items || []);
    }).catch(()=>{});
  }, []);

  const filtered = pbItems.filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()) || (i.description||"").toLowerCase().includes(search.toLowerCase()));
  const activeItem = selected.find(s => s.id === activeId) ?? null;

  function addItem(item: PricebookItem) {
    const existing = selected.find(s => s.name === item.name);
    if (existing) { setActiveId(existing.id); return; }
    const newItem: SelectedItem = {
      id: uid(), name: item.name,
      description: item.description || item.name,
      unitCost: item.unitCost || 0, quantity: 1, totalCost: item.unitCost || 0,
      taxable: item.taxable ?? false,
      unitOfMeasure: "", costCode: "", jobCostType: "Materials", revenueType: "Materials",
    };
    setSelected(s => [...s, newItem]);
    setActiveId(newItem.id);
  }

  function addManual(name: string, unitCost: number) {
    const newItem: SelectedItem = {
      id: uid(), name, description: name, unitCost, quantity: 1, totalCost: unitCost,
      taxable: false, unitOfMeasure: "", costCode: "", jobCostType: "Materials", revenueType: "Materials",
    };
    setSelected(s => [...s, newItem]);
    setActiveId(newItem.id);
  }

  function updateItem(updated: SelectedItem) { setSelected(s => s.map(x => x.id===updated.id ? updated : x)); }
  function removeItem(id: string) { setSelected(s => s.filter(x => x.id !== id)); if (activeId===id) setActiveId(null); }

  const subtotal = selected.reduce((sum,i)=>sum+(i.totalCost||0), 0);
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
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", borderRight:"1px solid #e5e7eb" }}>
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
              {pbItems.length === 0 ? "No pricebook loaded. Add a custom item below." : "No products match your search."}
            </div>
          )}
          {filtered.map((item, i) => {
            const isAdded = selected.some(s => s.name === item.name);
            const isActive = activeItem?.name === item.name;
            return (
              <div key={i} onClick={()=>addItem(item)}
                style={{ padding:"11px 16px", borderBottom:"1px solid #f3f4f6", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"flex-start", background: isActive ? "#f0fdf4" : "transparent" }}
                onMouseEnter={e=>{ if(!isActive) e.currentTarget.style.background="#f9fafb"; }}
                onMouseLeave={e=>{ if(!isActive) e.currentTarget.style.background="transparent"; }}>
                <div style={{ flex:1, minWidth:0, paddingRight:8 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#111827" }}>{item.name}</div>
                  <div style={{ fontSize:12, color:"#6b7280", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.description || item.name}</div>
                  <div style={{ fontSize:11, color:"#9ca3af" }}>Uncategorized • Uncategorized</div>
                </div>
                {isAdded ? (
                  <span style={{ fontSize:11, color:"#16a34a", fontWeight:700, whiteSpace:"nowrap", paddingTop:2 }}>✓ Added to Purchase Order</span>
                ) : item.unitCost > 0 ? (
                  <div style={{ fontSize:13, fontWeight:600, color:"#374151", whiteSpace:"nowrap" }}>{fmtC(item.unitCost)}</div>
                ) : null}
              </div>
            );
          })}
          <ManualAddRow onAdd={addManual} />
        </div>
      </div>

      {/* Right: Selected Items panel */}
      <div style={{ width:360, display:"flex", flexDirection:"column", flexShrink:0 }}>
        <div style={{ padding:"12px 16px", borderBottom:"1px solid #e5e7eb", fontSize:14, fontWeight:800, color:"#16a34a", flexShrink:0 }}>Selected Items</div>

        <div style={{ flex:1, overflowY:"auto" }}>
          {activeItem ? (
            <ItemConfigPanel item={activeItem} jobNumber={jobNumber} onChange={updateItem} onRemove={()=>removeItem(activeItem.id)} />
          ) : (
            <div style={{ padding:32, textAlign:"center", color:"#9ca3af", fontSize:13 }}>
              {selected.length === 0 ? "Click items from the list to add them" : "Click an added item to edit its details"}
            </div>
          )}
        </div>

        {/* Mini list when multiple items */}
        {selected.length > 1 && (
          <div style={{ borderTop:"1px solid #e5e7eb", maxHeight:130, overflowY:"auto", flexShrink:0 }}>
            {selected.map(item => (
              <div key={item.id} onClick={()=>setActiveId(item.id)}
                style={{ padding:"8px 14px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", borderBottom:"1px solid #f3f4f6", background:activeId===item.id?"#eff6ff":"transparent" }}>
                <span style={{ fontSize:12, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{item.name}</span>
                <span style={{ fontSize:12, color:"#6b7280", marginLeft:8, whiteSpace:"nowrap" }}>{fmtC(item.totalCost)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Totals */}
        <div style={{ padding:"12px 16px", borderTop:"2px solid #e5e7eb", background:"#f9fafb", flexShrink:0 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
            <span style={{ fontSize:13, fontWeight:700, color:"#16a34a" }}>Total Cost</span>
            <span style={{ fontSize:13, fontWeight:800, color:"#16a34a" }}>{fmtC(total)} ∧</span>
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

function ManualAddRow({ onAdd }: { onAdd: (name: string, unitCost: number) => void }) {
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
      <input style={{...inp, flex:1, fontSize:12}} placeholder="Item name" value={name} onChange={e=>setName(e.target.value)} />
      <input style={{...inp, width:90, fontSize:12}} placeholder="Cost" value={cost} onChange={e=>setCost(e.target.value.replace(/[^0-9.]/g,""))} />
      <button onClick={()=>{ if(!name) return; onAdd(name, parseFloat(cost)||0); setName(""); setCost(""); setOpen(false); }}
        style={{background:"#16a34a",color:"#fff",border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>Add</button>
      <button onClick={()=>setOpen(false)} style={{background:"none",border:"1px solid #d1d5db",borderRadius:6,padding:"6px 10px",fontSize:12,cursor:"pointer"}}>✕</button>
    </div>
  );
}

// ── Step 3: Summary ───────────────────────────────────────────────────────────
function Step3({ form, selected }: { form: any; selected: SelectedItem[] }) {
  const subtotal = selected.reduce((s,i)=>s+(i.totalCost||0), 0);
  const taxPct = form.taxRate==="GST (5%)" ? 0.05 : form.taxRate==="HST ON (13%)" ? 0.13 : form.taxRate==="HST BC (12%)" ? 0.12 : form.taxRate==="PST (7%)" ? 0.07 : 0;
  const taxAmt = subtotal * taxPct;

  function SumField({ label, value }: { label: string; value?: React.ReactNode }) {
    return (
      <div>
        <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase" as const, letterSpacing:0.6, marginBottom:3 }}>{label}</div>
        <div style={{ fontSize:13, color:"#111827" }}>{value || "—"}</div>
      </div>
    );
  }

  function SumSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <div style={{ border:"1px solid #e5e7eb", borderRadius:8, marginBottom:12, overflow:"hidden" }}>
        <div style={{ background:"#f9fafb", padding:"9px 16px", fontSize:12, fontWeight:800, color:"#374151", borderBottom:"1px solid #e5e7eb" }}>{title}</div>
        <div style={{ padding:"14px 16px" }}>{children}</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth:900, margin:"0 auto", padding:"8px 0" }}>
      {/* Vendor */}
      <div style={{ border:"1px solid #e5e7eb", borderRadius:8, marginBottom:12, padding:"14px 16px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        <SumField label="Vendor Type" value={form.vendorType} />
        <SumField label="Vendor" value={form.vendor} />
      </div>

      <SumSection title="General Information">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:14, marginBottom:14 }}>
          <SumField label="Custom PO Type" value={form.poType} />
          <SumField label="PO Date" value={form.poDate} />
          <SumField label="Assign To" value={form.assignTo} />
          <SumField label="Required By" value={form.requiredBy} />
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          <SumField label="Tags" value={form.tags} />
          <SumField label="Description" value={form.description} />
        </div>
      </SumSection>

      <SumSection title="Job / Project Information">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14 }}>
          <SumField label="Job / Project" value={form.jobNumber} />
          <SumField label="Department" value={form.department} />
          <SumField label="Project Manager" value={form.projectManager} />
        </div>
      </SumSection>

      <SumSection title="Tax Info">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          <SumField label="Tax Rate" value={form.taxRate==="None"?"—":form.taxRate} />
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase" as const, letterSpacing:0.6, marginBottom:6 }}>Direct Payer — Sales Tax</div>
            <input type="checkbox" checked={form.directPayerSalesTax} readOnly style={{ width:16, height:16 }} />
          </div>
        </div>
      </SumSection>

      <SumSection title="Shipping Info">
        <SumField label="Ship To" value={form.shipTo} />
      </SumSection>

      {/* PO Lines */}
      <div style={{ border:"1px solid #e5e7eb", borderRadius:8, overflow:"hidden", marginBottom:12 }}>
        <div style={{ background:"#f9fafb", padding:"9px 16px", fontSize:12, fontWeight:800, color:"#374151", borderBottom:"1px solid #e5e7eb" }}>Purchase Order Lines</div>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:"1px solid #e5e7eb" }}>
              {[["Name","left"],["Description","left"],["Quantity","right"],["Unit Cost","right"],["Total","right"]].map(([h,align]) => (
                <th key={h} style={{ padding:"8px 14px", fontSize:11, fontWeight:700, color:"#6b7280", textTransform:"uppercase" as const, textAlign: align as any }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {selected.length === 0 && (
              <tr><td colSpan={5} style={{ padding:"16px 14px", color:"#9ca3af", fontSize:13, textAlign:"center" }}>No items added.</td></tr>
            )}
            {selected.map((item, i) => (
              <tr key={item.id} style={{ borderBottom:i<selected.length-1?"1px solid #f3f4f6":"none" }}>
                <td style={{ padding:"9px 14px", fontSize:13, fontWeight:600 }}>{item.name}</td>
                <td style={{ padding:"9px 14px", fontSize:13, color:"#6b7280", maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.description}</td>
                <td style={{ padding:"9px 14px", fontSize:13, textAlign:"right" }}>{item.quantity}</td>
                <td style={{ padding:"9px 14px", fontSize:13, textAlign:"right" }}>{fmtC(item.unitCost)}</td>
                <td style={{ padding:"9px 14px", fontSize:13, fontWeight:600, textAlign:"right" }}>{fmtC(item.totalCost)}</td>
              </tr>
            ))}
            {selected.length > 0 && (
              <tr style={{ borderTop:"2px solid #e5e7eb", background:"#f9fafb" }}>
                <td colSpan={4} style={{ padding:"9px 14px" }}></td>
                <td style={{ padding:"9px 14px", fontSize:14, fontWeight:800, textAlign:"right" as const, color:"#16a34a" }}>{fmtC(subtotal+taxAmt)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <div style={{ padding:"6px 14px 10px", fontSize:12, color:"#9ca3af", textAlign:"right" as const }}>Total Rows: {selected.length}</div>
      </div>
    </div>
  );
}

// ── Main Modal ─────────────────────────────────────────────────────────────────
export default function CreatePOModal({ jobId, jobNumber, department, projectManager, onClose }: Props) {
  const [step, setStep]         = useState(1);
  const [saving, setSaving]     = useState(false);
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
    if (!validateStep1()) return;
    setSaving(true);
    try {
      const subtotal = selected.reduce((s,i)=>s+(i.totalCost||0), 0);
      const taxPct = form.taxRate==="GST (5%)" ? 0.05 : form.taxRate==="HST ON (13%)" ? 0.13 : form.taxRate==="HST BC (12%)" ? 0.12 : form.taxRate==="PST (7%)" ? 0.07 : 0;
      const taxAmt = subtotal * taxPct;
      await addDoc(collection(db,"purchaseOrders"), {
        jobId, jobNumber,
        poNumber:    form.poNumber.trim() || `PO-${Date.now().toString(36).toUpperCase()}`,
        status,
        vendorType:  form.vendorType,
        vendor:      form.vendor.trim(),
        poType:      form.poType,
        poDate:      form.poDate,
        fieldOrder:  false,
        assignTo:    form.assignTo,
        assignedTo:  form.assignTo,
        requiredBy:  form.requiredBy,
        tags:        form.tags,
        description: form.description,
        department:  form.department,
        projectManager: form.projectManager,
        taxRate:     form.taxRate,
        directPayerSalesTax: form.directPayerSalesTax,
        shipTo:      form.shipTo,
        items: selected.map(i => ({
          id:                i.id,
          name:              i.name,
          description:       i.description,
          fulfillmentStatus: "Pending",
          quantityOrdered:   Number(i.quantity),
          quantityReceived:  0,
          unitCost:          Number(i.unitCost),
          totalCost:         Number(i.totalCost),
          taxable:           i.taxable,
          unitOfMeasure:     i.unitOfMeasure,
          costCode:          i.costCode,
          jobCostType:       i.jobCostType,
          revenueType:       i.revenueType,
        })),
        bills: [],
        subtotal,
        taxAmount: taxAmt,
        total: subtotal + taxAmt,
        createdBy: auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
        createdAt: new Date().toISOString().slice(0,10),
      });
      onClose();
    } catch(e) { console.error(e); setSaving(false); alert("Failed to save purchase order. Check console for details."); }
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
        <button onClick={()=>save("Draft")} disabled={saving}
          style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:6, padding:"8px 20px", fontSize:13, fontWeight:700, cursor:"pointer", opacity:saving?0.7:1 }}>
          {saving?"Saving…":"SAVE DRAFT"}
        </button>
      </div>

      {/* Content */}
      <div style={{ flex:1, overflowY:step===2?"hidden":"auto", padding:step===2?"0":"20px 32px" }}>
        {step===1 && <Step1 form={form} setForm={setForm} employees={employees} vendors={vendors} />}
        {step===2 && <Step2 selected={selected} setSelected={setSelected} taxRate={form.taxRate} jobNumber={form.jobNumber} />}
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
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
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
            {saving?"Saving…":"CREATE PO"}
          </button>
        )}
      </div>
    </div>
  );
}
