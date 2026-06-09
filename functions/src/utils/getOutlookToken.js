import { db } from "./firestore.js";

const TENANT_ID = "1c1d62e8-f392-4caa-a8a6-0ce98e0913d9";
const CLIENT_ID = "9a1a21f1-40a3-4872-a4d6-888bd51d116d";

export async function getOutlookAccessToken() {
  const snap = await db.collection("settings").doc("outlookOnCall").get();
  const data = snap.data() || {};
  const refreshToken = data.refreshToken;

  if (!refreshToken) throw new Error("No Outlook connection. Go to On-Call Manager → Setup → Connect Outlook.");

  const params = {
    grant_type:    "refresh_token",
    client_id:     CLIENT_ID,
    refresh_token: refreshToken,
    scope:         "Calendars.ReadWrite offline_access",
  };

  const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // SPA-issued refresh tokens may only be redeemed via cross-origin requests
      // (AADSTS9002327). Supplying an Origin header satisfies that requirement
      // for server-side redemption.
      "Origin": "https://skysuite.ca",
    },
    body:    new URLSearchParams(params).toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || "Token refresh failed");

  // Persist new refresh token if Microsoft rotated it
  if (json.refresh_token && json.refresh_token !== refreshToken) {
    await db.collection("settings").doc("outlookOnCall").update({ refreshToken: json.refresh_token });
  }

  return json.access_token;
}
