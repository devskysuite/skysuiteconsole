/**
 * One-time migration: re-tags all tools in Firestore as TL-0001, TL-0002, etc.
 * Tools are sorted by their current document ID (alphabetically) so the order is consistent.
 *
 * Usage:
 *   1. Download your Firebase service account JSON from:
 *      Firebase Console → Project Settings → Service Accounts → Generate New Private Key
 *   2. Save it as scripts/service-account.json
 *   3. cd scripts && node retag-tools.mjs
 */

import { readFileSync, existsSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Load service account — from file or env var
let serviceAccount;
const localPath = new URL("./service-account.json", import.meta.url).pathname;

if (existsSync(localPath)) {
  serviceAccount = JSON.parse(readFileSync(localPath, "utf8"));
  console.log("Using service-account.json");
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  console.log("Using FIREBASE_SERVICE_ACCOUNT env var");
} else {
  console.error(
    "No credentials found.\n" +
    "Save your Firebase service account JSON as scripts/service-account.json\n" +
    "or set the FIREBASE_SERVICE_ACCOUNT environment variable."
  );
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// --- Fetch all tools ---
const snap = await db.collection("tools").get();
const tools = snap.docs.map((d) => ({ oldId: d.id, data: d.data() }));

if (tools.length === 0) {
  console.log("No tools found — nothing to do.");
  process.exit(0);
}

// Sort by existing ID so ordering is predictable
tools.sort((a, b) => a.oldId.localeCompare(b.oldId));

console.log(`\nFound ${tools.length} tool(s). Retagging...\n`);

// --- Migrate each tool ---
let counter = 1;
for (const { oldId, data } of tools) {
  const newId = `TL-${String(counter).padStart(4, "0")}`;
  counter++;

  if (oldId === newId) {
    console.log(`  ✓ ${oldId} — already correct, skipping`);
    continue;
  }

  const newData = { ...data, toolId: newId };

  // Write new doc
  await db.collection("tools").doc(newId).set(newData);

  // Delete old doc
  await db.collection("tools").doc(oldId).delete();

  console.log(`  ${oldId.padEnd(20)} → ${newId}`);
}

console.log(`\nDone! All ${tools.length} tools retagged successfully.`);
console.log(`Next tool will be: TL-${String(counter).padStart(4, "0")}`);
