import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { arrayUnion, collection, doc, getDoc, getDocs, query, runTransaction, updateDoc, where } from "firebase/firestore";
import { auth, db, storage } from "../firebase";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// ── Types ──────────────────────────────────────────────────────────────────────
interface POItem {
  id: string; name: string; description: string;
  quantityOrdered: number; quantityReceived: number;
  unitCost: number; totalCost: number; taxable: boolean;
  unitOfMeasure: string; costCode: string; jobCostType: string; revenueType: string;
  fulfillmentStatus: string;
}

type LineMode = "receive" | "new" | "skip";

interface InvoiceLine {
  partNo: string; description: string; qty: number; uom: string;
  unitPrice: number; total: number; taxable: boolean;
  mode: LineMode;
  matchedItemId: string | null; // id of the POItem this receives against
}

interface ParsedInvoice {
  invoiceNumber: string; poNumber: string; vendor: string; date: string;
  lines: InvoiceLine[]; subtotal: number; taxAmount: number; grandTotal: number; taxLabel: string;
}

interface POStub { id: string; poNumber: string; vendor: string; jobNumber: string; status: string; }

// ── PDF Text Extraction ────────────────────────────────────────────────────────
async function extractLines(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const allLines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const byY = new Map<number, Array<{ x: number; str: string }>>();
    for (const item of content.items) {
      if (!("str" in item) || !(item as any).str?.trim()) continue;
      const y = Math.round((item as any).transform[5] / 2) * 2;
      const x = (item as any).transform[4];
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push({ x, str: (item as any).str });
    }
    const sortedY = [...byY.keys()].sort((a, b) => b - a);
    for (const y of sortedY) {
      const line = byY.get(y)!.sort((a, b) => a.x - b.x).map(i => i.str).join(" ").replace(/\s{2,}/g, " ").trim();
      if (line) allLines.push(line);
    }
  }
  return allLines;
}

// ── Invoice Parser ─────────────────────────────────────────────────────────────
function parseInvoice(lines: string[]): ParsedInvoice {
  const result: ParsedInvoice = { invoiceNumber: "", poNumber: "", vendor: "", date: "", lines: [], subtotal: 0, taxAmount: 0, grandTotal: 0, taxLabel: "Tax" };
  const full = lines.join("\n");
  const invMatch = full.match(/invoice\s*(?:no\.?|number|#)?\s*:?\s*(\d{5,})/i);
  if (invMatch) result.invoiceNumber = invMatch[1];
  // PO number must start with a digit to avoid grabbing column headers like "ORDERED"
  // Also scan the line AFTER the label in case the value is on the next row
  const custPoInline = full.match(/customer\s+p\.?o\.?\s+no\.?\s*[:\s]+(\d[\dA-Z-]*)/i);
  if (custPoInline) {
    result.poNumber = custPoInline[1];
  } else {
    // label and value may be on separate lines — find the label line index and peek next
    const labelIdx = lines.findIndex(l => /customer\s+p\.?o\.?\s+no/i.test(l));
    if (labelIdx >= 0) {
      for (let k = labelIdx + 1; k <= labelIdx + 3 && k < lines.length; k++) {
        const m = lines[k].match(/(\d[\dA-Z-]{3,})/i);
        if (m) { result.poNumber = m[1]; break; }
      }
    }
    if (!result.poNumber) {
      const poMatch = full.match(/(?:purchase\s+order|p\.?o\.?)\s*(?:no\.?|number|#)?\s*:?\s*(\d[\d-]*)/i);
      if (poMatch) result.poNumber = poMatch[1];
    }
  }
  // Date extraction — 3-pass escalating search
  function normalizeDate(raw: string): string {
    const parts = raw.split(/[\/\-]/);
    if (parts.length !== 3) return raw;
    if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2,"0")}-${parts[2].padStart(2,"0")}`;
    if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`;
    return raw;
  }
  const dateRe = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})\b/;
  // Pass 1: labeled inline — "Order Date: 06/05/2024" or "Date 06/05/2024"
  const dateLabeled = full.match(/(?:order\s+date|invoice\s+date|date)\s*[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})/i);
  if (dateLabeled) {
    result.date = normalizeDate(dateLabeled[1]);
  } else {
    // Pass 2: lines after a "date" label (column-header layout)
    const labelIdx = lines.findIndex(l => /\bdate\b/i.test(l));
    if (labelIdx >= 0) {
      for (let k = labelIdx + 1; k <= labelIdx + 5 && k < lines.length; k++) {
        const m = lines[k].match(dateRe);
        if (m) { result.date = normalizeDate(m[1]); break; }
      }
    }
    // Pass 3: just find the first 4-digit-year date anywhere in the document
    if (!result.date) {
      for (const line of lines) {
        const m = line.match(dateRe);
        if (m) { result.date = normalizeDate(m[1]); break; }
      }
    }
  }
  if (lines.length > 0) result.vendor = lines[0];
  // Extract the last dollar amount on a line (right-aligned invoice values)
  const getLastAmt = (line: string): number | null => {
    const matches = [...line.matchAll(/\$?\s*([\d,]+\.\d{2})/g)];
    if (!matches.length) return null;
    return parseFloat(matches[matches.length - 1][1].replace(/,/g, ""));
  };
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const next = lines[li + 1] || "";
    if (/sub[\s\-]?total|subtotal/i.test(line) && !/grand/i.test(line)) {
      const prev = lines[li - 1] || "";
      const amt = getLastAmt(line) ?? getLastAmt(next) ?? getLastAmt(prev);
      if (amt !== null) result.subtotal = amt;
      continue;
    }
    if (/^(hst|gst|pst|qst|tax(?:\s*\(?\d+(?:\.\d+)?%?\)?)?)\b/i.test(line)) {
      const amt = getLastAmt(line) ?? getLastAmt(next);
      if (amt !== null) {
        result.taxLabel = line.split(/\s+/)[0].replace(/\s+/g, " ").toUpperCase();
        result.taxAmount = amt;
      }
      continue;
    }
    if (/\btotal\b/i.test(line) && !/sub[\s\-]?total|subtotal/i.test(line)) {
      const amt = getLastAmt(line) ?? getLastAmt(next);
      if (amt !== null) result.grandTotal = amt;
      continue;
    }
  }
  const UOMS = /^(EA|EACH|PC|PCS|LB|FT|M|L|KG|BOX|RL|BAG|HR|SET|PR|CS|GAL|TON|YD|ROLL|CAN|PAIR)$/i;
  const skipP = /^(ship|bill|invoice|date|p\.?o|purchase|customer|sub|total|hst|gst|tax|page|line|qty|description|unit|amount|price|receipt)/i;
  const isGerrieLine = (s: string) => /^\d+\.\d+\s+[A-Z]/i.test(s);
  const isSummaryLine = (s: string) => /^(sub[\s\-]?total|hst|gst|pst|qst|tax|total|freight|shipping|pack\s*slip|please\s*remit)/i.test(s);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // Gerrie format: {lineNo} {partNo} {qty} {UOM} {unitPrice} {UOM} NET {total}
    // e.g. "1.000 SYL20906 40 EA 4.8150 EA NET 192.60"
    const gm = line.match(/^\d+\.\d+\s+([A-Z0-9][A-Z0-9\-\/]*)\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,6})\s+(\.?\d[\d.]*)\s+[A-Z]{1,6}\s+NET\s+([\d,]+\.\d+)/i);
    if (gm) {
      const [, partNo, qtyStr, uom, upStr, totStr] = gm;
      const qty = parseFloat(qtyStr);
      const unitPrice = parseFloat(upStr);
      const total = parseFloat(totStr.replace(/,/g, ""));
      // Description: scan next 1-3 continuation lines, prefer one with spaces (human-readable)
      const picks: string[] = [];
      for (let j = li + 1; j < Math.min(li + 4, lines.length); j++) {
        const l = lines[j].trim();
        if (!l || isGerrieLine(l) || isSummaryLine(l)) break;
        picks.push(l);
      }
      const description = picks.find(p => p.includes(" ")) || picks[0] || "";
      result.lines.push({ partNo, description, qty, uom: uom.toUpperCase(), unitPrice, total, taxable: true, mode: "new", matchedItemId: null });
      continue;
    }
    // Generic format: {description} {qty} {UOM} {unitPrice} {total}
    if (skipP.test(line)) continue;
    const m = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,6})\s+(\d[\d,]*\.\d+)\s+(\d[\d,]*\.\d+)\s*$/i);
    if (!m) continue;
    const [, raw, qtyStr, uom, upStr, totStr] = m;
    if (!UOMS.test(uom)) continue;
    const qty = parseFloat(qtyStr), unitPrice = parseFloat(upStr.replace(/,/g, "")), total = parseFloat(totStr.replace(/,/g, ""));
    if (qty > 0 && unitPrice > 0 && Math.abs(qty * unitPrice - total) > total * 0.05 + 0.1) continue;
    const rawT = raw.trim(), si = rawT.indexOf(" ");
    const partNo = si > 0 ? rawT.slice(0, si) : rawT;
    const description = si > 0 ? rawT.slice(si + 1).trim() : "";
    result.lines.push({ partNo, description, qty, uom: uom.toUpperCase(), unitPrice, total, taxable: true, mode: "new", matchedItemId: null });
  }
  return result;
}

// ── Auto-match invoice lines to existing PO items ─────────────────────────────
function autoMatchLines(lines: InvoiceLine[], poItems: POItem[]): InvoiceLine[] {
  return lines.map(line => {
    const pn = line.partNo.toLowerCase().trim();
    // 1. exact match on item name
    let match = poItems.find(i => i.name.toLowerCase().trim() === pn);
    // 2. item name contains the part#
    if (!match) match = poItems.find(i => i.name.toLowerCase().includes(pn) && pn.length >= 4);
    // 3. part# contains item name
    if (!match) match = poItems.find(i => pn.includes(i.name.toLowerCase().trim()) && i.name.length >= 4);
    if (match) return { ...line, mode: "receive" as LineMode, matchedItemId: match.id };
    return line;
  });
}

// ── PO Lookup ─────────────────────────────────────────────────────────────────
// Gerrie format: 26-15698-{PO#} — always use the LAST numeric segment first.
// PO numbers may be stored as strings or integers in Firestore, so query both.
async function findMatchingPOs(rawPoField: string): Promise<POStub[]> {
  if (!rawPoField) return [];

  // Split on non-digit runs and take segments of 4–8 digits
  const allSegs = (rawPoField.match(/\d{4,8}/g) || []);
  if (allSegs.length === 0) return [];

  // Prioritise: last segment first, then remaining (deduped)
  const lastSeg = allSegs[allSegs.length - 1];
  const otherSegs = Array.from(new Set(allSegs.slice(0, -1)));
  const ordered = [lastSeg, ...otherSegs];

  // Build two candidate arrays: strings and numbers (Firestore may store either)
  const strCandidates = Array.from(new Set(ordered));
  const numCandidates = strCandidates.map(s => parseInt(s, 10)).filter(n => !isNaN(n));

  const seen = new Set<string>();
  const results: POStub[] = [];

  async function runQuery(candidates: (string | number)[]) {
    for (let i = 0; i < candidates.length; i += 30) {
      const chunk = candidates.slice(i, i + 30);
      const snap = await getDocs(query(collection(db, "purchaseOrders"), where("poNumber", "in", chunk)));
      snap.forEach(d => {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          results.push({ id: d.id, poNumber: String(d.data().poNumber), vendor: d.data().vendor || "", jobNumber: d.data().jobNumber || "", status: d.data().status || "" });
        }
      });
    }
  }

  await runQuery(strCandidates);
  await runQuery(numCandidates);

  // Sort so the last-segment match comes first
  results.sort((a, b) => {
    const aIsLast = String(a.poNumber) === lastSeg ? 0 : 1;
    const bIsLast = String(b.poNumber) === lastSeg ? 0 : 1;
    return aIsLast - bIsLast;
  });

  return results;
}

// ── Auto Bill Number ───────────────────────────────────────────────────────────
async function getNextBillNumber(): Promise<string> {
  const settingsRef = doc(db, "settings", "poSettings");
  let next = 10001;
  try {
    await runTransaction(db, async tx => {
      const snap = await tx.get(settingsRef);
      const cur = snap.exists() ? (snap.data().nextBillNumber ?? 10001) : 10001;
      next = cur;
      tx.set(settingsRef, { nextBillNumber: cur + 1 }, { merge: true });
    });
  } catch {
    // fallback: timestamp-based 5-digit number
    next = parseInt(String(Date.now()).slice(-5), 10);
  }
  return String(next).padStart(5, "0");
}

// ── Save ───────────────────────────────────────────────────────────────────────
async function saveImport(targetPoId: string, invoice: ParsedInvoice, editLines: InvoiceLine[], file: File): Promise<{ pdfError?: string }> {
  const billNumber = await getNextBillNumber();

  let pdfUrl = "";
  let pdfError: string | undefined;
  try {
    const sRef = storageRef(storage, `bills/${billNumber}.pdf`);
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("upload timed out after 30s")), 30000));
    const upload = uploadBytes(sRef, file, { contentType: "application/pdf" }).then(snap => getDownloadURL(snap.ref));
    pdfUrl = await Promise.race([upload, timeout]);
  } catch (e: any) {
    pdfError = e?.code ? `${e.code}: ${e.message}` : (e instanceof Error ? e.message : String(e));
    console.error("[PDF upload]", e);
  }
  const bill = {
    id: crypto.randomUUID(), billNumber,
    receiptNumber: invoice.invoiceNumber, vendor: invoice.vendor,
    dateIssued: invoice.date || new Date().toISOString().slice(0, 10),
    total: invoice.grandTotal || invoice.subtotal + invoice.taxAmount,
    pdfUrl, createdBy: auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
  };

  const poSnap = await getDoc(doc(db, "purchaseOrders", targetPoId));
  const poData = poSnap.data();
  let items: POItem[] = (poData?.items || []).map((i: any) => ({ ...i }));

  const newItems: POItem[] = [];
  for (const line of editLines) {
    if (line.mode === "skip") continue;

    if (line.mode === "receive" && line.matchedItemId) {
      // increment quantityReceived on the matched item
      items = items.map(i => {
        if (i.id !== line.matchedItemId) return i;
        const newQtyRec = (i.quantityReceived || 0) + line.qty;
        const fulfilled = newQtyRec >= (i.quantityOrdered || 0) && i.quantityOrdered > 0;
        return { ...i, quantityReceived: newQtyRec, fulfillmentStatus: fulfilled ? "Fulfilled" : "Pending" };
      });
    } else if (line.mode === "new") {
      newItems.push({
        id: crypto.randomUUID(), name: line.partNo || line.description,
        description: line.partNo && line.description ? line.description : "",
        fulfillmentStatus: "Pending", quantityOrdered: line.qty, quantityReceived: 0,
        unitCost: line.unitPrice, totalCost: line.total, taxable: line.taxable,
        unitOfMeasure: line.uom, costCode: "Materials", jobCostType: "Materials", revenueType: "Materials",
      });
    }
  }

  const allItems = [...items, ...newItems];
  const poTaxPct = ({ "GST (5%)": 0.05, "HST ON (13%)": 0.13, "HST BC (12%)": 0.12, "PST (7%)": 0.07 } as Record<string, number>)[poData?.taxRate || ""] ?? 0;
  const newSubtotal = allItems.reduce((s, i) => s + (i.totalCost || 0), 0);
  const newTaxAmt = allItems.filter(i => i.taxable).reduce((s, i) => s + (i.totalCost || 0), 0) * poTaxPct;
  // Bills are present (we're adding one right now), so gate on that too
  const allFulfilled = allItems.length > 0 && allItems.every(i => i.fulfillmentStatus === "Fulfilled");
  const curStatus = poData?.status || "Open";

  const updates: Record<string, any> = { bills: arrayUnion(bill), items: allItems, subtotal: newSubtotal, taxAmount: newTaxAmt, total: newSubtotal + newTaxAmt };
  if (!["Cancelled", "Draft"].includes(curStatus)) {
    updates.status = allItems.length === 0 ? "Open" : allFulfilled ? "Fulfilled" : "Waiting on Material";
  }
  await updateDoc(doc(db, "purchaseOrders", targetPoId), updates);
  return { pdfError };
}

// ── helpers ────────────────────────────────────────────────────────────────────
function fmtC(n: number) { return `$${(n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

const MODE_LABELS: Record<LineMode, string> = { receive: "Receive", new: "Add New", skip: "Skip" };
const MODE_COLORS: Record<LineMode, { bg: string; color: string; border: string }> = {
  receive: { bg: "#f0fdf4", color: "#166534", border: "#86efac" },
  new:     { bg: "#eff6ff", color: "#1e40af", border: "#bfdbfe" },
  skip:    { bg: "#f9fafb", color: "#9ca3af", border: "#e5e7eb" },
};

// ── Main Modal ─────────────────────────────────────────────────────────────────
interface ImportJob {
  id: string; file: File; parsing: boolean; searching: boolean;
  invoice: ParsedInvoice | null; editLines: InvoiceLine[]; rawLines: string[];
  matchedPOs: POStub[] | null; selectedPO: POStub | null;
  poItems: POItem[]; poSearch: string;
}

export default function ImportBillModal({
  poId: fixedPoId, poNumber: fixedPoNumber, vendor: fixedVendor, onClose,
}: {
  poId?: string; poNumber?: string; vendor?: string; onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs]           = useState<ImportJob[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [savingIdx, setSavingIdx]   = useState(-1);
  const [saveResults, setSaveResults] = useState<Array<{ ok: boolean; label: string }>>([]);
  const [allPOs, setAllPOs]       = useState<POStub[]>([]);
  const isGlobal = !fixedPoId;

  const inp: React.CSSProperties = { padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" as const };
  const labelS: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3, display: "block" };

  // For fixed-PO mode load items once
  const [fixedPoItems, setFixedPoItems] = useState<POItem[]>([]);
  useEffect(() => {
    if (!fixedPoId) return;
    getDoc(doc(db, "purchaseOrders", fixedPoId))
      .then(s => setFixedPoItems((s.data()?.items || []) as POItem[]))
      .catch(() => {});
  }, [fixedPoId]);
  useEffect(() => {
    if (!fixedPoId || !fixedPoItems.length) return;
    setJobs(prev => prev.map(j => ({ ...j, poItems: fixedPoItems, editLines: autoMatchLines(j.editLines, fixedPoItems) })));
  }, [fixedPoItems]);

  async function addFiles(files: FileList) {
    const pdfs = Array.from(files).filter(f => f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) return;
    const newJobs: ImportJob[] = pdfs.map(f => ({
      id: crypto.randomUUID(), file: f, parsing: true, searching: false,
      invoice: null, editLines: [], rawLines: [],
      matchedPOs: null, selectedPO: null,
      poItems: fixedPoId ? fixedPoItems : [], poSearch: "",
    }));
    setJobs(prev => {
      const next = [...prev, ...newJobs];
      setActiveIdx(prev.length);
      return next;
    });
    for (const nj of newJobs) void parseJob(nj.id, nj.file);
  }

  async function parseJob(jobId: string, file: File) {
    try {
      const lines = await extractLines(file);
      const parsed = parseInvoice(lines);
      let matchedPOs: POStub[] = [];
      let selectedPO: POStub | null = null;
      let poItems: POItem[] = fixedPoId ? fixedPoItems : [];

      if (isGlobal && parsed.poNumber) {
        setJobs(prev => prev.map(j => j.id !== jobId ? j : { ...j, searching: true }));
        try {
          matchedPOs = await findMatchingPOs(parsed.poNumber);
          if (matchedPOs.length === 1) {
            selectedPO = matchedPOs[0];
            const snap = await getDoc(doc(db, "purchaseOrders", selectedPO.id));
            poItems = (snap.data()?.items || []) as POItem[];
          }
        } catch { matchedPOs = []; }
      }

      const matched = autoMatchLines(parsed.lines, poItems);
      setJobs(prev => prev.map(j => j.id !== jobId ? j : {
        ...j, parsing: false, searching: false, invoice: parsed,
        editLines: matched, rawLines: lines, matchedPOs, selectedPO, poItems,
      }));
    } catch (e) {
      console.error(e);
      setJobs(prev => prev.map(j => j.id !== jobId ? j : { ...j, parsing: false, searching: false }));
    }
  }

  function patchJob(jobId: string, patch: Partial<ImportJob>) {
    setJobs(prev => prev.map(j => j.id !== jobId ? j : { ...j, ...patch }));
  }
  function patchLine(jobId: string, li: number, patch: Partial<InvoiceLine>) {
    setJobs(prev => prev.map(j => j.id !== jobId ? j : { ...j, editLines: j.editLines.map((l, i) => i === li ? { ...l, ...patch } : l) }));
  }

  async function handleSelectPO(jobId: string, po: POStub) {
    patchJob(jobId, { selectedPO: po, poSearch: "" });
    try {
      const snap = await getDoc(doc(db, "purchaseOrders", po.id));
      const poItems = (snap.data()?.items || []) as POItem[];
      setJobs(prev => prev.map(j => j.id !== jobId ? j : {
        ...j, poItems, editLines: autoMatchLines(j.editLines, poItems),
      }));
    } catch {}
  }

  async function loadAllPOs() {
    if (allPOs.length > 0) return;
    try {
      const snap = await getDocs(collection(db, "purchaseOrders"));
      setAllPOs(snap.docs.map(d => ({ id: d.id, poNumber: String(d.data().poNumber || ""), vendor: d.data().vendor || "", jobNumber: d.data().jobNumber || "", status: d.data().status || "" })));
    } catch {}
  }

  const readyJobs  = jobs.filter(j => !j.parsing && !j.searching && j.invoice && (fixedPoId || j.selectedPO));
  const needsPO    = jobs.filter(j => !j.parsing && !j.searching && j.invoice && isGlobal && !j.selectedPO);
  const busyCount  = jobs.filter(j => j.parsing || j.searching).length;
  const canConfirm = readyJobs.length > 0 && savingIdx === -1;

  async function saveAll() {
    const results: Array<{ ok: boolean; label: string }> = [];
    for (let i = 0; i < readyJobs.length; i++) {
      setSavingIdx(i);
      const job = readyJobs[i];
      const tPoId = fixedPoId || job.selectedPO?.id || "";
      if (!tPoId || !job.invoice) continue;
      try {
        const { pdfError } = await saveImport(tPoId, job.invoice, job.editLines, job.file);
        const label = pdfError
          ? `Invoice ${job.invoice.invoiceNumber || job.file.name} ✓ — PDF attachment failed: ${pdfError}`
          : `Invoice ${job.invoice.invoiceNumber || job.file.name} ✓`;
        results.push({ ok: true, label });
      } catch (e) {
        results.push({ ok: false, label: `${job.file.name} — failed to save: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    setSavingIdx(-1);
    setSaveResults(results);
    if (results.every(r => r.ok)) setTimeout(onClose, 700);
  }

  const job = jobs[Math.min(activeIdx, jobs.length - 1)] ?? null;
  const hasExisting   = job ? job.poItems.length > 0 : false;
  const receiveCount  = job ? job.editLines.filter(l => l.mode === "receive").length : 0;
  const newCount      = job ? job.editLines.filter(l => l.mode === "new").length : 0;
  const skipCount     = job ? job.editLines.filter(l => l.mode === "skip").length : 0;

  const headerSub = jobs.length === 0
    ? (fixedPoNumber ? `PO ${fixedPoNumber} · ${fixedVendor || ""}` : "Auto-detect PO from invoice")
    : `${jobs.length} file${jobs.length !== 1 ? "s" : ""} — ${readyJobs.length} ready${needsPO.length ? `, ${needsPO.length} need PO` : ""}${busyCount ? `, ${busyCount} parsing` : ""}`;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      {/* shared hidden file input */}
      <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: "none" }} onChange={e => { if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ""; } }} />

      <div style={{ background: "#fff", borderRadius: 14, width: 960, maxWidth: "96vw", maxHeight: "92vh", boxShadow: "0 24px 64px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid #e5e7eb", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#111827" }}>
              {confirming ? "Confirm Import" : "Import Supplier Invoice"}
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{headerSub}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af" }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>

          {/* ── Upload zone (no jobs yet) ── */}
          {jobs.length === 0 && (
            <div style={{ padding: "20px 22px", flex: 1 }}>
              <div style={{ border: "2px dashed #d1d5db", borderRadius: 10, padding: "50px 24px", textAlign: "center", cursor: "pointer", background: "#f9fafb" }}
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#374151", marginBottom: 4 }}>Drop supplier invoice PDFs here</div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>or click to browse — multiple files supported</div>
              </div>
            </div>
          )}

          {/* ── Tab bar + review ── */}
          {jobs.length > 0 && !confirming && saveResults.length === 0 && (
            <>
              {/* Tab bar */}
              <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", background: "#f9fafb", overflowX: "auto", flexShrink: 0 }}>
                {jobs.map((j, i) => {
                  const label = j.invoice?.invoiceNumber || j.file.name.replace(/\.pdf$/i, "").slice(0, 22);
                  const poBadge = fixedPoNumber ? `PO ${fixedPoNumber}` : j.selectedPO ? `PO ${j.selectedPO.poNumber}` : (j.parsing || j.searching) ? "…" : "No PO";
                  const isActive = i === activeIdx;
                  const badColor = !j.parsing && !j.searching && isGlobal && !j.selectedPO;
                  return (
                    <button key={j.id} onClick={() => setActiveIdx(i)} style={{ padding: "10px 16px", border: "none", borderBottom: isActive ? "2px solid #1565c0" : "2px solid transparent", background: isActive ? "#fff" : "transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, flexShrink: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: isActive ? 700 : 400, color: isActive ? "#1565c0" : "#374151" }}>{label}</span>
                      <span style={{ fontSize: 11, color: badColor ? "#92400e" : j.selectedPO ? "#16a34a" : "#9ca3af" }}>{poBadge}</span>
                    </button>
                  );
                })}
                <button onClick={() => fileRef.current?.click()} style={{ padding: "10px 16px", border: "none", background: "transparent", cursor: "pointer", color: "#6b7280", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>+ Add more</button>
              </div>

              {/* Active job review */}
              {job && (
                <div style={{ padding: "20px 22px", flex: 1, overflowY: "auto" }}>
                  {(job.parsing || job.searching) && (
                    <div style={{ textAlign: "center", padding: "40px 0", color: "#6b7280", fontSize: 14 }}>
                      {job.parsing ? "Parsing PDF…" : "Searching for matching PO…"}
                    </div>
                  )}
                  {!job.parsing && !job.searching && !job.invoice && (
                    <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: "14px 18px", color: "#991b1b", fontSize: 13 }}>
                      Failed to parse this PDF. Only Gerrie-format invoices are supported.
                    </div>
                  )}

                  {job.invoice && !job.parsing && !job.searching && (
                    <>
                      {/* PO selection (global mode) */}
                      {isGlobal && (
                        <div style={{ marginBottom: 18, borderRadius: 10, border: "1px solid #e5e7eb", overflow: "hidden" }}>
                          <div style={{ background: "#f9fafb", padding: "10px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase" }}>Purchase Order</span>
                            {job.invoice.poNumber && <span style={{ fontSize: 12, color: "#6b7280" }}>Invoice references: <strong>{job.invoice.poNumber}</strong></span>}
                          </div>
                          <div style={{ padding: "14px 16px" }}>
                            {job.matchedPOs !== null && job.matchedPOs.length === 0 && (
                              <div style={{ color: "#92400e", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>
                                No matching PO found. Select manually below.
                              </div>
                            )}
                            {job.matchedPOs && job.matchedPOs.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                                {job.matchedPOs.map(po => (
                                  <button key={po.id} onClick={() => handleSelectPO(job.id, po)}
                                    style={{ background: job.selectedPO?.id === po.id ? "#0d2e5e" : "#f0f4ff", color: job.selectedPO?.id === po.id ? "#fff" : "#1e40af", border: `1px solid ${job.selectedPO?.id === po.id ? "#0d2e5e" : "#bfdbfe"}`, borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                                    <span>PO {po.poNumber}</span>
                                    <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.8 }}>{po.vendor} · {po.status}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                            <details onToggle={e => { if ((e.target as HTMLDetailsElement).open) loadAllPOs(); }}>
                              <summary style={{ fontSize: 12, color: "#1565c0", cursor: "pointer", fontWeight: 600, userSelect: "none" }}>{job.selectedPO ? "Change PO selection" : "Search for a PO manually"}</summary>
                              <div style={{ marginTop: 10 }}>
                                <input style={{ ...inp, marginBottom: 8 }} placeholder="Search by PO #, vendor, job…"
                                  value={job.poSearch} onChange={e => patchJob(job.id, { poSearch: e.target.value })} />
                                <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 6 }}>
                                  {allPOs.filter(p => !job.poSearch || String(p.poNumber).includes(job.poSearch) || p.vendor.toLowerCase().includes(job.poSearch.toLowerCase())).slice(0, 40).map(po => (
                                    <div key={po.id} onClick={() => handleSelectPO(job.id, po)}
                                      style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #f3f4f6", background: job.selectedPO?.id === po.id ? "#eff6ff" : "#fff", display: "flex", justifyContent: "space-between" }}>
                                      <span>PO {po.poNumber} · {po.vendor}</span>
                                      <span style={{ fontSize: 11, color: "#9ca3af" }}>{po.jobNumber || "—"}</span>
                                    </div>
                                  ))}
                                  {allPOs.length === 0 && <div style={{ padding: "16px 12px", color: "#9ca3af", fontSize: 13, textAlign: "center" }}>Loading…</div>}
                                </div>
                              </div>
                            </details>
                            {job.selectedPO && <div style={{ marginTop: 10, padding: "8px 12px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 7, fontSize: 13, color: "#166534", fontWeight: 600 }}>✓ PO {job.selectedPO.poNumber} · {job.selectedPO.vendor}</div>}
                          </div>
                        </div>
                      )}

                      {/* Invoice header fields */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "12px 18px", marginBottom: 16 }}>
                        <div><span style={labelS}>Vendor</span><input style={inp} value={job.invoice.vendor} onChange={e => patchJob(job.id, { invoice: { ...job.invoice!, vendor: e.target.value } })} /></div>
                        <div><span style={labelS}>Invoice #</span><input style={inp} value={job.invoice.invoiceNumber} onChange={e => patchJob(job.id, { invoice: { ...job.invoice!, invoiceNumber: e.target.value } })} /></div>
                        <div><span style={labelS}>Date</span><input style={inp} type="date" value={job.invoice.date} onChange={e => patchJob(job.id, { invoice: { ...job.invoice!, date: e.target.value } })} /></div>
                        <div><span style={labelS}>Subtotal</span><input style={{ ...inp, background: "#f9fafb" }} value={fmtC(job.invoice.subtotal)} readOnly /></div>
                        <div><span style={labelS}>{job.invoice.taxLabel}</span><input style={{ ...inp, background: "#f9fafb" }} value={fmtC(job.invoice.taxAmount)} readOnly /></div>
                        <div><span style={labelS}>Grand Total</span><input style={{ ...inp, background: "#f9fafb", fontWeight: 700 }} value={fmtC(job.invoice.grandTotal)} readOnly /></div>
                      </div>

                      {/* No lines warning */}
                      {job.editLines.length === 0 && (
                        <div style={{ marginBottom: 14, background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, overflow: "hidden" }}>
                          <div style={{ padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
                            <span style={{ fontSize: 16 }}>⚠️</span>
                            <div style={{ fontSize: 13, color: "#92400e", fontWeight: 600 }}>No line items detected. Bill record will still be saved.</div>
                          </div>
                          <details style={{ borderTop: "1px solid #fcd34d" }}>
                            <summary style={{ padding: "8px 14px", fontSize: 12, color: "#92400e", cursor: "pointer", userSelect: "none" }}>Show extracted PDF text</summary>
                            <pre style={{ margin: 0, padding: "10px 14px", fontSize: 11, color: "#78350f", background: "#fefce8", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 260, overflowY: "auto" }}>{job.rawLines.join("\n")}</pre>
                          </details>
                        </div>
                      )}

                      {/* Summary badges */}
                      {job.editLines.length > 0 && (
                        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                          {receiveCount > 0 && <span style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>↓ {receiveCount} receiving</span>}
                          {newCount > 0 && <span style={{ background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>+ {newCount} new</span>}
                          {skipCount > 0 && <span style={{ background: "#f9fafb", color: "#9ca3af", border: "1px solid #e5e7eb", borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>— {skipCount} skipped</span>}
                          {!hasExisting && job.editLines.length > 0 && <span style={{ fontSize: 12, color: "#9ca3af", alignSelf: "center" }}>No existing PO items — all added as new</span>}
                        </div>
                      )}

                      {/* Line items table */}
                      {job.editLines.length > 0 && (
                        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                              <tr style={{ background: "#f9fafb" }}>
                                {["Part #", "Description", "Qty", "Unit $", "Total", "Action"].map(h => (
                                  <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: ["Qty","Unit $","Total"].includes(h) ? "right" : "left" }}>{h}</th>
                                ))}
                                {hasExisting && <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>Match to PO Item</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {job.editLines.map((line, li) => {
                                const dimmed = line.mode === "skip";
                                const matchedItem = job.poItems.find(p => p.id === line.matchedItemId);
                                return (
                                  <tr key={li} style={{ background: dimmed ? "#f9fafb" : "#fff", opacity: dimmed ? 0.5 : 1, borderBottom: "1px solid #f3f4f6" }}>
                                    <td style={{ padding: "6px 10px" }}><input style={{ ...inp, fontSize: 12, padding: "4px 6px" }} value={line.partNo} onChange={e => patchLine(job.id, li, { partNo: e.target.value })} /></td>
                                    <td style={{ padding: "6px 10px" }}><input style={{ ...inp, fontSize: 12, padding: "4px 6px" }} value={line.description} onChange={e => patchLine(job.id, li, { description: e.target.value })} /></td>
                                    <td style={{ padding: "6px 10px", textAlign: "right" }}><input style={{ ...inp, fontSize: 12, padding: "4px 6px", textAlign: "right", width: 55 }} type="number" min={0} value={line.qty} onChange={e => patchLine(job.id, li, { qty: parseFloat(e.target.value) || 0 })} /></td>
                                    <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 13 }}>{fmtC(line.unitPrice)}</td>
                                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600, fontSize: 13 }}>{fmtC(line.total)}</td>
                                    <td style={{ padding: "6px 10px" }}>
                                      <div style={{ display: "flex", gap: 4 }}>
                                        {(["receive", "new", "skip"] as LineMode[]).map(m =>
                                          m === "receive" && !hasExisting ? null : (
                                            <button key={m} onClick={() => patchLine(job.id, li, { mode: m })}
                                              style={{ background: line.mode === m ? MODE_COLORS[m].bg : "#f9fafb", color: line.mode === m ? MODE_COLORS[m].color : "#9ca3af", border: `1px solid ${line.mode === m ? MODE_COLORS[m].border : "#e5e7eb"}`, borderRadius: 5, padding: "3px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                              {MODE_LABELS[m]}
                                            </button>
                                          )
                                        )}
                                      </div>
                                    </td>
                                    {hasExisting && (
                                      <td style={{ padding: "6px 10px" }}>
                                        {line.mode === "receive" ? (
                                          <div>
                                            <select value={line.matchedItemId || ""} onChange={e => patchLine(job.id, li, { matchedItemId: e.target.value, mode: "receive" })} style={{ ...inp, fontSize: 12, padding: "4px 6px" }}>
                                              <option value="">— select PO item —</option>
                                              {job.poItems.map(pi => <option key={pi.id} value={pi.id}>{pi.name} ({pi.quantityReceived||0}/{pi.quantityOrdered} rcvd)</option>)}
                                            </select>
                                            {matchedItem && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{matchedItem.quantityReceived||0} + {line.qty} = {(matchedItem.quantityReceived||0)+line.qty} / {matchedItem.quantityOrdered}</div>}
                                          </div>
                                        ) : <span style={{ fontSize: 12, color: "#9ca3af" }}>—</span>}
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Confirmation screen ── */}
          {confirming && savingIdx === -1 && saveResults.length === 0 && (
            <div style={{ padding: "20px 22px" }}>
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "16px 18px", marginBottom: 18 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#166534", marginBottom: 10 }}>
                  Ready to import {readyJobs.length} invoice{readyJobs.length !== 1 ? "s" : ""}
                </div>
                {readyJobs.map((j, i) => (
                  <div key={j.id} style={{ padding: "10px 14px", background: "#fff", border: "1px solid #d1fae5", borderRadius: 7, marginBottom: 6, fontSize: 13, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontWeight: 700, color: "#166534" }}>Invoice {j.invoice!.invoiceNumber || `#${i+1}`}</span>
                    <span style={{ color: "#6b7280" }}>→ PO {j.selectedPO?.poNumber || fixedPoNumber}</span>
                    <span style={{ color: "#374151", fontWeight: 600 }}>{fmtC(j.invoice!.grandTotal || j.invoice!.subtotal + j.invoice!.taxAmount)}</span>
                    <span style={{ color: "#9ca3af", fontSize: 12 }}>{j.editLines.filter(l => l.mode !== "skip").length} lines</span>
                  </div>
                ))}
                {needsPO.length > 0 && (
                  <div style={{ color: "#92400e", fontSize: 12, marginTop: 8 }}>⚠️ {needsPO.length} invoice{needsPO.length !== 1 ? "s" : ""} without a selected PO will be skipped.</div>
                )}
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setConfirming(false)} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer" }}>← Back to Review</button>
                <button onClick={onClose} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer" }}>Cancel</button>
                <button onClick={saveAll} style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "9px 22px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                  Confirm — Import {readyJobs.length} Invoice{readyJobs.length !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
          )}

          {/* ── Saving progress ── */}
          {savingIdx >= 0 && (
            <div style={{ padding: "50px 22px", textAlign: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#374151", marginBottom: 14 }}>
                Importing invoice {savingIdx + 1} of {readyJobs.length}…
              </div>
              <div style={{ background: "#f3f4f6", borderRadius: 8, height: 8, overflow: "hidden", maxWidth: 400, margin: "0 auto" }}>
                <div style={{ background: "#16a34a", height: "100%", width: `${((savingIdx + 1) / readyJobs.length) * 100}%`, transition: "width 0.3s" }} />
              </div>
            </div>
          )}

          {/* ── Results ── */}
          {saveResults.length > 0 && savingIdx === -1 && (
            <div style={{ padding: "20px 22px" }}>
              {saveResults.map((r, i) => (
                <div key={i} style={{ padding: "10px 14px", marginBottom: 8, borderRadius: 7, background: r.ok ? "#f0fdf4" : "#fee2e2", border: `1px solid ${r.ok ? "#86efac" : "#fca5a5"}`, fontSize: 13, color: r.ok ? "#166534" : "#991b1b" }}>
                  {r.label}
                </div>
              ))}
              {!saveResults.every(r => r.ok) && (
                <button onClick={onClose} style={{ marginTop: 8, background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer" }}>Close</button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {jobs.length > 0 && !confirming && savingIdx === -1 && saveResults.length === 0 && (
          <div style={{ padding: "14px 22px", borderTop: "1px solid #e5e7eb", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#9ca3af" }}>
              {readyJobs.length} ready · {needsPO.length} need PO · {busyCount} parsing
            </span>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={onClose} style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 7, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => setConfirming(true)} disabled={!canConfirm}
                style={{ background: canConfirm ? "#1565c0" : "#93c5fd", color: "#fff", border: "none", borderRadius: 7, padding: "9px 24px", fontSize: 13, fontWeight: 800, cursor: canConfirm ? "pointer" : "default" }}>
                Review & Confirm →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
