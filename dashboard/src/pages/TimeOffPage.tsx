import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import { useToast } from "../components/Toast";
import { fmtISODate, timeOffStatusBadge } from "../utils/formatting";
import type { TimeOffRequest } from "../types";

export default function TimeOffPage() {
  const [currentUser, setCurrentUser] = useState<{ uid: string; email: string; displayName: string } | null>(null);
  const { confirm } = useToast();
  const [myRequests, setMyRequests] = useState<TimeOffRequest[]>([]);

  const [singleDay, setSingleDay] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const today = new Date().toISOString().split("T")[0];

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { setCurrentUser(null); return; }
      try {
        const snap = await getDocs(
          query(collection(db, "users"), where("uid", "==", user.uid))
        );
        const data = snap.empty ? null : snap.docs[0].data();
        setCurrentUser({
          uid: user.uid,
          email: user.email ?? "",
          displayName: data?.displayName ?? user.email ?? "",
        });
      } catch {
        setCurrentUser({ uid: user.uid, email: user.email ?? "", displayName: user.email ?? "" });
      }
    });
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    loadMyRequests();
  }, [currentUser]);

  async function loadMyRequests() {
    if (!currentUser) return;
    const snap = await getDocs(
      query(
        collection(db, "timeOffRequests"),
        where("uid", "==", currentUser.uid)
      )
    );
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TimeOffRequest));

    // Auto-deny PENDING requests whose start date has passed
    const now = new Date().toISOString().split("T")[0];
    for (const r of results) {
      if (r.status === "PENDING" && r.startDate < now) {
        updateDoc(doc(db, "timeOffRequests", r.id), { status: "DENIED" }).catch(() => {});
        r.status = "DENIED";
      }
    }

    results.sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() ?? 0;
      const bTime = b.createdAt?.toMillis?.() ?? 0;
      return bTime - aTime;
    });
    setMyRequests(results);
  }

  async function submitRequest() {
    setError("");
    setSuccess("");

    if (!startDate || (!singleDay && !endDate)) {
      setError(singleDay ? "Please select a date." : "Please select a start and end date.");
      return;
    }
    const effectiveEnd = singleDay ? startDate : endDate;
    if (effectiveEnd < startDate) {
      setError("End date cannot be before start date.");
      return;
    }
    if (!currentUser) {
      setError("Not logged in.");
      return;
    }

    // Check for overlapping dates with existing PENDING or APPROVED requests
    const overlap = myRequests.find(
      (r) =>
        r.status !== "DENIED" &&
        startDate <= r.endDate &&
        effectiveEnd >= r.startDate
    );
    if (overlap) {
      setError(
        `You already have a ${overlap.status.toLowerCase()} request for ${overlap.startDate} – ${overlap.endDate}. Choose different dates.`
      );
      return;
    }

    // Warn if requesting dates that were previously denied
    const deniedOverlap = myRequests.find(
      (r) =>
        r.status === "DENIED" &&
        startDate <= r.endDate &&
        effectiveEnd >= r.startDate
    );
    if (deniedOverlap) {
      const proceed = await confirm(
        "The time off you are requesting has previously been denied. Are you sure you want to request this time off?"
      );
      if (!proceed) return;
    }

    setBusy(true);
    try {
      await addDoc(collection(db, "timeOffRequests"), {
        uid: currentUser.uid,
        employeeName: currentUser.displayName,
        employeeEmail: currentUser.email,
        startDate,
        endDate: effectiveEnd,
        reason: reason.trim(),
        status: "PENDING",
        createdAt: new Date(),
      });

      // Send email notification to admin
      try {
        const idToken = await auth.currentUser?.getIdToken() ?? "";
        await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idToken,
            type: "time-off",
            payload: {
              employee_name: currentUser.displayName,
              employee_email: currentUser.email,
              start_date: startDate,
              end_date: effectiveEnd,
              reason: reason.trim() || "No reason provided",
            },
          }),
        });
      } catch (emailErr) {
        console.error("Email notification failed:", emailErr);
        // Don't block the request — it was saved to Firestore already
      }

      setSuccess("Time off request submitted successfully.");
      setStartDate("");
      setEndDate("");
      setReason("");
      await loadMyRequests();
    } catch (e: any) {
      setError(e?.message ?? "Failed to submit request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 style={styles.h1}>Time Off Requests</h1>

      {/* ── Submit Form ── */}
      <div id="time-off-request-form" style={styles.card}>
        <h2 style={styles.h2}>Request Vacation</h2>

        {/* Single / Multiple day toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: singleDay ? "#aaa" : "#333" }}>Multiple Days</span>
          <div
            onClick={() => { setSingleDay(!singleDay); setEndDate(""); }}
            style={{
              width: 44, height: 24, borderRadius: 12, cursor: "pointer",
              backgroundColor: singleDay ? "#1e7d3a" : "#ccc",
              position: "relative", transition: "background-color 0.2s",
            }}
          >
            <div style={{
              width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff",
              position: "absolute", top: 2,
              left: singleDay ? 22 : 2, transition: "left 0.2s",
              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: singleDay ? "#333" : "#aaa" }}>Single Day</span>
        </div>

        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>{singleDay ? "Date" : "Start Date"}</label>
            <input
              type="date"
              style={styles.input}
              min={today}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          {!singleDay && (
            <div style={styles.field}>
              <label style={styles.label}>End Date</label>
              <input
                type="date"
                style={styles.input}
                min={startDate || today}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          )}
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Reason (optional)</label>
          <textarea
            style={{ ...styles.input, resize: "vertical", minHeight: 80, fontFamily: "inherit" }}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Any additional details…"
          />
        </div>

        {error && <p style={styles.error}>{error}</p>}
        {success && <p style={styles.successMsg}>{success}</p>}

        <button style={styles.btn} onClick={submitRequest} disabled={busy}>
          {busy ? "Submitting…" : "Submit Request"}
        </button>
      </div>

      {/* ── My Requests ── */}
      <div style={styles.card}>
        <h2 style={styles.h2}>My Requests</h2>
        {myRequests.length === 0 ? (
          <p style={{ color: "#888", fontSize: 14 }}>No requests submitted yet.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Start</th>
                <th style={styles.th}>End</th>
                <th style={styles.th}>Reason</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {myRequests.map((r) => (
                <tr key={r.id} style={styles.tr}>
                  <td style={styles.td}>{fmtISODate(r.startDate)}</td>
                  <td style={styles.td}>{fmtISODate(r.endDate)}</td>
                  <td style={styles.td}>{r.reason || "—"}</td>
                  <td style={styles.td}>
                    <span style={timeOffStatusBadge(r.status)}>{r.status}</span>
                  </td>
                  <td style={styles.td}>
                    {r.createdAt?.toDate
                      ? r.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
                      : r.createdAt
                      ? new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Vacation Calendar */}
      <VacationCalendar />
    </div>
  );
}

// ── Vacation Calendar ─────────────────────────────────────────────────────────
const TENANT_ID_VC = "1c1d62e8-f392-4caa-a8a6-0ce98e0913d9";
const CLIENT_ID_VC = "9a1a21f1-40a3-4872-a4d6-888bd51d116d";
const CAL_ID_VC    = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";
const MONTHS_VC = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS_VC   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

import { doc as fsDoc, getDoc as fsGetDoc, setDoc as fsSetDoc } from "firebase/firestore";

function VacationCalendar() {
  const today = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [view,  setView]  = useState<"month"|"list">("month");
  const [events, setEvents] = useState<{id:string;subject:string;start:string;end:string}[]>([]);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState("");

  useEffect(()=>{
    async function loadToken() {
      try {
        const snap = await fsGetDoc(fsDoc(db,"settings","outlookOnCall"));
        if(snap.exists()&&snap.data().refreshToken){
          const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID_VC}/oauth2/v2.0/token`,{
            method:"POST",body:new URLSearchParams({client_id:CLIENT_ID_VC,refresh_token:snap.data().refreshToken,grant_type:"refresh_token",scope:"Calendars.ReadWrite offline_access"})
          });
          const d = await r.json();
          if(d.access_token){ setToken(d.access_token); try{await fsSetDoc(fsDoc(db,"settings","outlookOnCall"),{refreshToken:d.refresh_token},{merge:true});}catch{} }
        }
      } catch {}
    }
    loadToken();
  },[]);

  useEffect(()=>{
    if(!token) return;
    setLoading(true);
    const start=new Date(year,month,1).toISOString().slice(0,10);
    const end=new Date(year,month+1,1).toISOString().slice(0,10);
    (async()=>{
      const evs:any[]=[];
      let url=`https://graph.microsoft.com/v1.0/me/calendars/${CAL_ID_VC}/calendarView?startDateTime=${start}T00:00:00&endDateTime=${end}T00:00:00&$top=999&$select=id,subject,start,end`;
      while(url){
        const d=await(await fetch(url,{headers:{Authorization:`Bearer ${token}`}})).json();
        // ONLY vacation events
        (d.value||[]).filter((e:any)=>e.subject?.toLowerCase().includes("vacation")).forEach((e:any)=>evs.push({id:e.id,subject:e.subject,start:e.start?.date||e.start?.dateTime?.slice(0,10)||"",end:e.end?.date||e.end?.dateTime?.slice(0,10)||""}));
        url=d["@odata.nextLink"]||"";
      }
      setEvents(evs); setLoading(false);
    })().catch(()=>setLoading(false));
  },[token,year,month]);

  const todayStr=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const first=new Date(year,month,1).getDay();
  const days=new Date(year,month+1,0).getDate();
  const grid:string[]=[];
  for(let i=0;i<first;i++) grid.push("");
  for(let d=1;d<=days;d++) grid.push(`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`);

  // Build map: each date that falls within a vacation range
  const vacMap:Record<string,string[]>={};
  events.forEach(ev=>{
    let cur=new Date(ev.start+"T12:00:00");
    const end=new Date(ev.end+"T12:00:00");
    const name=ev.subject.replace(/vacation\s*[-–]?\s*/i,"").replace(/[-–]\s*vacation/i,"").trim();
    while(cur<end){
      const d=cur.toISOString().slice(0,10);
      if(!vacMap[d]) vacMap[d]=[];
      if(!vacMap[d].includes(name)) vacMap[d].push(name);
      cur.setDate(cur.getDate()+1);
    }
  });

  const scrollToRequest = () => document.getElementById("time-off-request-form")?.scrollIntoView({behavior:"smooth"});

  return (
    <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",marginTop:0}}>
      {/* Header matching on-call style */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>{let m=month-1,y=year;if(m<0){m=11;y--;}setMonth(m);setYear(y);}} style={{background:"#f3f4f6",border:"1px solid #d1d5db",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontWeight:700,fontSize:16}}>◀</button>
          <span style={{fontWeight:700,fontSize:18,color:"#0d2e5e",minWidth:160,textAlign:"center"}}>{MONTHS_VC[month]} {year}</span>
          <button onClick={()=>{let m=month+1,y=year;if(m>11){m=0;y++;}setMonth(m);setYear(y);}} style={{background:"#f3f4f6",border:"1px solid #d1d5db",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontWeight:700,fontSize:16}}>▶</button>
        </div>
        <select value={view} onChange={e=>{if(e.target.value==="request"){scrollToRequest();return;}setView(e.target.value as any);}}
          style={{padding:"7px 12px",border:"1px solid #d1d5db",borderRadius:8,fontSize:14,fontWeight:600,color:"#374151",cursor:"pointer"}}>
          <option value="month">📅 Month View</option>
          <option value="list">📋 List View</option>
          <option value="request">✏️ Request Time Off</option>
        </select>
      </div>

      <div style={{display:"flex",gap:16,marginBottom:14,alignItems:"center"}}>
        <span style={{background:"#f97316",color:"#fff",fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:99}}>🏖 Vacation</span>
        {!token&&<span style={{fontSize:11,color:"#9ca3af"}}>Connect Outlook in On-Call Setup to see team vacations</span>}
      </div>

      {loading&&<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}>⏳ Loading...</div>}

      {token&&!loading&&view==="month"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
          {DAYS_VC.map(d=><div key={d} style={{textAlign:"center",fontSize:12,fontWeight:700,color:"#6b7280",padding:"8px 0",textTransform:"uppercase"}}>{d}</div>)}
          {grid.map((date,i)=>{
            const names=date?(vacMap[date]||[]):[];
            const isToday=date===todayStr;
            return(
              <div key={i} style={{minHeight:110,background:isToday?"#fff8f0":names.length?"#fff7ed":"#fafafa",border:isToday?"2px solid #f97316":"1px solid #e5e7eb",borderRadius:6,padding:6}}>
                {date&&<>
                  <div style={{fontSize:12,fontWeight:isToday?800:500,color:isToday?"#f97316":"#374151",marginBottom:2}}>{parseInt(date.slice(8))}</div>
                  {names.slice(0,2).map(n=><div key={n} style={{fontSize:11,fontWeight:600,background:"#f97316",color:"white",borderRadius:4,padding:"2px 5px",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>🏖 {n}</div>)}
                  {names.length>2&&<div style={{fontSize:9,color:"#9ca3af"}}>+{names.length-2}</div>}
                </>}
              </div>
            );
          })}
        </div>
      )}

      {token&&!loading&&view==="list"&&(
        <div>
          {events.length===0&&<p style={{color:"#9ca3af",fontSize:13}}>No vacations this month.</p>}
          {events.map(ev=>(
            <div key={ev.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid #f5f5f5"}}>
              <div>
                <div style={{fontWeight:600,fontSize:14}}>{ev.subject.replace(/vacation\s*[-–]?\s*/i,"").replace(/[-–]\s*vacation/i,"").trim()}</div>
                <div style={{fontSize:12,color:"#6b7280"}}>{ev.start} → {ev.end}</div>
              </div>
              <span style={{background:"#fff3e0",color:"#e65100",fontSize:12,fontWeight:600,padding:"3px 10px",borderRadius:99}}>🏖 Vacation</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  h1: { fontSize: 24, fontWeight: 800, marginBottom: 20 },
  h2: { fontSize: 16, fontWeight: 700, marginBottom: 16, color: "#333" },
  card: {
    border: "1px solid #e5e5e5",
    borderRadius: 12,
    padding: 24,
    marginBottom: 24,
    backgroundColor: "#fff",
  },
  row: { display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 },
  field: { display: "flex", flexDirection: "column", flex: 1, minWidth: 200, marginBottom: 16 },
  label: { fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#555" },
  input: { border: "1px solid #ddd", borderRadius: 8, padding: "9px 12px", fontSize: 14 },
  btn: {
    backgroundColor: "#1e7d3a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 22px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  error: { color: "#cc0000", fontSize: 13, marginBottom: 12 },
  successMsg: { color: "#007700", fontSize: 13, marginBottom: 12 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    fontSize: 12,
    fontWeight: 700,
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingBottom: 8,
    borderBottom: "1px solid #eee",
  },
  tr: { borderBottom: "1px solid #f5f5f5" },
  td: { padding: "12px 8px 12px 0", fontSize: 14, color: "#333" },
};
