import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault(), projectId: "sky-suite-d14ff" });
const db = getFirestore();

const snap = await db.collection("purchaseOrders").doc("PO-MQ8CQTUL").get();
if (!snap.exists) {
  console.log("NOT FOUND");
} else {
  console.log(JSON.stringify(snap.data(), null, 2));
}
process.exit(0);
