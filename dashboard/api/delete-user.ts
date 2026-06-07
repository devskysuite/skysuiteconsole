import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { uid, idToken } = req.body as { uid: string; idToken: string };

  if (!uid || !idToken) {
    return res.status(400).json({ error: "Missing uid or idToken" });
  }

  // Init Firebase Admin once per cold start
  if (!getApps().length) {
    initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)),
    });
  }

  const adminAuth = getAuth();

  // Verify the caller is a logged-in admin
  try {
    await adminAuth.verifyIdToken(idToken);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Delete the user from Firebase Auth
  try {
    await adminAuth.deleteUser(uid);
    return res.status(200).json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Failed to delete user" });
  }
}
