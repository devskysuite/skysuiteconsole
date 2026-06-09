import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";

/** Admin-only toggles controlling how approvers are alerted to new vacation requests. */
export default function TimeOffNotifySettings() {
  const [sms, setSms]     = useState(false);
  const [email, setEmail] = useState(false);

  useEffect(() => {
    getDoc(doc(db, "settings", "timeOffNotify"))
      .then((s) => { const d = s.data() || {}; setSms(!!d.sms); setEmail(!!d.email); })
      .catch(() => {});
  }, []);

  async function save(next: { sms?: boolean; email?: boolean }) {
    const merged = { sms, email, ...next };
    setSms(merged.sms); setEmail(merged.email);
    await setDoc(doc(db, "settings", "timeOffNotify"), merged, { merge: true }).catch(() => {});
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e5e5", borderRadius: 12, padding: 20, marginBottom: 20 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "#0d2e5e", marginBottom: 4 }}>🔔 New Request Notifications</h2>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 14 }}>
        Choose how approvers (owners, admins, managers) are alerted when someone submits a vacation request.
        Requests always appear in the Approvals list regardless.
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: "#374151", cursor: "pointer" }}>
          <input type="checkbox" checked={sms} onChange={(e) => save({ sms: e.target.checked })} style={{ width: 16, height: 16 }} />
          📱 Text approvers (SMS)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: "#374151", cursor: "pointer" }}>
          <input type="checkbox" checked={email} onChange={(e) => save({ email: e.target.checked })} style={{ width: 16, height: 16 }} />
          ✉️ Email approvers
        </label>
      </div>
      {!sms && !email && (
        <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 10 }}>
          Both off — approvers will only see requests in the Approvals list (with the nav badge).
        </p>
      )}
    </div>
  );
}
