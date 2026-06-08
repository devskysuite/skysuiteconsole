import { useState } from "react";
import {
  signInWithEmailAndPassword,
  multiFactor,
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  browserLocalPersistence,
  setPersistence,
} from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth } from "../firebase";

type Screen = "login" | "mfa-verify" | "mfa-enroll" | "reset" | "reset-sent";

export default function Login() {
  const navigate = useNavigate();
  const [screen, setScreen] = useState<Screen>("login");

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [code,     setCode]     = useState("");
  const [error,    setError]    = useState("");
  const [busy,     setBusy]     = useState(false);

  // MFA state
  const [mfaResolver,  setMfaResolver]  = useState<any>(null);
  const [totpSecret,   setTotpSecret]   = useState<any>(null);
  const [qrCodeUrl,    setQrCodeUrl]    = useState("");

  // ── Login ────────────────────────────────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("Enter email and password."); return; }
    try {
      setBusy(true);
      await setPersistence(auth, browserLocalPersistence);
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);

      // Check if MFA is enrolled — if not, start enrollment
      const factors = multiFactor(cred.user).enrolledFactors;
      if (factors.length === 0) {
        await startEnrollment(cred.user);
      } else {
        navigate("/");
      }
    } catch (err: any) {
      if (err.code === "auth/multi-factor-auth-required") {
        const resolver = getMultiFactorResolver(auth, err);
        setMfaResolver(resolver);
        setScreen("mfa-verify");
      } else {
        setError(friendlyError(err.code));
      }
    } finally {
      setBusy(false);
    }
  }

  // ── Start MFA enrollment ─────────────────────────────────────────────────────
  async function startEnrollment(user: any) {
    const session = await multiFactor(user).getSession();
    const secret  = await TotpMultiFactorGenerator.generateSecret(session);
    const url     = secret.generateQrCodeUrl(user.email || "user", "SkySuite Console");
    setTotpSecret(secret);
    setQrCodeUrl(url);
    setScreen("mfa-enroll");
  }

  // ── Verify enrollment code ───────────────────────────────────────────────────
  async function handleEnroll(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!code || code.length !== 6) { setError("Enter the 6-digit code from your authenticator app."); return; }
    try {
      setBusy(true);
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, code);
      await multiFactor(auth.currentUser!).enroll(assertion, "Authenticator App");
      navigate("/");
    } catch (err: any) {
      setError("Invalid code — try again.");
    } finally {
      setBusy(false);
    }
  }

  // ── Verify MFA on login ──────────────────────────────────────────────────────
  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!code || code.length !== 6) { setError("Enter the 6-digit code."); return; }
    try {
      setBusy(true);
      const hint      = mfaResolver.hints[0];
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
      await mfaResolver.resolveSignIn(assertion);
      navigate("/");
    } catch (err: any) {
      setError("Invalid code — try again.");
    } finally {
      setBusy(false);
    }
  }

  // ── Password reset ───────────────────────────────────────────────────────────
  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email) { setError("Enter your email address."); return; }
    try {
      setBusy(true);
      await fetch("/api/send-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), type: "reset" }),
      });
      setScreen("reset-sent");
    } catch (err: any) {
      setError(err?.message ?? "Failed to send reset email");
    } finally {
      setBusy(false);
    }
  }

  function friendlyError(code: string) {
    if (code === "auth/invalid-credential" || code === "auth/wrong-password") return "Incorrect email or password.";
    if (code === "auth/user-not-found")   return "No account found for that email.";
    if (code === "auth/too-many-requests") return "Too many attempts — try again later.";
    return "Login failed. Try again.";
  }

  // ── QR code image via Google Charts ─────────────────────────────────────────
  const qrImgUrl = qrCodeUrl
    ? `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(qrCodeUrl)}`
    : "";

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
          <form onSubmit={handleMfaVerify} style={{ marginTop: 28 }}>
            <div style={S.infoBox}>🔐 Enter the 6-digit code from your authenticator app.</div>
            <label style={S.label}>Authentication Code</label>
            <input style={{ ...S.input, textAlign: "center", fontSize: 22, letterSpacing: 8, fontWeight: 700 }}
              type="text" inputMode="numeric" maxLength={6} autoFocus
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000" />
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
              <span style={{ fontSize: 12, fontWeight: 400 }}>Scan this QR code with Google Authenticator, Authy, or any authenticator app.</span>
            </div>
            {qrImgUrl && (
              <div style={{ display: "flex", justifyContent: "center", margin: "16px 0" }}>
                <img src={qrImgUrl} alt="QR Code" style={{ width: 180, height: 180, border: "1px solid #e5e7eb", borderRadius: 8 }} />
              </div>
            )}
            <label style={S.label}>Enter the 6-digit code to confirm</label>
            <input style={{ ...S.input, textAlign: "center", fontSize: 22, letterSpacing: 8, fontWeight: 700 }}
              type="text" inputMode="numeric" maxLength={6} autoFocus
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000" />
            {error && <p style={S.error}>{error}</p>}
            <button style={S.btn} type="submit" disabled={busy || code.length !== 6}>{busy ? "Setting up…" : "Activate 2FA"}</button>
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
