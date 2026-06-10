import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";

const TENANT_ID  = "1c1d62e8-f392-4caa-a8a6-0ce98e0913d9";
const CLIENT_ID  = "9a1a21f1-40a3-4872-a4d6-888bd51d116d";
const LOCK_TTL   = 20_000; // ms — how long we wait before assuming a stuck lock is stale

async function doMsRefresh(rt: string): Promise<{ access: string; refresh: string; expiresAt: number } | null | "invalid_grant"> {
  try {
    const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: "POST",
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        refresh_token: rt,
        grant_type: "refresh_token",
        scope: "Calendars.ReadWrite offline_access",
      }),
    });
    let d: any;
    try { d = await r.json(); } catch { return null; }
    if (d.access_token) {
      return {
        access:    d.access_token,
        refresh:   d.refresh_token || rt,       // Microsoft rotates the refresh token
        expiresAt: Date.now() + ((d.expires_in || 3600) - 300) * 1000, // 5-min buffer
      };
    }
    return d.error === "invalid_grant" ? "invalid_grant" : null;
  } catch {
    return null;
  }
}

/**
 * Returns a valid Outlook access token, using the Firestore-cached token when
 * possible and only calling Microsoft when the cached token has expired.
 *
 * A distributed lock (refreshLockAt timestamp in Firestore) prevents multiple
 * browser tabs / pages from calling Microsoft simultaneously with the same
 * refresh token — which would cause the first caller's rotated token to
 * invalidate the second caller's attempt ("invalid_grant"), clearing the
 * connection for everyone.
 *
 * Return values:
 *   string          — valid access token
 *   "disconnected"  — refresh token gone or permanently revoked; admin must reconnect
 *   null            — transient network error; caller can silently ignore / retry on reload
 */
export async function getOutlookToken(): Promise<string | null | "disconnected"> {
  const ref = doc(db, "settings", "outlookOnCall");

  const snap = await getDoc(ref);
  if (!snap.exists() || !snap.data().refreshToken) return "disconnected";

  const data = snap.data();
  const now  = Date.now();

  // ── Cached token still valid ────────────────────────────────────────────────
  if (data.accessToken && data.tokenExpiresAt && data.tokenExpiresAt > now) {
    return data.accessToken as string;
  }

  // ── Another instance is refreshing — wait for it then re-read ───────────────
  if (data.refreshLockAt && now - data.refreshLockAt < LOCK_TTL) {
    const remaining = LOCK_TTL - (now - data.refreshLockAt) + 500;
    await new Promise(r => setTimeout(r, remaining));
    const snap2 = await getDoc(ref);
    if (snap2.exists()) {
      const d2 = snap2.data();
      if (d2.accessToken && d2.tokenExpiresAt > Date.now()) return d2.accessToken as string;
      // Lock holder may have had a transient failure — fall through and try ourselves
    }
  }

  // ── Acquire lock and refresh ────────────────────────────────────────────────
  try { await setDoc(ref, { refreshLockAt: now }, { merge: true }); } catch {}

  const result = await doMsRefresh(data.refreshToken as string);

  if (result && result !== "invalid_grant") {
    // Persist all three fields so the next caller uses the cache
    try {
      await setDoc(ref, {
        accessToken:    result.access,
        refreshToken:   result.refresh,
        tokenExpiresAt: result.expiresAt,
        refreshLockAt:  null,
      }, { merge: true });
    } catch {}
    return result.access;
  }

  if (result === "invalid_grant") {
    // Refresh token permanently revoked — clear everything
    try {
      await setDoc(ref, {
        refreshToken: null, accessToken: null, tokenExpiresAt: null, refreshLockAt: null,
      }, { merge: true });
    } catch {}
    return "disconnected";
  }

  // Transient error — release lock, leave tokens untouched
  try { await setDoc(ref, { refreshLockAt: null }, { merge: true }); } catch {}
  return null;
}
