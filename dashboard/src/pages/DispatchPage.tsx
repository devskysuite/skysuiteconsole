import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, onSnapshot, query, addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { useIsAdmin } from "../hooks/useIsAdmin";
import Spinner from "../components/Spinner";
import { getOutlookToken } from "../utils/outlookToken";

type Visit = {
  id: string;
  techUid: string;
  techName: string;
  date: string;        // YYYY-MM-DD
  title: string;       // customer / job name
  jobNumber?: string;
  jobId?: string;      // linked job ID (if created from a job)
  visitNumber?: number;
  start?: string;      // HH:MM (24h)
  end?: string;        // HH:MM
  duration?: number;
  status: string;      // see STATUSES keys
  priority?: "high" | "normal" | "";
  flagged?: boolean;
  notes?: string;
  department?: string;
};

type Tech = { uid: string; name: string; section?: string };

// Calendar events pulled from Outlook (vacation / on-call)
type CalChip = { type: "vacation" | "oncall"; label: string };
type CalMap  = Record<string, CalChip[]>; // key: "firstName|YYYY-MM-DD"

// Status → label + colors (modeled on the dispatch board screenshot)
const STATUSES: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  scheduled: { label: "Scheduled", bg: "#eef2f7", fg: "#0d2e5e", border: "#cbd5e1" },
  traveling: { label: "Traveling", bg: "#dbeafe", fg: "#1e40af", border: "#93c5fd" },
  working:   { label: "Working",   bg: "#1565c0", fg: "#ffffff", border: "#0d47a1" },
  paused:    { label: "Paused",    bg: "#fef9c3", fg: "#854d0e", border: "#fde047" },
  onhold:    { label: "On Hold",   bg: "#ffedd5", fg: "#9a3412", border: "#fdba74" },
  canceled:  { label: "Canceled",  bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" },
  closed:    { label: "Closed",    bg: "#f3f4f6", fg: "#6b7280", border: "#d1d5db" },
  complete:  { label: "Complete",  bg: "#dcfce7", fg: "#166534", border: "#86efac" },
};
const STATUS_ORDER = ["scheduled", "traveling", "working", "paused", "onhold", "canceled", "closed", "complete"];

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayStr() { return fmtYMD(new Date()); }
function weekDays(dateStr: string): string[] {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay();                 // 0 Sun .. 6 Sat
  const offsetToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d); mon.setDate(d.getDate() + offsetToMon);
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return fmtYMD(x); });
}
function prettyDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtTime(t?: string) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join("");
}

export default function DispatchPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [techs, setTechs] = useState<Tech[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<"week" | "day">("week");
  const [anchor, setAnchor] = useState<string>(todayStr());   // selected date
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [activeStatus, setActiveStatus] = useState<string>("all"); // "all" or a status key

  const [modal, setModal] = useState<{ techUid: string; techName: string; date: string; visit?: Visit } | null>(null);
  const [calMap, setCalMap] = useState<CalMap>({});

  // Technicians flagged to show on the dispatch board
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .filter(u => u.showInDispatch && (u.uid || u.id))
        .map(u => ({ uid: u.uid || u.id, name: u.displayName || u.email || "Unknown", section: u.section }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setTechs(list);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);

  // Visits (real-time)
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, "dispatchVisits")), snap => {
      setVisits(snap.docs.map(d => ({ id: d.id, ...d.data() } as Visit)));
    }, () => {});
    return unsub;
  }, []);

  const days = useMemo(() => (view === "week" ? weekDays(anchor) : [anchor]), [view, anchor]);

  // Pull vacation + on-call events from Outlook for the displayed date range
  useEffect(() => {
    const start = days[0];
    const end   = days[days.length - 1];
    // Add one day to end so the calendarView includes the last day
    const endD = new Date(end + "T00:00:00"); endD.setDate(endD.getDate() + 1);
    const endStr = fmtYMD(endD);

    let cancelled = false;
    getOutlookToken().then(async token => {
      if (!token || token === "disconnected" || cancelled) return;
      try {
        const CAL_ID = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";
        const headers = { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="America/Toronto"' };
        const evs: any[] = [];
        let url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(CAL_ID)}/calendarView?startDateTime=${start}T00:00:00&endDateTime=${endStr}T00:00:00&$top=200&$select=subject,start,end`;
        while (url) {
          const res  = await fetch(url, { headers });
          const json = await res.json();
          if (!res.ok || cancelled) return;
          evs.push(...(json.value || []));
          url = json["@odata.nextLink"] || null;
        }
        if (cancelled) return;

        const map: CalMap = {};
        const TZ = "America/Toronto";

        for (const ev of evs) {
          const subj = (ev.subject || "") as string;
          const sl   = subj.toLowerCase();
          let type: "vacation" | "oncall" | null = null;
          if (sl.includes("vacation")) type = "vacation";
          else if (sl.includes("on call") || sl.includes("oncall")) type = "oncall";
          if (!type) continue;

          // Extract first name: "John - On Call" → "john"
          const firstName = subj.split(/[\s-–]+/)[0].trim().toLowerCase();
          if (!firstName) continue;

          // Expand multi-day events across each day in range
          const evStart = new Date(ev.start?.dateTime ? ev.start.dateTime + "Z" : ev.start?.date + "T00:00:00");
          const evEnd   = new Date(ev.end?.dateTime   ? ev.end.dateTime   + "Z" : ev.end?.date   + "T00:00:00");
          const cur = new Date(evStart);
          while (cur < evEnd) {
            const d = cur.toLocaleDateString("en-CA", { timeZone: TZ });
            if (d >= start && d <= end) {
              const key = `${firstName}|${d}`;
              (map[key] ||= []).push({ type, label: subj });
            }
            cur.setDate(cur.getDate() + 1);
          }
        }
        setCalMap(map);
      } catch {}
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [days[0], days[days.length - 1]]);

  // Index visits by techUid|date
  const byCell = useMemo(() => {
    const m: Record<string, Visit[]> = {};
    for (const v of visits) {
      if (flaggedOnly && !v.flagged) continue;
      if (activeStatus !== "all" && v.status !== activeStatus) continue;
      const k = `${v.techUid}|${v.date}`;
      (m[k] ||= []).push(v);
    }
    for (const k in m) m[k].sort((a, b) => (a.start || "").localeCompare(b.start || ""));
    return m;
  }, [visits, flaggedOnly, activeStatus]);

  function shift(dir: number) {
    const d = new Date(anchor + "T00:00:00");
    d.setDate(d.getDate() + dir * (view === "week" ? 7 : 1));
    setAnchor(fmtYMD(d));
  }

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of visits) c[v.status] = (c[v.status] || 0) + 1;
    return c;
  }, [visits]);

  if (isAdmin === null) return <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>;

  return (
    <div>
      {/* ── Header bar ── */}
      <div style={s.headerBar}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 20, fontWeight: 800 }}>🗓 Job Board</span>
          <div style={s.segment}>
            <button style={view === "day" ? s.segOn : s.segOff} onClick={() => setView("day")}>DAY</button>
            <button style={view === "week" ? s.segOn : s.segOff} onClick={() => setView("week")}>WEEK</button>
          </div>
          <div style={s.segment}>
            <button style={!flaggedOnly ? s.segOn : s.segOff} onClick={() => setFlaggedOnly(false)}>ALL</button>
            <button style={flaggedOnly ? s.segOn : s.segOff} onClick={() => setFlaggedOnly(true)}>FLAGGED</button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button style={s.navBtn} onClick={() => shift(-1)}>←</button>
          <input type="date" value={anchor} onChange={e => setAnchor(e.target.value || todayStr())} style={s.dateInput} />
          <button style={s.navBtn} onClick={() => shift(1)}>→</button>
          <button style={s.todayBtn} onClick={() => setAnchor(todayStr())}>TODAY</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>
      ) : techs.length === 0 ? (
        <div style={s.empty}>
          No technicians on the Job Board yet.<br />
          Go to <strong>Admin → Users</strong> and turn on <strong>Show in Dispatch</strong> for the techs you want here.
        </div>
      ) : (
        <div style={s.boardWrap}>
          <div style={{ ...s.grid, gridTemplateColumns: `150px repeat(${days.length}, minmax(120px, 1fr))` }}>
            {/* Header row */}
            <div style={s.cornerCell}>Technician</div>
            {days.map(d => {
              const isToday = d === todayStr();
              return (
                <div key={d} style={{ ...s.dayHead, ...(isToday ? { color: "#1565c0" } : {}) }}>
                  {DAY_NAMES[(new Date(d + "T00:00:00").getDay() + 6) % 7]} <span style={{ color: "#9ca3af", fontWeight: 600 }}>{prettyDate(d)}</span>
                </div>
              );
            })}

            {/* Tech rows */}
            {techs.map(t => (
              <Row key={t.uid} tech={t} days={days} byCell={byCell} calMap={calMap}
                onAdd={(date) => setModal({ techUid: t.uid, techName: t.name, date })}
                onOpen={(v) => {
                  if (v.jobId) { navigate(`/jobs/${v.jobId}`); }
                  else { setModal({ techUid: t.uid, techName: t.name, date: v.date, visit: v }); }
                }}
                canEdit={!!isAdmin} />
            ))}
          </div>
        </div>
      )}

      {/* ── Status filter footer ── */}
      <div style={s.footer}>
        <button style={activeStatus === "all" ? s.tabOn("#374151") : s.tabOff} onClick={() => setActiveStatus("all")}>
          All Visits {visits.length > 0 ? `(${visits.length})` : ""}
        </button>
        {STATUS_ORDER.map(k => {
          const st = STATUSES[k]; const n = statusCounts[k] || 0;
          return (
            <button key={k} onClick={() => setActiveStatus(activeStatus === k ? "all" : k)}
              style={activeStatus === k ? s.tabOn(st.bg === "#ffffff" ? "#374151" : st.fg) : { ...s.tabOff, background: st.bg, color: st.fg, borderColor: st.border }}>
              {st.label}{n ? ` (${n})` : ""}
            </button>
          );
        })}
      </div>

      {modal && (
        <VisitModal
          init={modal}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function Row({ tech, days, byCell, calMap, onAdd, onOpen, canEdit }: {
  tech: Tech; days: string[]; byCell: Record<string, Visit[]>; calMap: CalMap;
  onAdd: (date: string) => void; onOpen: (v: Visit) => void; canEdit: boolean;
}) {
  const firstName = tech.name.split(/\s+/)[0].toLowerCase();
  return (
    <>
      <div style={s.techCell}>
        <div style={s.avatar}>{initials(tech.name)}</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#0d2e5e" }}>{tech.name}</div>
          {tech.section && <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "capitalize" }}>{tech.section}</div>}
        </div>
      </div>
      {days.map(d => {
        const cellVisits = byCell[`${tech.uid}|${d}`] || [];
        const chips = calMap[`${firstName}|${d}`] || [];
        return (
          <div key={d} style={s.cell} onClick={() => canEdit && onAdd(d)} title={canEdit ? "Click to add a visit" : ""}>
            {chips.map((chip, i) => (
              <div key={i} style={{
                borderRadius: 5, padding: "4px 8px", marginBottom: 5, fontSize: 11, fontWeight: 700,
                background: chip.type === "vacation" ? "#fff7ed" : "#f5f3ff",
                color:      chip.type === "vacation" ? "#c2410c"  : "#6d28d9",
                border:     `1px solid ${chip.type === "vacation" ? "#fed7aa" : "#ddd6fe"}`,
              }}>
                {chip.type === "vacation" ? "☀ Vacation" : "📞 On Call"}
              </div>
            ))}
            {cellVisits.map(v => {
              const st = STATUSES[v.status] || STATUSES.scheduled;
              return (
                <div key={v.id}
                  onClick={(e) => { e.stopPropagation(); onOpen(v); }}
                  style={{ ...s.visit, background: st.bg, color: st.fg, borderColor: st.border }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", opacity: 0.85 }}>{st.label}</span>
                    <span style={{ display: "flex", gap: 3, alignItems: "center" }}>
                      {v.priority === "high" && <span style={s.priHigh}>HIGH</span>}
                      {v.flagged && <span style={s.flag}>⚑</span>}
                    </span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.title}</div>
                  {v.jobNumber && <div style={{ fontSize: 10, opacity: 0.85 }}>{v.jobNumber}{v.visitNumber ? ` · Visit #${v.visitNumber}` : ""}</div>}
                  {v.department && <div style={{ fontSize: 10, opacity: 0.75 }}>{v.department}</div>}
                  {(v.start || v.end) && <div style={{ fontSize: 10, opacity: 0.85 }}>{fmtTime(v.start)}{v.end ? ` - ${fmtTime(v.end)}` : ""}</div>}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function VisitModal({ init, onClose }: { init: { techUid: string; techName: string; date: string; visit?: Visit }; onClose: () => void }) {
  const v = init.visit;
  const [title, setTitle] = useState(v?.title || "");
  const [jobNumber, setJobNumber] = useState(v?.jobNumber || "");
  const [date, setDate] = useState(v?.date || init.date);
  const [start, setStart] = useState(v?.start || "08:00");
  const [end, setEnd] = useState(v?.end || "09:00");
  const [status, setStatus] = useState(v?.status || "scheduled");
  const [priority, setPriority] = useState<string>(v?.priority || "normal");
  const [flagged, setFlagged] = useState(!!v?.flagged);
  const [notes, setNotes] = useState(v?.notes || "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim()) return;
    setBusy(true);
    const payload = {
      techUid: init.techUid, techName: init.techName, date,
      title: title.trim(), jobNumber: jobNumber.trim(),
      start, end, status, priority, flagged, notes: notes.trim(),
    };
    try {
      if (v) await updateDoc(doc(db, "dispatchVisits", v.id), payload);
      else await addDoc(collection(db, "dispatchVisits"), { ...payload, createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || "" });
      onClose();
    } catch (e) { setBusy(false); }
  }
  async function remove() {
    if (!v) return;
    if (!window.confirm(`Delete "${v.title}"?`)) return;
    setBusy(true);
    try { await deleteDoc(doc(db, "dispatchVisits", v.id)); onClose(); } catch { setBusy(false); }
  }

  return (
    <div style={s.backdrop} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0d2e5e", marginBottom: 2 }}>{v ? "Edit Visit" : "Add Visit"}</h2>
        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>{init.techName}</p>

        <label style={s.lbl}>Customer / Job</label>
        <input style={s.inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="Office Renovation" autoFocus />

        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label style={s.lbl}>Job #</label><input style={s.inp} value={jobNumber} onChange={e => setJobNumber(e.target.value)} placeholder="#P25-0093" /></div>
          <div style={{ flex: 1 }}><label style={s.lbl}>Date</label><input type="date" style={s.inp} value={date} onChange={e => setDate(e.target.value)} /></div>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><label style={s.lbl}>Start</label><input type="time" style={s.inp} value={start} onChange={e => setStart(e.target.value)} /></div>
          <div style={{ flex: 1 }}><label style={s.lbl}>End</label><input type="time" style={s.inp} value={end} onChange={e => setEnd(e.target.value)} /></div>
        </div>

        <label style={s.lbl}>Status</label>
        <select style={s.inp} value={status} onChange={e => setStatus(e.target.value)}>
          {STATUS_ORDER.map(k => <option key={k} value={k}>{STATUSES[k].label}</option>)}
        </select>

        <div style={{ display: "flex", gap: 16, alignItems: "center", margin: "12px 0" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>
            <input type="checkbox" checked={priority === "high"} onChange={e => setPriority(e.target.checked ? "high" : "normal")} /> High priority
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#374151" }}>
            <input type="checkbox" checked={flagged} onChange={e => setFlagged(e.target.checked)} /> Flagged
          </label>
        </div>

        <label style={s.lbl}>Notes</label>
        <textarea style={{ ...s.inp, minHeight: 56, resize: "vertical" }} value={notes} onChange={e => setNotes(e.target.value)} />

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
          {v ? <button onClick={remove} disabled={busy} style={s.delBtn}>Delete</button> : <span />}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={s.cancelBtn}>Cancel</button>
            <button onClick={save} disabled={busy || !title.trim()} style={{ ...s.saveBtn, opacity: (busy || !title.trim()) ? 0.5 : 1 }}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, any> = {
  headerBar: { display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0d2e5e", color: "#fff", borderRadius: 0, padding: "12px 18px", marginBottom: 14, flexWrap: "wrap", gap: 10 },
  segment: { display: "flex", background: "rgba(255,255,255,0.12)", borderRadius: 8, overflow: "hidden" },
  segOn: { background: "#fff", color: "#0d2e5e", border: "none", padding: "6px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer" },
  segOff: { background: "transparent", color: "rgba(255,255,255,0.8)", border: "none", padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  navBtn: { background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", borderRadius: 8, width: 34, height: 32, fontSize: 16, cursor: "pointer" },
  dateInput: { border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 13, fontWeight: 600 },
  todayBtn: { background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer" },
  boardWrap: { overflow: "auto", maxHeight: "calc(100vh - 250px)", border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" },
  grid: { display: "grid", minWidth: 990, width: "100%" },
  cornerCell: { position: "sticky", top: 0, left: 0, zIndex: 4, background: "#f8fafc", borderBottom: "2px solid #e5e7eb", borderRight: "1px solid #e5e7eb", padding: "10px 12px", fontSize: 12, fontWeight: 800, color: "#6b7280", textTransform: "uppercase" },
  dayHead: { position: "sticky", top: 0, zIndex: 3, background: "#f8fafc", borderBottom: "2px solid #e5e7eb", borderRight: "1px solid #f0f0f0", padding: "14px 12px", fontSize: 14, fontWeight: 700, color: "#374151", textAlign: "center" },
  techCell: { position: "sticky", left: 0, zIndex: 2, background: "#fff", borderBottom: "1px solid #f0f0f0", borderRight: "1px solid #e5e7eb", padding: "12px", display: "flex", alignItems: "center", gap: 10 },
  avatar: { width: 32, height: 32, borderRadius: "50%", background: "#e8f0ff", color: "#1565c0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0 },
  cell: { minHeight: 180, borderBottom: "1px solid #f0f0f0", borderRight: "1px solid #f0f0f0", padding: 6, cursor: "pointer", background: "#fafafa" },
  visit: { border: "1px solid", borderRadius: 7, padding: "7px 9px", marginBottom: 6, cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" },
  priHigh: { fontSize: 8, fontWeight: 800, background: "#dc2626", color: "#fff", borderRadius: 3, padding: "1px 4px" },
  flag: { fontSize: 11, color: "#dc2626" },
  footer: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12, padding: "10px 4px", borderTop: "1px solid #eee" },
  tabOn: (c: string) => ({ background: c, color: "#fff", border: `1px solid ${c}`, borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }),
  tabOff: { background: "#fff", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  empty: { textAlign: "center", padding: 60, color: "#9ca3af", fontSize: 14, lineHeight: 1.8, border: "1px dashed #d1d5db", borderRadius: 12 },
  backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { background: "#fff", borderRadius: 16, padding: 26, width: "100%", maxWidth: 440, boxShadow: "0 8px 40px rgba(0,0,0,0.2)", maxHeight: "90vh", overflowY: "auto" },
  lbl: { display: "block", fontSize: 12, fontWeight: 700, color: "#374151", margin: "10px 0 4px" },
  inp: { width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 10px", fontSize: 14, boxSizing: "border-box" },
  saveBtn: { background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  cancelBtn: { background: "#6b7280", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  delBtn: { background: "transparent", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 8, padding: "9px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
};
