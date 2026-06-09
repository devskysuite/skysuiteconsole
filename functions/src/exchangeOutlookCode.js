import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "./utils/firestore.js";

const TENANT_ID = "1c1d62e8-f392-4caa-a8a6-0ce98e0913d9";
const CLIENT_ID = "9a1a21f1-40a3-4872-a4d6-888bd51d116d";

// Proxy the OAuth authorization-code exchange server-side.
// The browser cannot call Microsoft's token endpoint directly when the Azure app
// registration is "Web" type — it returns AADSTS9002326 (cross-origin redemption
// blocked). A Cloud Function has no cross-origin restriction, so the exchange
// succeeds here. The resulting tokens are saved to Firestore and the access
// token is returned to the client.
export const exchangeOutlookCode = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

  const { code, codeVerifier, redirectUri } = request.data || {};
  if (!code) throw new HttpsError("invalid-argument", "code is required.");

  const params = new URLSearchParams({
    grant_type:   "authorization_code",
    client_id:    CLIENT_ID,
    code,
    redirect_uri: redirectUri || "https://skysuite.ca/",
    scope:        "Calendars.ReadWrite offline_access",
  });
  if (codeVerifier) params.append("code_verifier", codeVerifier);

  let json;
  try {
    const res = await fetch(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      {
        method:  "POST",
        headers: {
          // Do NOT include an Origin header for the initial code exchange.
          // Azure checks for an Origin header to detect cross-origin browser
          // requests and blocks them for Web-type app registrations (AADSTS9002326).
          // A genuine server-to-server call has no Origin header, so Microsoft
          // treats it as a legitimate Web-app auth-code exchange and allows it.
          // (Contrast with refresh-token redemption, which needs Origin to
          // satisfy AADSTS9002327 for SPA-issued tokens — see getOutlookToken.js.)
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    );
    json = await res.json();
  } catch (e) {
    throw new HttpsError("internal", "Network error contacting Microsoft: " + e.message);
  }

  if (!json.access_token) {
    throw new HttpsError(
      "internal",
      json.error_description || json.error || "Token exchange failed"
    );
  }

  const expiresAt = Date.now() + ((json.expires_in || 3600) - 300) * 1000;

  // Persist tokens so all users share the cached access token (same pattern
  // as the existing getOutlookToken utility used by Cloud Functions).
  await db.collection("settings").doc("outlookOnCall").set(
    {
      refreshToken:   json.refresh_token,
      accessToken:    json.access_token,
      tokenExpiresAt: expiresAt,
    },
    { merge: true }
  );

  return { accessToken: json.access_token, expiresAt };
});
