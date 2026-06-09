import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, collection, addDoc, onSnapshot, updateDoc, serverTimestamp, query, getDocs, orderBy, limit, deleteDoc, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db, auth } from "../firebase";
import { useRole, isAdminRole } from "../hooks/useRole";

// ── Graph API config ────────────────────────────────────────────────────────
const TENANT_ID = "1c1d62e8-f392-4caa-a8a6-0ce98e0913d9"; // skysuite ca tenant
const CLIENT_ID = "9a1a21f1-40a3-4872-a4d6-888bd51d116d";
const CAL_ID    = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";
const REDIRECT  = "https://skysuite.ca/";

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

// ── Canadian Statutory Holidays (Federal + Ontario) ──────────────────────────
function getStatHolidays(year: number): { name: string; date: string }[] {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  // Easter (Anonymous Gregorian algorithm)
  const a=year%19,b=Math.floor(year/100),c=year%100,d2=Math.floor(b/4),e=b%4,
    f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d2-g+15)%30,
    ii=Math.floor(c/4),k=c%4,l=(32+2*e+2*ii-h-k)%7,m2=Math.floor((a+11*h+22*l)/451),
    mo=Math.floor((h+l-7*m2+114)/31),dy=((h+l-7*m2+114)%31)+1;
  const easter=new Date(year,mo-1,dy);
  const goodFriday=new Date(easter); goodFriday.setDate(goodFriday.getDate()-2);
  // nth Monday of a 0-indexed month
  const nthMon=(mo2:number,n:number)=>{const d=new Date(year,mo2,1);const skip2=(1-d.getDay()+7)%7;d.setDate(1+skip2+(n-1)*7);return d;};
  // Monday before May 25 (Victoria Day)
  const may25=new Date(year,4,25);const vd=may25.getDay();
  const victoria=new Date(may25);victoria.setDate(may25.getDate()-(vd===1?7:vd===0?6:vd-1));
  return [
    {name:"New Year's Day",  date:`${year}-01-01`},
    {name:"Family Day",      date:fmt(nthMon(1,3))},
    {name:"Good Friday",     date:fmt(goodFriday)},
    {name:"Victoria Day",    date:fmt(victoria)},
    {name:"Canada Day",      date:`${year}-07-01`},
    {name:"Civic Holiday",   date:fmt(nthMon(7,1))},
    {name:"Labour Day",      date:fmt(nthMon(8,1))},
    {name:"Thanksgiving",    date:fmt(nthMon(9,2))},
    {name:"Christmas Day",   date:`${year}-12-25`},
    {name:"Boxing Day",      date:`${year}-12-26`},
  ];
}

const ROLE_LEVELS: Record<string,number>={user:0,manager:1,admin:2,owner:3};
function roleAtLeast(userRole:string,minRole:string){return(ROLE_LEVELS[userRole]||0)>=(ROLE_LEVELS[minRole]||0);}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function OnCallManagerPage() {
  const role=useRole(), isAdmin=isAdminRole(role);
  const today=new Date();
  const [year,setYear]=useState(today.getFullYear());
  const [month,setMonth]=useState(today.getMonth());
  const [tab,setTab]=useState<"calendar"|"swaps"|"stats"|"setup">("calendar");
  const [refreshKey,setRefreshKey]=useState(0);
  function switchTab(t:"calendar"|"swaps"|"stats"|"setup"){setTab(t);setRefreshKey(k=>k+1);}
  const [statVisMinRole,setStatVisMinRole]=useState("manager");

  const [accessToken,setAccessToken]=useState("");
  const [connected,setConnected]=useState(false);
  const [events,setEvents]=useState<CalEvent[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  const [currentUser,setCurrentUser]=useState<UserInfo|null>(null);
  const [allUsers,setAllUsers]=useState<UserInfo[]>([]);
  const [swapRequests,setSwapRequests]=useState<SwapReq[]>([]);

  // Rebalance modal
  const [rebalanceModal,setRebalanceModal]=useState(false);

  // Floating progress bar — DOM-based so it renders immediately regardless of React batching
  function startProgress(title:string,message:string,total=0){
    let el=document.getElementById("__skyprog__");
    if(!el){el=document.createElement("div");el.id="__skyprog__";document.body.appendChild(el);}
    const fillBar=total>0?'<div style="height:6px;border-radius:99px;background:#e2e8f0;margin-bottom:8px;overflow:hidden"><div id="__skyprog_fill__" style="height:100%;border-radius:99px;background:#1565c0;width:0%;transition:width 0.3s ease"></div></div>':"";
    (el as HTMLElement).innerHTML='<div style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;background:white;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.18);padding:16px 24px;min-width:320px;max-width:480px;width:90%;font-family:sans-serif"><div style="font-weight:700;font-size:14px;color:#0d2e5e;margin-bottom:8px">'+title+'</div>'+fillBar+'<div id="__skyprog_msg__" style="font-size:12px;color:#374151">'+message+'</div></div>';
  }
  function tickProgress(message:string,done:number,total:number){
    const msg=document.getElementById("__skyprog_msg__");
    const fill=document.getElementById("__skyprog_fill__");
    if(msg) msg.textContent=message;
    if(fill) fill.style.width=`${total>0?Math.round((done/total)*100):0}%`;
  }
  function finishProgress(message:string){
    const msg=document.getElementById("__skyprog_msg__");
    const fill=document.getElementById("__skyprog_fill__");
    const bar=document.querySelector("#__skyprog__ div") as HTMLElement|null;
    if(msg){msg.textContent=message;msg.style.color="#059669";}
    if(fill){fill.style.width="100%";fill.style.background="#059669";}
    if(bar){
      const btn=document.createElement("button");
      btn.textContent="✕";btn.style.cssText="position:absolute;top:12px;right:16px;background:none;border:none;cursor:pointer;font-size:18px;color:#9ca3af";
      btn.onclick=()=>document.getElementById("__skyprog__")?.remove();
      bar.style.position="relative";bar.appendChild(btn);
    }
  }

  // Swap modal
  const [swapModal,setSwapModal]=useState<{event:CalEvent}|null>(null);
  const [swapTargetUid,setSwapTargetUid]=useState("");
  const [swapTargetName,setSwapTargetName]=useState("");
  const [swapTheirDate,setSwapTheirDate]=useState("");
  const [swapReason,setSwapReason]=useState("");
  const [swapSubmitting,setSwapSubmitting]=useState(false);
  const [targetFutureEvents,setTargetFutureEvents]=useState<CalEvent[]>([]);
  const [rosterNames,setRosterNames]=useState<string[]>([]);
  // Add-event modal
  const [addModal,setAddModal]=useState<{date:string}|null>(null);
  const [addName,setAddName]=useState("");
  const [addType,setAddType]=useState<"oncall"|"vacation">("oncall");
  const [addMultiDay,setAddMultiDay]=useState(false);
  const [addEndDate,setAddEndDate]=useState("");
  const [addSubmitting,setAddSubmitting]=useState(false);

  // Auth user
  useEffect(()=>{ return onAuthStateChanged(auth, u=>{ if(u) setCurrentUser({uid:u.uid,displayName:u.displayName||u.email||"Me"}); }); },[]);

  // Load all users
  useEffect(()=>{
    getDocs(collection(db,"users")).then(snap=>{
      setAllUsers(snap.docs.map(d=>({ uid:d.data().uid||d.id, displayName:d.data().displayName||d.data().email||d.id })));
    }).catch(()=>{});
    // Load on-call roster
    getDoc(doc(db,"settings","onCallConfig")).then(snap=>{
      if(snap.exists()&&snap.data().employees) setRosterNames(snap.data().employees);
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
      try {
        const cfg=await getDoc(doc(db,"settings","oncallConfig"));
        if(cfg.exists()&&cfg.data().statVisMinRole) setStatVisMinRole(cfg.data().statVisMinRole);
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
  },[accessToken,year,month,refreshKey]);


  async function connectOutlook() {
    const v=genVerifier(), c=await genChallenge(v);
    sessionStorage.setItem("pkce_verifier",v);
    window.location.href=`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent("Calendars.ReadWrite offline_access")}&response_mode=query&code_challenge=${c}&code_challenge_method=S256&prompt=login`;
  }

  // ── Calendar Backup ──────────────────────────────────────────────────────────
  async function backupCalendar(trigger: string) {
    if (!accessToken) return;
    try {
      // Fetch all on-call events for the next 400 days
      const start = new Date().toISOString().slice(0,10);
      const endD  = new Date(); endD.setDate(endD.getDate()+400);
      const end   = endD.toISOString().slice(0,10);
      const evs: any[] = [];
      let url = `https://graph.microsoft.com/v1.0/me/calendars/${CAL_ID}/calendarView?startDateTime=${start}T00:00:00&endDateTime=${end}T00:00:00&$top=999&$select=id,subject,start,end,isAllDay`;
      while (url) {
        const d = await graphFetch(accessToken, url.replace("https://graph.microsoft.com/v1.0",""));
        (d.value||[]).filter((e:any)=>{const s=(e.subject||"").toLowerCase();return(s.includes("on call")||s.includes("oncall"))&&!s.includes("vacation");})
          .forEach((e:any)=>{
            const s=e.start?.date||e.start?.dateTime?.slice(0,10)||"";
            let en=e.end?.date||e.end?.dateTime?.slice(0,10)||"";
            // Fallback: if end missing or same as start, set end = start + 1 day
            if(!en||en===s){const d=new Date(s);d.setDate(d.getDate()+1);en=d.toISOString().slice(0,10);}
            evs.push({id:e.id,subject:e.subject,start:s,end:en,isAllDay:e.isAllDay});
          });
        url = d["@odata.nextLink"]||"";
      }
      await addDoc(collection(db,"calendarBackups"),{
        trigger, eventCount: evs.length, events: evs, createdAt: serverTimestamp()
      });
      // Keep only last 10 backups
      const bSnap = await getDocs(query(collection(db,"calendarBackups"), orderBy("createdAt","desc"), limit(20)));
      const toDelete = bSnap.docs.slice(10);
      for (const d of toDelete) await deleteDoc(doc(db,"calendarBackups",d.id));
    } catch(e) { console.warn("Backup failed silently:", e); }
  }

  async function restoreBackup(backup: any) {
    if (!accessToken) return;
    if (!window.confirm(`Restore ${backup.eventCount} events from backup taken ${new Date(backup.createdAt?.toDate?.()).toLocaleString()}?\n\nThis will delete all current on-call events and restore the backup.`)) return;

    startProgress("↩ Restoring backup", "Fetching current events…", 0);

    // Fetch + delete all current on-call events
    const start = new Date().toISOString().slice(0,10);
    const endD = new Date(); endD.setDate(endD.getDate()+400);
    const end = endD.toISOString().slice(0,10);
    const existing: any[] = [];
    let url = `https://graph.microsoft.com/v1.0/me/calendars/${CAL_ID}/calendarView?startDateTime=${start}T00:00:00&endDateTime=${end}T00:00:00&$top=999&$select=id,subject`;
    while (url) {
      const d = await graphFetch(accessToken, url.replace("https://graph.microsoft.com/v1.0",""));
      (d.value||[]).filter((e:any)=>{const s=(e.subject||"").toLowerCase();return(s.includes("on call")||s.includes("oncall"))&&!s.includes("vacation");}).forEach((e:any)=>existing.push(e));
      url = d["@odata.nextLink"]||"";
    }

    let deleted=0;
    for (let i=0;i<existing.length;i+=20) {
      const chunk=existing.slice(i,i+20);
      await graphFetch(accessToken,"/$batch","POST",{requests:chunk.map((e:any,j:number)=>({id:String(j+1),method:"DELETE",url:`/me/events/${e.id}`}))}).catch(()=>{});
      deleted+=chunk.length;
      tickProgress(`Clearing old events… ${deleted}/${existing.length}`, deleted, existing.length+backup.eventCount);
    }

    // Recreate from backup — with exponential backoff on throttle
    // Only restore future events (past events were never deleted so they're still in the calendar)
    // Normalise events: compute end if missing
    const normalised = backup.events.map((e:any)=>{
      let en=e.end||"";
      if((!en||en===e.start)&&e.start){const d=new Date(e.start);d.setDate(d.getDate()+1);en=d.toISOString().slice(0,10);}
      return {...e,end:en};
    });
    const past = normalised.filter((e:any)=>e.end<=start).length;
    const toAdd = normalised.filter((e:any)=>e.end>start&&e.start);
    tickProgress(`Restoring ${toAdd.length} future events (${past} past events already in calendar)…`, 0, toAdd.length);
    let pushed=0;
    async function createEvent(e:any):Promise<boolean>{
      for(let attempt=0;attempt<4;attempt++){
        if(attempt>0) await new Promise(r=>setTimeout(r,1000*Math.pow(2,attempt))); // 2s, 4s, 8s
        const res=await graphFetch(accessToken,`/me/calendars/${CAL_ID}/events`,"POST",{
          subject:e.subject,
          start:{dateTime:`${e.start}T00:00:00`,timeZone:"America/Toronto"},
          end:{dateTime:`${e.end}T00:00:00`,timeZone:"America/Toronto"},
          isAllDay:true
        }).catch(()=>null);
        if(res?.id) return true;
      }
      return false;
    }
    for(let i=0;i<toAdd.length;i++){
      const ok=await createEvent(toAdd[i]);
      if(ok) pushed++;
      tickProgress(`Restoring… ${pushed}/${toAdd.length}`, pushed, toAdd.length);
      await new Promise(r=>setTimeout(r,300)); // base delay between events
    }
    const failed=toAdd.length-pushed;
    finishProgress(`✅ Restored ${pushed}/${toAdd.length} events${failed>0?` · ${failed} failed — run Fill 365 Days to patch`:""}`);
    setEvents([]);
  }

  // Swap actions
  async function submitSwap() {
    if(!swapModal||!swapTargetName||!swapTheirDate||!currentUser) return;
    setSwapSubmitting(true);
    const myName=getName(swapModal.event.subject);
    // Find target's event on their date
    const theirEvent=targetFutureEvents.find(e=>e.start===swapTheirDate)||events.find(e=>e.start===swapTheirDate&&getName(e.subject).toLowerCase()===swapTargetName.toLowerCase());
    // Find target user in Firestore (may not exist)
    const targetUser=allUsers.find(u=>u.displayName.split(" ")[0].toLowerCase()===swapTargetName.toLowerCase());
    await addDoc(collection(db,"onCallSwapRequests"),{
      requesterUid:currentUser.uid, requesterName:myName,
      targetUid:targetUser?.uid||swapTargetName, targetName:swapTargetName,
      myDate:swapModal.event.start, myEventId:swapModal.event.id,
      theirDate:swapTheirDate, theirEventId:theirEvent?.id||"",
      reason:swapReason, status:"PENDING", createdAt:serverTimestamp()
    });
    setSwapModal(null); setSwapReason(""); setSwapTargetName(""); setSwapTargetUid(""); setSwapTheirDate(""); setSwapSubmitting(false);
  }

  async function resolveSwap(swap:SwapReq, accept:boolean) {
    if(accept&&accessToken) {
      await backupCalendar(`swap:${swap.requesterName}↔${swap.targetName}:${swap.myDate}`);
      // Update both calendar events
      await graphFetch(accessToken,`/me/events/${swap.myEventId}`,"PATCH",{subject:`${swap.targetName.split(" ")[0]} On Call`}).catch(()=>{});
      await graphFetch(accessToken,`/me/events/${swap.theirEventId}`,"PATCH",{subject:`${swap.requesterName.split(" ")[0]} On Call`}).catch(()=>{});
    }
    await updateDoc(doc(db,"onCallSwapRequests",swap.id),{ status:accept?"ACCEPTED":"DECLINED", resolvedAt:serverTimestamp() });
    if(accept) setEvents(prev=>prev.map(e=>{ if(e.id===swap.myEventId) return {...e,subject:`${swap.targetName.split(" ")[0]} On Call`}; if(e.id===swap.theirEventId) return {...e,subject:`${swap.requesterName.split(" ")[0]} On Call`}; return e; }));
  }

  async function runRotation(action:"preview"|"push"|"rebalance", rebalanceFrom?:string) {
    if(!accessToken) return;
    const rotDays=parseInt((document.getElementById("rot-days") as HTMLSelectElement)?.value||"1");
    const shuffle=(document.getElementById("rot-shuffle") as HTMLInputElement)?.checked;

    // 365-day rolling window from today
    const today=new Date().toISOString().slice(0,10);
    const startDate=action==="rebalance"&&rebalanceFrom?rebalanceFrom:today;
    const endDate=new Date(); endDate.setDate(endDate.getDate()+364);
    const endStr=endDate.toISOString().slice(0,10);

    // Get roster — this IS the rotation order, single source of truth
    const cfgSnap=await getDoc(doc(db,"settings","onCallConfig")).catch(()=>null);
    const roster:string[]=cfgSnap?.data()?.employees||rosterNames;
    if(!roster.length){ finishProgress("No employees in roster. Go to Setup → On-Call Roster."); return; }

    const actionLabel=action==="preview"?"👁 Preview":action==="rebalance"?"⚖ Rebalance":"⬆ Fill 365 Days";
    startProgress(actionLabel, `Roster: ${roster.join(", ")}`, 365);

    if(action!=="preview") await backupCalendar(action);
    // tickProgress after first await so React has committed the startProgress update
    tickProgress(action==="preview"?"Building preview…":action==="rebalance"?"Fetching events to rebalance…":"Fetching existing events…",0,365);

    // Fetch existing on-call events in the window
    const existingEvs:any[]=[];
    let url=`https://graph.microsoft.com/v1.0/me/calendars/${CAL_ID}/calendarView?startDateTime=${startDate}T00:00:00&endDateTime=${endStr}T23:59:59&$top=999&$select=id,subject,start&$orderby=start/dateTime`;
    while(url){ const d=await graphFetch(accessToken,url.replace("https://graph.microsoft.com/v1.0","")); (d.value||[]).filter((e:any)=>{const s=(e.subject||"").toLowerCase();return(s.includes("on call")||s.includes("oncall"))&&!s.includes("vacation");}).forEach((e:any)=>existingEvs.push(e)); url=d["@odata.nextLink"]||""; }

    const occupied=new Set(existingEvs.map((e:any)=>e.start?.date||e.start?.dateTime?.slice(0,10)));

    if(action==="rebalance"){
      // Check if the target year is locked
      const rebalYear=parseInt((rebalanceFrom||startDate).slice(0,4));
      const lockSnap=await getDoc(doc(db,"settings","lockedYears")).catch(()=>null);
      const lockedYears:number[]=lockSnap?.data()?.years||[];
      if(lockedYears.includes(rebalYear)){
        finishProgress(`🔒 ${rebalYear} is locked and cannot be rebalanced.`);
        return;
      }
      let deleted=0;
      for(let i=0;i<existingEvs.length;i+=20){
        const chunk=existingEvs.slice(i,i+20);
        await graphFetch(accessToken,"/$batch","POST",{requests:chunk.map((e:any,j:number)=>({id:String(j+1),method:"DELETE",url:`/me/events/${e.id}`}))}).catch(()=>{});
        deleted+=chunk.length;
        tickProgress(`Clearing old events… ${deleted}/${existingEvs.length}`, deleted, existingEvs.length+365);
      }
      occupied.clear();
    }

    if(action==="preview"){finishProgress(`${existingEvs.length} days assigned, ${364-existingEvs.length} gaps. Push to fill.`);return;}

    // Find the last scheduled person BEFORE the start date to continue the rotation
    // This is the key: we derive where we are in the rotation from the calendar itself
    let startIdx=0;
    if(action==="push"&&existingEvs.length>0){
      // Find last person before or at the first gap
      const lastEv=existingEvs[existingEvs.length-1];
      const lastName=getName(lastEv.subject);
      const lastIdx=roster.findIndex(n=>n.toLowerCase()===lastName.toLowerCase());
      if(lastIdx>=0) startIdx=(lastIdx+1)%roster.length;
    } else if(action==="rebalance"){
      // For rebalance: look at the event just before rebalanceFrom in the full calendar
      const prevEvs:any[]=[];
      const prevStart=new Date(startDate); prevStart.setDate(prevStart.getDate()-(rotDays*roster.length+5));
      let pUrl=`https://graph.microsoft.com/v1.0/me/calendars/${CAL_ID}/calendarView?startDateTime=${prevStart.toISOString().slice(0,10)}T00:00:00&endDateTime=${startDate}T00:00:00&$top=999&$select=id,subject,start&$orderby=start/dateTime`;
      while(pUrl){ const d=await graphFetch(accessToken,pUrl.replace("https://graph.microsoft.com/v1.0","")); (d.value||[]).filter((e:any)=>{const s=(e.subject||"").toLowerCase();return(s.includes("on call")||s.includes("oncall"))&&!s.includes("vacation");}).forEach((e:any)=>prevEvs.push(e)); pUrl=d["@odata.nextLink"]||""; }
      if(prevEvs.length>0){
        const lastName=getName(prevEvs[prevEvs.length-1].subject);
        const lastIdx=roster.findIndex(n=>n.toLowerCase()===lastName.toLowerCase());
        if(lastIdx>=0) startIdx=(lastIdx+1)%roster.length;
      }
      if(shuffle) startIdx=0;
    }

    // Build schedule — gaps only, continuing rotation from where calendar left off
    const toAdd:any[]=[];
    tickProgress(`Starting from ${roster[startIdx]} (${startIdx+1}/${roster.length}) — building schedule…`, 0, 365);
    let cur=new Date(startDate), idx=startIdx;
    while(cur.toISOString().slice(0,10)<=endStr){
      const d=cur.toISOString().slice(0,10);
      if(!occupied.has(d)){
        const end2=new Date(cur); end2.setDate(end2.getDate()+rotDays);
        toAdd.push({subject:`${roster[idx%roster.length]} On Call`,start:{dateTime:`${d}T00:00:00`,timeZone:"America/Toronto"},end:{dateTime:`${end2.toISOString().slice(0,10)}T00:00:00`,timeZone:"America/Toronto"},isAllDay:true});
        idx++;
      } else {
        // Still advance rotation index for occupied days
        idx++;
      }
      cur.setDate(cur.getDate()+rotDays);
    }


    tickProgress(`Pushing ${toAdd.length} events…`, 0, toAdd.length);
    let pushed=0;
    for(let i=0;i<toAdd.length;i+=4){
      const chunk=toAdd.slice(i,i+4);
      await graphFetch(accessToken,"/$batch","POST",{requests:chunk.map((e:any,j:number)=>({id:String(j+1),method:"POST",url:`/me/calendars/${CAL_ID}/events`,headers:{"Content-Type":"application/json"},body:e}))}).catch(()=>{});
      pushed+=chunk.length;
      tickProgress(`Pushing events… ${pushed}/${toAdd.length}`, pushed, toAdd.length);
      await new Promise(r=>setTimeout(r,200));
    }
    finishProgress(`✅ Done! ${pushed} events created.`);
  }

  // Admin: add an on-call or vacation event (one day or a range) from the calendar grid
  async function submitAddEvent(){
    if(!addModal||!accessToken||!addName.trim()) return;
    const isVac = addType==="vacation";
    setAddSubmitting(true);
    const subject = isVac ? `${addName.trim()} Vacation` : `${addName.trim()} On Call`;
    const targetCal = CAL_ID; // one shared calendar; subject distinguishes type
    const startDate = addModal.date;
    const lastDate  = addMultiDay && addEndDate ? addEndDate : startDate;
    try{
      if(isVac){
        // Single multi-day all-day event on the Vacation calendar
        const nx=new Date(lastDate); nx.setDate(nx.getDate()+1);
        await graphFetch(accessToken,`/me/calendars/${targetCal}/events`,"POST",{
          subject,
          start:{dateTime:`${startDate}T00:00:00`,timeZone:"America/Toronto"},
          end:{dateTime:`${nx.toISOString().slice(0,10)}T00:00:00`,timeZone:"America/Toronto"},
          isAllDay:true
        });
      } else {
        // One all-day event per day so each day shows on the on-call grid
        const days:string[]=[];
        let d=new Date(startDate); const last=new Date(lastDate);
        while(d<=last){ days.push(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1); }
        for(const day of days){
          const nx=new Date(day); nx.setDate(nx.getDate()+1);
          await graphFetch(accessToken,`/me/calendars/${targetCal}/events`,"POST",{
            subject,
            start:{dateTime:`${day}T00:00:00`,timeZone:"America/Toronto"},
            end:{dateTime:`${nx.toISOString().slice(0,10)}T00:00:00`,timeZone:"America/Toronto"},
            isAllDay:true
          });
        }
      }
      setAddModal(null); setAddName(""); setAddType("oncall"); setAddMultiDay(false); setAddEndDate("");
      setRefreshKey(k=>k+1);
    }catch{ window.alert("Failed to add event. Try again."); }
    setAddSubmitting(false);
  }

  const eventMap:Record<string,CalEvent[]>={};
  events.forEach(e=>{if(!eventMap[e.start])eventMap[e.start]=[];eventMap[e.start].push(e);});
  const todayStr=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const grid=calGrid(year,month);

  const myPendingSwaps=swapRequests.filter(s=>s.status==="PENDING"&&(s.targetUid===currentUser?.uid||(isAdmin)));
  const pendingCount=myPendingSwaps.length;

  return (
    <div>
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
        <TabBtn label="📅 Calendar" active={tab==="calendar"} onClick={()=>switchTab("calendar")}/>
        <TabBtn label={`🔄 Swaps${pendingCount>0?` (${pendingCount})`:""}`} active={tab==="swaps"} onClick={()=>switchTab("swaps")}/>
        {roleAtLeast(role||"user",statVisMinRole)&&<TabBtn label="🎉 Stat Holidays" active={tab==="stats"} onClick={()=>switchTab("stats")}/>}
        {isAdmin&&<TabBtn label="⚙ Setup" active={tab==="setup"} onClick={()=>switchTab("setup")}/>}
      </div>

      {/* ── CALENDAR TAB ── */}
      {tab==="calendar"&&(
        <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <button onClick={()=>{let m=month-1,y=year;if(m<0){m=11;y--;}setMonth(m);setYear(y);}} style={navS}>◀</button>
            <span style={{fontWeight:700,fontSize:18,color:"#0d2e5e"}}>{MONTHS[month]} {year}</span>
            <button onClick={()=>{let m=month+1,y=year;if(m>11){m=0;y++;}setMonth(m);setYear(y);}} style={navS}>▶</button>
          </div>
          <div style={{display:"flex",gap:16,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{background:"#1565c0",color:"#fff",fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:99}}>📞 On Call</span>
            {connected&&<span style={{fontSize:11,color:"#9ca3af"}}>Click your on-call day to request a swap{isAdmin?" · tap ＋ to add an event":""}</span>}
          </div>
          {loading&&<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}>⏳ Loading...</div>}
          {!connected&&!loading&&<div style={{textAlign:"center",padding:40,color:"#9ca3af"}}>Connect Outlook above to view the calendar.</div>}
          {connected&&!loading&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
              {DAYS.map(d=><div key={d} style={{textAlign:"center",fontSize:12,fontWeight:700,color:"#6b7280",padding:"8px 0",textTransform:"uppercase"}}>{d}</div>)}
              {grid.map((date,i)=>{
                const isOnCall=(s:string)=>{const l=s.toLowerCase();return(l.includes("on call")||l.includes("oncall"))&&!l.includes("vacation");};
                const dayEvs=date?(eventMap[date]||[]).filter(e=>isOnCall(e.subject)):[];
                const isToday=date===todayStr;
                const myOncall=dayEvs.find(e=>getName(e.subject).toLowerCase()===currentUser?.displayName?.split(" ")[0].toLowerCase());
                // Admin can click any on-call event; user can only click their own
                const clickableOncall=isAdmin?dayEvs.find(e=>isOnCall(e.subject)):myOncall;
                return(
                  <div key={i} style={{minHeight:110,background:isToday?"#eff6ff":"#fafafa",border:isToday?"2px solid #1565c0":"1px solid #e5e7eb",borderRadius:6,padding:6,cursor:clickableOncall?"pointer":"default"}}
                    onClick={()=>{ if(clickableOncall&&connected) setSwapModal({event:clickableOncall}); }}>
                    {date&&<>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                        <span style={{fontSize:12,fontWeight:isToday?800:500,color:isToday?"#1565c0":"#374151"}}>{parseInt(date.slice(8))}</span>
                        {isAdmin&&connected&&<button title="Add event" onClick={(e)=>{e.stopPropagation();setAddModal({date});setAddName("");setAddType("oncall");setAddMultiDay(false);setAddEndDate(date);}} style={{background:"none",border:"none",color:"#1565c0",fontSize:14,fontWeight:700,cursor:"pointer",lineHeight:1,padding:0}}>＋</button>}
                      </div>
                      {dayEvs.map(ev=>{const c=pillStyle(ev.subject);const n=getName(ev.subject);return(
                        <div key={ev.id} style={{fontSize:11,fontWeight:600,background:c.bg,color:c.color,borderRadius:4,padding:"2px 5px",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {c.prefix}{n}
                        </div>);})}
                      {clickableOncall&&<div style={{fontSize:9,color:"#1565c0",marginTop:2}}>tap to swap</div>}
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

      {/* ── STATS TAB ── */}
      {tab==="stats"&&roleAtLeast(role||"user",statVisMinRole)&&(
        <div style={{background:"white",borderRadius:12,padding:24,boxShadow:"0 1px 4px rgba(0,0,0,0.07)"}}>
          <h2 style={{fontSize:16,fontWeight:700,color:"#0d2e5e",marginBottom:4}}>🎉 Stat Holiday Assignments</h2>
          <p style={{fontSize:12,color:"#6b7280",marginBottom:16}}>Canadian statutory holidays (Federal + Ontario) and who is on-call. Each person is limited to 1 stat per year.</p>
          <StatHolidaysPanel accessToken={accessToken} calId={CAL_ID} db={db}/>
        </div>
      )}

      {/* ── SETUP TAB ── */}
      {tab==="setup"&&isAdmin&&(
        <div>
          {/* Connection */}
          <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",marginBottom:16}}>
            <h2 style={{fontSize:15,fontWeight:700,color:"#0d2e5e",marginBottom:12}}>Outlook Connection</h2>
            {connected
              ? <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <span style={{fontSize:13,color:"#059669",fontWeight:600}}>✅ Connected to Outlook</span>
                  <button onClick={connectOutlook} style={{...btnS("#6b7280"),fontSize:12,padding:"5px 14px"}}>🔄 Reconnect</button>
                </div>
              : <><p style={{fontSize:13,color:"#6b7280",marginBottom:10}}>Sign in with the SkySuite Outlook account to enable calendar features.</p>
                 <button onClick={connectOutlook} style={btnS("#1565c0")}>🔗 Connect Outlook</button></>}
          </div>

          {/* On-Call Roster */}
          <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",marginBottom:16}}>
            <h2 style={{fontSize:15,fontWeight:700,color:"#0d2e5e",marginBottom:4}}>👥 On-Call Roster</h2>
            <p style={{fontSize:12,color:"#6b7280",marginBottom:14}}>Select which employees are in the on-call rotation. Reads from all user accounts.</p>
            <OnCallRoster db={db} allUsers={allUsers} onSaved={r => setRosterNames(r)}/>
          </div>

          {/* Stat Holiday Visibility */}
          <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",marginBottom:16}}>
            <h2 style={{fontSize:15,fontWeight:700,color:"#0d2e5e",marginBottom:4}}>🎉 Stat Holiday Visibility</h2>
            <p style={{fontSize:12,color:"#6b7280",marginBottom:12}}>Choose the minimum role that can see the Stat Holidays tab.</p>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <select value={statVisMinRole} onChange={async e=>{
                const v=e.target.value; setStatVisMinRole(v);
                await setDoc(doc(db,"settings","oncallConfig"),{statVisMinRole:v},{merge:true});
              }} style={{...inp,maxWidth:160}}>
                <option value="user">All Users</option>
                <option value="manager">Manager +</option>
                <option value="admin">Admin +</option>
                <option value="owner">Owner only</option>
              </select>
              <span style={{fontSize:12,color:"#059669",fontWeight:600}}>✅ Saved automatically</span>
            </div>
          </div>

          {/* Rotation Planner */}
          <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)"}}>
            <h2 style={{fontSize:15,fontWeight:700,color:"#0d2e5e",marginBottom:4}}>🔁 Rotation Planner</h2>
            <p style={{fontSize:12,color:"#6b7280",marginBottom:4}}>Always maintains exactly 365 days scheduled. Rotation order shuffles automatically on Jan 1 each year.</p>
            <p style={{fontSize:11,color:"#9ca3af",marginBottom:16}}>Push fills the next 365 days. Rebalance clears from a date and rebuilds.</p>

            {/* Year rotation orders display */}
            <RotationOrderDisplay db={db} accessToken={accessToken}/>

            <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-end",margin:"16px 0"}}>
              <div><label style={lbl}>Days per person</label>
                <select id="rot-days" style={{...inp,maxWidth:120}}>
                  <option value="1">1 day</option><option value="2">2 days</option><option value="7">7 days</option><option value="14">14 days</option>
                </select>
              </div>

              <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:"#374151",paddingBottom:2}}>
                <input type="checkbox" id="rot-shuffle" style={{width:15,height:15}}/>Shuffle order
              </label>
            </div>

            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button onClick={()=>runRotation("preview")}   disabled={!connected} style={btnS("#6b7280")}>👁 Preview</button>
              <button onClick={()=>runRotation("push")}      disabled={!connected} style={btnS("#1565c0")}>⬆ Fill 365 Days</button>
              <button onClick={()=>setRebalanceModal(true)} disabled={!connected} style={btnS("#f97316")}>⚖ Rebalance</button>
            </div>
          </div>

          {/* Locked Years */}
          <LockedYearsPanel db={db}/>

          {/* Backups */}
          <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",marginTop:16}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
              <h2 style={{fontSize:15,fontWeight:700,color:"#0d2e5e",margin:0}}>🗄 Calendar Backups</h2>
              <button onClick={async()=>{await backupCalendar("manual");window.location.reload();}} disabled={!connected} style={{...btnS("#6b7280"),fontSize:12,padding:"5px 14px"}}>📸 Backup Now</button>
            </div>
            <p style={{fontSize:12,color:"#6b7280",marginBottom:14}}>Auto-saved before every swap, push, or rebalance. Last 10 kept. Click ↩ Restore to roll back.</p>
            <BackupsList db={db} onRestore={restoreBackup} connected={connected}/>
          </div>
        </div>
      )}


      {/* ── ADD EVENT MODAL ── */}
      {addModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"white",borderRadius:16,padding:28,width:"100%",maxWidth:420,boxShadow:"0 8px 40px rgba(0,0,0,0.2)"}}>
            <h2 style={{fontSize:18,fontWeight:700,color:"#0d2e5e",marginBottom:16}}>Add Event</h2>

            <label style={lbl}>Type</label>
            <div style={{display:"flex",gap:10,marginBottom:14}}>
              <button onClick={()=>setAddType("oncall")} style={{flex:1,padding:"8px",borderRadius:8,fontWeight:700,fontSize:13,cursor:"pointer",border:`2px solid ${addType==="oncall"?"#1565c0":"#d1d5db"}`,background:addType==="oncall"?"#eff6ff":"#fff",color:addType==="oncall"?"#1565c0":"#374151"}}>📞 On Call</button>
              <button onClick={()=>setAddType("vacation")} style={{flex:1,padding:"8px",borderRadius:8,fontWeight:700,fontSize:13,cursor:"pointer",border:`2px solid ${addType==="vacation"?"#f97316":"#d1d5db"}`,background:addType==="vacation"?"#fff7ed":"#fff",color:addType==="vacation"?"#ea580c":"#374151"}}>🏖 Vacation</button>
            </div>

            <label style={lbl}>Person</label>
            <select value={addName} onChange={e=>setAddName(e.target.value)} style={{...inp,marginBottom:14}}>
              <option value="">Select person…</option>
              {(rosterNames.length>0?rosterNames:allUsers.map(u=>u.displayName.split(" ")[0])).map(n=><option key={n} value={n}>{n}</option>)}
            </select>

            <label style={lbl}>Start date</label>
            <input type="date" value={addModal.date} onChange={e=>setAddModal({date:e.target.value})} style={{...inp,marginBottom:14}}/>

            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#374151",marginBottom:addMultiDay?10:14,cursor:"pointer"}}>
              <input type="checkbox" checked={addMultiDay} onChange={e=>{setAddMultiDay(e.target.checked);if(e.target.checked&&!addEndDate)setAddEndDate(addModal.date);}} style={{width:15,height:15}}/>
              Multi-day event
            </label>
            {addMultiDay&&<>
              <label style={lbl}>End date</label>
              <input type="date" value={addEndDate} min={addModal.date} onChange={e=>setAddEndDate(e.target.value)} style={{...inp,marginBottom:14}}/>
            </>}

            <div style={{display:"flex",gap:10,marginTop:8}}>
              <button disabled={!addName||addSubmitting} onClick={submitAddEvent} style={{...btnS(addType==="vacation"?"#f97316":"#1565c0"),opacity:(!addName||addSubmitting)?0.5:1}}>{addSubmitting?"Adding…":"Add to Calendar"}</button>
              <button onClick={()=>setAddModal(null)} style={btnS("#6b7280")}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── REBALANCE MODAL ── */}
      {rebalanceModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"white",borderRadius:16,padding:32,width:"100%",maxWidth:380,boxShadow:"0 8px 40px rgba(0,0,0,0.2)",textAlign:"center"}}>
            <div style={{fontSize:32,marginBottom:12}}>⚖️</div>
            <h2 style={{fontSize:18,fontWeight:800,color:"#0d2e5e",marginBottom:8}}>Rebalance Rotation</h2>
            <p style={{fontSize:13,color:"#6b7280",marginBottom:24}}>Choose which year to rebalance. This will clear and rebuild the on-call schedule from Jan 1 of the selected year.</p>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <button
                style={{...btnS("#1565c0"),fontSize:15,padding:"12px"}}
                onClick={()=>{setRebalanceModal(false);runRotation("rebalance",`${today.getFullYear()}-01-01`);}}>
                📅 Current Year ({today.getFullYear()})
              </button>
              <button
                style={{...btnS("#059669"),fontSize:15,padding:"12px"}}
                onClick={()=>{setRebalanceModal(false);runRotation("rebalance",`${today.getFullYear()+1}-01-01`);}}>
                📅 Next Year ({today.getFullYear()+1})
              </button>
              <button
                style={{...btnS("#6b7280"),fontSize:15,padding:"12px"}}
                onClick={()=>setRebalanceModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SWAP MODAL ── */}
      {swapModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"white",borderRadius:16,padding:28,width:"100%",maxWidth:420,boxShadow:"0 8px 40px rgba(0,0,0,0.2)"}}>
            <h2 style={{fontSize:18,fontWeight:700,color:"#0d2e5e",marginBottom:4}}>Request Swap</h2>
            <p style={{fontSize:13,color:"#6b7280",marginBottom:16}}>Your on-call day: <strong>{swapModal.event.start}</strong></p>

            <label style={lbl}>Swap with</label>
            <select value={swapTargetName} onChange={async e=>{
              const name=e.target.value; setSwapTargetName(name); setSwapTheirDate(""); setTargetFutureEvents([]);
              if(!name||!accessToken) return;
              // Fetch all future on-call events for this person across 12 months
              const today2=new Date().toISOString().slice(0,10);
              const end2=new Date(); end2.setMonth(end2.getMonth()+12);
              let url=`https://graph.microsoft.com/v1.0/me/calendars/${CAL_ID}/calendarView?startDateTime=${today2}T00:00:00&endDateTime=${end2.toISOString().slice(0,10)}T00:00:00&$top=999&$select=id,subject,start`;
              const evs:CalEvent[]=[];
              while(url){const d=await(await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`}})).json();(d.value||[]).filter((e:any)=>{const s=(e.subject||"").toLowerCase();return(s.includes("on call")||s.includes("oncall"))&&!s.includes("vacation")&&getName(e.subject).toLowerCase()===name.toLowerCase();}).forEach((e:any)=>evs.push({id:e.id,subject:e.subject,start:e.start?.date||e.start?.dateTime?.slice(0,10)||"",end:e.end?.date||e.end?.dateTime?.slice(0,10)||""}));url=d["@odata.nextLink"]||"";}
              setTargetFutureEvents(evs);
            }} style={inp}>
              <option value="">— Select person —</option>
              {(rosterNames.length>0?rosterNames:allUsers.map(u=>u.displayName.split(" ")[0]))
                .filter(n=>n.toLowerCase()!==getName(swapModal.event.subject).toLowerCase())
                .map(n=><option key={n} value={n}>{n}</option>)}
            </select>

            <label style={{...lbl,marginTop:12}}>Their date to swap {swapTargetName&&targetFutureEvents.length===0&&<span style={{color:"#9ca3af",fontWeight:400}}>(loading...)</span>}</label>
            <select value={swapTheirDate} onChange={e=>setSwapTheirDate(e.target.value)} style={inp}>
              <option value="">— Select date —</option>
              {targetFutureEvents.map(e=><option key={e.id} value={e.start}>{e.start}</option>)}
            </select>

            <label style={{...lbl,marginTop:12}}>Reason (optional)</label>
            <input value={swapReason} onChange={e=>setSwapReason(e.target.value)} placeholder="e.g. family event" style={{...inp,marginBottom:0}}/>

            <div style={{display:"flex",gap:10,marginTop:20}}>
              <button onClick={()=>setSwapModal(null)} style={btnS("#6b7280")}>Cancel</button>
              <button onClick={submitSwap} disabled={!swapTargetName||!swapTheirDate||swapSubmitting} style={btnS("#1565c0")}>{swapSubmitting?"Sending...":"Send Request"}</button>
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

function IcsExportPanel({ accessToken, calId, db }: { accessToken:string; calId:string; db:any }) {
  const [roster,setRoster]=useState<string[]>([]);
  const [busy,setBusy]=useState<string|null>(null);
  useEffect(()=>{
    getDoc(doc(db,"settings","onCallConfig")).then(s=>setRoster(s.data()?.employees||[])).catch(()=>{});
  },[]);

  async function downloadIcs(name:string){
    setBusy(name);
    try{
      // Fetch on-call events for this person (next 400 days)
      const start=new Date().toISOString().slice(0,10);
      const endD=new Date();endD.setDate(endD.getDate()+400);
      const end=endD.toISOString().slice(0,10);
      const onCallEvents:any[]=[];
      let url=`https://graph.microsoft.com/v1.0/me/calendars/${calId}/calendarView?startDateTime=${start}T00:00:00&endDateTime=${end}T00:00:00&$top=999&$select=subject,start,end`;
      while(url){
        const d=await graphFetch(accessToken,url.replace("https://graph.microsoft.com/v1.0",""));
        (d.value||[]).filter((e:any)=>getName(e.subject||"").toLowerCase()===name.toLowerCase()).forEach((e:any)=>onCallEvents.push(e));
        url=d["@odata.nextLink"]||"";
      }
      // Fetch approved vacation for this person from Firestore
      const vSnap=await getDocs(query(collection(db,"timeOffRequests"),where("status","==","APPROVED")));
      const vacations=vSnap.docs.map(d=>d.data()).filter((r:any)=>r.employeeName?.toLowerCase()===name.toLowerCase()||(r.employeeName||"").split(" ")[0]?.toLowerCase()===name.toLowerCase());

      // Build ICS
      const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//SkySuite//On-Call Calendar//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH"];
      const stamp=new Date().toISOString().replace(/[-:]/g,"").slice(0,15)+"Z";
      onCallEvents.forEach((e:any,i:number)=>{
        const s=(e.start?.date||e.start?.dateTime?.slice(0,10)||"").replace(/-/g,"");
        const en=(e.end?.date||e.end?.dateTime?.slice(0,10)||"").replace(/-/g,"");
        if(!s)return;
        lines.push("BEGIN:VEVENT",`UID:oncall-${name}-${s}-${i}@skysuite.ca`,`DTSTAMP:${stamp}`,`DTSTART;VALUE=DATE:${s}`,`DTEND;VALUE=DATE:${en||s}`,`SUMMARY:${name} On Call`,"END:VEVENT");
      });
      vacations.forEach((r:any,i:number)=>{
        const s=(r.startDate||"").replace(/-/g,"");
        const enD=new Date(r.endDate||r.startDate);enD.setDate(enD.getDate()+1);
        const en=enD.toISOString().slice(0,10).replace(/-/g,"");
        if(!s)return;
        lines.push("BEGIN:VEVENT",`UID:vacation-${name}-${s}-${i}@skysuite.ca`,`DTSTAMP:${stamp}`,`DTSTART;VALUE=DATE:${s}`,`DTEND;VALUE=DATE:${en}`,`SUMMARY:${name} Vacation`,"END:VEVENT");
      });
      lines.push("END:VCALENDAR");
      const blob=new Blob([lines.join("\r\n")],{type:"text/calendar"});
      const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${name.replace(/\s+/g,"_")}_oncall.ics`;a.click();
    }catch(e){console.error(e);}
    setBusy(null);
  }

  if(!roster.length)return null;
  return(
    <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",marginTop:16}}>
      <h2 style={{fontSize:15,fontWeight:700,color:"#0d2e5e",margin:"0 0 4px"}}>📅 ICS Calendars</h2>
      <p style={{fontSize:12,color:"#6b7280",marginBottom:14}}>Download a personal .ics file for each person — includes their on-call days and approved vacation. Import into any calendar app.</p>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {roster.map(name=>(
          <button key={name} onClick={()=>downloadIcs(name)} disabled={busy===name} style={{...btnS(busy===name?"#9ca3af":"#1565c0"),fontSize:13,padding:"7px 14px"}}>
            {busy===name?"⏳ Building…":`⬇ ${name}`}
          </button>
        ))}
      </div>
    </div>
  );
}

function TwilioSettingsPanel({ db }: { db:any }) {
  const [sid,   setSid]   = useState("");
  const [token, setToken] = useState("");
  const [from,  setFrom]  = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(()=>{
    getDoc(doc(db,"settings","secrets")).then(s=>{
      const d = s.data()||{};
      setSid(d.twilioAccountSid||"");
      setToken(d.twilioAuthToken||"");
      setFrom(d.twilioFrom||"");
      setLoaded(true);
    }).catch(()=>setLoaded(true));
  },[]);

  async function save(){
    if(!sid.trim()||!token.trim()||!from.trim()) return;
    setSaving(true); setSaved(false);
    await setDoc(doc(db,"settings","secrets"),{ twilioAccountSid:sid.trim(), twilioAuthToken:token.trim(), twilioFrom:from.trim() },{merge:true});
    setSaving(false); setSaved(true);
    setTimeout(()=>setSaved(false),3000);
  }

  if(!loaded) return null;
  return(
    <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",marginTop:16}}>
      <h2 style={{fontSize:15,fontWeight:700,color:"#0d2e5e",margin:"0 0 4px"}}>📱 Twilio SMS Settings</h2>
      <p style={{fontSize:12,color:"#6b7280",marginBottom:14}}>Enter your Twilio credentials to enable SMS features. Find these in your <a href="https://console.twilio.com" target="_blank" rel="noreferrer" style={{color:"#1565c0"}}>Twilio Console</a>.</p>
      <div style={{display:"grid",gap:10,maxWidth:480}}>
        <div>
          <label style={lbl}>Account SID</label>
          <input style={inp} type="text" value={sid} onChange={e=>setSid(e.target.value)} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" autoComplete="off"/>
        </div>
        <div>
          <label style={lbl}>Auth Token</label>
          <input style={inp} type="password" value={token} onChange={e=>setToken(e.target.value)} placeholder="••••••••••••••••••••••••••••••••" autoComplete="off"/>
        </div>
        <div>
          <label style={lbl}>From Number (E.164)</label>
          <input style={inp} type="text" value={from} onChange={e=>setFrom(e.target.value)} placeholder="+12895551234"/>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12,marginTop:4}}>
          <button onClick={save} disabled={saving||!sid||!token||!from} style={btnS("#1565c0")}>{saving?"Saving…":"💾 Save"}</button>
          {saved&&<span style={{fontSize:13,color:"#059669",fontWeight:600}}>✅ Saved</span>}
        </div>
      </div>
    </div>
  );
}

function LockedYearsPanel({ db }: { db:any }) {
  const thisYear = new Date().getFullYear();
  const years = [thisYear-1, thisYear, thisYear+1, thisYear+2];
  const [locked, setLocked] = useState<number[]>([]);
  useEffect(()=>{
    getDoc(doc(db,"settings","lockedYears")).then(s=>setLocked(s.data()?.years||[])).catch(()=>{});
  },[]);
  async function toggle(y:number){
    const next=locked.includes(y)?locked.filter(x=>x!==y):[...locked,y];
    await setDoc(doc(db,"settings","lockedYears"),{years:next},{merge:true});
    setLocked(next);
  }
  return(
    <div style={{background:"white",borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(0,0,0,0.07)",marginTop:16}}>
      <h2 style={{fontSize:15,fontWeight:700,color:"#0d2e5e",margin:"0 0 4px"}}>🔒 Lock Rotation Years</h2>
      <p style={{fontSize:12,color:"#6b7280",marginBottom:14}}>Locked years cannot be rebalanced. Lock a year once you're happy with it.</p>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        {years.map(y=>{
          const isLocked=locked.includes(y);
          return <button key={y} onClick={()=>toggle(y)} style={{padding:"8px 18px",borderRadius:8,fontWeight:700,fontSize:14,cursor:"pointer",border:`2px solid ${isLocked?"#dc2626":"#d1d5db"}`,background:isLocked?"#fef2f2":"#f9fafb",color:isLocked?"#dc2626":"#374151"}}>
            {isLocked?"🔒":"🔓"} {y}
          </button>;
        })}
      </div>
    </div>
  );
}

function BackupsList({ db, onRestore, connected }: { db:any; onRestore:(b:any)=>void; connected:boolean }) {
  const [backups, setBackups] = useState<any[]>([]);
  useEffect(()=>{
    getDocs(query(collection(db,"calendarBackups"),orderBy("createdAt","desc"),limit(10)))
      .then(s=>setBackups(s.docs.map(d=>({id:d.id,...d.data()}))))
      .catch(()=>{});
  },[]);
  if(!backups.length) return <p style={{fontSize:12,color:"#9ca3af"}}>No backups yet — one will be created automatically before your next change.</p>;
  return(
    <div>
      {backups.map(b=>(
        <div key={b.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #f5f5f5"}}>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:"#0d2e5e"}}>{b.eventCount} events</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>{b.createdAt?.toDate?.().toLocaleString()} · {b.trigger}</div>
          </div>
          <button onClick={()=>onRestore(b)} disabled={!connected} style={{fontSize:12,padding:"4px 12px",borderRadius:6,background:"transparent",border:"1px solid #f97316",color:"#ea580c",cursor:"pointer",fontWeight:600}}>
            ↩ Restore
          </button>
        </div>
      ))}
    </div>
  );
}

const btnS=(bg:string):React.CSSProperties=>({background:bg,color:"white",border:"none",borderRadius:8,padding:"8px 16px",fontSize:14,fontWeight:600,cursor:"pointer"});
const navS:React.CSSProperties={background:"#f3f4f6",border:"1px solid #d1d5db",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontWeight:700,fontSize:16};
const lbl:React.CSSProperties={display:"block",fontSize:12,fontWeight:600,color:"#374151",marginBottom:4};
const inp:React.CSSProperties={width:"100%",padding:"8px 12px",border:"1px solid #d1d5db",borderRadius:8,fontSize:14,boxSizing:"border-box"as const};

// ── Rotation Order Display ───────────────────────────────────────────────────
function RotationOrderDisplay({ db, accessToken }: { db: any; accessToken: string }) {
  const [orders,   setOrders]   = useState<Record<string, string[]>>({});
  const [errors,   setErrors]   = useState<string[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [loaded,   setLoaded]   = useState(false);
  const thisYear = new Date().getFullYear();

  // Auto-load when token becomes available
  useEffect(() => {
    if (accessToken && !loaded && !loading) loadFromCalendar();
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadFromCalendar() {
    if (!accessToken) return;
    setLoading(true);
    try {
      // Fetch all on-call events for this year and next
      const allEvs: {date: string; name: string}[] = [];
      for (const yr of [thisYear, thisYear + 1]) {
        let url = `https://graph.microsoft.com/v1.0/me/calendars/${CAL_ID}/calendarView?startDateTime=${yr}-01-01T00:00:00&endDateTime=${yr}-12-31T23:59:59&$top=999&$select=subject,start&$orderby=start/dateTime`;
        while (url) {
          const d = await (await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })).json();
          (d.value || []).forEach((e: any) => {
            const s = (e.subject || "").toLowerCase();
            if ((s.includes("on call") || s.includes("oncall")) && !s.includes("vacation")) {
              const skip = new Set(["on","call","oncall","-","–"]);
              const name = e.subject.split(/\s+/).find((w: string) => w.length > 1 && !skip.has(w.toLowerCase())) || "";
              const date = e.start?.date || e.start?.dateTime?.slice(0, 10) || "";
              if (name && date) allEvs.push({ date, name: name.charAt(0).toUpperCase() + name.slice(1).toLowerCase() });
            }
          });
          url = d["@odata.nextLink"] || "";
        }
      }

      // Deduplicate allEvs by date+name (Graph returns Dec-31 event in both year fetches)
      const dedupKey = new Set<string>();
      const dedupedEvs = allEvs.filter(e => {
        const k = `${e.date}|${e.name}`;
        if (dedupKey.has(k)) return false;
        dedupKey.add(k);
        return true;
      });

      // Derive rotation cycle per year (unique names in first-appearance order)
      const newOrders: Record<string, string[]> = {};
      const errs: string[] = [];
      for (const yr of [thisYear, thisYear + 1]) {
        const yrEvs = dedupedEvs.filter(e => e.date.startsWith(String(yr)));
        const seen = new Set<string>(), cycle: string[] = [];
        yrEvs.forEach(e => { if (!seen.has(e.name)) { seen.add(e.name); cycle.push(e.name); } });
        newOrders[String(yr)] = cycle;

        // Check for errors: multiple DIFFERENT people on same day
        const dateCount: Record<string, string[]> = {};
        yrEvs.forEach(e => { if (!dateCount[e.date]) dateCount[e.date] = []; dateCount[e.date].push(e.name); });
        Object.entries(dateCount).forEach(([date, names]) => {
          if (names.length > 1) errs.push(`⚠️ ${date}: multiple people on call — ${names.join(", ")}`);
        });
      }

      setOrders(newOrders);
      setErrors(errs);
    } catch(e) { console.error(e); }
    setLoading(false);
    setLoaded(true);
  }

  async function shuffleYear(year: number) {
    const current = orders[String(year)] || [];
    if (!current.length) return;
    const shuffled = [...current].sort(() => Math.random() - 0.5);
    const updated = { ...orders, [String(year)]: shuffled };
    await setDoc(doc(db, "settings", "rotationOrders"), updated, { merge: true });
    setOrders(updated);
  }

  if (!accessToken) return <p style={{ fontSize: 12, color: "#9ca3af" }}>Connect Outlook above to view rotation.</p>;

  if (loading && !loaded) return <p style={{ fontSize: 12, color: "#9ca3af" }}>⏳ Loading rotation from calendar…</p>;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={loadFromCalendar} disabled={loading} style={{ ...btnS("#6b7280"), fontSize: 12, padding: "5px 14px" }}>
          {loading ? "Refreshing…" : "🔄 Refresh"}
        </button>
      </div>

      {/* Error banner */}
      {errors.length > 0 && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", marginBottom: 6 }}>⚠️ {errors.length} Error{errors.length > 1 ? "s" : ""} Found</div>
          {errors.map((e, i) => <div key={i} style={{ fontSize: 12, color: "#dc2626" }}>{e}</div>)}
        </div>
      )}
      {errors.length === 0 && loaded && (
        <div style={{ fontSize: 12, color: "#059669", fontWeight: 600, marginBottom: 12 }}>✅ No errors found</div>
      )}

      {/* Year cards */}
      {[thisYear, thisYear + 1].map(y => {
        const cycle = orders[String(y)] || [];
        const isCurrent = y === thisYear;
        return (
          <div key={y} style={{ marginBottom: 16, background: "#f8fafc", borderRadius: 10, padding: "14px 16px", border: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#0d2e5e" }}>📅 {y} {isCurrent ? "(Current Year)" : "(Next Year)"}</span>
              {isCurrent && <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600 }}>🔒 Locked — read from calendar</span>}
              {!isCurrent && cycle.length > 0 && (
                <button onClick={() => shuffleYear(y)} style={{ fontSize: 11, padding: "3px 12px", borderRadius: 99, background: "#eff6ff", border: "1px solid #bfdbfe", cursor: "pointer", fontWeight: 600, color: "#1565c0" }}>
                  🔀 Shuffle {y}
                </button>
              )}
            </div>
            {cycle.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {cycle.map((name, i) => (
                  <span key={name} style={{ fontSize: 12, fontWeight: 600, background: isCurrent ? "#eff6ff" : "#f0fdf4", color: isCurrent ? "#1565c0" : "#15803d", border: `1px solid ${isCurrent ? "#bfdbfe" : "#86efac"}`, borderRadius: 99, padding: "3px 10px" }}>
                    {i + 1}. {name}
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 12, color: "#9ca3af" }}>No events found for {y}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Stat Holidays Panel ───────────────────────────────────────────────────────
const PERSON_COLORS = ["#1565c0","#059669","#7c3aed","#dc2626","#d97706","#0891b2","#be185d","#4f46e5","#15803d","#9a3412"];
function StatHolidaysPanel({accessToken,calId,db}:{accessToken:string;calId:string;db:any}){
  const thisYear=new Date().getFullYear();
  const [selYear,setSelYear]=useState(thisYear);
  const [loading,setLoading]=useState(false);
  // date → {name, confirmed}
  const [assignments,setAssignments]=useState<Record<string,{name:string;confirmed:boolean}>>({});
  const [loaded,setLoaded]=useState(false);

  async function load(year:number){
    setLoading(true);
    try{
      // 1. Load roster from Firestore
      const cfgSnap=await getDoc(doc(db,"settings","onCallConfig")).catch(()=>null);
      const roster:string[]=cfgSnap?.data()?.employees||[];

      // 2. Fetch all on-call events for the selected year from Outlook
      const confirmedMap:Record<string,string>={};
      if(accessToken){
        const evs:any[]=[];
        let url=`https://graph.microsoft.com/v1.0/me/calendars/${calId}/calendarView?startDateTime=${year}-01-01T00:00:00&endDateTime=${year}-12-31T23:59:59&$top=999&$select=subject,start&$orderby=start/dateTime`;
        while(url){const d=await(await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`}})).json();(d.value||[]).forEach((e:any)=>{const s=(e.subject||"").toLowerCase();if((s.includes("on call")||s.includes("oncall"))&&!s.includes("vacation"))evs.push(e);});url=d["@odata.nextLink"]||"";}
        evs.forEach(e=>{const date=e.start?.date||e.start?.dateTime?.slice(0,10)||"";const name=getName(e.subject||"");if(date&&name)confirmedMap[date]=name;});
      }

      // 3. Build projection: find last confirmed event, continue rotation from there
      const projectedMap:Record<string,string>={};
      if(roster.length>0&&accessToken){
        // Fetch last ~14 days before year start to find rotation position
        const lookback=new Date(year,0,1); lookback.setDate(lookback.getDate()-roster.length*2+1);
        const anchors:any[]=[];
        let aUrl=`https://graph.microsoft.com/v1.0/me/calendars/${calId}/calendarView?startDateTime=${lookback.toISOString().slice(0,10)}T00:00:00&endDateTime=${year+1}-12-31T23:59:59&$top=999&$select=subject,start&$orderby=start/dateTime`;
        while(aUrl){const d=await(await fetch(aUrl,{headers:{Authorization:`Bearer ${accessToken}`}})).json();(d.value||[]).forEach((e:any)=>{const s=(e.subject||"").toLowerCase();if((s.includes("on call")||s.includes("oncall"))&&!s.includes("vacation"))anchors.push(e);});aUrl=d["@odata.nextLink"]||"";}

        // Find last confirmed date and derive next rotation index
        if(anchors.length>0){
          const lastEv=anchors[anchors.length-1];
          const lastDate=lastEv.start?.date||lastEv.start?.dateTime?.slice(0,10)||"";
          const lastName=getName(lastEv.subject||"");
          const lastIdx=roster.findIndex(n=>n.toLowerCase()===lastName.toLowerCase());
          let nextIdx=(lastIdx>=0?lastIdx+1:0)%roster.length;
          // Walk forward from the day after the last confirmed date to end of selected year
          const cur=new Date(lastDate+"T12:00:00"); cur.setDate(cur.getDate()+1);
          const endOfYear=new Date(year,11,31);
          while(cur<=endOfYear){
            const d=cur.toISOString().slice(0,10);
            if(!confirmedMap[d]){
              projectedMap[d]=roster[nextIdx%roster.length];
            }
            nextIdx++; cur.setDate(cur.getDate()+1);
          }
        }
      }

      // 4. Merge: confirmed takes priority
      const merged:Record<string,{name:string;confirmed:boolean}>={};
      Object.entries(confirmedMap).forEach(([d,n])=>merged[d]={name:n,confirmed:true});
      Object.entries(projectedMap).forEach(([d,n])=>{if(!merged[d])merged[d]={name:n,confirmed:false};});
      setAssignments(merged);
    }catch(err){console.error(err);}
    setLoading(false);setLoaded(true);
  }

  useEffect(()=>{load(selYear);},[accessToken,selYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats=getStatHolidays(selYear);
  const today=new Date().toISOString().slice(0,10);

  // Build person→color map across all assigned names
  const allNames=[...new Set(stats.map(s=>assignments[s.date]?.name).filter(Boolean) as string[])];
  const colorMap:Record<string,string>={};
  allNames.forEach((p,i)=>colorMap[p]=PERSON_COLORS[i%PERSON_COLORS.length]);

  // Count per person (confirmed + projected)
  const countByPerson:Record<string,{confirmed:number;projected:number}>={};
  stats.forEach(s=>{
    const a=assignments[s.date];
    if(!a)return;
    if(!countByPerson[a.name])countByPerson[a.name]={confirmed:0,projected:0};
    if(a.confirmed)countByPerson[a.name].confirmed++;
    else countByPerson[a.name].projected++;
  });

  return(
    <div>
      <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:16,flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:4}}>
          <button onClick={()=>setSelYear(v=>v-1)} style={navS}>◀</button>
          <span style={{fontWeight:700,fontSize:16,color:"#0d2e5e",padding:"4px 12px"}}>{selYear}</span>
          <button onClick={()=>setSelYear(v=>v+1)} style={navS}>▶</button>
        </div>
        <div style={{fontSize:11,color:"#9ca3af",display:"flex",gap:12,alignItems:"center"}}>
          <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,borderRadius:"50%",background:"#1565c0",display:"inline-block"}}/>Confirmed in calendar</span>
          <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,borderRadius:"50%",background:"#d1d5db",border:"2px dashed #9ca3af",display:"inline-block"}}/>Projected</span>
        </div>
        {!accessToken&&<span style={{fontSize:13,color:"#f97316",fontWeight:600}}>⚠️ Connect Outlook to see projections</span>}
      </div>

      {/* Summary chips */}
      {loaded&&Object.keys(countByPerson).length>0&&(
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
          {Object.entries(countByPerson).map(([name,counts])=>{
            const total=counts.confirmed+counts.projected;
            return(
              <span key={name} style={{fontSize:12,fontWeight:700,padding:"4px 12px",borderRadius:99,background:colorMap[name]||"#e5e7eb",color:"white"}}>
                {name} — {total} stat{total>1?" 🚨":""}
                {counts.projected>0&&<span style={{fontWeight:400,opacity:0.85}}> ({counts.projected} projected)</span>}
              </span>
            );
          })}
        </div>
      )}

      {loading&&<div style={{textAlign:"center",padding:24,color:"#9ca3af"}}>⏳ Loading…</div>}

      {!loading&&(
        <div style={{display:"grid",gap:6}}>
          {stats.map(s=>{
            const a=assignments[s.date];
            const isPast=s.date<today;
            const isConfirmed=a?.confirmed===true;
            const name=a?.name;
            const color=name?(isConfirmed?colorMap[name]:"transparent"):"#f3f4f6";
            const textColor=name?(isConfirmed?"white":colorMap[name]||"#374151"):"#9ca3af";
            const border=name?(isConfirmed?"none":`2px dashed ${colorMap[name]||"#9ca3af"}`):"1px solid #e5e7eb";
            return(
              <div key={s.date} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:8,background:isPast?"#f9fafb":"#fff",border:"1px solid #e2e8f0",opacity:isPast?0.6:1}}>
                <div style={{minWidth:140}}>
                  <div style={{fontSize:13,fontWeight:700,color:isPast?"#9ca3af":"#0d2e5e"}}>{s.name}</div>
                  <div style={{fontSize:11,color:"#9ca3af"}}>{new Date(s.date+"T12:00:00").toLocaleDateString("en-CA",{weekday:"short",month:"short",day:"numeric"})}</div>
                </div>
                <span style={{fontSize:12,fontWeight:700,padding:"4px 14px",borderRadius:99,background:color,color:textColor,border,minWidth:90,textAlign:"center",whiteSpace:"nowrap"}}>
                  {name||"—"}
                </span>
                {name&&!isConfirmed&&<span style={{fontSize:10,color:"#9ca3af",fontWeight:600}}>projected</span>}
                {name&&isConfirmed&&<span style={{fontSize:10,color:"#059669",fontWeight:600}}>✓ confirmed</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── On-Call Roster ────────────────────────────────────────────────────────────
function OnCallRoster({ db, allUsers, onSaved }: { db: any; allUsers: UserInfo[]; onSaved?: (roster: string[]) => void }) {
  const [roster, setRoster] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    getDoc(doc(db, "settings", "onCallConfig")).then(snap => {
      if (snap.exists() && snap.data().employees) setRoster(snap.data().employees);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  // Case-insensitive check: roster stores "Jordan", displayName may be "JORDAN SIBBICK"
  function isActive(displayName: string) {
    const first = displayName.split(" ")[0].toLowerCase();
    return roster.some(r => r.toLowerCase() === first);
  }

  function toggle(displayName: string) {
    const first = displayName.split(" ")[0];
    // Preserve existing casing in roster if already there; add proper-cased first name if new
    setRoster(prev => {
      const idx = prev.findIndex(r => r.toLowerCase() === first.toLowerCase());
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      // Use title-case version
      const titleCase = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
      return [...prev, titleCase];
    });
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    await setDoc(doc(db, "settings", "onCallConfig"), { employees: roster }, { merge: true });
    setSaving(false); setSaved(true);
    onSaved?.(roster);
  }

  const sorted = [...allUsers].sort((a, b) => a.displayName.localeCompare(b.displayName));

  if (!loaded) return <p style={{ fontSize: 12, color: "#9ca3af" }}>Loading roster…</p>;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {sorted.map(u => {
          const active = isActive(u.displayName);
          return (
            <button key={u.uid} onClick={() => toggle(u.displayName)} style={{
              padding: "6px 14px", borderRadius: 99, fontSize: 13, fontWeight: 600, cursor: "pointer",
              background: active ? "#1565c0" : "#f3f4f6", color: active ? "white" : "#374151",
              border: active ? "2px solid #1565c0" : "2px solid #e5e7eb",
            }}>
              {active ? "✓ " : ""}{u.displayName}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={save} disabled={saving} style={btnS("#059669")}>{saving ? "Saving..." : "💾 Save Roster"}</button>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{roster.length} selected</span>
        {saved && <span style={{ fontSize: 12, color: "#059669", fontWeight: 600 }}>✅ Saved!</span>}
      </div>
    </div>
  );
}
