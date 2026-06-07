import { useEffect, useState, useCallback } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useRole, isAdminRole } from "../hooks/useRole";

// ── Graph API config ────────────────────────────────────────────────────────
const TENANT_ID  = "1c1d62e8-f392-4caa-a8a6-0ce98e0913d9";
const CLIENT_ID  = "9a1a21f1-40a3-4872-a4d6-888bd51d116d";
const CAL_ID     = "AAMkADgyOGUwMDUyLTNiZjMtNGQzNi1hNTgwLTQ2M2IzYzE2YmQ5MgBGAAAAAACGxuDePTlOQawDDU8UfW0gBwBxt6lSDH0kQY0tk4wDjNk8AAAAAAEGAABxt6lSDH0kQY0tk4wDjNk8AAALmQObAAA=";
const PROD_URL = "https://sky-suite-d14ff.web.app/";
const REDIRECT = PROD_URL; // Always redirect to production after OAuth
const IS_PROD  = window.location.hostname === "sky-suite-d14ff.web.app";

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

  // Load refresh token — try Firestore first, fall back to hardcoded
  const FALLBACK_RT = "1.AW8B6GIdHJLzqkyopgzpjgkT2fEhGpqjQHJIpNaIi9UdEW0AABFvAQ.BQABAwEAAAADAOz_BQD0_0V2b1N0c0FydGlmYWN0cwIAAAAAAPr_vnngWePaOrh5eWXUA9QRdzxVk8aOzPXDZ6o5eZqQ9FJ3d-U2eJAcGjlJBQX_opx2RinePiL6IehJXjOMyo-06fXVTJe9W9IO-JxRuAsljsArxXyaDux0RE68kpGs8LCanwBDEspkVI6TOb3e1nFBlwH5mTyGgByJWaxNy2_8kTrkFNUrY4bNuhjER4d1_BJrUjLqcAfIGfOZnUM3_toZyXKSZvniZYemuAJtVeWPPWPRTZ6PYVTB7ebb9844jxpWlpzTqeuhnS9uCe8QFXCOORbgPUKLLt8T8WLteDlwAj8pQTB9toSCWD8NDuBQ2IC_6c6bVd32n1vgf7MtpDwgIQpzt7MtQV5b1_n3kbE_KpXrMXMwJbrNMNi1aIjpXD5HZ5qWshSZeHgdXvOeuz_dGU7C1xKz8MEmJZcmdf2U4jBs0P05MTSlIxuvBndRRPXS9D0ibHaVKumzki52CIc-n-qM3gdljKd7n84EQ6XX7wTlVznYc1PVlc3YoQO9_B9jhbmfPWS0hHcRLe_KegwdTz9dnWojEnfbaFFy08xeYLZtd6-ttbnkJm_oZ3mUmvWuM2T-T_j5Sc7idLD3XZpaFTSBkykxk847XToY7PRxcNEHUOa7HJ5R3MzxXjQSGDoPT6uffxLMut0lTDZSOlgv57lF_8SCRziIeZDGoAXyWeSSZznwsD5jUiZK6VBk_qo_4Z4cw1epID_9D8XiKXNo2XJkQcM4LLwM4sIxb2U6_BW0DPlq5-Qwi9AofJNGRL5prhGsoIHyBFUUQJo16P8ehX817XQmX6SEw3OqIWntf1G7WOmU133BKe8P9WpkgUMsNEoXE7ERIUffd5_cmWeGM86fx31xMDMLh71j-ufkQ0SYtnr1oDjBD0h1jT1IyjAIBquXAP2Hdy5bZ8u5k_-rpmaewKhyhPvdOq1sO0Js5FcFh6i7vgx6Wn5-F7AfCYh0IchbVFHFNVzM63klvyvW6C7Hnn1P24jRwTQRssQO0L3NnkgwrQon-sllv80zk9Y1tXoJ3z139N7WX8lI_SOywnfBWwS8_lvff4OHQzrTDleV_7B3xACijh12N_hFxvegt6a3oumawz9BDK7j2QGXxqHJXxCoqidnO4f1Dm0FsVw7Q6UAOqful6Bl0BVqYFAwBVgquEgBhGIKqpWq5em-k6spRFltaq8CWlGIyRRmtXdSvczQXh9V-xwEcapzXpi_ZPYT1LVc83a3qIshCWTII7EBbpWeG74RCEymwjkpnx_neZPiN2JaFxrfK4zXk9ImOoljU3w5EOQS6wupezItYLBHt0ZYciYXngloYEU5TV0PuHanxC02WlrnBmybRN473iSyM9uoY_5QQfm9X4JpEPAgyfkcb5wq9x8S2zcVMMB2D8YjRkhKVKN4OqGjGDn2dAoLsADoMPx0Wq3v6uBL6Y4H00XOo1mSGoQStZhDmAUP00G4H7hyVQhEFVIQEBKd6Wj5vbBz9I5Vs6qfV3sXollwuievxhGzPfOU9xpxjNQDgUIf_V77GtS0I_mMAXR3seITS3bJmCVRumf8DInjEUKOk7RbqduWJcTcCcxJgwtM6k90AtLQ1qrFIvTxbj7rFHhoryXLiYCOIaOUrzu5Jy4qdEEzDVFmPp2oEzkzUaU95gPfTH-BUetW3AcVj8w";

  useEffect(() => {
    async function load() {
      let rt = FALLBACK_RT;
      try {
        const snap = await getDoc(doc(db, "settings", "outlookOnCall"));
        if (snap.exists() && snap.data().refreshToken) rt = snap.data().refreshToken;
      } catch {}
      const tokens = await refreshAccessToken(rt);
      if (tokens) {
        setAccessToken(tokens.access);
        setRefreshToken(tokens.refresh);
        setConnected(true);
        try { await setDoc(doc(db, "settings", "outlookOnCall"), { refreshToken: tokens.refresh }, { merge: true }); } catch {}
      } else {
        setError("Could not connect to Outlook calendar.");
      }
    }
    load();
  }, []);

  // Handle OAuth callback — works with or without PKCE verifier
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get("code");
    if (!code) return;
    window.history.replaceState({}, "", window.location.pathname);
    const verifier = sessionStorage.getItem("pkce_verifier");
    sessionStorage.removeItem("pkce_verifier");

    (async () => {
      try {
        const bodyParams: Record<string, string> = {
          client_id:    CLIENT_ID,
          code,
          redirect_uri: REDIRECT,
          grant_type:   "authorization_code",
          scope:        "Calendars.ReadWrite offline_access",
        };
        if (verifier) bodyParams.code_verifier = verifier;
        const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
          method: "POST", body: new URLSearchParams(bodyParams)
        });
        const d = await r.json();
        if (d.access_token) {
          setAccessToken(d.access_token);
          setRefreshToken(d.refresh_token);
          setConnected(true);
          try { await setDoc(doc(db, "settings", "outlookOnCall"), { refreshToken: d.refresh_token }, { merge: true }); } catch {}
        } else {
          setError("Auth failed: " + (d.error_description || JSON.stringify(d)));
        }
      } catch (e: any) { setError("Auth error: " + e.message); }
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
            <span style={{ fontSize: 13, color: "#9ca3af" }}>Go to Setup tab to connect Outlook</span>
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

          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>
              {connected ? "✅ Outlook connected." : "Paste the Microsoft Refresh Token below to connect the Outlook calendar."}
            </p>
            <SetupTokenForm db={db} onConnected={(rt) => {
              setRefreshToken(rt);
              refreshAccessToken(rt).then(t => { if (t) { setAccessToken(t.access); setConnected(true); } });
            }} />
          </div>

          <p style={{ fontSize: 13, color: "#9ca3af" }}>📌 Rotation planner coming soon.</p>
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

function SetupTokenForm({ db, onConnected }: { db: any; onConnected: (rt: string) => void }) {
  const [rt, setRt] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    if (!rt.trim()) return;
    setSaving(true);
    try {
      await setDoc(doc(db, "settings", "outlookOnCall"), { refreshToken: rt.trim() }, { merge: true });
      setMsg("✅ Saved! Calendar will now load.");
      onConnected(rt.trim());
    } catch (e: any) {
      setMsg("❌ Failed: " + e.message);
    } finally { setSaving(false); }
  }

  return (
    <div>
      <textarea
        value={rt} onChange={e => setRt(e.target.value)}
        placeholder="Paste Microsoft Refresh Token here..."
        rows={4}
        style={{ width: "100%", padding: 10, border: "1px solid #d1d5db", borderRadius: 8, fontSize: 12, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box" as const }}
      />
      <button onClick={save} disabled={saving || !rt.trim()} style={{ ...btnStyle("#1565c0"), marginTop: 8 }}>
        {saving ? "Saving..." : "💾 Save Token"}
      </button>
      {msg && <p style={{ fontSize: 13, marginTop: 8, color: msg.startsWith("✅") ? "#059669" : "#dc2626" }}>{msg}</p>}
    </div>
  );
}
