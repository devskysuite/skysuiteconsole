import { useState } from "react";
import { signInWithEmailAndPassword, browserLocalPersistence, setPersistence } from "firebase/auth";
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";

type Screen = "login" | "mfa-verify" | "mfa-enroll" | "reset" | "reset-sent";

// ── TOTP (RFC 6238) — pure browser crypto, no library needed ─────────────────
const B32_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32decode(s: string): Uint8Array {
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const c of s.toUpperCase().replace(/=+$/, "")) {
    val = (val << 5) | B32_ALPHA.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let out = "";
  for (let i = 0; i < bytes.length; i += 5) {
    const b = Array.from(bytes.slice(i, i + 5));
    while (b.length < 5) b.push(0);
    out += B32_ALPHA[(b[0] >> 3) & 31];
    out += B32_ALPHA[((b[0] << 2) | (b[1] >> 6)) & 31];
    out += B32_ALPHA[(b[1] >> 1) & 31];
    out += B32_ALPHA[((b[1] << 4) | (b[2] >> 4)) & 31];
    out += B32_ALPHA[((b[2] << 1) | (b[3] >> 7)) & 31];
    out += B32_ALPHA[(b[3] >> 2) & 31];
    out += B32_ALPHA[((b[3] << 3) | (b[4] >> 5)) & 31];
    out += B32_ALPHA[b[4] & 31];
  }
  return out;
}

async function totpCode(secret: string, offset = 0): Promise<string> {
  const counter = Math.floor(Date.now() / 1000 / 30) + offset;
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(4, counter, false);
  const key = await crypto.subtle.importKey("raw", base32decode(secret).buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const off = sig[19] & 0xf;
  const code = ((sig[off] & 0x7f) << 24 | sig[off+1] << 16 | sig[off+2] << 8 | sig[off+3]) % 1000000;
  return code.toString().padStart(6, "0");
}

async function verifyTOTP(secret: string, code: string): Promise<boolean> {
  for (const offset of [0, -1, 1]) {
    if (await totpCode(secret, offset) === code) return true;
  }
  return false;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function rememberKey(uid: string) { return `skysuite_2fa_${uid}`; }

function isRemembered(uid: string) {
  return localStorage.getItem(rememberKey(uid)) === "true";
}

function rememberDevice(uid: string) {
  localStorage.setItem(rememberKey(uid), "true");
}

function friendlyError(code: string) {
  if (code === "auth/invalid-credential" || code === "auth/wrong-password") return "Incorrect email or password.";
  if (code === "auth/user-not-found")    return "No account found for that email.";
  if (code === "auth/too-many-requests") return "Too many attempts — try again later.";
  return "Login failed.";
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Login() {
  const navigate = useNavigate();
  const [screen,   setScreen]   = useState<Screen>("login");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [code,     setCode]     = useState("");
  const [error,    setError]    = useState("");
  const [busy,     setBusy]     = useState(false);
  const [remember, setRemember] = useState(true);

  // Set during login flow
  const [firestoreDocId, setFirestoreDocId] = useState("");
  const [totpSecret,     setTotpSecret]     = useState("");
  const [newSecret,      setNewSecret]      = useState("");
  const [qrUrl,          setQrUrl]          = useState("");

  // ── Step 1: email + password ─────────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("Enter email and password."); return; }
    try {
      setBusy(true);
      await setPersistence(auth, browserLocalPersistence);
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const uid  = cred.user.uid;

      // Look up Firestore user doc
      const snap = await getDocs(query(collection(db, "users"), where("uid", "==", uid)));
      const userDoc = snap.empty ? null : snap.docs[0];
      const docId   = userDoc?.id ?? "";
      const secret  = userDoc?.data()?.totpSecret ?? "";

      setFirestoreDocId(docId);

      if (!secret) {
        // First time — set up 2FA
        const s = generateSecret();
        const uri = `otpauth://totp/SkySuite%20Console:${encodeURIComponent(cred.user.email || "")}?secret=${s}&issuer=SkySuite`;
        setNewSecret(s);
        setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(uri)}&size=200x200&margin=10`);
        setScreen("mfa-enroll");
      } else if (isRemembered(uid)) {
        // Device remembered — skip 2FA
        navigate("/");
      } else {
        // Has 2FA — verify
        setTotpSecret(secret);
        setScreen("mfa-verify");
      }
    } catch (err: any) {
      setError(friendlyError(err.code));
    } finally {
      setBusy(false);
    }
  }

  // ── Step 2a: verify existing TOTP ────────────────────────────────────────
  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (code.length !== 6) { setError("Enter the 6-digit code."); return; }
    try {
      setBusy(true);
      const ok = await verifyTOTP(totpSecret, code);
      if (!ok) { setError("Invalid code — try again."); return; }
      if (remember) rememberDevice(auth.currentUser!.uid);
      navigate("/");
    } catch {
      setError("Verification failed — try again.");
    } finally {
      setBusy(false);
    }
  }

  // ── Step 2b: enroll new TOTP ─────────────────────────────────────────────
  async function handleEnroll(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (code.length !== 6) { setError("Enter the 6-digit code from your app."); return; }
    try {
      setBusy(true);
      const ok = await verifyTOTP(newSecret, code);
      if (!ok) { setError("Invalid code — make sure you scanned the QR code and try again."); return; }
      // Save secret to Firestore
      if (firestoreDocId) {
        await updateDoc(doc(db, "users", firestoreDocId), { totpSecret: newSecret });
      }
      if (remember) rememberDevice(auth.currentUser!.uid);
      navigate("/");
    } catch {
      setError("Setup failed — try again.");
    } finally {
      setBusy(false);
    }
  }

  // ── Forgot password ──────────────────────────────────────────────────────
  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email) { setError("Enter your email address."); return; }
    try {
      setBusy(true);
      await fetch("/api/send-password-reset", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), type: "reset" }),
      });
      setScreen("reset-sent");
    } catch (err: any) {
      setError(err?.message ?? "Failed to send reset email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <img src="/skysuite_logo.png" alt="SkySuite" style={{ width: "100%", maxHeight: 160, objectFit: "contain", marginBottom: 12 }} />
        <h1 style={S.title}>SkySuite Console</h1>
        <p style={S.sub}>Employee Portal</p>

        {/* ── Sign In ── */}
        {screen === "login" && (
          <form onSubmit={handleLogin} style={{ marginTop: 28 }}>
            <label style={S.label}>Email</label>
            <input style={S.input} type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoFocus />
            <label style={S.label}>Password</label>
            <input style={S.input} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
            <div style={{ textAlign: "right", marginTop: 6 }}>
              <button type="button" style={S.forgotLink} onClick={() => { setScreen("reset"); setError(""); }}>Forgot password?</button>
            </div>
            {error && <p style={S.error}>{error}</p>}
            <button style={S.btn} type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign In"}</button>
          </form>
        )}

        {/* ── MFA Verify ── */}
        {screen === "mfa-verify" && (
          <form onSubmit={handleVerify} style={{ marginTop: 28 }}>
            <div style={S.infoBox}>🔐 Enter the 6-digit code from your authenticator app.</div>
            <label style={S.label}>Authentication Code</label>
            <input style={{ ...S.input, textAlign: "center", fontSize: 22, letterSpacing: 8, fontWeight: 700 }}
              type="text" inputMode="numeric" maxLength={6} autoFocus
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
              <input type="checkbox" id="remember" checked={remember} onChange={e => setRemember(e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
              <label htmlFor="remember" style={{ fontSize: 13, color: "#555", cursor: "pointer" }}>Remember this device</label>
            </div>
            {error && <p style={S.error}>{error}</p>}
            <button style={S.btn} type="submit" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify"}</button>
            <button type="button" style={S.backLink} onClick={() => { setScreen("login"); setCode(""); setError(""); }}>← Back</button>
          </form>
        )}

        {/* ── MFA Enroll ── */}
        {screen === "mfa-enroll" && (
          <form onSubmit={handleEnroll} style={{ marginTop: 20 }}>
            <div style={S.infoBox}>
              🔐 <strong>Set up two-factor authentication</strong><br />
              <span style={{ fontSize: 12, fontWeight: 400 }}>Scan with Google Authenticator, Authy, or any authenticator app.</span>
            </div>
            {qrUrl && (
              <div style={{ display: "flex", justifyContent: "center", margin: "16px 0" }}>
                <img src={qrUrl} alt="QR Code" style={{ width: 180, height: 180, border: "1px solid #e5e7eb", borderRadius: 8 }} />
              </div>
            )}
            <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", marginBottom: 12 }}>
              Manual key: <span style={{ fontFamily: "monospace", color: "#374151" }}>{newSecret}</span>
            </p>
            <label style={S.label}>Enter the 6-digit code to confirm</label>
            <input style={{ ...S.input, textAlign: "center", fontSize: 22, letterSpacing: 8, fontWeight: 700 }}
              type="text" inputMode="numeric" maxLength={6} autoFocus
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
              <input type="checkbox" id="remember2" checked={remember} onChange={e => setRemember(e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
              <label htmlFor="remember2" style={{ fontSize: 13, color: "#555", cursor: "pointer" }}>Remember this device</label>
            </div>
            {error && <p style={S.error}>{error}</p>}
            <button style={S.btn} type="submit" disabled={busy || code.length !== 6}>{busy ? "Activating…" : "Activate 2FA"}</button>
          </form>
        )}

        {/* ── Reset ── */}
        {screen === "reset" && (
          <form onSubmit={handleReset} style={{ marginTop: 28 }}>
            <p style={S.resetHint}>Enter your email and we'll send you a link to reset your password.</p>
            <label style={S.label}>Email</label>
            <input style={S.input} type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoFocus />
            {error && <p style={S.error}>{error}</p>}
            <button style={S.btn} type="submit" disabled={busy}>{busy ? "Sending…" : "Send Reset Email"}</button>
            <button type="button" style={S.backLink} onClick={() => { setScreen("login"); setError(""); }}>← Back to Sign In</button>
          </form>
        )}

        {/* ── Reset sent ── */}
        {screen === "reset-sent" && (
          <div style={{ marginTop: 28 }}>
            <div style={S.successBox}>✓ Reset email sent! Check your inbox and follow the link to reset your password.</div>
            <button style={{ ...S.btn, marginTop: 16 }} onClick={() => { setScreen("login"); setError(""); }}>← Back to Sign In</button>
          </div>
        )}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page:       { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0d2e5e, #1565c0)" },
  card:       { background: "#fff", borderRadius: 16, padding: "40px 36px", width: 380, boxShadow: "0 8px 40px rgba(0,0,0,0.25)", textAlign: "center" },
  title:      { fontSize: 22, fontWeight: 900, letterSpacing: 2, color: "#0d2e5e" },
  sub:        { color: "#888", fontSize: 14, marginTop: 4 },
  label:      { display: "block", fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 6, marginTop: 16, textAlign: "left" },
  input:      { width: "100%", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 12px", fontSize: 15, outline: "none", boxSizing: "border-box" as const },
  btn:        { marginTop: 16, width: "100%", background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, padding: "12px", fontSize: 16, fontWeight: 700, cursor: "pointer" },
  error:      { color: "#d32f2f", fontSize: 13, marginTop: 10, textAlign: "left" },
  forgotLink: { background: "none", border: "none", color: "#1565c0", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0, textDecoration: "underline" },
  backLink:   { marginTop: 12, width: "100%", background: "none", border: "none", color: "#888", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "8px 0" },
  resetHint:  { fontSize: 13, color: "#666", textAlign: "left", marginBottom: 4 },
  successBox: { background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: 10, padding: "16px", color: "#1565c0", fontWeight: 600, fontSize: 14, textAlign: "left" },
  infoBox:    { background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "12px 14px", color: "#166534", fontWeight: 600, fontSize: 13, textAlign: "left", marginBottom: 4 },
};
