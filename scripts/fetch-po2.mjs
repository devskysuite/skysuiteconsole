import { readFileSync } from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const cfg = JSON.parse(readFileSync(
  "C:\\Users\\JordanSibbick.RBT-11\\.config\\configstore\\firebase-tools.json", "utf8"
));

const { refresh_token } = cfg.tokens;
const CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

// Refresh the access token
const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token,
    grant_type: "refresh_token",
  }),
});
const tokenData = await tokenRes.json();
if (!tokenData.access_token) {
  console.error("Token refresh failed:", tokenData);
  process.exit(1);
}
console.error("Token refreshed OK");

// Query for poNumber = "PO-MQ8CQTUL"
const url = "https://firestore.googleapis.com/v1/projects/sky-suite-d14ff/databases/(default)/documents:runQuery";
const body = {
  structuredQuery: {
    from: [{ collectionId: "purchaseOrders" }],
    where: {
      fieldFilter: {
        field: { fieldPath: "poNumber" },
        op: "EQUAL",
        value: { stringValue: "PO-MQ8CQTUL" },
      },
    },
    limit: 5,
  },
};
const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const docs = await res.json();
console.log(JSON.stringify(docs, null, 2));
