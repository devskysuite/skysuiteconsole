/**
 * update-oncall-forwarding.mjs
 *
 * Runs daily via GitHub Actions. Reads today's on-call person from Firestore,
 * looks up their phone number, then updates the Main IVR (820) destination 6
 * ("Call External Number") in the Cozzmic PBX to route to that number.
 *
 * Uses Puppeteer (headless Chrome) to interact with the Cozzmic portal,
 * since the form relies on JavaScript/Semantic UI for proper serialization.
 *
 * Required env vars:
 *   FIREBASE_SERVICE_ACCOUNT  — JSON service account key
 *   COZZMIC_USERNAME          — Cozzmic portal login email
 *   COZZMIC_PASSWORD          — Cozzmic portal login password
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import puppeteer from "puppeteer";

// ── Firebase init ──
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ── Today's date as "YYYY-MM-DD" ──
const now = new Date();
// Use Eastern Time for date calculation
const eastern = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(now);
const today = eastern; // "YYYY-MM-DD"
console.log(`[On-Call Forwarding] Date (Eastern): ${today}`);

// ── Step 1: Get today's on-call assignment ──
const assignSnap = await db
  .collection("onCallAssignments")
  .where("date", "==", today)
  .limit(1)
  .get();

if (assignSnap.empty) {
  console.log("No on-call assignment for today. Skipping.");
  process.exit(0);
}

const assignment = assignSnap.docs[0].data();
const onCallUid = assignment.uid;
const onCallName = assignment.employeeName;
console.log(`On-call today: ${onCallName} (uid: ${onCallUid})`);

// ── Step 2: Look up their phone number ──
// Try by uid first; if uid is empty/missing, fall back to displayName match
let userSnap;
if (onCallUid) {
  userSnap = await db
    .collection("users")
    .where("uid", "==", onCallUid)
    .limit(1)
    .get();
}

if (!userSnap || userSnap.empty) {
  console.log(`No uid match — falling back to displayName "${onCallName}"`);
  userSnap = await db
    .collection("users")
    .where("displayName", "==", onCallName)
    .limit(1)
    .get();
}

if (userSnap.empty) {
  console.error(`ERROR: No user record found for uid "${onCallUid}" or name "${onCallName}"`);
  process.exit(1);
}

const userData = userSnap.docs[0].data();
const phoneRaw = userData.phone || "";
// Strip everything except digits (Cozzmic expects digits only)
const phone = phoneRaw.replace(/\D/g, "");

if (!phone) {
  console.error(
    `ERROR: ${onCallName} has no phone number set in their profile. Cannot update forwarding.`
  );
  process.exit(1);
}

console.log(`Phone number: ${phoneRaw} → ${phone}`);

// ── Step 3: Login and update IVR via Puppeteer ──
const COZZMIC_BASE = "https://myphone3.cozzmic.ca";
const cozzmicUser = process.env.COZZMIC_USERNAME;
const cozzmicPass = process.env.COZZMIC_PASSWORD;

if (!cozzmicUser || !cozzmicPass) {
  console.error("ERROR: COZZMIC_USERNAME and COZZMIC_PASSWORD must be set.");
  process.exit(1);
}

const IVR_URL = `${COZZMIC_BASE}/?app=pbxware&t=auto_attendants&v=auto_attendants:ext&id=193&server=57`;

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();

  // Step 3a: Login via Puppeteer
  console.log("Navigating to Cozzmic login...");
  await page.goto(COZZMIC_BASE, { waitUntil: "networkidle2" });

  await page.type('input[name="email"]', cozzmicUser);
  await page.type('input[name="password"]', cozzmicPass);

  // Add the sm_int_login hidden field (submit button value the server expects)
  // then submit the form — form.submit() doesn't include submit button values
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }),
    page.evaluate(() => {
      const form = document.querySelector("form");
      if (!form) return;
      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = "sm_int_login";
      hidden.value = "Login";
      form.appendChild(hidden);
      form.submit();
    }),
  ]);

  // Verify login succeeded
  const onLoginPage = await page.evaluate(() =>
    document.querySelector('input[name="password"]') !== null
  );
  if (onLoginPage) {
    console.error("ERROR: Login failed — still on login page.");
    process.exit(1);
  }
  console.log("Login successful.");

  // Step 3b: Navigate to IVR edit page
  console.log("Navigating to IVR edit page...");
  await page.goto(IVR_URL, { waitUntil: "networkidle2" });

  // Step 3c: Read current value of destination 6
  const currentValue = await page.$eval(
    "input[name='_char_value[5]'][type='text']",
    (el) => el.value
  );
  console.log(`Current destination 6 value: ${currentValue}`);

  if (currentValue === phone) {
    console.log(`Destination 6 already set to ${phone}. No change needed.`);
  } else {
    // Step 3d: Clear the field and type the new phone number
    console.log(`Updating destination 6 from "${currentValue}" to "${phone}"...`);
    const input = await page.$("input[name='_char_value[5]'][type='text']");
    await input.click({ clickCount: 3 }); // select all
    await input.type(phone);

    // Step 3e: Submit the IVR edit form
    // Find and submit the form that contains _char_type fields
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2" }),
      page.evaluate(() => {
        const forms = document.querySelectorAll("form");
        for (const f of forms) {
          if (f.querySelector("[name*='_char_type']")) {
            f.submit();
            return;
          }
        }
      }),
    ]);
    console.log("Form submitted, page navigated.");
  }

  // Step 3f: Verify by re-loading the IVR edit page
  console.log("Verifying...");
  await page.goto(IVR_URL, { waitUntil: "networkidle2" });

  const savedValue = await page.$eval(
    "input[name='_char_value[5]'][type='text']",
    (el) => el.value
  );
  console.log(`Verification — IVR destination 6 is now: ${savedValue}`);

  // Also verify other destinations are intact
  const dest1Value = await page.$eval(
    "select[name='_char_type[0]']",
    (el) => el.options[el.selectedIndex]?.text || "MISSING"
  );
  console.log(`Verification — Dest 1 type: ${dest1Value}`);

  if (savedValue === phone) {
    console.log(`SUCCESS: IVR 820 destination 6 updated to ${onCallName} at ${phoneRaw} (${phone})`);
  } else {
    console.error(`ERROR: Expected ${phone} but found ${savedValue}.`);
    process.exit(1);
  }
} finally {
  await browser.close();
}
