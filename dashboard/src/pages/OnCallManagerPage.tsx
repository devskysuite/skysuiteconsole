import { useEffect, useState, useCallback } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useRole, isAdminRole } from "../hooks/useRole";

// ── Graph API config ────────────────────────────────────────────────────────
const TENANT_ID  = "1c1d62e8-f392-4caa-a8a6-0ce98e0913d9";
const CLIENT_ID  = "9a1a21f1-40a3-4872-a4d6-888bd51d116d";
const CAL_ID     = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";
const REDIRECT   = "https://sky-suite-d14ff.web.app/";

// ── Types ───────────────────────────────────────────────────────────────────
interface CalEvent { id: string; subject: string; start: string; end: string; isAllDay: boolean; }

// ── PKCE helpers ────────────────────────────────────────────────────────────
function generateVerifier() {
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
async function generateChallenge(verifier: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ── Token helpers ───────────────────────────────────────────────────────────
async function refreshAccessToken(refreshToken: string): Promise<{ access: string; refresh: string } | null> {
  try {
    const body = new URLSearchParams({
      client_id:     CLIENT_ID,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
      scope:         "Calendars.ReadWrite offline_access",
    });
    const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, { method: "POST", body });
    const d = await r.json();
    if (d.access_token) return { access: d.access_token, refresh: d.refresh_token || refreshToken };
    return null;
  } catch { return null; }
}

async function fetchCalendarEvents(token: string, year: number, month: number): Promise<CalEvent[]> {
  const start = new Date(year, month, 1).toISOString().slice(0, 10);
  const end   = new Date(year, month + 1, 1).toISOString().slice(0, 10);
  let url = `https://graph.microsoft.com/v1.0/me/calendars/${CAL_ID}/calendarView`
          + `?startDateTime=${start}T00:00:00&endDateTime=${end}T00:00:00&$top=999&$select=id,subject,start,end,isAllDay`;
  const events: CalEvent[] = [];
  while (url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    (d.value || []).forEach((ev: any) => events.push({
      id: ev.id, subject: ev.subject || "",
      start: ev.start?.date || ev.start?.dateTime?.slice(0, 10) || "",
      end:   ev.end?.date   || ev.end?.dateTime?.slice(0, 10)   || "",
      isAllDay: ev.isAllDay,
    }));
    url = d["@odata.nextLink"] || "";
  }
  return events;
}

// ── Calendar grid ───────────────────────────────────────────────────────────
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function calGrid(year: number, month: number) {
  const grid: string[] = [];
  const first = new Date(year, month, 1).getDay();
  const days  = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < first; i++) grid.push("");
  for (let d = 1; d <= days; d++) {
    grid.push(`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`);
  }
  return grid;
}

// ── Main component ──────────────────────────────────────────────────────────
export default function OnCallManagerPage() {
  const role    = useRole();
  const isAdmin = isAdminRole(role);

  const today     = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [activeTab, setActiveTab] = useState<"calendar"|"setup">("calendar");

  const [accessToken,  setAccessToken]  = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [events, setEvents]   = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  // Load stored refresh token from Firestore
  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, "settings", "outlookOnCall"));
        if (snap.exists() && snap.data().refreshToken) {
          const rt = snap.data().refreshToken;
          setRefreshToken(rt);
          const tokens = await refreshAccessToken(rt);
          if (tokens) {
            setAccessToken(tokens.access);
            setRefreshToken(tokens.refresh);
            setConnected(true);
            // Save updated refresh token
            await setDoc(doc(db, "settings", "outlookOnCall"), { refreshToken: tokens.refresh }, { merge: true });
          }
        }
      } catch {}
    }
    load();
  }, []);

  // Handle OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get("code");
    const verifier = sessionStorage.getItem("pkce_verifier");
    if (!code || !verifier) return;
    window.history.replaceState({}, "", window.location.pathname);
    sessionStorage.removeItem("pkce_verifier");

    (async () => {
      try {
        const body = new URLSearchParams({
          client_id:     CLIENT_ID,
          code,
          redirect_uri:  REDIRECT,
          grant_type:    "authorization_code",
          code_verifier: verifier,
          scope:         "Calendars.ReadWrite offline_access",
        });
        const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, { method: "POST", body });
        const d = await r.json();
        if (d.access_token) {
          setAccessToken(d.access_token);
          setRefreshToken(d.refresh_token);
          setConnected(true);
          await setDoc(doc(db, "settings", "outlookOnCall"), { refreshToken: d.refresh_token }, { merge: true });
        } else {
          setError("Failed to connect: " + (d.error_description || "unknown error"));
        }
      } catch (e: any) { setError(e.message); }
    })();
  }, []);

  // Fetch events when connected
  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    fetchCalendarEvents(accessToken, year, month)
      .then(setEvents)
      .catch(() => setError("Failed to fetch calendar"))
      .finally(() => setLoading(false));
  }, [accessToken, year, month]);

  async function connectOutlook() {
    const verifier   = generateVerifier();
    const challenge  = await generateChallenge(verifier);
    sessionStorage.setItem("pkce_verifier", verifier);
    window.location.href = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize`
      + `?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}`
      + `&scope=${encodeURIComponent("Calendars.ReadWrite offline_access")}&response_mode=query`
      + `&code_challenge=${challenge}&code_challenge_method=S256`;
  }

  function changeMonth(dir: number) {
    let m = month + dir, y = year;
    if (m > 11) { m = 0; y++; }
    if (m < 0)  { m = 11; y--; }
    setMonth(m); setYear(y);
  }

  // Build event map: date -> events
  const eventMap: Record<string, CalEvent[]> = {};
  events.forEach(ev => {
    if (!eventMap[ev.start]) eventMap[ev.start] = [];
    eventMap[ev.start].push(ev);
  });

  const grid = calGrid(year, month);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  function pillColor(subject: string) {
    const s = subject.toLowerCase();
    if ((s.includes("on call") || s.includes("oncall")) && !s.includes("vacation"))
      return { bg: "#1565c0", color: "#ffffff", border: "#1565c0", prefix: "📞 " };
    if (s.includes("vacation"))
      return { bg: "#f97316", color: "#ffffff", border: "#f97316", prefix: "🏖 " };
    return { bg: "#f3f4f6", color: "#374151", border: "#d1d5db", prefix: "" };
  }

  return (
    <div style={{ padding: "24px 32px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0d2e5e" }}>On-Call Manager</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {!connected && isAdmin && (
            <button onClick={connectOutlook} style={btnStyle("#1565c0")}>
              🔗 Connect Outlook
            </button>
          )}
          {connected && <span style={{ fontSize: 13, color: "#059669", fontWeight: 600 }}>✅ Connected to Outlook</span>}
        </div>
      </div>

      {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 16px", color: "#dc2626", marginBottom: 16 }}>{error}</div>}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "2px solid #e5e7eb" }}>
        <TabBtn label="📅 Calendar" active={activeTab === "calendar"} onClick={() => setActiveTab("calendar")} />
        {isAdmin && <TabBtn label="⚙ Setup" active={activeTab === "setup"} onClick={() => setActiveTab("setup")} />}
      </div>

      {/* Calendar Tab */}
      {activeTab === "calendar" && (
        <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
          {/* Month nav */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <button onClick={() => changeMonth(-1)} style={navBtn}>◀</button>
            <span style={{ fontWeight: 700, fontSize: 18, color: "#0d2e5e" }}>{MONTHS[month]} {year}</span>
            <button onClick={() => changeMonth(1)} style={navBtn}>▶</button>
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
            <Pill label="📞 On Call" bg="#1565c0" color="#ffffff" />
            <Pill label="🏖 Vacation" bg="#f97316" color="#ffffff" />
          </div>

          {loading && <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>⏳ Loading...</div>}

          {!connected && !loading && (
            <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>
              {isAdmin ? "Connect Outlook above to view the calendar." : "Calendar not connected yet."}
            </div>
          )}

          {connected && !loading && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
              {DAYS.map(d => (
                <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#6b7280", padding: "6px 0", textTransform: "uppercase" }}>{d}</div>
              ))}
              {grid.map((date, i) => {
                const dayEvents = date ? (eventMap[date] || []) : [];
                const isToday = date === todayStr;
                return (
                  <div key={i} style={{
                    minHeight: 80, background: isToday ? "#eff6ff" : "#fafafa",
                    border: isToday ? "2px solid #1565c0" : "1px solid #e5e7eb",
                    borderRadius: 6, padding: 4,
                  }}>
                    {date && (
                      <>
                        <div style={{ fontSize: 12, fontWeight: isToday ? 800 : 500, color: isToday ? "#1565c0" : "#374151", marginBottom: 2 }}>
                          {parseInt(date.slice(8))}
                        </div>
                        {dayEvents.slice(0, 2).map(ev => {
                          const c = pillColor(ev.subject);
                          const name = ev.subject.split(/\s+/).find(w => !["on","call","oncall","vacation","-"].includes(w.toLowerCase())) || ev.subject;
                          return (
                            <div key={ev.id} style={{ fontSize: 10, fontWeight: 600, background: c.bg, color: c.color, border: `1px solid ${c.border}`, borderRadius: 4, padding: "1px 4px", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {c.prefix}{name}
                            </div>
                          );
                        })}
                        {dayEvents.length > 2 && <div style={{ fontSize: 9, color: "#9ca3af" }}>+{dayEvents.length - 2} more</div>}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Setup Tab (admin only) */}
      {activeTab === "setup" && isAdmin && (
        <div style={{ background: "white", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0d2e5e", marginBottom: 16 }}>On-Call Setup</h2>
          <div style={{ color: "#6b7280", fontSize: 14 }}>
            <p>📌 Rotation planner and employee management coming soon.</p>
            <p style={{ marginTop: 8 }}>For now, manage on-call schedules directly in the On-Call Manager app.</p>
            {!connected && (
              <button onClick={connectOutlook} style={{ ...btnStyle("#1565c0"), marginTop: 16 }}>
                🔗 Connect Outlook Calendar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small components ────────────────────────────────────────────────────────
function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: "8px 20px", fontWeight: 600, fontSize: 14, cursor: "pointer",
      background: "none", border: "none", borderBottom: active ? "3px solid #1565c0" : "3px solid transparent",
      color: active ? "#1565c0" : "#6b7280", marginBottom: -2,
    }}>{label}</button>
  );
}

function Pill({ label, bg, color }: { label: string; bg: string; color: string }) {
  return <span style={{ background: bg, color, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99 }}>{label}</span>;
}

function btnStyle(bg: string): React.CSSProperties {
  return { background: bg, color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
}

const navBtn: React.CSSProperties = { background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontWeight: 700, fontSize: 16 };
