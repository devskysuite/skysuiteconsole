import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, collection, addDoc, onSnapshot, updateDoc, serverTimestamp, query, getDocs } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db, auth } from "../firebase";
import { useRole, isAdminRole } from "../hooks/useRole";

// ── Graph API config ────────────────────────────────────────────────────────
const TENANT_ID = "1c1d62e8-f392-4caa-a8a6-0ce98e0913d9";
const CLIENT_ID = "9a1a21f1-40a3-4872-a4d6-888bd51d116d";
const CAL_ID    = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";
const REDIRECT  = "https://sky-suite-d14ff.web.app/";

interface CalEvent  { id: string; subject: string; start: string; end: string; }
interface SwapReq   { id: string; requesterUid: string; requesterName: string; targetUid: string; targetName: string; myDate: string; myEventId: string; theirDate: string; theirEventId: string; reason: string; status: "PENDING"|"ACCEPTED"|"DECLINED"; createdAt: any; }
interface UserInfo  { uid: string; displayName: string; }

// ── PKCE ────────────────────────────────────────────────────────────────────
function genVerifier() { const a=new Uint8Array(64); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,""); }
async function genChallenge(v: string) { const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)); return btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,""); }

// ── Token ────────────────────────────────────────────────────────────────────
async function refreshToken(rt: string) {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method:"POST", body: new URLSearchParams({ client_id:CLIENT_ID, refresh_token:rt, grant_type:"refresh_token", scope:"Calendars.ReadWrite offline_access" })
  });
  const d = await r.json();
  return d.access_token ? { access:d.access_token, refresh:d.refresh_token||rt } : null;
}

async function graphFetch(token:string, path:string, method="GET", body?:any) {
  const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method, headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" }, body:body?JSON.stringify(body):undefined
  });
  return method==="DELETE" ? { ok:r.ok } : r.json();
}

// ── Calendar grid ────────────────────────────────────────────────────────────
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function calGrid(year:number, month:number) {
  const g:string[]=[], first=new Date(year,month,1).getDay(), days=new Date(year,month+1,0).getDate();
  for(let i=0;i<first;i++) g.push("");
  for(let d=1;d<=days;d++) g.push(`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`);
  return g;
}

function pillStyle(subject:string) {
  const s=subject.toLowerCase();
  if((s.includes("on call")||s.includes("oncall"))&&!s.includes("vacation")) return { bg:"#1565c0",color:"#fff",prefix:"📞 "};
  if(s.includes("vacation")) return {bg:"#f97316",color:"#fff",prefix:"🏖 "};
  return {bg:"#f3f4f6",color:"#374151",prefix:""};
}

function getName(subject:string) {
  const skip=new Set(["on","call","oncall","vacation","-","–"]);
  return subject.split(/\s+/).find(w=>w.length>1&&!skip.has(w.toLowerCase()))||subject;
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function OnCallManagerPage() {
  const role=useRole(), isAdmin=isAdminRole(role);
  const today=new Date();
  const [year,setYear]=useState(today.getFullYear());
  const [month,setMonth]=useState(today.getMonth());
  const [tab,setTab]=useState<"calendar"|"swaps"|"setup">("calendar");

  const [accessToken,setAccessToken]=useState("");
  const [connected,setConnected]=useState(false);
  const [events,setEvents]=useState<CalEvent[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  const [currentUser,setCurrentUser]=useState<UserInfo|null>(null);
  const [allUsers,setAllUsers]=useState<UserInfo[]>([]);
  const [swapRequests,setSwapRequests]=useState<SwapReq[]>([]);

  // Swap modal
  const [swapModal,setSwapModal]=useState<{event:CalEvent}|null>(null);
  const [swapTargetUid,setSwapTargetUid]=useState("");
  const [swapTheirDate,setSwapTheirDate]=useState("");
  const [swapReason,setSwapReason]=useState("");
  const [swapSubmitting,setSwapSubmitting]=useState(false);

  // Auth user
  useEffect(()=>{ return onAuthStateChanged(auth, u=>{ if(u) setCurrentUser({uid:u.uid,displayName:u.displayName||u.email||"Me"}); }); },[]);

  // Load all users
  useEffect(()=>{
    getDocs(collection(db,"users")).then(snap=>{
      setAllUsers(snap.docs.map(d=>({ uid:d.data().uid||d.id, displayName:d.data().displayName||d.data().email||d.id })));
    }).catch(()=>{});
  },[]);

  // Subscribe to swap requests
  useEffect(()=>{
    const unsub=onSnapshot(collection(db,"onCallSwapRequests"),snap=>{
      setSwapRequests(snap.docs.map(d=>({id:d.id,...d.data()}as SwapReq)));
    });
    return unsub;
  },[]);

  // Load token from Firestore
  useEffect(()=>{
    async function load() {
      try {
        const snap=await getDoc(doc(db,"settings","outlookOnCall"));
        if(snap.exists()&&snap.data().refreshToken) {
          const t=await refreshToken(snap.data().refreshToken);
          if(t){ setAccessToken(t.access); setConnected(true); try{await setDoc(doc(db,"settings","outlookOnCall"),{refreshToken:t.refresh},{merge:true});}catch{} }
        }
      } catch {}
    }
    load();
  },[]);

  // Handle OAuth callback
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const code=params.get("code");
    if(!code) return;
    window.history.replaceState({},"",window.location.pathname);
    const verifier=sessionStorage.getItem("pkce_verifier")||"";
    sessionStorage.removeItem("pkce_verifier");
    (async()=>{
      const bodyParams:any={ client_id:CLIENT_ID, code, redirect_uri:REDIRECT, grant_type:"authorization_code", scope:"Calendars.ReadWrite offline_access" };
      if(verifier) bodyParams.code_verifier=verifier;
      const r=await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,{method:"POST",body:new URLSearchParams(bodyParams)});
      const d=await r.json();
      if(d.access_token){
        setAccessToken(d.access_token); setConnected(true);
        try{await setDoc(doc(db,"settings","outlookOnCall"),{refreshToken:d.refresh_token},{merge:true});}catch{}
      } else { setError("Auth failed: "+(d.error_description||JSON.stringify(d))); }
    })();
  },[]);

  // Fetch events
  useEffect(()=>{
    if(!accessToken) return;
    setLoading(true);
    const start=new Date(year,month,1).toISOString().slice(0,10);
    const end=new Date(year,month+1,1).toISOString().slice(0,10);
    let url=`https://graph.microsoft.com/v1.0/me/calendars/${CAL_ID}/calendarView?startDateTime=${start}T00:00:00&endDateTime=${end}T00:00:00&$top=999&$select=id,subject,start,end,isAllDay`;
    const evs:CalEvent[]=[];
    (async()=>{
      while(url){ const d=await(await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`}})).json(); (d.value||[]).forEach((e:any)=>evs.push({id:e.id,subject:e.subject||"",start:e.start?.date||e.start?.dateTime?.slice(0,10)||"",end:e.end?.date||e.end?.dateTime?.slice(0,10)||""})); url=d["@odata.nextLink"]||""; }
      setEvents(evs); setLoading(false);
    })().catch(()=>setLoading(false));
  },[accessToken,year,month]);

  async function connectOutlook() {
    const v=genVerifier(), c=await genChallenge(v);
    sessionStorage.setItem("pkce_verifier",v);
    window.location.href=`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent("Calendars.ReadWrite offline_access")}&response_mode=query&code_challenge=${c}&code_challenge_method=S256`;
  }

  // Swap actions
  async function submitSwap() {
    if(!swapModal||!swapTargetUid||!swapTheirDate||!currentUser) return;
    setSwapSubmitting(true);
    const target=allUsers.find(u=>u.uid===swapTargetUid);
    // Find their event on that date
    const theirEvent=events.find(e=>e.start===swapTheirDate&&getName(e.subject).toLowerCase()===target?.displayName?.split(" ")[0].toLowerCase());
    await addDoc(collection(db,"onCallSwapRequests"),{
      requesterUid:currentUser.uid, requesterName:currentUser.displayName,
      targetUid:swapTargetUid, targetName:target?.displayName||"",
      myDate:swapModal.event.start, myEventId:swapModal.event.id,
      theirDate:swapTheirDate, theirEventId:theirEvent?.id||"",
      reason:swapReason, status:"PENDING", createdAt:serverTimestamp()
    });
    setSwapModal(null); setSwapReason(""); setSwapTargetUid(""); setSwapTheirDate(""); setSwapSubmitting(false);
  }

  async function resolveSwap(swap:SwapReq, accept:boolean) {
    if(accept&&accessToken) {
      // Update both calendar events
      await graphFetch(accessToken,`/me/events/${swap.myEventId}`,"PATCH",{subject:`${swap.targetName.split(" ")[0]} On Call`}).catch(()=>{});
      await graphFetch(accessToken,`/me/events/${swap.theirEventId}`,"PATCH",{subject:`${swap.requesterName.split(" ")[0]} On Call`}).catch(()=>{});
    }
    await updateDoc(doc(db,"onCallSwapRequests",swap.id),{ status:accept?"ACCEPTED":"DECLINED", resolvedAt:serverTimestamp() });
    if(accept) setEvents(prev=>prev.map(e=>{ if(e.id===swap.myEventId) return {...e,subject:`${swap.targetName.split(" ")[0]} On Call`}; if(e.id===swap.theirEventId) return {...e,subject:`${swap.requesterName.split(" ")[0]} On Call`}; return e; }));
  }

  const eventMap:Record<string,CalEvent[]>={};
  events.forEach(e=>{if(!eventMap[e.start])eventMap[e.start]=[];eventMap[e.start].push(e);});
  const todayStr=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const grid=calGrid(year,month);

  const myPendingSwaps=swapRequests.filter(s=>s.status==="PENDING"&&(s.targetUid===currentUser?.uid||(isAdmin)));
  const pendingCount=myPendingSwaps.length;

  return (
    <div style={{padding:"24px 32px"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <h1 style={{fontSize:24,fontWeight:800,color:"#0d2e5e"}}>On-Call Manager</h1>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          {connected ? <span style={{fontSize:13,color:"#059669",fontWeight:600}}>✅ Connected</span>
            : <button onClick={connectOutlook} style={btnS("#1565c0")}>🔗 Connect Outlook</button>}
        </div>
      </div>

      {error&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 16px",color:"#dc2626",marginBottom:16}}>{error}</div>}

      {/* Tabs */}
      <div style={{display:"flex",gap:4,marginBottom:20,borderBottom:"2px solid #e5e7eb"}}>
        <TabBtn label="📅 Calendar" active={tab==="calendar"} onClick={()=>setTab("calendar")}/>
        <TabBtn label={`🔄 Swaps${pendingCount>0?` (${pendingCount})`:""}`} active={tab==="swaps"} onClick={()=>setTab("swaps")}/>
        {isAdmin&&<TabBtn label="⚙ Setup" active={tab==="setup"} onClick={()=>setTab("setup")}/>}
      </div>

      {/* ── CALENDAR TAB ── */}
      {tab==="calendar"&&(
        <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <button onClick={()=>{let m=month-1,y=year;if(m<0){m=11;y--;}setMonth(m);setYear(y);}} style={navS}>◀</button>
            <span style={{fontWeight:700,fontSize:18,color:"#0d2e5e"}}>{MONTHS[month]} {year}</span>
            <button onClick={()=>{let m=month+1,y=year;if(m>11){m=0;y++;}setMonth(m);setYear(y);}} style={navS}>▶</button>
          </div>
          <div style={{display:"flex",gap:16,marginBottom:14,flexWrap:"wrap"}}>
            <span style={{background:"#1565c0",color:"#fff",fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:99}}>📞 On Call</span>
            <span style={{background:"#f97316",color:"#fff",fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:99}}>🏖 Vacation</span>
            {connected&&<span style={{fontSize:11,color:"#9ca3af"}}>Click your on-call day to request a swap</span>}
          </div>
          {loading&&<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}>⏳ Loading...</div>}
          {!connected&&!loading&&<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}>Connect Outlook above to view the calendar.</div>}
          {connected&&!loading&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
              {DAYS.map(d=><div key={d} style={{textAlign:"center",fontSize:11,fontWeight:700,color:"#6b7280",padding:"6px 0",textTransform:"uppercase"}}>{d}</div>)}
              {grid.map((date,i)=>{
                const dayEvs=date?(eventMap[date]||[]):[];
                const isToday=date===todayStr;
                const myOncall=dayEvs.find(e=>{const s=e.subject.toLowerCase();return(s.includes("on call")||s.includes("oncall"))&&!s.includes("vacation")&&getName(e.subject).toLowerCase()===currentUser?.displayName?.split(" ")[0].toLowerCase();});
                return(
                  <div key={i} style={{minHeight:80,background:isToday?"#eff6ff":"#fafafa",border:isToday?"2px solid #1565c0":"1px solid #e5e7eb",borderRadius:6,padding:4,cursor:myOncall?"pointer":"default"}}
                    onClick={()=>{ if(myOncall&&connected) setSwapModal({event:myOncall}); }}>
                    {date&&<>
                      <div style={{fontSize:12,fontWeight:isToday?800:500,color:isToday?"#1565c0":"#374151",marginBottom:2}}>{parseInt(date.slice(8))}</div>
                      {dayEvs.slice(0,2).map(ev=>{const c=pillStyle(ev.subject);const n=getName(ev.subject);return(
                        <div key={ev.id} style={{fontSize:10,fontWeight:600,background:c.bg,color:c.color,borderRadius:4,padding:"1px 4px",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {c.prefix}{n}
                        </div>);})}
                      {dayEvs.length>2&&<div style={{fontSize:9,color:"#9ca3af"}}>+{dayEvs.length-2}</div>}
                      {myOncall&&<div style={{fontSize:9,color:"#1565c0",marginTop:2}}>tap to swap</div>}
                    </>}
                  </div>);
              })}
            </div>
          )}
        </div>
      )}

      {/* ── SWAPS TAB ── */}
      {tab==="swaps"&&(
        <div style={{background:"white",borderRadius:12,padding:24,boxShadow:"0 1px 4px rgba(0,0,0,0.07)"}}>
          <h2 style={{fontSize:16,fontWeight:700,color:"#0d2e5e",marginBottom:16}}>Swap Requests</h2>

          {/* Incoming / admin view */}
          {(() => {
            const pending = swapRequests.filter(s=>s.status==="PENDING"&&(s.targetUid===currentUser?.uid||isAdmin));
            const mine    = swapRequests.filter(s=>s.requesterUid===currentUser?.uid);
            return(<>
              {pending.length>0&&<>
                <h3 style={{fontSize:13,fontWeight:700,color:"#374151",marginBottom:10}}>⏳ Awaiting Your Response</h3>
                {pending.map(s=>(
                  <div key={s.id} style={{border:"1px solid #e5e7eb",borderRadius:8,padding:14,marginBottom:10}}>
                    <div style={{fontSize:14,fontWeight:600,color:"#0d2e5e",marginBottom:4}}>{s.requesterName} → {s.targetName}</div>
                    <div style={{fontSize:12,color:"#6b7280",marginBottom:8}}>
                      Trade <strong>{s.myDate}</strong> ↔ <strong>{s.theirDate}</strong>
                      {s.reason&&<span> · "{s.reason}"</span>}
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={()=>resolveSwap(s,true)} style={btnS("#059669")}>✅ Accept</button>
                      <button onClick={()=>resolveSwap(s,false)} style={btnS("#dc2626")}>❌ Decline</button>
                    </div>
                  </div>))}
              </>}

              {mine.length>0&&<>
                <h3 style={{fontSize:13,fontWeight:700,color:"#374151",marginBottom:10,marginTop:16}}>📤 My Requests</h3>
                {mine.map(s=>(
                  <div key={s.id} style={{border:"1px solid #e5e7eb",borderRadius:8,padding:12,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:600}}>{s.myDate} ↔ {s.theirDate} with {s.targetName}</div>
                      {s.reason&&<div style={{fontSize:11,color:"#9ca3af"}}>"{s.reason}"</div>}
                    </div>
                    <span style={{fontSize:12,fontWeight:700,padding:"3px 10px",borderRadius:99,background:s.status==="PENDING"?"#fef3c7":s.status==="ACCEPTED"?"#d1fae5":"#fee2e2",color:s.status==="PENDING"?"#92400e":s.status==="ACCEPTED"?"#065f46":"#991b1b"}}>{s.status}</span>
                  </div>))}
              </>}

              {pending.length===0&&mine.length===0&&<p style={{color:"#9ca3af",fontSize:13}}>No swap requests yet. Click an on-call day in the calendar to request a swap.</p>}
            </>);
          })()}
        </div>
      )}

      {/* ── SETUP TAB ── */}
      {tab==="setup"&&isAdmin&&(
        <div style={{background:"white",borderRadius:12,padding:24,boxShadow:"0 1px 4px rgba(0,0,0,0.07)"}}>
          <h2 style={{fontSize:16,fontWeight:700,color:"#0d2e5e",marginBottom:16}}>On-Call Setup</h2>
          {connected ? <p style={{fontSize:13,color:"#059669",fontWeight:600}}>✅ Outlook connected.</p>
            : <><p style={{fontSize:13,color:"#6b7280",marginBottom:12}}>Click to sign in with the SkySuite Outlook account.</p>
               <button onClick={connectOutlook} style={btnS("#1565c0")}>🔗 Connect Outlook</button></>}
          <p style={{fontSize:13,color:"#9ca3af",marginTop:16}}>📌 Rotation planner coming soon.</p>
        </div>
      )}

      {/* ── SWAP MODAL ── */}
      {swapModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"white",borderRadius:16,padding:28,width:"100%",maxWidth:420,boxShadow:"0 8px 40px rgba(0,0,0,0.2)"}}>
            <h2 style={{fontSize:18,fontWeight:700,color:"#0d2e5e",marginBottom:4}}>Request Swap</h2>
            <p style={{fontSize:13,color:"#6b7280",marginBottom:16}}>Your on-call day: <strong>{swapModal.event.start}</strong></p>

            <label style={lbl}>Swap with</label>
            <select value={swapTargetUid} onChange={e=>setSwapTargetUid(e.target.value)} style={inp}>
              <option value="">— Select person —</option>
              {allUsers.filter(u=>u.uid!==currentUser?.uid).map(u=><option key={u.uid} value={u.uid}>{u.displayName}</option>)}
            </select>

            <label style={{...lbl,marginTop:12}}>Their date to swap</label>
            <select value={swapTheirDate} onChange={e=>setSwapTheirDate(e.target.value)} style={inp}>
              <option value="">— Select date —</option>
              {events.filter(e=>{const s=e.subject.toLowerCase();const target=allUsers.find(u=>u.uid===swapTargetUid);return(s.includes("on call")||s.includes("oncall"))&&!s.includes("vacation")&&getName(e.subject).toLowerCase()===target?.displayName?.split(" ")[0].toLowerCase()&&e.start>=todayStr;}).map(e=><option key={e.id} value={e.start}>{e.start}</option>)}
            </select>

            <label style={{...lbl,marginTop:12}}>Reason (optional)</label>
            <input value={swapReason} onChange={e=>setSwapReason(e.target.value)} placeholder="e.g. family event" style={{...inp,marginBottom:0}}/>

            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button onClick={()=>setSwapModal(null)} style={btnS("#6b7280")}>Cancel</button>
              <button onClick={submitSwap} disabled={!swapTargetUid||!swapTheirDate||swapSubmitting} style={btnS("#1565c0")}>{swapSubmitting?"Sending...":"Send Request"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({label,active,onClick}:{label:string;active:boolean;onClick:()=>void}) {
  return <button onClick={onClick} style={{padding:"8px 20px",fontWeight:600,fontSize:14,cursor:"pointer",background:"none",border:"none",borderBottom:active?"3px solid #1565c0":"3px solid transparent",color:active?"#1565c0":"#6b7280",marginBottom:-2}}>{label}</button>;
}

const btnS=(bg:string):React.CSSProperties=>({background:bg,color:"white",border:"none",borderRadius:8,padding:"8px 16px",fontSize:14,fontWeight:600,cursor:"pointer"});
const navS:React.CSSProperties={background:"#f3f4f6",border:"1px solid #d1d5db",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontWeight:700,fontSize:16};
const lbl:React.CSSProperties={display:"block",fontSize:12,fontWeight:600,color:"#374151",marginBottom:4};
const inp:React.CSSProperties={width:"100%",padding:"8px 12px",border:"1px solid #d1d5db",borderRadius:8,fontSize:14,boxSizing:"border-box"as const};
