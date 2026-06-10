import { doc, getDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../firebase";

/**
 * Returns a valid Outlook access token.
 *
 * First checks the Firestore-cached token (written by the Cloud Function).
 * If the cached token is still valid, returns it immediately with no network
 * call. If it's expired, calls the refreshOutlookToken Cloud Function which
 * refreshes server-side (no CORS/AADSTS9002326 issue) and updates Firestore.
 *
 * Return values:
 *   string          — valid access token
 *   "disconnected"  — Outlook not connected or refresh token permanently revoked
 *   null            — transient error; caller can silently ignore / retry on reload
 */
export async function getOutlookToken(): Promise<string | null | "disconnected"> {
  try {
    const ref  = doc(db, "settings", "outlookOnCall");
    const snap = await getDoc(ref);

    if (!snap.exists() || !snap.data()?.refreshToken) return "disconnected";

    const data = snap.data();
    const now  = Date.now();

    // Use cached access token if still valid
    if (data.accessToken && data.tokenExpiresAt && data.tokenExpiresAt > now) {
      return data.accessToken as string;
    }

    // Token expired — refresh server-side to avoid AADSTS9002326
    const refresh = httpsCallable<unknown, { accessToken: string; expiresAt: number }>(
      getFunctions(), "refreshOutlookToken"
    );
    const result = await refresh({});
    return result.data.accessToken;
  } catch (err: any) {
    const code = err?.code || "";
    if (code === "functions/unauthenticated" || code === "functions/failed-precondition") {
      return "disconnected";
    }
    return null;
  }
}
