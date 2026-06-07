import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function clearSubcollection(toolRef, subcollection) {
  const snap = await toolRef.collection(subcollection).get();
  if (snap.empty) return 0;
  // Batch deletes in chunks of 500 (Firestore limit)
  let deleted = 0;
  for (let i = 0; i < snap.docs.length; i += 500) {
    const batch = db.batch();
    snap.docs.slice(i, i + 500).forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += Math.min(500, snap.docs.length - i);
  }
  return deleted;
}

const toolsSnap = await db.collection("tools").get();
console.log(`Found ${toolsSnap.size} tools. Clearing history and maintenance logs…\n`);

let totalHistory = 0;
let totalMaintenance = 0;

for (const tool of toolsSnap.docs) {
  const name = tool.data().name ?? tool.id;
  const h = await clearSubcollection(tool.ref, "history");
  const m = await clearSubcollection(tool.ref, "maintenance");
  if (h > 0 || m > 0) {
    console.log(`  ${name}: deleted ${h} history, ${m} maintenance`);
  }
  totalHistory += h;
  totalMaintenance += m;
}

console.log(`\nDone. Deleted ${totalHistory} history entries and ${totalMaintenance} maintenance entries.`);
