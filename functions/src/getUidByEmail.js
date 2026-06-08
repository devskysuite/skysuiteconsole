import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";

export const getUidByEmail = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

  const { email } = request.data;
  if (!email) throw new HttpsError("invalid-argument", "Email required.");

  try {
    const user = await getAuth().getUserByEmail(email);
    return { uid: user.uid };
  } catch (e) {
    if (e.code === "auth/user-not-found") throw new HttpsError("not-found", "No account found for that email.");
    throw new HttpsError("internal", e.message || "Lookup failed.");
  }
});
