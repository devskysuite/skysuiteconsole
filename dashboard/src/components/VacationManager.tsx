import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../firebase";

const callVacation = httpsCallable(getFunctions(), "vacationAction");

type VacEvent = { id: string; subject: string; start: string; end: string };

function fmt(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
}

export default function VacationManager() {
  const [people, setPeople]   = useState<string[]>([]);
  const [events, setEvents]   = useState<VacEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  const [name, setName]         = useState("");
  const [multiDay, setMultiDay] = useState(false);
  const [start, setStart]       = useState("");
  const [end, setEnd]           = useState("");
  const [adding, setAdding]     = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function loadPeople() {
    try {
      const snap = await getDocs(collection(db, "users"));
      const names = snap.docs.map(d => d.data().displayName).filter(Boolean) as string[];
      setPeople(Array.from(new Set(names)).sort((a, b) => a.localeCompare(b)));
    } catch {}
  }

  async function loadEvents() {
    setLoading(true); setError("");
    try {
      const res: any = await callVacation({ action: "list" });
      setEvents((res?.data?.events || []).sort((a: VacEvent, b: VacEvent) => a.start.localeCompare(b.start)));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load vacations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPeople(); loadEvents(); }, []);

  async function add() {
    if (!name || !start) { setError("Pick a person and a start date."); return; }
    if (multiDay && end && end < start) { setError("End date can't be before start date."); return; }
    setAdding(true); setError("");
    try {
      await callVacation({ action: "add", personName: name, startDate: start, endDate: multiDay ? (end || start) : start });
      setName(""); setStart(""); setEnd(""); setMultiDay(false);
      await loadEvents();
    } catch (e: any) {
      setError(e?.message ?? "Failed to add vacation.");
    } finally {
      setAdding(false);
    }
  }

  async function remove(ev: VacEvent) {
    if (!window.confirm(`Delete "${ev.subject}" (${fmt(ev.start)})?`)) return;
    setDeleting(ev.id);
    try {
      await callVacation({ action: "delete", eventId: ev.id });
      setEvents(prev => prev.filter(e => e.id !== ev.id));
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete vacation.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16, color: "#0d2e5e" }}>Manage Vacation Calendar</h2>

      {/* Add form */}
      <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 12, padding: 18, marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#ea580c", marginBottom: 12 }}>➕ Add Vacation</h3>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <label style={lbl}>Person</label>
            <select value={name} onChange={e => setName(e.target.value)} style={inp}>
              <option value="">Select…</option>
              {people.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <label style={lbl}>{multiDay ? "Start date" : "Date"}</label>
            <input type="date" value={start} onChange={e => setStart(e.target.value)} style={inp} />
          </div>
          {multiDay && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <label style={lbl}>End date</label>
              <input type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} style={inp} />
            </div>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#374151", paddingBottom: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={multiDay} onChange={e => { setMultiDay(e.target.checked); if (e.target.checked && !end) setEnd(start); }} style={{ width: 15, height: 15 }} />
            Multiple days
          </label>
          <button onClick={add} disabled={adding || !name || !start} style={{ ...btn, opacity: (adding || !name || !start) ? 0.5 : 1 }}>
            {adding ? "Adding…" : "Add to Vacation Calendar"}
          </button>
        </div>
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {/* Existing vacations */}
      {loading ? (
        <p style={{ color: "#888", fontSize: 14 }}>Loading vacations…</p>
      ) : events.length === 0 ? (
        <p style={{ color: "#888", fontSize: 14 }}>No upcoming vacations on the calendar.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Vacation</th><th style={th}>Start</th><th style={th}>End</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {events.map(ev => {
              // Graph all-day end is exclusive — show the last actual day
              const endD = ev.end ? new Date(ev.end) : null;
              if (endD) endD.setDate(endD.getDate() - 1);
              const lastDay = endD ? endD.toISOString().slice(0, 10) : ev.start;
              return (
                <tr key={ev.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={td}>{ev.subject}</td>
                  <td style={td}>{fmt(ev.start)}</td>
                  <td style={td}>{lastDay !== ev.start ? fmt(lastDay) : "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button onClick={() => remove(ev)} disabled={deleting === ev.id}
                      style={{ background: "transparent", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: 6, padding: "3px 10px", fontSize: 12, cursor: "pointer" }}>
                      {deleting === ev.id ? "…" : "Delete"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 };
const inp: React.CSSProperties = { border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 10px", fontSize: 14 };
const btn: React.CSSProperties = { background: "#f97316", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const th: React.CSSProperties = { textAlign: "left", fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, paddingBottom: 8, borderBottom: "1px solid #eee" };
const td: React.CSSProperties = { padding: "10px 8px 10px 0", fontSize: 14, color: "#333" };
