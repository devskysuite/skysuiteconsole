import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { idToken } = req.body as { idToken: string };

  if (!idToken) {
    return res.status(400).json({ error: "Missing idToken" });
  }

  // Init Firebase Admin once per cold start
  if (!getApps().length) {
    initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)),
    });
  }

  // Verify the caller is authenticated
  try {
    await getAuth().verifyIdToken(idToken);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Trigger the GitHub Actions workflow
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    return res.status(500).json({ error: "GITHUB_TOKEN not configured" });
  }

  try {
    const response = await fetch(
      "https://api.github.com/repos/rbtelectrical/rbt-tool-tracker/actions/workflows/oncall-forwarding.yml/dispatches",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `GitHub API error: ${text}` });
    }

    return res.status(200).json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Failed to trigger workflow" });
  }
}
