/**
 * seed-users.mjs
 *
 * Seeds all employees from the directory into Firestore users collection.
 * Phone, department, section already filled — admins add email later.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT=<json> node scripts/seed-users.mjs
 *   or set it in .env
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { config } from "dotenv";
config();

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
initializeApp({ credential: cert(sa) });
const db = getFirestore();

// Active on-call names (first name only, matches config.json)
const ON_CALL = new Set([
  "Jordan","Jamie","Dave","Will","Steve","Braeden",
  "Zenon","Mitch","Liam","Dylan","Hugo","Joel","Matt","Mike","Connor",
]);

const FIELD = [
  { phone:"519-732-5626", name:"ASHTON HALL",        department:"GENERAL LABORER" },
  { phone:"519-761-0387", name:"AUSTIN HALL",        department:"APPRENTICE" },
  { phone:"519-717-2261", name:"BRAEDEN SIBBICK",    department:"ELECTRICIAN" },
  { phone:"226-979-0975", name:"CARTER REID",        department:"APPRENTICE" },
  { phone:"519-717-5047", name:"CONNOR MUSCAT-HALL", department:"APPRENTICE" },
  { phone:"226-802-4291", name:"DAVE SMITH",         department:"ELECTRICIAN" },
  { phone:"519-865-3532", name:"DYLAN KOOPS",        department:"ELECTRICIAN" },
  { phone:"519-717-3715", name:"EMERSON NOSEWORTHY", department:"APPRENTICE" },
  { phone:"519-717-4542", name:"GABE SMUCK",         department:"APPRENTICE" },
  { phone:"226-698-6461", name:"HUGO DUMAS",         department:"APPRENTICE" },
  { phone:"519-716-1997", name:"HUNTER ANTHILL",     department:"APPRENTICE" },
  { phone:"519-829-5542", name:"JAMIE NAYLOR",       department:"ELECTRICIAN" },
  { phone:"519-717-0878", name:"JOEL LAWRENCE",      department:"ELECTRICIAN" },
  { phone:"519-717-4987", name:"JOSEPH ROSWELL",     department:"ELECTRICIAN" },
  { phone:"519-757-5638", name:"KYLE SKILLITER",     department:"ELECTRICIAN" },
  { phone:"519-717-5041", name:"LIAM DEMEER",        department:"APPRENTICE" },
  { phone:"226-920-9545", name:"MATT ROBINSON",      department:"APPRENTICE" },
  { phone:"519-757-5552", name:"MIKE BEATON",        department:"ELECTRICIAN" },
  { phone:"548-885-3434", name:"MITCHELL PROSSER",   department:"APPRENTICE" },
  { phone:"519-608-0723", name:"MITCH VAN OORSCHOT", department:"APPRENTICE" },
  { phone:"226-802-1180", name:"SARAH BUCCI",        department:"APPRENTICE" },
  { phone:"519-717-2216", name:"WILLIAM ELLIOT",     department:"ELECTRICIAN" },
  { phone:"519-761-8784", name:"WYATT WARREN",       department:"APPRENTICE" },
  { phone:"519-761-8618", name:"ZENON LAFLEUR",      department:"APPRENTICE" },
];

const OFFICE = [
  { phone:"519-757-2040", name:"DAVITA POWELL",  ext:"103", department:"OFFICE" },
  { phone:"226-234-5990", name:"DANILO SILVA",   ext:"N/A", department:"AUTOMATION" },
  { phone:"226-387-2175", name:"JORDAN SIBBICK", ext:"104", department:"OFFICE" },
  { phone:"519-770-5448", name:"RANDALL KOOPS",  ext:"102", department:"OFFICE" },
  { phone:"519-770-5252", name:"ROB TIMMERMAN",  ext:"101", department:"OFFICE" },
  { phone:"519-732-2587", name:"STEVE KNILL",    ext:"105", department:"OFFICE" },
];

function makeId(name) {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

async function run() {
  let ok = 0, skip = 0;
  const all = [
    ...FIELD.map(e => ({ ...e, section: "field" })),
    ...OFFICE.map(e => ({ ...e, section: "office" })),
  ];

  for (const e of all) {
    const id = makeId(e.name);
    const firstName = e.name.split(" ")[0];
    const lastName = e.name.split(" ").slice(1).join(" ");
    const onCall = ON_CALL.has(firstName);

    const ref = db.collection("users").doc(id);
    const existing = await ref.get();

    // Don't overwrite if uid is set (real account already linked)
    if (existing.exists && existing.data().uid) {
      console.log(`⏭  Skip (has uid): ${e.name}`);
      skip++;
      continue;
    }

    const data = {
      displayName: e.name,
      firstName,
      lastName,
      phone: e.phone,
      department: e.department,
      section: e.section,
      onCall,
      role: "user",
      uid: "",
      email: "",
    };
    if (e.ext) data.ext = e.ext;

    await ref.set(data, { merge: true });
    console.log(`✅ ${e.name} (onCall: ${onCall})`);
    ok++;
  }

  // Save on-call roster to settings
  const onCallRoster = FIELD
    .map(e => e.name.split(" ")[0])
    .filter(fn => ON_CALL.has(fn));

  await db.collection("settings").doc("onCallConfig").set(
    { employees: onCallRoster },
    { merge: true }
  );
  console.log(`\n✅ On-call roster saved: ${onCallRoster.join(", ")}`);
  console.log(`\nDone: ${ok} seeded, ${skip} skipped (already have uid)`);
}

run().catch(err => { console.error(err); process.exit(1); });
