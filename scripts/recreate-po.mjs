/**
 * Recreates PO-MQ8CQTUL with a proper 5-digit auto-assigned number.
 * Steps:
 *  1. Refresh OAuth token via Firebase CLI credentials
 *  2. Read settings/poSettings for nextPoNumber
 *  3. Create new purchaseOrders doc with same data + new poNumber
 *  4. Increment nextPoNumber counter
 *  5. Delete old doc TcZKTG8IPdYPeyfTilK9
 */

import { readFileSync } from "fs";

const cfg = JSON.parse(readFileSync(
  "C:\\Users\\JordanSibbick.RBT-11\\.config\\configstore\\firebase-tools.json", "utf8"
));

// Refresh token
const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
    refresh_token: cfg.tokens.refresh_token,
    grant_type: "refresh_token",
  }),
});
const { access_token } = await tokenRes.json();
if (!access_token) { console.error("Token refresh failed"); process.exit(1); }

const BASE = "https://firestore.googleapis.com/v1/projects/sky-suite-d14ff/databases/(default)/documents";
const auth = { Authorization: `Bearer ${access_token}` };

async function getDoc(path) {
  const r = await fetch(`${BASE}/${path}`, { headers: auth });
  return r.json();
}

async function patchDoc(path, fields) {
  const r = await fetch(`${BASE}/${path}`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  return r.json();
}

async function createDoc(collection, fields) {
  const r = await fetch(`${BASE}/${collection}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  return r.json();
}

async function deleteDoc(path) {
  const r = await fetch(`${BASE}/${path}`, { method: "DELETE", headers: auth });
  return r.status;
}

// 1. Read settings/poSettings
const settings = await getDoc("settings/poSettings");
let nextPoNumber = 16919; // default if not set
if (settings.fields?.nextPoNumber?.integerValue) {
  nextPoNumber = parseInt(settings.fields.nextPoNumber.integerValue);
} else if (settings.fields?.nextPoNumber?.doubleValue) {
  nextPoNumber = Math.floor(settings.fields.nextPoNumber.doubleValue);
}
console.log(`Next PO number: ${nextPoNumber}`);

const newPoNumber = String(nextPoNumber);

// 2. Build new doc fields (same data as TcZKTG8IPdYPeyfTilK9, with new poNumber)
const newFields = {
  jobId:                { stringValue: "AYkPeQQeLYRC0R3giRXA" },
  jobNumber:            { stringValue: "26-00001" },
  poNumber:             { stringValue: newPoNumber },
  status:               { stringValue: "Draft" },
  vendorType:           { stringValue: "Supplier" },
  vendor:               { stringValue: "Gerrie Electric Wholesale Ltd." },
  poType:               { stringValue: "Vendor delivery" },
  poDate:               { stringValue: "2026-06-10" },
  fieldOrder:           { booleanValue: false },
  assignTo:             { stringValue: "" },
  assignedTo:           { stringValue: "" },
  requiredBy:           { stringValue: "" },
  tags:                 { stringValue: "" },
  description:          { stringValue: "" },
  department:           { stringValue: "Service" },
  projectManager:       { stringValue: "" },
  taxRate:              { stringValue: "None" },
  directPayerSalesTax:  { booleanValue: false },
  shipTo:               { stringValue: "" },
  items: {
    arrayValue: {
      values: [
        {
          mapValue: {
            fields: {
              id:                  { stringValue: "lb5pcs27" },
              name:                { stringValue: "Purchased Materials" },
              description:         { stringValue: "Testing more" },
              fulfillmentStatus:   { stringValue: "Pending" },
              quantityOrdered:     { integerValue: "1" },
              quantityReceived:    { integerValue: "0" },
              unitCost:            { doubleValue: 0.01 },
              totalCost:           { doubleValue: 0.01 },
              taxable:             { booleanValue: true },
              unitOfMeasure:       { stringValue: "" },
              costCode:            { stringValue: "" },
              jobCostType:         { stringValue: "Materials" },
              revenueType:         { stringValue: "Materials" },
            }
          }
        }
      ]
    }
  },
  bills:      { arrayValue: {} },
  subtotal:   { doubleValue: 0.01 },
  taxAmount:  { integerValue: "0" },
  total:      { doubleValue: 0.01 },
  createdBy:  { stringValue: "j.sibbick@rbtautomate.com" },
  createdAt:  { stringValue: "2026-06-10" },
};

// 3. Create new doc
const created = await createDoc("purchaseOrders", newFields);
if (!created.name) {
  console.error("Failed to create new PO:", JSON.stringify(created));
  process.exit(1);
}
const newDocId = created.name.split("/").pop();
console.log(`Created new PO with number ${newPoNumber}, doc ID: ${newDocId}`);

// 4. Increment counter
const patchRes = await patchDoc("settings/poSettings", {
  nextPoNumber: { integerValue: String(nextPoNumber + 1) },
});
console.log("Counter incremented to", nextPoNumber + 1);

// 5. Delete old doc
const delStatus = await deleteDoc("purchaseOrders/TcZKTG8IPdYPeyfTilK9");
console.log(`Deleted old PO-MQ8CQTUL doc, HTTP status: ${delStatus}`);

console.log("\nDone. New PO:", newPoNumber, "| Doc ID:", newDocId);
