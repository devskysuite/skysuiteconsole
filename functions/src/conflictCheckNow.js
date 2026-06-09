import { onCall, HttpsError } from "firebase-functions/v2/https";
import { runConflictCheck } from "./vacationConflictCheck.js";

// Manual, admin-only run of the conflict check. Texts ONLY the alert number
// (never the affected people) and returns the conflict summary for the UI.
export const conflictCheckNow = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");
  try {
    return await runConflictCheck({ adminOnly: true });
  } catch (e) {
    throw new HttpsError("internal", e.message || "Conflict check failed.");
  }
});
