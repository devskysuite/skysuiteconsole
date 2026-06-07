import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth } from "../firebase";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [busy, setBusy]         = useState(false);

  // Forgot password
  const [resetMode, setResetMode]   = useState(false);
  const [resetSent, setResetSent]   = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("Enter email and password."); return; }
    try {
      setBusy(true);
      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate("/");
    } catch (err: any) {
      setError(err?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  }

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
      setResetSent(true);
    } catch (err: any) {
      setError(err?.message ?? "Failed to send reset email");
    } finally {
      setBusy(false);
    }
  }

  function backToLogin() {
    setResetMode(false);
    setResetSent(false);
    setError("");
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <img src="/skysuite_logo.png" alt="SkySuite" style={{ width: "100%", maxHeight: 90, objectFit: "contain", marginBottom: 12, background: "#0d2e5e", borderRadius: 12, padding: "8px 16px" }} />
        <h1 style={styles.title}>SkySuite Console</h1>
        <p style={styles.sub}>Employee Portal</p>

        {resetMode ? (
          /* ── Forgot Password form ── */
          resetSent ? (
            <div style={{ marginTop: 28 }}>
              <div style={styles.successBox}>
                ✓ Reset email sent! Check your inbox and follow the link to reset your password.
              </div>
              <button style={{ ...styles.btn, marginTop: 16 }} onClick={backToLogin}>
                ← Back to Sign In
              </button>
            </div>
          ) : (
            <form onSubmit={handleReset} style={{ marginTop: 28 }}>
              <p style={styles.resetHint}>
                Enter your email and we'll send you a link to reset your password.
              </p>
              <label style={styles.label}>Email</label>
              <input
                style={styles.input}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoFocus
              />
              {error && <p style={styles.error}>{error}</p>}
              <button style={styles.btn} type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send Reset Email"}
              </button>
              <button type="button" style={styles.backLink} onClick={backToLogin}>
                ← Back to Sign In
              </button>
            </form>
          )
        ) : (
          /* ── Sign In form ── */
          <form onSubmit={handleLogin} style={{ marginTop: 28 }}>
            <label style={styles.label}>Email</label>
            <input
              style={styles.input}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />

            <label style={styles.label}>Password</label>
            <input
              style={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
            />

            <div style={{ textAlign: "right", marginTop: 6 }}>
              <button type="button" style={styles.forgotLink} onClick={() => { setResetMode(true); setError(""); }}>
                Forgot password?
              </button>
            </div>

            {error && <p style={styles.error}>{error}</p>}

            <button style={styles.btn} type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign In"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
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
};
