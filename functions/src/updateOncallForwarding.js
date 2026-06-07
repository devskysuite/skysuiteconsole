import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { db } from "./utils/firestore.js";

const cozzmicUsername = defineSecret("COZZMIC_USERNAME");
const cozzmicPassword = defineSecret("COZZMIC_PASSWORD");

export const updateOncallForwarding = onSchedule(
  {
    schedule: "every day 06:30",
    timeZone: "America/Toronto",
    memory: "1GiB",
    timeoutSeconds: 300,
    secrets: [cozzmicUsername, cozzmicPassword],
  },
  async () => {
    // Today's date as "YYYY-MM-DD" in Eastern Time
    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    console.log(`[On-Call Forwarding] Date (Eastern): ${today}`);

    // Step 1: Get today's on-call assignment
    const assignSnap = await db
      .collection("onCallAssignments")
      .where("date", "==", today)
      .limit(1)
      .get();

    if (assignSnap.empty) {
      console.log("No on-call assignment for today. Skipping.");
      return;
    }

    const assignment = assignSnap.docs[0].data();
    const onCallUid = assignment.uid;
    const onCallName = assignment.employeeName;
    console.log(`On-call today: ${onCallName} (uid: ${onCallUid})`);

    // Step 2: Look up their phone number
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
      throw new Error(`No user record found for uid "${onCallUid}" or name "${onCallName}"`);
    }

    const userData = userSnap.docs[0].data();
    const phoneRaw = userData.phone || "";
    const phone = phoneRaw.replace(/\D/g, "");

    if (!phone) {
      throw new Error(`${onCallName} has no phone number set in their profile. Cannot update forwarding.`);
    }

    console.log(`Phone number: ${phoneRaw} → ${phone}`);

    // Step 3: Login and update IVR via Puppeteer
    const COZZMIC_BASE = "https://myphone3.cozzmic.ca";
    const cozzmicUser = cozzmicUsername.value();
    const cozzmicPass = cozzmicPassword.value();

    const IVR_URL = `${COZZMIC_BASE}/?app=pbxware&t=auto_attendants&v=auto_attendants:ext&id=193&server=57`;

    // Dynamic import to avoid 10s initialization timeout
    const chromium = (await import("@sparticuz/chromium")).default;
    const puppeteer = (await import("puppeteer-core")).default;

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    try {
      const page = await browser.newPage();

      // Step 3a: Login
      console.log("Navigating to Cozzmic login...");
      await page.goto(COZZMIC_BASE, { waitUntil: "networkidle2" });

      await page.type('input[name="email"]', cozzmicUser);
      await page.type('input[name="password"]', cozzmicPass);

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

      const onLoginPage = await page.evaluate(() =>
        document.querySelector('input[name="password"]') !== null
      );
      if (onLoginPage) {
        throw new Error("Login failed — still on login page.");
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
        // Step 3d: Update the phone number
        console.log(`Updating destination 6 from "${currentValue}" to "${phone}"...`);
        const input = await page.$("input[name='_char_value[5]'][type='text']");
        await input.click({ clickCount: 3 });
        await input.type(phone);

        // Step 3e: Submit the IVR edit form
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

      // Step 3f: Verify
      console.log("Verifying...");
      await page.goto(IVR_URL, { waitUntil: "networkidle2" });

      const savedValue = await page.$eval(
        "input[name='_char_value[5]'][type='text']",
        (el) => el.value
      );
      console.log(`Verification — IVR destination 6 is now: ${savedValue}`);

      const dest1Value = await page.$eval(
        "select[name='_char_type[0]']",
        (el) => el.options[el.selectedIndex]?.text || "MISSING"
      );
      console.log(`Verification — Dest 1 type: ${dest1Value}`);

      if (savedValue === phone) {
        console.log(`SUCCESS: IVR 820 destination 6 updated to ${onCallName} at ${phoneRaw} (${phone})`);
      } else {
        throw new Error(`Expected ${phone} but found ${savedValue}.`);
      }
    } finally {
      await browser.close();
    }
  }
);
