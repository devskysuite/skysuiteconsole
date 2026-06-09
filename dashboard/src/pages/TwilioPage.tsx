import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { getFunctions, httpsCallable } from "firebase/functions";
import Spinner from "../components/Spinner";

const fns = getFunctions();
const callSendSms = httpsCallable(fns, "sendTestSms");

export default function TwilioPage() {
  const isAdmin = useIsAdmin();
  const [sid,   setSid]   = useState("");
  const [token, setToken] = useState("");
  const [from,  setFrom]  = useState("");
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [testPhone, setTestPhone] = useState("");
  const [testName,  setTestName]  = useState("");
  const [testing,   setTesting]   = useState(false);
  const [testResult, setTestResult] = useState<{ok:boolean; msg:string}|null>(null);

  useEffect(() => {
    getDoc(doc(db, "settings", "secrets")).then(s => {
      const d = s.data() || {};
      setSid(d.twilioAccountSid || "");
      setToken(d.twilioAuthToken || "");
      setFrom(d.twilioFrom || "");
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  async function save() {
    if (!sid.trim() || !token.trim() || !from.trim()) return;
    setSaving(true); setSaved(false);
    await setDoc(doc(db, "settings", "secrets"), {
      twilioAccountSid: sid.trim(),
      twilioAuthToken:  token.trim(),
      twilioFrom:       from.trim(),
    }, { merge: true });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function sendTest() {
    if (!testPhone.trim()) return;
    setTesting(true); setTestResult(null);
    try {
      const res: any = await callSendSms({ to: testPhone.trim(), name: testName.trim() || "there" });
      setTestResult({ ok: true, msg: `✅ Sent! SID: ${res?.data?.sid || "—"}` });
    } catch (e: any) {
      setTestResult({ ok: false, msg: `❌ ${e?.message || "Failed to send"}` });
    } finally {
      setTesting(false);
    }
  }

  if (isAdmin === null) return <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>;
  if (!isAdmin) return <div style={{ padding: 40, textAlign: "center", color: "#cc0000" }}>Access denied.</div>;
  if (!loaded)  return <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>;

  return (
    <div style={{ maxWidth: 600 }}>
      <h1 style={s.h1}>📱 Twilio SMS Setup</h1>

      {/* Credentials */}
      <div style={s.card}>
        <h2 style={s.h2}>Credentials</h2>
        <p style={s.hint}>
          Find these in your{" "}
          <a href="https://console.twilio.com" target="_blank" rel="noreferrer" style={{ color: "#1565c0" }}>
            Twilio Console
          </a>
          . Saved securely to Firestore — never exposed to the browser after saving.
        </p>

        <div style={s.field}>
          <label style={s.label}>Account SID</label>
          <input style={s.input} type="text" value={sid} onChange={e => setSid(e.target.value)}
            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" autoComplete="off" />
        </div>

        <div style={s.field}>
          <label style={s.label}>Auth Token</label>
          <input style={s.input} type="password" value={token} onChange={e => setToken(e.target.value)}
            placeholder="••••••••••••••••••••••••••••••••" autoComplete="new-password" />
        </div>

        <div style={s.field}>
          <label style={s.label}>From Number <span style={{ fontWeight: 400, color: "#9ca3af" }}>(E.164 format)</span></label>
          <input style={s.input} type="text" value={from} onChange={e => setFrom(e.target.value)}
            placeholder="+12895551234" />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
          <button style={s.btn} onClick={save} disabled={saving || !sid || !token || !from}>
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span style={{ fontSize: 13, color: "#059669", fontWeight: 600 }}>✅ Saved</span>}
        </div>
      </div>

      {/* Test SMS */}
      <div style={s.card}>
        <h2 style={s.h2}>Send Test SMS</h2>
        <p style={s.hint}>Verify your credentials are working by sending a test message.</p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" as const, marginBottom: 12 }}>
          <div style={{ ...s.field, flex: 1, minWidth: 160 }}>
            <label style={s.label}>Phone Number</label>
            <input style={s.input} type="tel" value={testPhone} onChange={e => setTestPhone(e.target.value)}
              placeholder="905-555-1234" />
          </div>
          <div style={{ ...s.field, flex: 1, minWidth: 140 }}>
            <label style={s.label}>Name (optional)</label>
            <input style={s.input} type="text" value={testName} onChange={e => setTestName(e.target.value)}
              placeholder="Jordan" />
          </div>
        </div>

        <button style={{ ...s.btn, backgroundColor: "#16a34a" }} onClick={sendTest}
          disabled={testing || !testPhone.trim()}>
          {testing ? "Sending…" : "Send Test"}
        </button>

        {testResult && (
          <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: testResult.ok ? "#059669" : "#dc2626" }}>
            {testResult.msg}
          </p>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  h1:    { fontSize: 24, fontWeight: 800, marginBottom: 20 },
  h2:    { fontSize: 16, fontWeight: 700, marginBottom: 8, color: "#0d2e5e" },
  hint:  { fontSize: 13, color: "#6b7280", marginBottom: 16 },
  card:  { background: "#fff", border: "1px solid #e5e5e5", borderRadius: 12, padding: 24, marginBottom: 20 },
  field: { display: "flex", flexDirection: "column", marginBottom: 14 },
  label: { fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" },
  input: { border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 12px", fontSize: 14 },
  btn:   { background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, padding: "10px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
};
