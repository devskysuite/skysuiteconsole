import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addDoc, collection, doc, getDocs, onSnapshot, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { db, auth } from "../firebase";
import * as XLSX from "xlsx";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PayrollEntry {
  id: string;
  employeeCode: string;
  employeeName: string;
  date: string;        // YYYY-MM-DD
  department: string;
  event: string;       // Visit, Vacation, Holiday, etc.
  jobNumber: string;
  phase: string;
  costCode: string;
  visitRef: string;    // Visit number (display)
  visitId?: string;    // dispatchVisits doc ID (auto-created entries)
  jobId?: string;
  eventStatus: string; // Scheduled, Working, Complete, etc.
  reviewStatus: string;// UNSUBMITTED | SUBMITTED | PENDING_APPROVAL | APPROVED | DISPUTED
  customer: string;
  property: string;
  location: string;
  notes: string;
  rt: number;
  ot: number;
  dt: number;
  pto: number;
  laborRate: string;
  laborType: string;
  source?: string;     // "visit" | "import" | undefined (manual add)
}

// ── Constants ─────────────────────────────────────────────────────────────────
const LABOR_RATES = ["Default Labor Rate Group", "Apprentice Rate", "Journeyman Rate", "Red Seal Rate", "Foreman Rate"];
const LABOR_TYPES = ["Electrician", "Automation Tech", "General Labour", "Supervisor", "Project Manager", "Apprentice"];
const EVENT_TYPES = ["Visit", "Vacation", "Holiday", "Training", "Office", "Travel", "Sick", "Other"];
const DEPARTMENTS = ["Service", "Electrical", "Automation", "Industrial", "Commercial", "HVAC", "Maintenance", "General"];

const REVIEW_STATUS: Record<string, { label: string; bg: string; color: string; border: string }> = {
  UNSUBMITTED:      { label: "Unsubmitted",      bg: "#f3f4f6", color: "#6b7280", border: "#d1d5db" },
  SUBMITTED:        { label: "Submitted",        bg: "#dbeafe", color: "#1e40af", border: "#93c5fd" },
  PENDING_APPROVAL: { label: "Pending Approval", bg: "#fef3c7", color: "#92400e", border: "#fcd34d" },
  APPROVED:         { label: "Approved",         bg: "#dcfce7", color: "#166534", border: "#86efac" },
  DISPUTED:         { label: "Disputed",         bg: "#fee2e2", color: "#991b1b", border: "#fca5a5" },
};
const EVENT_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  scheduled: { bg: "#e0f2fe", color: "#0369a1" },
  working:   { bg: "#1565c0", color: "#ffffff" },
  complete:  { bg: "#dcfce7", color: "#166534" },
  canceled:  { bg: "#fee2e2", color: "#991b1b" },
};

const DAY_SHORT  = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const DAY_FULL   = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

// ── Date helpers ──────────────────────────────────────────────────────────────
function fmtYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function todayYMD(): string { return fmtYMD(new Date()); }
function mondayOf(s: string): string {
  const d = new Date(s + "T00:00:00");
  const offset = d.getDay() === 0 ? -6 : 1 - d.getDay();
  const m = new Date(d); m.setDate(d.getDate() + offset);
  return fmtYMD(m);
}
function weekDays(monday: string): string[] {
  const m = new Date(monday + "T00:00:00");
  return Array.from({length:7}, (_, i) => { const d = new Date(m); d.setDate(m.getDate()+i); return fmtYMD(d); });
}
function fmtDateRange(monday: string): string {
  const days = weekDays(monday);
  const s = new Date(days[0]+"T00:00:00"), e = new Date(days[6]+"T00:00:00");
  return `${s.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})} - ${e.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`;
}
function fmtFullDate(s: string): string {
  return new Date(s+"T00:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"});
}
function fmtH(n: number): string { return n === 0 ? "0h" : `${n.toFixed(2)}h`; }
function totalH(e: PayrollEntry): number { return (e.rt||0)+(e.ot||0)+(e.dt||0)+(e.pto||0); }
function sumEntries(list: PayrollEntry[]) {
  return list.reduce((a,e)=>({ rt:a.rt+(e.rt||0), ot:a.ot+(e.ot||0), dt:a.dt+(e.dt||0), pto:a.pto+(e.pto||0), total:a.total+totalH(e) }), {rt:0,ot:0,dt:0,pto:0,total:0});
}

// ── Add Entry form blank ──────────────────────────────────────────────────────
const BLANK_ENTRY = { employeeName:"", date:"", event:"Visit", jobNumber:"", department:"", customer:"", property:"", location:"", rt:"0", ot:"0", dt:"0", pto:"0", notes:"", reviewStatus:"UNSUBMITTED" };

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PayrollPage() {
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart]   = useState(() => mondayOf(todayYMD()));
  const [selectedEmp, setSelectedEmp] = useState<string|null>(null);
  const [activeDay, setActiveDay]   = useState<string|null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [pendingEdits, setPendingEdits] = useState<Record<string,{laborRate?:string;laborType?:string;rt?:number;ot?:number;dt?:number;pto?:number}>>({});
  const navigate = useNavigate();
  const [importing, setImporting]   = useState(false);
  const [addOpen, setAddOpen]       = useState(false);
  const [addForm, setAddForm]       = useState(BLANK_ENTRY);
  const [savingAdd, setSavingAdd]   = useState(false);
  const [fieldUsers, setFieldUsers] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const days = useMemo(() => weekDays(weekStart), [weekStart]);

  // Load all field users once (showInDispatch = true)
  useEffect(() => {
    getDocs(query(collection(db,"users"), where("showInDispatch","==",true)))
      .then(snap => {
        const names = snap.docs
          .map(d => (d.data().displayName as string) || (d.data().email as string) || "")
          .filter(Boolean)
          .sort((a,b) => a.localeCompare(b));
        setFieldUsers(names);
      })
      .catch(() => {});
  }, []);

  // Load entries for selected week
  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(
      query(collection(db,"payrollEntries"), where("date",">=",days[0]), where("date","<=",days[6])),
      snap => { setEntries(snap.docs.map(d=>({id:d.id,...d.data()} as PayrollEntry))); setLoading(false); },
      () => setLoading(false)
    );
    return unsub;
  }, [days[0], days[6]]);

  // Employee list: all field users, merged with any entry data for the week
  const employees = useMemo(() => {
    const map: Record<string,PayrollEntry[]> = {};
    for (const e of entries) { (map[e.employeeName]??=[]).push(e); }
    // Start with every field user (guaranteed to appear), then add anyone in entries who isn't a field user
    const allNames = [...new Set([...fieldUsers, ...Object.keys(map)])].sort((a,b) => a.localeCompare(b));
    return allNames.map(name => {
      const list = map[name] ?? [];
      return { name, totals: sumEntries(list), disputed: list.filter(e=>e.reviewStatus==="DISPUTED").length, pending: list.filter(e=>e.reviewStatus==="PENDING_APPROVAL"||e.reviewStatus==="SUBMITTED").length };
    });
  }, [entries, fieldUsers]);

  const disputedTotal = useMemo(() => entries.filter(e=>e.reviewStatus==="DISPUTED").length, [entries]);
  const approvedTotal = useMemo(() => entries.filter(e=>e.reviewStatus==="APPROVED").length, [entries]);

  // Selected employee entries
  const empEntries = useMemo(() => selectedEmp ? entries.filter(e=>e.employeeName===selectedEmp) : [], [entries, selectedEmp]);
  const filteredEmp = useMemo(() => statusFilter==="all" ? empEntries : empEntries.filter(e=>e.reviewStatus===statusFilter), [empEntries, statusFilter]);
  const dayEntries  = useMemo(() => activeDay ? filteredEmp.filter(e=>e.date===activeDay) : [], [filteredEmp, activeDay]);

  function selectEmployee(name: string) {
    setSelectedEmp(name);
    setPendingEdits({});
    setStatusFilter("all");
    const today = todayYMD();
    setActiveDay(days.includes(today) ? today : days[0]);
  }

  function shiftWeek(dir: number) {
    const m = new Date(weekStart+"T00:00:00"); m.setDate(m.getDate()+dir*7);
    setWeekStart(fmtYMD(m)); setActiveDay(null);
  }

  async function updateStatus(id: string, status: string) {
    await updateDoc(doc(db,"payrollEntries",id), { reviewStatus: status });
  }

  async function updateDayStatus(date: string, status: string) {
    if (!selectedEmp) return;
    const list = entries.filter(e=>e.employeeName===selectedEmp && e.date===date);
    const batch = writeBatch(db);
    for (const e of list) batch.update(doc(db,"payrollEntries",e.id), { reviewStatus: status });
    await batch.commit();
  }

  async function saveEdits() {
    if (!Object.keys(pendingEdits).length) return;
    const batch = writeBatch(db);
    for (const [id, changes] of Object.entries(pendingEdits)) batch.update(doc(db,"payrollEntries",id), changes);
    await batch.commit();
    setPendingEdits({});
  }

  // Import from Excel
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
      const data = rows.slice(1).filter(r => (r as unknown[])[1]);

      // Batch in chunks of 450
      for (let i = 0; i < data.length; i += 450) {
        const batch = writeBatch(db);
        for (const raw of data.slice(i, i+450)) {
          const r = raw as unknown[];
          let dateStr = "";
          if (r[2] instanceof Date) {
            dateStr = fmtYMD(r[2] as Date);
          } else if (r[2]) {
            const s = String(r[2]);
            if (s.includes("/")) {
              const [mm,dd,yyyy] = s.split("/");
              dateStr = `${yyyy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
            } else { dateStr = s; }
          }
          const rawStatus = String(r[10]||"UNSUBMITTED").trim().toUpperCase();
          const reviewStatus = rawStatus === "SUBMITTED" ? "PENDING_APPROVAL" : rawStatus === "UNSUBMITTED" ? "UNSUBMITTED" : rawStatus;
          batch.set(doc(collection(db,"payrollEntries")), {
            employeeCode: String(r[0]||""),
            employeeName: String(r[1]||""),
            date:         dateStr,
            department:   String(r[3]||""),
            event:        String(r[4]||""),
            jobNumber:    String(r[5]||""),
            phase:        String(r[6]||""),
            costCode:     String(r[7]||""),
            visitRef:     String(r[8]||""),
            eventStatus:  String(r[9]||""),
            reviewStatus,
            customer:     String(r[11]||""),
            property:     String(r[12]||""),
            location:     String(r[13]||""),
            notes:        String(r[14]||""),
            rt:           parseFloat(String(r[15]||"0"))||0,
            ot:           parseFloat(String(r[16]||"0"))||0,
            dt:           parseFloat(String(r[17]||"0"))||0,
            pto:          parseFloat(String(r[18]||"0"))||0,
            laborRate:    "",
            laborType:    "",
            importedAt:   new Date().toISOString(),
          });
        }
        await batch.commit();
      }
    } catch(err) { console.error(err); }
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  // Export to Excel
  function handleExport() {
    const src = selectedEmp ? empEntries : entries;
    const rows = src.map(e => ({
      "Employee Name": e.employeeName, Date: e.date, Event: e.event,
      "Job / Project Number": e.jobNumber, "Visit": e.visitRef,
      "Event Status": e.eventStatus, "Review Status": e.reviewStatus,
      Department: e.department, Customer: e.customer, Property: e.property,
      Location: e.location, Notes: e.notes,
      RT: e.rt, OT: e.ot, DT: e.dt, PTO: e.pto,
      "Labor Rate": e.laborRate, "Labor Type": e.laborType,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wbOut = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbOut, ws, "Timesheet");
    XLSX.writeFile(wbOut, `payroll-${weekStart}.xlsx`);
  }

  // Add entry
  async function handleAddEntry() {
    if (!addForm.employeeName || !addForm.date) return;
    setSavingAdd(true);
    const now = new Date().toISOString();
    await addDoc(collection(db,"payrollEntries"), {
      employeeCode: "", employeeName: addForm.employeeName, date: addForm.date,
      department: addForm.department, event: addForm.event, jobNumber: addForm.jobNumber,
      phase: "", costCode: "", visitRef: "", eventStatus: "Scheduled",
      reviewStatus: addForm.reviewStatus,
      customer: addForm.customer, property: addForm.property,
      location: addForm.location, notes: addForm.notes,
      rt: parseFloat(addForm.rt)||0, ot: parseFloat(addForm.ot)||0,
      dt: parseFloat(addForm.dt)||0, pto: parseFloat(addForm.pto)||0,
      laborRate: "", laborType: "", importedAt: now,
    });
    setSavingAdd(false);
    setAddOpen(false);
    setAddForm(BLANK_ENTRY);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const empSummary = sumEntries(empEntries);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 96px)", background:"#f9fafb", overflow:"hidden" }}>

      {/* ── Top header ── */}
      <div style={{ background:"#fff", borderBottom:"1px solid #e5e7eb", padding:"10px 20px", display:"flex", alignItems:"center", gap:12, flexShrink:0, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ width:10, height:10, borderRadius:"50%", background:"#16a34a", display:"inline-block", flexShrink:0 }} />
          <span style={{ fontSize:16, fontWeight:800, color:"#111827" }}>Time Tracking</span>
        </div>

        {/* Date nav */}
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <button onClick={()=>shiftWeek(-1)} style={navBtn}>←</button>
          <span style={{ fontSize:13, fontWeight:600, color:"#374151", minWidth:220, textAlign:"center" }}>{fmtDateRange(weekStart)}</span>
          <button onClick={()=>shiftWeek(1)} style={navBtn}>→</button>
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ background:"#f0fdf4", border:"1px solid #86efac", color:"#166534", borderRadius:6, padding:"5px 10px", fontSize:12, fontWeight:700, cursor:"pointer", appearance:"auto" as React.CSSProperties["appearance"] }}
        >
          <option value="all">All Statuses</option>
          {Object.entries(REVIEW_STATUS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        <button onClick={()=>{ setWeekStart(mondayOf(todayYMD())); setActiveDay(null); }} style={{ background:"#f3f4f6", border:"1px solid #d1d5db", borderRadius:6, padding:"5px 12px", fontSize:12, fontWeight:700, cursor:"pointer", color:"#374151" }}>THIS WEEK</button>

        <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center" }}>
          {importing && <span style={{ fontSize:12, color:"#9ca3af" }}>Importing…</span>}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display:"none" }} onChange={handleFile} />
          <button onClick={()=>fileRef.current?.click()} style={{ background:"#f3f4f6", border:"1px solid #d1d5db", borderRadius:6, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer", color:"#374151" }}>
            IMPORT EXCEL
          </button>
          <button onClick={()=>setAddOpen(true)} style={{ background:"#1565c0", color:"#fff", border:"none", borderRadius:6, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer" }}>
            ADD ENTRY
          </button>
          <button onClick={handleExport} style={{ background:"#0d2e5e", color:"#fff", border:"none", borderRadius:6, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer" }}>
            EXPORT MANUAL TIMESHEET
          </button>
        </div>
      </div>

      {/* ── Body: sidebar + main ── */}
      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* ── Left sidebar: employee list ── */}
        <div style={{ width:220, flexShrink:0, borderRight:"1px solid #e5e7eb", background:"#fff", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ overflowY:"auto", flex:1 }}>
            {loading && <div style={{ padding:20, color:"#9ca3af", fontSize:13 }}>Loading…</div>}
            {!loading && employees.length === 0 && (
              <div style={{ padding:20, color:"#9ca3af", fontSize:12, textAlign:"center" }}>
                No entries for this week.<br/>Import an Excel file to get started.
              </div>
            )}
            {employees.map(emp => {
              const selected = selectedEmp === emp.name;
              return (
                <div
                  key={emp.name}
                  onClick={() => selectEmployee(emp.name)}
                  style={{ padding:"10px 14px", cursor:"pointer", background: selected ? "#eff6ff" : "transparent", borderLeft: selected ? "3px solid #1565c0" : "3px solid transparent", display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:"1px solid #f9fafb" }}
                >
                  <span style={{ fontSize:13, fontWeight: selected ? 700 : 500, color: selected ? "#1565c0" : "#111827", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:130 }}>{emp.name}</span>
                  <span style={{ fontSize:12, fontWeight:600, color: emp.disputed > 0 ? "#991b1b" : "#6b7280", whiteSpace:"nowrap" }}>
                    {fmtH(emp.totals.total)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Sidebar footer stats */}
          <div style={{ borderTop:"1px solid #e5e7eb", padding:"10px 14px", flexShrink:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6, cursor:"pointer" }} onClick={() => setStatusFilter(f => f==="DISPUTED"?"all":"DISPUTED")}>
              <span style={{ fontSize:11, color:"#dc2626" }}>⚠</span>
              <span style={{ fontSize:12, fontWeight:600, color:"#dc2626" }}>Disputed ({disputedTotal})</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }} onClick={() => setStatusFilter(f => f==="APPROVED"?"all":"APPROVED")}>
              <span style={{ fontSize:11, color:"#16a34a" }}>✓</span>
              <span style={{ fontSize:12, fontWeight:600, color:"#16a34a" }}>Approved ({approvedTotal})</span>
            </div>
          </div>
        </div>

        {/* ── Right panel ── */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {!selectedEmp ? (
            <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#9ca3af", fontSize:14 }}>
              Select an employee to view their timesheet
            </div>
          ) : (
            <>
              {/* Employee summary bar */}
              <div style={{ background:"#fff", borderBottom:"1px solid #e5e7eb", padding:"10px 20px", display:"flex", alignItems:"center", gap:16, flexShrink:0 }}>
                <span style={{ fontSize:15, fontWeight:800, color:"#111827" }}>{selectedEmp}</span>
                <span style={{ fontSize:13, color:"#6b7280" }}>
                  <strong style={{ color:"#111827" }}>{fmtH(empSummary.total)}</strong> Total
                  &nbsp;|&nbsp;<strong style={{ color:"#111827" }}>{fmtH(empSummary.rt)}</strong> RT
                  &nbsp;|&nbsp;<strong style={{ color:"#111827" }}>{fmtH(empSummary.ot)}</strong> OT
                  {empSummary.dt > 0 && <>&nbsp;|&nbsp;<strong style={{ color:"#111827" }}>{fmtH(empSummary.dt)}</strong> DT</>}
                  {empSummary.pto > 0 && <>&nbsp;|&nbsp;<strong style={{ color:"#111827" }}>{fmtH(empSummary.pto)}</strong> PTO</>}
                </span>
                <button
                  onClick={saveEdits}
                  disabled={!Object.keys(pendingEdits).length}
                  style={{ marginLeft:"auto", background: Object.keys(pendingEdits).length ? "#1565c0" : "#f3f4f6", color: Object.keys(pendingEdits).length ? "#fff" : "#9ca3af", border:"none", borderRadius:6, padding:"6px 18px", fontSize:12, fontWeight:700, cursor: Object.keys(pendingEdits).length ? "pointer" : "default" }}
                >
                  SAVE EDITS
                </button>
              </div>

              {/* Day tabs */}
              <div style={{ background:"#fff", borderBottom:"1px solid #e5e7eb", display:"flex", flexShrink:0, overflowX:"auto" }}>
                {days.map((day, i) => {
                  const dayTotal = sumEntries(empEntries.filter(e=>e.date===day));
                  const isActive = activeDay === day;
                  return (
                    <button key={day} onClick={() => setActiveDay(day)} style={{ padding:"11px 18px", fontWeight:600, fontSize:13, cursor:"pointer", background:"none", border:"none", borderBottom: isActive ? "2px solid #0d2e5e" : "2px solid transparent", color: isActive ? "#0d2e5e" : "#6b7280", whiteSpace:"nowrap" }}>
                      {DAY_SHORT[i]} <span style={{ fontSize:12, color: dayTotal.total > 0 ? "#111827" : "#9ca3af" }}>{fmtH(dayTotal.total)}</span>
                    </button>
                  );
                })}
              </div>

              {/* Day content */}
              <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
                {activeDay && (
                  <>
                    {/* Day header */}
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8, flexWrap:"wrap" }}>
                      <span style={{ fontSize:15, fontWeight:800, color:"#111827" }}>{fmtFullDate(activeDay)}</span>
                      {(() => {
                        const dayEnts = empEntries.filter(e=>e.date===activeDay);
                        const statuses = [...new Set(dayEnts.map(e=>e.reviewStatus))];
                        const dominant = statuses.includes("DISPUTED") ? "DISPUTED" : statuses.includes("PENDING_APPROVAL") ? "PENDING_APPROVAL" : statuses.includes("SUBMITTED") ? "SUBMITTED" : statuses.includes("APPROVED") ? "APPROVED" : "UNSUBMITTED";
                        const st = REVIEW_STATUS[dominant] || REVIEW_STATUS.UNSUBMITTED;
                        return <span style={{ background:st.bg, color:st.color, border:`1px solid ${st.border}`, borderRadius:6, padding:"2px 10px", fontSize:11, fontWeight:700 }}>{st.label}</span>;
                      })()}
                      <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
                        {(() => { const daySum = sumEntries(empEntries.filter(e=>e.date===activeDay)); return (
                          <span style={{ fontSize:12, color:"#6b7280" }}>
                            <strong style={{color:"#111827"}}>{fmtH(daySum.total)}</strong> Total
                            {daySum.rt>0 && <> | <strong style={{color:"#111827"}}>{fmtH(daySum.rt)}</strong> RT</>}
                            {daySum.ot>0 && <> | <strong style={{color:"#111827"}}>{fmtH(daySum.ot)}</strong> OT</>}
                            {daySum.dt>0 && <> | <strong style={{color:"#111827"}}>{fmtH(daySum.dt)}</strong> DT</>}
                            {daySum.pto>0 && <> | <strong style={{color:"#111827"}}>{fmtH(daySum.pto)}</strong> PTO</>}
                          </span>
                        ); })()}
                        <button onClick={() => updateDayStatus(activeDay,"DISPUTED")} style={{ background:"none", border:"1px solid #fca5a5", color:"#991b1b", borderRadius:6, padding:"5px 12px", fontSize:12, fontWeight:700, cursor:"pointer" }}>DISPUTE DAY</button>
                        <button onClick={() => updateDayStatus(activeDay,"APPROVED")} style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:6, padding:"5px 14px", fontSize:12, fontWeight:700, cursor:"pointer" }}>APPROVE</button>
                      </div>
                    </div>

                    {/* Entry cards */}
                    {dayEntries.length === 0 && (
                      <div style={{ color:"#9ca3af", fontSize:13, paddingTop:24, textAlign:"center" }}>No entries for this day</div>
                    )}
                    {dayEntries.map(entry => {
                      const rs = REVIEW_STATUS[entry.reviewStatus] || REVIEW_STATUS.UNSUBMITTED;
                      const esKey = entry.eventStatus.toLowerCase();
                      const es = EVENT_STATUS_COLORS[esKey] || { bg:"#f3f4f6", color:"#374151" };
                      const edit = pendingEdits[entry.id] || {};
                      const laborRate = edit.laborRate ?? entry.laborRate;
                      const laborType = edit.laborType ?? entry.laborType;
                      return (
                        <div key={entry.id} style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:10, marginBottom:14, overflow:"hidden" }}>
                          {/* Card header */}
                          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"11px 16px", borderBottom:"1px solid #f3f4f6", flexWrap:"wrap" }}>
                            {entry.visitId && entry.jobId
                              ? <span onClick={() => navigate(`/jobs/${entry.jobId}/visits/${entry.visitId}`)} style={{ fontSize:13, fontWeight:800, color:"#1565c0", cursor:"pointer", textDecoration:"underline" }}>
                                  {entry.jobNumber ? `Job ${entry.jobNumber}` : entry.event}{entry.visitRef ? `, Visit ${entry.visitRef}` : ""}
                                </span>
                              : <span style={{ fontSize:13, fontWeight:800, color:"#1565c0" }}>
                                  {entry.jobNumber ? `Job ${entry.jobNumber}` : entry.event}{entry.visitRef ? `, Visit ${entry.visitRef}` : ""}
                                </span>
                            }
                            {entry.department && (
                              <span style={{ background:"#e0f2fe", color:"#0369a1", fontSize:11, fontWeight:700, borderRadius:99, padding:"2px 8px" }}>{entry.department}</span>
                            )}
                            <span style={{ background:es.bg, color:es.color, fontSize:11, fontWeight:700, borderRadius:99, padding:"2px 8px" }}>{entry.eventStatus || "—"}</span>
                            <span style={{ background:rs.bg, color:rs.color, border:`1px solid ${rs.border}`, fontSize:11, fontWeight:700, borderRadius:6, padding:"2px 8px" }}>{rs.label}</span>
                            {entry.source === "visit" && <span style={{ background:"#f0fdf4", color:"#15803d", fontSize:10, fontWeight:700, borderRadius:99, padding:"2px 8px", border:"1px solid #86efac" }}>AUTO</span>}
                            <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
                              <button onClick={()=>updateStatus(entry.id,"DISPUTED")} style={{ background:"none", border:"1px solid #d1d5db", borderRadius:5, padding:"3px 10px", fontSize:11, fontWeight:700, cursor:"pointer", color:"#374151" }}>DISPUTE</button>
                              <button onClick={()=>updateStatus(entry.id,"APPROVED")} style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:5, padding:"3px 10px", fontSize:11, fontWeight:700, cursor:"pointer" }}>APPROVE</button>
                            </div>
                          </div>

                          {/* Card body */}
                          <div style={{ padding:"12px 16px" }}>
                            {/* Customer / location */}
                            {(entry.customer || entry.location) && (
                              <div style={{ fontSize:12, color:"#6b7280", marginBottom:10 }}>
                                {[entry.location, entry.customer, entry.property].filter(Boolean).join(" • ")}
                              </div>
                            )}

                            {/* Hours breakdown — editable for admin override */}
                            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"0 12px", marginBottom:12 }}>
                              {(["rt","ot","dt","pto"] as const).map(key => {
                                const current = pendingEdits[entry.id]?.[key] ?? entry[key];
                                return (
                                  <div key={key}>
                                    <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", marginBottom:3 }}>{key.toUpperCase()}</div>
                                    <input
                                      type="number" min="0" step="0.25"
                                      value={current ?? 0}
                                      onChange={e => setPendingEdits(p => ({...p,[entry.id]:{...p[entry.id],[key]:parseFloat(e.target.value)||0}}))}
                                      style={{ width:"100%", padding:"4px 6px", border:"1px solid #e5e7eb", borderRadius:4, fontSize:13, fontWeight:700, color:(current??0)>0?"#111827":"#9ca3af", background:"#f9fafb", boxSizing:"border-box" as const }}
                                    />
                                  </div>
                                );
                              })}
                            </div>

                            {/* Labor rate / type (editable) */}
                            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0 16px", marginBottom: entry.notes ? 10 : 0 }}>
                              <div>
                                <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", marginBottom:3 }}>Labor Rate</div>
                                <select
                                  value={laborRate}
                                  onChange={e => setPendingEdits(p => ({...p,[entry.id]:{...p[entry.id],laborRate:e.target.value}}))}
                                  style={{ width:"100%", fontSize:12, border:"1px solid #e5e7eb", borderRadius:5, padding:"4px 6px", background:"#f9fafb", appearance:"auto" as React.CSSProperties["appearance"] }}
                                >
                                  <option value="">Select Rate…</option>
                                  {LABOR_RATES.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                              </div>
                              <div>
                                <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", marginBottom:3 }}>Labor Type</div>
                                <select
                                  value={laborType}
                                  onChange={e => setPendingEdits(p => ({...p,[entry.id]:{...p[entry.id],laborType:e.target.value}}))}
                                  style={{ width:"100%", fontSize:12, border:"1px solid #e5e7eb", borderRadius:5, padding:"4px 6px", background:"#f9fafb", appearance:"auto" as React.CSSProperties["appearance"] }}
                                >
                                  <option value="">Select Type…</option>
                                  {LABOR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </div>
                              <div>
                                <div style={{ fontSize:10, fontWeight:700, color:"#9ca3af", textTransform:"uppercase", marginBottom:3 }}>Event</div>
                                <div style={{ fontSize:12, color:"#374151", paddingTop:4 }}>{entry.event || "—"}</div>
                              </div>
                            </div>

                            {entry.notes && (
                              <div style={{ marginTop:8, background:"#f9fafb", borderRadius:6, padding:"8px 10px", fontSize:12, color:"#374151", borderLeft:"3px solid #e5e7eb" }}>
                                {entry.notes}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Add Entry Modal ── */}
      {addOpen && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={() => setAddOpen(false)}>
          <div style={{ background:"#fff", borderRadius:12, width:"100%", maxWidth:560, padding:28, boxShadow:"0 12px 48px rgba(0,0,0,0.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:800, color:"#111827", marginBottom:20 }}>Add Time Entry</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px 20px" }}>
              {[["Employee Name","employeeName","text"],["Date","date","date"],["Job / Project Number","jobNumber","text"],["Department","department","select-dept"],["Event","event","select-event"],["Customer","customer","text"],["Property","property","text"],["Location","location","text"],["RT (hrs)","rt","number"],["OT (hrs)","ot","number"],["DT (hrs)","dt","number"],["PTO (hrs)","pto","number"]].map(([label, key, type]) => (
                <div key={key}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#6b7280", textTransform:"uppercase", letterSpacing:0.4, marginBottom:4 }}>{label}</div>
                  {type === "select-dept" ? (
                    <select value={(addForm as Record<string,string>)[key]} onChange={e=>setAddForm(f=>({...f,[key]:e.target.value}))} style={modalInp}>
                      <option value="">Select…</option>
                      {DEPARTMENTS.map(d=><option key={d} value={d}>{d}</option>)}
                    </select>
                  ) : type === "select-event" ? (
                    <select value={(addForm as Record<string,string>)[key]} onChange={e=>setAddForm(f=>({...f,[key]:e.target.value}))} style={modalInp}>
                      {EVENT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  ) : (
                    <input type={type} value={(addForm as Record<string,string>)[key]} onChange={e=>setAddForm(f=>({...f,[key]:e.target.value}))} style={modalInp} />
                  )}
                </div>
              ))}
              <div style={{ gridColumn:"1/-1" }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#6b7280", textTransform:"uppercase", letterSpacing:0.4, marginBottom:4 }}>Notes</div>
                <textarea rows={2} value={addForm.notes} onChange={e=>setAddForm(f=>({...f,notes:e.target.value}))} style={{ ...modalInp, resize:"vertical", fontFamily:"inherit" }} />
              </div>
            </div>
            <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginTop:20 }}>
              <button onClick={()=>setAddOpen(false)} style={{ background:"none", border:"1px solid #d1d5db", borderRadius:6, padding:"8px 18px", fontSize:13, fontWeight:600, cursor:"pointer", color:"#374151" }}>Cancel</button>
              <button onClick={handleAddEntry} disabled={savingAdd} style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:6, padding:"8px 24px", fontSize:13, fontWeight:700, cursor:savingAdd?"not-allowed":"pointer", opacity:savingAdd?0.7:1 }}>
                {savingAdd ? "Saving…" : "Add Entry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared style atoms ────────────────────────────────────────────────────────
const navBtn: React.CSSProperties = { background:"#f3f4f6", border:"1px solid #d1d5db", borderRadius:6, width:30, height:30, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" };
const modalInp: React.CSSProperties = { width:"100%", padding:"7px 10px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, boxSizing:"border-box", color:"#111827", background:"#fff", appearance:"auto" as React.CSSProperties["appearance"] };
