import { useEffect, useState } from "react";
import { addDoc, collection, doc, getDocs, query, runTransaction, where } from "firebase/firestore";
import { auth, db } from "../firebase";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PropertyCtx {
  id?: string;
  name: string;
  customerName: string;
  customerId?: string;
  billingCustomer?: string;
}

interface Props {
  property: PropertyCtx;
  onClose: () => void;
  onCreated?: (jobId: string, jobNumber: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const WORK_TYPES  = ["Service Call","Quoted Work","Maintenance","Emergency","Project","Inspection","Commissioning","Start-up","Other"];
const JOB_TYPES   = ["Service","Project","Quote","Emergency","Warranty"];
const DEPARTMENTS = ["Electrical","Automation","Industrial","Commercial","HVAC","Plumbing","Maintenance","General","Other"];
const PRIORITIES  = ["Low","Medium","High","Critical"];

// ── Styles ────────────────────────────────────────────────────────────────────
const lbl: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  fontSize: 10, fontWeight: 700, color: "#6b7280",
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "8px 12px",
  border: "1px solid #d1d5db", borderRadius: 6,
  fontSize: 13, boxSizing: "border-box" as const,
  color: "#111827", background: "#fff", outline: "none",
};
const req: React.CSSProperties = { color: "#ef4444", fontSize: 9, fontWeight: 700, letterSpacing: 0.3 };

// ── Job-number counter ────────────────────────────────────────────────────────
async function reserveJobNumber(): Promise<string> {
  const counterRef = doc(db, "settings", "jobCounter");
  const year = new Date().getFullYear().toString().slice(-2);
  let seq = 1;
  await runTransaction(db, async txn => {
    const snap = await txn.get(counterRef);
    seq = (snap.exists() ? (snap.data().current as number) || 0 : 0) + 1;
    txn.set(counterRef, { current: seq }, { merge: true });
  });
  return `${year}-${String(seq).padStart(5, "0")}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function CreateJobModal({ property, onClose, onCreated }: Props) {
  const [users, setUsers]           = useState<string[]>([]);
  const [projectManagers, setProjectManagers] = useState<string[]>([]);
  const [contacts, setContacts]     = useState<{ id: string; name: string; role: string }[]>([]);
  const [pricebooks, setPricebooks] = useState<{ id: string; name: string; isDefault: boolean }[]>([]);
  const [dispatchTechs, setDispatchTechs] = useState<{ uid: string; name: string }[]>([]);
  const [customerProperties, setCustomerProperties] = useState<{ id: string; name: string }[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState(property.id || "");
  const [saving, setSaving]         = useState(false);
  const [errors, setErrors]         = useState<Record<string, boolean>>({});
  const [visitOpen, setVisitOpen]   = useState(false);
  const [visitAdditionalTechs, setVisitAdditionalTechs] = useState<string[]>([]);
  const [visitForm, setVisitForm]   = useState({
    description: "", toDo: "", forms: "",
    requiredSkills: "", requiredCertifications: "",
    department: "", primaryTechUid: "",
    date: "", time: "", duration: "1",
  });

  const [form, setForm] = useState({
    customer:                   property.customerName || "",
    propertyName:               property.name || "",
    propertyRep:                "",
    billingCustomer:            property.billingCustomer || property.customerName || "",
    billingCustomerDifferent:   false,
    billingCustomerFromProperty:false,
    customerPO:                 "",
    workType:                   "",
    pricebook:                  "",
    jobType:                    "Service",
    customerWO:                 "",
    authorizedBy:               "",
    nte:                        "",
    quoteSubtotal:              "",
    quoteTax:                   "",
    costAmount:                 "",
    projectManager:             "",
    accountManager:             "",
    soldBy:                     "",
    preferredTechnician:        "",
    departmentsNeeded:          "",
    priority:                   "",
    issueDescription:           "",
  });

  // Load users, contacts, and pricebooks
  useEffect(() => {
    getDocs(collection(db, "users")).then(snap => {
      const names = snap.docs
        .map(d => d.data().displayName as string)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      setUsers(names);
      const pms = snap.docs
        .filter(d => d.data().isProjectManager)
        .map(d => d.data().displayName as string)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      setProjectManagers(pms);
    }).catch(() => {});

    // When opened from customer level (no property pre-selected), load that customer's properties
    if (property.customerId && !property.id) {
      getDocs(query(collection(db, "properties"), where("customerId", "==", property.customerId))).then(snap => {
        const list = snap.docs
          .map(d => ({ id: d.id, name: (d.data().name as string) || "" }))
          .filter(p => p.name)
          .sort((a, b) => a.name.localeCompare(b.name));
        setCustomerProperties(list);
      }).catch(() => {});
    }

    if (property.customerId) {
      getDocs(collection(db, "customers", property.customerId, "contacts")).then(snap => {
        const list = snap.docs
          .map(d => ({ id: d.id, name: d.data().name as string, role: d.data().role as string || "" }))
          .filter(c => c.name)
          .sort((a, b) => a.name.localeCompare(b.name));
        setContacts(list);
      }).catch(() => {});
    }

    getDocs(collection(db, "pricebooks")).then(snap => {
      const books = snap.docs
        .map(d => ({ id: d.id, name: d.data().name as string, isDefault: d.data().isDefault as boolean }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setPricebooks(books);
      const def = books.find(b => b.isDefault);
      if (def) setForm(f => f.pricebook ? f : { ...f, pricebook: def.name });
    }).catch(() => {});

    getDocs(query(collection(db, "users"), where("showInDispatch", "==", true))).then(snap => {
      const list = snap.docs
        .map(d => ({ uid: (d.data().uid as string) || d.id, name: (d.data().displayName as string) || (d.data().email as string) || "Unknown" }))
        .filter(t => t.name).sort((a, b) => a.name.localeCompare(b.name));
      setDispatchTechs(list);
    }).catch(() => {});
  }, [property.customerId]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  function bind(key: keyof typeof form) {
    return {
      value: form[key] as string,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const v = e.target.type === "checkbox"
          ? (e.target as HTMLInputElement).checked
          : e.target.value;
        setForm(f => ({ ...f, [key]: v }));
        if (errors[key]) setErrors(er => ({ ...er, [key]: false }));
      },
    };
  }
  function bindCheck(key: keyof typeof form) {
    return {
      checked: form[key] as boolean,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm(f => ({ ...f, [key]: e.target.checked })),
    };
  }

  async function handleSave() {
    const errs: Record<string, boolean> = {};
    if (!form.pricebook)        errs.pricebook = true;
    if (!form.departmentsNeeded)errs.departmentsNeeded = true;
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSaving(true);
    try {
      const jobNumber = await reserveJobNumber();
      const now = new Date().toISOString();
      const performer = auth.currentUser?.displayName || auth.currentUser?.email || "Unknown";
      const ref = await addDoc(collection(db, "jobs"), {
        jobNumber,
        customerId:                  property.customerId || "",
        customerName:                form.customer,
        propertyId:                  selectedPropertyId || property.id || "",
        propertyName:                form.propertyName,
        propertyRep:                 form.propertyRep,
        billingCustomer:             form.billingCustomer,
        billingCustomerDifferent:    form.billingCustomerDifferent,
        billingCustomerFromProperty: form.billingCustomerFromProperty,
        customerPO:                  form.customerPO,
        workType:                    form.workType,
        pricebook:                   form.pricebook,
        jobType:                     form.jobType,
        customerWO:                  form.customerWO,
        authorizedBy:                form.authorizedBy,
        nte:                         parseFloat(form.nte) || 0,
        quoteSubtotal:               parseFloat(form.quoteSubtotal) || 0,
        quoteTax:                    parseFloat(form.quoteTax) || 0,
        costAmount:                  parseFloat(form.costAmount) || 0,
        projectManager:              form.projectManager,
        accountManager:              form.accountManager,
        soldBy:                      form.soldBy,
        preferredTechnician:         form.preferredTechnician,
        departmentsNeeded:           form.departmentsNeeded,
        priority:                    form.priority,
        issueDescription:            form.issueDescription,
        status:                      "Open",
        createdAt:                   now,
        createdBy:                   performer,
      });

      // Log creation to history sub-collection
      await addDoc(collection(db, "jobs", ref.id, "history"), {
        action:      "Job Created",
        performedBy: performer,
        timestamp:   now,
      });

      // Create Visit #1 if requested
      if (visitOpen) {
        const dept = visitForm.department || form.departmentsNeeded;
        const selectedTech = dispatchTechs.find(t => t.uid === visitForm.primaryTechUid);
        const visitDuration = parseFloat(visitForm.duration) || 1;
        let endTime = "";
        if (visitForm.time) {
          const [h, m] = visitForm.time.split(":").map(Number);
          const totalMin = h * 60 + m + Math.round(visitDuration * 60);
          endTime = `${String(Math.floor(totalMin / 60) % 24).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
        }
        const visitRef = await addDoc(collection(db, "dispatchVisits"), {
          techUid:                  visitForm.primaryTechUid || "",
          techName:                 selectedTech?.name || "",
          date:                     visitForm.date || "",
          title:                    visitForm.description || `${form.customer}${form.propertyName ? " – " + form.propertyName : ""}`,
          jobNumber,
          start:                    visitForm.time || "",
          end:                      endTime,
          status:                   "scheduled",
          priority:                 "normal",
          flagged:                  false,
          notes:                    visitForm.toDo || "",
          jobId:                    ref.id,
          visitNumber:              1,
          description:              visitForm.description,
          toDo:                     visitForm.toDo,
          department:               dept,
          duration:                 visitDuration,
          additionalTechnicians:    visitAdditionalTechs,
          requiredSkills:           visitForm.requiredSkills ? visitForm.requiredSkills.split(",").map(s => s.trim()).filter(Boolean) : [],
          requiredCertifications:   visitForm.requiredCertifications ? visitForm.requiredCertifications.split(",").map(s => s.trim()).filter(Boolean) : [],
          forms:                    visitForm.forms ? visitForm.forms.split(",").map(s => s.trim()).filter(Boolean) : [],
          createdAt:                now,
          createdBy:                performer,
        });

        // Auto-create payroll entry for Visit #1 (primary + additional techs)
        const allTechs = [selectedTech?.name || "", ...visitAdditionalTechs].filter(Boolean);
        try {
          for (const techName of allTechs) {
            await addDoc(collection(db, "payrollEntries"), {
              employeeName:  techName,
              employeeCode:  "",
              date:          visitForm.date || "",
              department:    dept,
              event:         "Visit",
              jobNumber,
              phase:         "",
              costCode:      "",
              visitRef:      "1",
              visitId:       visitRef.id,
              jobId:         ref.id,
              eventStatus:   "Scheduled",
              reviewStatus:  "UNSUBMITTED",
              customer:      form.customer || "",
              property:      form.propertyName || "",
              location:      "",
              notes:         "",
              rt:            0,
              ot:            0,
              dt:            0,
              pto:           0,
              laborRate:     "",
              laborType:     "",
              source:        "visit",
              createdAt:     now,
            });
          }
        } catch {}

        await addDoc(collection(db, "jobs", ref.id, "history"), {
          action:      "Visit #1 Added",
          performedBy: performer,
          timestamp:   now,
        });
      }

      onCreated?.(ref.id, jobNumber);
      onClose();
    } catch (e) {
      console.error("Failed to create job", e);
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const sel = (errKey?: string): React.CSSProperties => ({
    ...inp,
    borderColor: errKey && errors[errKey] ? "#ef4444" : "#d1d5db",
    appearance: "auto" as React.CSSProperties["appearance"],
  });

  const UserSelect = ({ k, label }: { k: keyof typeof form; label: string }) => (
    <div>
      <label style={lbl}><span>{label}</span></label>
      <select style={sel()} {...bind(k)}>
        <option value="">Select...</option>
        {users.map(u => <option key={u} value={u}>{u}</option>)}
      </select>
    </div>
  );

  const ContactSelect = ({ k, label }: { k: keyof typeof form; label: string }) => (
    <div>
      <label style={lbl}><span>{label}</span></label>
      <select style={sel()} {...bind(k)}>
        <option value="">Select...</option>
        {contacts.map(c => (
          <option key={c.id} value={c.name}>{c.name}{c.role ? ` (${c.role})` : ""}</option>
        ))}
      </select>
    </div>
  );

  const MoneyField = ({ k, label }: { k: keyof typeof form; label: string }) => (
    <div>
      <label style={lbl}><span>{label}</span></label>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#9ca3af", fontSize: 13, pointerEvents: "none" }}>$</span>
        <input type="number" min="0" step="0.01" style={{ ...inp, paddingLeft: 22 }} {...bind(k)} />
      </div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 2000, overflowY: "auto", display: "flex", flexDirection: "column" }}>

      {/* ── Top bar ── */}
      <div style={{ position: "sticky", top: 0, background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#374151", lineHeight: 1, padding: "2px 4px" }}>✕</button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>New Job</span>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "9px 32px", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", letterSpacing: 0.3, opacity: saving ? 0.7 : 1 }}
        >{saving ? "Saving…" : "SAVE"}</button>
      </div>

      {/* ── Form ── */}
      <div style={{ maxWidth: 1060, margin: "0 auto", width: "100%", padding: "32px 32px 60px" }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 24, paddingBottom: 14, borderBottom: "1px solid #e5e7eb" }}>General Information</h2>

        {/* ── Row 1: Customer / Property / Rep ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "20px 28px" }}>
          <div>
            <label style={lbl}><span>Customer</span></label>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#9ca3af", fontSize: 13, pointerEvents: "none" }}>🔍</span>
              <input style={{ ...inp, paddingLeft: 30 }} {...bind("customer")} placeholder="Search customer…" />
            </div>
          </div>
          <div>
            <label style={lbl}>
              <span>Property Name</span>
              <span style={req}>REQUIRED</span>
            </label>
            {!property.id && customerProperties.length > 0 ? (
              <select
                style={sel()}
                value={selectedPropertyId}
                onChange={e => {
                  const pid = e.target.value;
                  const pname = customerProperties.find(p => p.id === pid)?.name || "";
                  setSelectedPropertyId(pid);
                  setForm(f => ({ ...f, propertyName: pname }));
                }}
              >
                <option value="">Select...</option>
                {customerProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : (
              <input style={inp} {...bind("propertyName")} />
            )}
          </div>
          <ContactSelect k="propertyRep" label="Property Rep" />
        </div>

        {/* ── Row 2: Billing ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "20px 28px", marginTop: 20 }}>
          <div>
            <label style={lbl}><span>Billing Customer</span></label>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#9ca3af", fontSize: 13, pointerEvents: "none" }}>🔍</span>
              <input style={{ ...inp, paddingLeft: 30 }} {...bind("billingCustomer")} placeholder="Search billing customer…" />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", paddingTop: 18 }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "#374151", cursor: "pointer", lineHeight: 1.4 }}>
              <input type="checkbox" style={{ marginTop: 1, flexShrink: 0 }} {...bindCheck("billingCustomerDifferent")} />
              Billing Customer Is Different Than The Customer Requesting Work
            </label>
          </div>
          <div style={{ display: "flex", alignItems: "center", paddingTop: 18 }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "#374151", cursor: "pointer", lineHeight: 1.4 }}>
              <input type="checkbox" style={{ marginTop: 1, flexShrink: 0 }} {...bindCheck("billingCustomerFromProperty")} />
              Billing Customer From Property
            </label>
          </div>
        </div>

        {/* ── Row 3: PO / Work Type / Pricebook ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "20px 28px", marginTop: 20 }}>
          <div>
            <label style={lbl}><span>Customer Provided PO #</span></label>
            <input style={inp} {...bind("customerPO")} />
          </div>
          <div>
            <label style={lbl}><span>Work Type</span></label>
            <select style={sel()} {...bind("workType")}>
              <option value="">Select...</option>
              {WORK_TYPES.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>
              <span>Pricebook</span>
              <span style={req}>REQUIRED</span>
            </label>
            <select style={sel("pricebook")} {...bind("pricebook")}>
              <option value="">Select...</option>
              {pricebooks.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
            {errors.pricebook && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>Select a pricebook</div>}
          </div>
        </div>

        {/* ── Row 4: Job Type / Job # / WO # / Authorized By ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "20px 28px", marginTop: 20 }}>
          <div>
            <label style={lbl}><span>Job Type</span></label>
            <select style={sel()} {...bind("jobType")}>
              {JOB_TYPES.map(j => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}><span>Job Number</span></label>
            <input readOnly style={{ ...inp, background: "#f9fafb", color: "#9ca3af" }} value="" placeholder="Auto-generated on save" />
          </div>
          <div>
            <label style={lbl}><span>Customer WO #</span></label>
            <input style={inp} {...bind("customerWO")} />
          </div>
          <ContactSelect k="authorizedBy" label="Authorized By" />
        </div>

        {/* ── Row 5: Money fields ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "20px 28px", marginTop: 20 }}>
          <MoneyField k="nte"           label="NTE" />
          <MoneyField k="quoteSubtotal" label="Quote Subtotal" />
          <MoneyField k="quoteTax"      label="Quote Tax" />
          <MoneyField k="costAmount"    label="Cost Amount" />
        </div>

        {/* ── Row 6: People dropdowns ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "20px 28px", marginTop: 20 }}>
          <div>
            <label style={lbl}><span>Project Manager</span></label>
            <select style={sel()} {...bind("projectManager")}>
              <option value="">Select...</option>
              {projectManagers.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <UserSelect k="accountManager"     label="Account Manager" />
          <UserSelect k="soldBy"             label="Sold By" />
          <div>
            <label style={lbl}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                Preferred Technician
                <span title="The technician preferred for this job" style={{ background: "#e5e7eb", color: "#6b7280", borderRadius: "50%", width: 14, height: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, cursor: "help" }}>?</span>
              </span>
            </label>
            <select style={sel()} {...bind("preferredTechnician")}>
              <option value="">Select...</option>
              {users.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>

        {/* ── Row 7: Departments / Priority ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "20px 28px", marginTop: 20 }}>
          <div>
            <label style={lbl}>
              <span>Departments Needed</span>
              <span style={req}>REQUIRED</span>
            </label>
            <select style={sel("departmentsNeeded")} {...bind("departmentsNeeded")}>
              <option value="">Select...</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            {errors.departmentsNeeded && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>Select a department</div>}
          </div>
          <div>
            <label style={lbl}><span>Priority</span></label>
            <select style={sel()} {...bind("priority")}>
              <option value="">Select...</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {/* ── Row 8: Issue Description ── */}
        <div style={{ marginTop: 20 }}>
          <label style={lbl}><span>Issue Description</span></label>
          <textarea
            rows={4}
            style={{ ...inp, resize: "vertical", minHeight: 96, fontFamily: "inherit" }}
            {...bind("issueDescription")}
          />
        </div>

        {/* ── Visit section toggle ── */}
        <div style={{ marginTop: 28, borderTop: "2px solid #e5e7eb", paddingTop: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: visitOpen ? 20 : 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Add Visit #1</span>
            <button
              type="button"
              onClick={() => setVisitOpen(v => !v)}
              style={{
                position: "relative", width: 44, height: 24, borderRadius: 12,
                background: visitOpen ? "#1565c0" : "#d1d5db",
                border: "none", cursor: "pointer", flexShrink: 0, transition: "background 0.2s",
              }}
            >
              <span style={{
                position: "absolute", top: 4, left: visitOpen ? 23 : 4,
                width: 16, height: 16, borderRadius: "50%", background: "#fff",
                transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                display: "block",
              }} />
            </button>
          </div>

          {visitOpen && (
            <div>
              {/* Visit Description */}
              <div style={{ marginBottom: 16 }}>
                <label style={lbl}><span>Visit Description</span></label>
                <input style={inp} placeholder="Short description" value={visitForm.description} onChange={e => setVisitForm(f => ({ ...f, description: e.target.value }))} />
              </div>

              {/* TO DO */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ ...lbl, fontSize: 9 }}><span>To Do – Actions before dispatch. Leave empty if there are no actions</span></label>
                <textarea rows={3} style={{ ...inp, resize: "vertical", minHeight: 72, fontFamily: "inherit" }} placeholder="TO DO" value={visitForm.toDo} onChange={e => setVisitForm(f => ({ ...f, toDo: e.target.value }))} />
              </div>

              {/* Forms */}
              <div style={{ marginBottom: 16 }}>
                <label style={lbl}><span>Forms</span></label>
                <input style={inp} placeholder="Select Forms (comma-separated)" value={visitForm.forms} onChange={e => setVisitForm(f => ({ ...f, forms: e.target.value }))} />
              </div>

              {/* Required Skills + Certifications */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 28px", marginBottom: 16 }}>
                <div>
                  <label style={lbl}><span>Required Skills</span></label>
                  <input style={inp} placeholder="Select required skills" value={visitForm.requiredSkills} onChange={e => setVisitForm(f => ({ ...f, requiredSkills: e.target.value }))} />
                </div>
                <div>
                  <label style={lbl}><span>Required Certifications</span></label>
                  <input style={inp} placeholder="Select required certifications" value={visitForm.requiredCertifications} onChange={e => setVisitForm(f => ({ ...f, requiredCertifications: e.target.value }))} />
                </div>
              </div>

              {/* Department + Primary Technician */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 28px", marginBottom: 16 }}>
                <div>
                  <label style={lbl}><span>Department</span><span style={req}>REQUIRED</span></label>
                  <select
                    style={{ ...inp, appearance: "auto" as React.CSSProperties["appearance"] }}
                    value={visitForm.department || form.departmentsNeeded}
                    onChange={e => setVisitForm(f => ({ ...f, department: e.target.value }))}
                  >
                    <option value="">Select Department</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}><span>Primary Technician</span></label>
                  <select
                    style={{ ...inp, appearance: "auto" as React.CSSProperties["appearance"] }}
                    value={visitForm.primaryTechUid}
                    onChange={e => setVisitForm(f => ({ ...f, primaryTechUid: e.target.value }))}
                  >
                    <option value="">Select Primary Technician</option>
                    {dispatchTechs.map(t => <option key={t.uid} value={t.uid}>{t.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Additional Technicians */}
              <div style={{ marginBottom: 16 }}>
                <label style={lbl}><span>Additional Technicians</span></label>
                <select
                  style={sel()}
                  value=""
                  onChange={e => {
                    const name = e.target.value;
                    if (name && !visitAdditionalTechs.includes(name))
                      setVisitAdditionalTechs(prev => [...prev, name]);
                  }}
                >
                  <option value="">— Add a technician —</option>
                  {dispatchTechs
                    .filter(t => t.uid !== visitForm.primaryTechUid)
                    .map(t => (
                      <option key={t.uid} value={t.name} disabled={visitAdditionalTechs.includes(t.name)}>{t.name}</option>
                    ))}
                </select>
                {visitAdditionalTechs.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                    {visitAdditionalTechs.map(name => (
                      <div key={name} style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 99, padding: "3px 10px", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                        {name}
                        <span style={{ cursor: "pointer", fontSize: 15, lineHeight: 1 }} onClick={() => setVisitAdditionalTechs(prev => prev.filter(n => n !== name))}>×</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Date / Time / Duration */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 140px", gap: "0 28px" }}>
                <div>
                  <label style={lbl}><span>Date</span></label>
                  <input type="date" style={inp} value={visitForm.date} onChange={e => setVisitForm(f => ({ ...f, date: e.target.value }))} />
                </div>
                <div>
                  <label style={lbl}><span>Time</span></label>
                  <input type="time" style={inp} value={visitForm.time} onChange={e => setVisitForm(f => ({ ...f, time: e.target.value }))} />
                </div>
                <div>
                  <label style={lbl}><span>Duration</span></label>
                  <div style={{ position: "relative" }}>
                    <input type="number" min="0.5" step="0.5" style={{ ...inp, paddingRight: 34 }} value={visitForm.duration} onChange={e => setVisitForm(f => ({ ...f, duration: e.target.value }))} />
                    <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "#9ca3af", pointerEvents: "none" }}>hr</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
