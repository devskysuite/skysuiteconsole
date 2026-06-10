import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "./utils/firestore.js";

const TENANT_ID = "1c1d62e8-f392-4caa-a8a6-0ce98e0913d9";
const CLIENT_ID = "9a1a21f1-40a3-4872-a4d6-888bd51d116d";
const LOCK_TTL  = 20_000; // ms

// Server-side token refresh — avoids AADSTS9002326 (cross-origin token
// redemption blocked for Web-type app registrations). The Cloud Function
// has no Origin header so Microsoft treats it as a server-to-server call.
export const refreshOutlookToken = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

  const ref  = db.collection("settings").doc("outlookOnCall");
  const snap = await ref.get();
  if (!snap.exists || !snap.data().refreshToken) {
    throw new HttpsError("failed-precondition", "Outlook not connected.");
  }

  const data = snap.data();
  const now  = Date.now();

  // Return cached token if still valid
  if (data.accessToken && data.tokenExpiresAt && data.tokenExpiresAt > now) {
    return { accessToken: data.accessToken, expiresAt: data.tokenExpiresAt };
  }

  // Wait if another instance is already refreshing
  if (data.refreshLockAt && now - data.refreshLockAt < LOCK_TTL) {
    await new Promise(r => setTimeout(r, LOCK_TTL - (now - data.refreshLockAt) + 500));
    const snap2 = await ref.get();
    if (snap2.exists && snap2.data().accessToken && snap2.data().tokenExpiresAt > Date.now()) {
      return { accessToken: snap2.data().accessToken, expiresAt: snap2.data().tokenExpiresAt };
    }
  }

  // Acquire lock
  await ref.set({ refreshLockAt: now }, { merge: true });

  let json;
  try {
    const res = await fetch(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type:    "refresh_token",
          client_id:     CLIENT_ID,
          refresh_token: data.refreshToken,
          scope:         "Calendars.ReadWrite offline_access",
        }).toString(),
      }
    );
    json = await res.json();
  } catch (e) {
    await ref.set({ refreshLockAt: null }, { merge: true });
    throw new HttpsError("internal", "Network error: " + e.message);
  }

  if (json.access_token) {
    const expiresAt = Date.now() + ((json.expires_in || 3600) - 300) * 1000;
    await ref.set({
      accessToken:    json.access_token,
      refreshToken:   json.refresh_token || data.refreshToken,
      tokenExpiresAt: expiresAt,
      refreshLockAt:  null,
    }, { merge: true });
    return { accessToken: json.access_token, expiresAt };
  }

  await ref.set({ refreshLockAt: null }, { merge: true });

  if (json.error === "invalid_grant") {
    await ref.set({ refreshToken: null, accessToken: null, tokenExpiresAt: null }, { merge: true });
    throw new HttpsError("unauthenticated", "Outlook disconnected — please reconnect.");
  }

  throw new HttpsError("internal", json.error_description || json.error || "Token refresh failed.");
});
