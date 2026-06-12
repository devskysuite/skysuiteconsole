import { useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { arrayUnion, collection, doc, getDoc, getDocs, query, runTransaction, updateDoc, where } from "firebase/firestore";
import { auth, db, storage } from "../firebase";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// ── Types ──────────────────────────────────────────────────────────────────────
interface ParsedLine {
  partNo: string; description: string; qty: number; uom: string;
  unitPrice: number; total: number; taxable: boolean; selected: boolean;
}
interface ParsedInvoice {
  invoiceNumber: string; poNumber: string; vendor: string; date: string;
  lines: ParsedLine[]; subtotal: number; taxAmount: number; grandTotal: number; taxLabel: string;
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
  const custPoMatch = full.match(/customer\s+p\.?o\.?\s+no\.?\s*[:\s]+([0-9A-Z-]+)/i);
  if (custPoMatch) result.poNumber = custPoMatch[1];
  else {
    const poMatch = full.match(/(?:purchase\s+order|p\.?o\.?)\s*(?:no\.?|number|#)?\s*:?\s*([0-9-]+)/i);
    if (poMatch) result.poNumber = poMatch[1];
  }
  const dateMatch = full.match(/(?:invoice\s+)?date\s*:?\s*(\d{1,4}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (dateMatch) {
    const raw = dateMatch[1];
    const parts = raw.split(/[\/\-]/);
    if (parts[0].length === 4) result.date = `${parts[0]}-${parts[1].padStart(2,"0")}-${parts[2].padStart(2,"0")}`;
    else if (parts[2].length === 4) result.date = `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`;
    else result.date = raw;
  }
  if (lines.length > 0) result.vendor = lines[0];
  for (const line of lines) {
    const subMatch = line.match(/^sub\s*total\s+(\d[\d,]*\.?\d*)$/i);
    if (subMatch) { result.subtotal = parseFloat(subMatch[1].replace(/,/g, "")); continue; }
    const taxMatch = line.match(/^(hst|gst|pst|qst|tax(?:\s*\d+%?)?)\s+(\d[\d,]*\.\d+)$/i);
    if (taxMatch) { result.taxLabel = taxMatch[1].toUpperCase(); result.taxAmount = parseFloat(taxMatch[2].replace(/,/g, "")); continue; }
    const totalMatch = line.match(/^(?:grand\s+)?total\s+(\d[\d,]*\.\d+)$/i);
    if (totalMatch) { result.grandTotal = parseFloat(totalMatch[1].replace(/,/g, "")); continue; }
  }
  const UOMS = /^(EA|EACH|PC|PCS|LB|FT|M|L|KG|BOX|RL|BAG|HR|SET|PR|CS|GAL|TON|YD|ROLL|CAN|PAIR)$/i;
  const skipPatterns = /^(ship|bill|invoice|date|p\.?o|purchase|customer|sub|total|hst|gst|tax|page|line|qty|description|unit|amount|price|receipt)/i;
  for (const line of lines) {
    if (skipPatterns.test(line)) continue;
    const m = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,6})\s+(\d[\d,]*\.\d+)\s+(\d[\d,]*\.\d+)\s*$/i);
    if (!m) continue;
    const [, raw, qtyStr, uom, upStr, totStr] = m;
    if (!UOMS.test(uom)) continue;
    const qty = parseFloat(qtyStr);
    const unitPrice = parseFloat(upStr.replace(/,/g, ""));
    const total = parseFloat(totStr.replace(/,/g, ""));
    if (qty > 0 && unitPrice > 0 && Math.abs(qty * unitPrice - total) > total * 0.05 + 0.1) continue;
    const rawTrimmed = raw.trim();
    const spaceIdx = rawTrimmed.indexOf(" ");
    const partNo = spaceIdx > 0 ? rawTrimmed.slice(0, spaceIdx) : rawTrimmed;
    const description = spaceIdx > 0 ? rawTrimmed.slice(spaceIdx + 1).trim() : "";
    result.lines.push({ partNo, description, qty, uom: uom.toUpperCase(), unitPrice, total, taxable: true, selected: true });
  }
  return result;
}

// ── PO Lookup — extract candidate numbers and search Firestore ─────────────────
async function findMatchingPOs(rawPoField: string): Promise<POStub[]> {
  if (!rawPoField) return [];
  // pull all distinct digit sequences of 4–8 chars from the PO field
  const segs = Array.from(new Set(rawPoField.match(/\d{4,8}/g) || []));
  if (segs.length === 0) return [];
  // Firestore `in` max 30
  const chunks: string[][] = [];
  for (let i = 0; i < segs.length; i += 30) chunks.push(segs.slice(i, i + 30));
  const results: POStub[] = [];
  for (const chunk of chunks) {
    const snap = await getDocs(query(collection(db, "purchaseOrders"), where("poNumber", "in", chunk)));
    snap.forEach(d => results.push({ id: d.id, poNumber: d.data().poNumber, vendor: d.data().vendor || "", jobNumber: d.data().jobNumber || "", status: d.data().status || "" }));
  }
  return results;
}

// ── Auto Bill Number ───────────────────────────────────────────────────────────
async function getNextBillNumber(): Promise<string> {
  const settingsRef = doc(db, "settings", "poSettings");
  let next = 10001;
  await runTransaction(db, async tx => {
    const snap = await tx.get(settingsRef);
    const cur = snap.exists() ? (snap.data().nextBillNumber ?? 10001) : 10001;
    next = cur;
    tx.set(settingsRef, { nextBillNumber: cur + 1 }, { merge: true });
  });
  return String(next).padStart(5, "0");
}

// ── Save to PO ─────────────────────────────────────────────────────────────────
async function saveImport(targetPoId: string, invoice: ParsedInvoice, editLines: ParsedLine[], importItems: boolean, file: File) {
  const billNumber = await getNextBillNumber();
  const sRef = storageRef(storage, `bills/${billNumber}.pdf`);
  await uploadBytes(sRef, file, { contentType: "application/pdf" });
  const pdfUrl = await getDownloadURL(sRef);
  const bill = {
    id: crypto.randomUUID(), billNumber,
    receiptNumber: invoice.invoiceNumber,
    vendor: invoice.vendor,
    dateIssued: invoice.date || new Date().toISOString().slice(0, 10),
    total: invoice.grandTotal || invoice.subtotal + invoice.taxAmount,
    pdfUrl,
    createdBy: auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
  };
  if (importItems && editLines.some(l => l.selected)) {
    const poSnap = await getDoc(doc(db, "purchaseOrders", targetPoId));
    const poData = poSnap.data();
    const existingItems: any[] = poData?.items || [];
    const newItems = editLines.filter(l => l.selected).map(l => ({
      id: crypto.randomUUID(), name: l.partNo || l.description,
      description: l.partNo && l.description ? l.description : "",
      fulfillmentStatus: "Pending", quantityOrdered: l.qty, quantityReceived: 0,
      unitCost: l.unitPrice, totalCost: l.total, taxable: l.taxable,
      unitOfMeasure: l.uom, costCode: "Materials", jobCostType: "Materials", revenueType: "Materials",
    }));
    const allItems = [...existingItems, ...newItems];
    const newSubtotal = allItems.reduce((s: number, i: any) => s + (i.totalCost || 0), 0);
    const poTaxPct = ({ "GST (5%)": 0.05, "HST ON (13%)": 0.13, "HST BC (12%)": 0.12, "PST (7%)": 0.07 } as Record<string, number>)[poData?.taxRate || ""] ?? 0;
    const newTaxAmt = allItems.filter((i: any) => i.taxable).reduce((s: number, i: any) => s + (i.totalCost || 0), 0) * poTaxPct;
    await updateDoc(doc(db, "purchaseOrders", targetPoId), { bills: arrayUnion(bill), items: allItems, subtotal: newSubtotal, taxAmount: newTaxAmt, total: newSubtotal + newTaxAmt });
  } else {
    await updateDoc(doc(db, "purchaseOrders", targetPoId), { bills: arrayUnion(bill) });
  }
}

// ── Main Modal ─────────────────────────────────────────────────────────────────
export default function ImportBillModal({
  poId: fixedPoId,
  poNumber: fixedPoNumber,
  vendor: fixedVendor,
  onClose,
}: {
  poId?: string;
  poNumber?: string;
  vendor?: string;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile]           = useState<File | null>(null);
  const [parsing, setParsing]     = useState(false);
  const [invoice, setInvoice]     = useState<ParsedInvoice | null>(null);
  const [editLines, setEditLines] = useState<ParsedLine[]>([]);
  const [importItems, setImportItems] = useState(true);

  // PO matching (only used in global mode — when no fixedPoId)
  const [searching, setSearching] = useState(false);
  const [matchedPOs, setMatchedPOs] = useState<POStub[] | null>(null); // null = not searched yet
  const [selectedPO, setSelectedPO] = useState<POStub | null>(null);
  const [allPOs, setAllPOs]       = useState<POStub[]>([]);
  const [poSearch, setPoSearch]   = useState("");

  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const isGlobal = !fixedPoId;

  const inp: React.CSSProperties = { padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" as const };
  const labelS: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3, display: "block" };

  async function handleFile(f: File) {
    if (!f.name.toLowerCase().endsWith(".pdf")) { setError("Please select a PDF file."); return; }
    setFile(f); setError(null); setParsing(true);
    try {
      const lines = await extractLines(f);
      const parsed = parseInvoice(lines);
      setInvoice(parsed);
      setEditLines(parsed.lines.map(l => ({ ...l })));
      // In global mode, immediately try to find the matching PO
      if (isGlobal && parsed.poNumber) {
        setSearching(true);
        try {
          const found = await findMatchingPOs(parsed.poNumber);
          setMatchedPOs(found);
          if (found.length === 1) setSelectedPO(found[0]);
        } catch { setMatchedPOs([]); }
        setSearching(false);
      }
    } catch (e) {
      setError("Failed to parse PDF. Please check the file and try again.");
      console.error(e);
    }
    setParsing(false);
  }

  async function loadAllPOs() {
    if (allPOs.length > 0) return;
    try {
      const snap = await getDocs(collection(db, "purchaseOrders"));
      setAllPOs(snap.docs.map(d => ({ id: d.id, poNumber: d.data().poNumber || "", vendor: d.data().vendor || "", jobNumber: d.data().jobNumber || "", status: d.data().status || "" })));
    } catch {}
  }

  function updateLine(i: number, field: keyof ParsedLine, value: string | number | boolean) {
    setEditLines(prev => { const n = [...prev]; n[i] = { ...n[i], [field]: value } as ParsedLine; return n; });
  }

  const targetPoId = fixedPoId || selectedPO?.id;
  const canSave = !!invoice && !!file && !!targetPoId;

  async function save() {
    if (!canSave || !invoice || !file || !targetPoId) return;
    setSaving(true); setError(null);
    try {
      await saveImport(targetPoId, invoice, editLines, importItems, file);
      onClose();
    } catch (e) { console.error(e); setError("Failed to save. Please try again."); }
    setSaving(false);
  }

  const headerSubtitle = fixedPoNumber
    ? `PO ${fixedPoNumber} · ${fixedVendor}`
    : selectedPO
      ? `PO ${selectedPO.poNumber} · ${selectedPO.vendor}`
      : "Auto-detect PO from invoice";

  const filteredAll = allPOs.filter(p =>
    !poSearch || String(p.poNumber).includes(poSearch) || p.vendor.toLowerCase().includes(poSearch.toLowerCase()) || p.jobNumber.includes(poSearch)
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 14, width: 880, maxWidth: "95vw", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid #e5e7eb", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#111827" }}>Import Supplier Invoice</div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{headerSubtitle}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af", lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: "22px", flex: 1, overflowY: "auto" }}>

          {/* File drop zone (before parse) */}
          {!invoice && (
            <div
              style={{ border: "2px dashed #d1d5db", borderRadius: 10, padding: "40px 24px", textAlign: "center", cursor: "pointer", background: "#f9fafb" }}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            >
              <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#374151", marginBottom: 4 }}>{file ? file.name : "Drop supplier invoice PDF here"}</div>
              <div style={{ fontSize: 12, color: "#9ca3af" }}>{parsing ? "Parsing PDF…" : "or click to browse"}</div>
              <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
          )}

          {(parsing || searching) && (
            <div style={{ textAlign: "center", padding: "32px 0", color: "#6b7280", fontSize: 14 }}>
              {parsing ? "Parsing PDF…" : "Searching for matching PO…"}
            </div>
          )}

          {error && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", color: "#991b1b", fontSize: 13, marginTop: 12 }}>
              {error}
            </div>
          )}

          {invoice && !parsing && (
            <>
              {/* ── PO match section (global mode only) ── */}
              {isGlobal && (
                <div style={{ marginBottom: 20, borderRadius: 10, border: "1px solid #e5e7eb", overflow: "hidden" }}>
                  <div style={{ background: "#f9fafb", padding: "10px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5 }}>Purchase Order</span>
                    {invoice.poNumber && <span style={{ fontSize: 12, color: "#6b7280" }}>Invoice references: <strong>{invoice.poNumber}</strong></span>}
                  </div>
                  <div style={{ padding: "14px 16px" }}>
                    {!searching && matchedPOs !== null && matchedPOs.length === 0 && (
                      <div style={{ color: "#92400e", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>
                        No matching PO found for "{invoice.poNumber}". Select one manually below.
                      </div>
                    )}

                    {/* Found PO chip(s) */}
                    {matchedPOs && matchedPOs.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                        {matchedPOs.map(po => (
                          <button key={po.id} onClick={() => setSelectedPO(po)} style={{
                            background: selectedPO?.id === po.id ? "#0d2e5e" : "#f0f4ff",
                            color: selectedPO?.id === po.id ? "#fff" : "#1e40af",
                            border: selectedPO?.id === po.id ? "1px solid #0d2e5e" : "1px solid #bfdbfe",
                            borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 700,
                            display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
                          }}>
                            <span>PO {po.poNumber}</span>
                            <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.8 }}>{po.vendor} · Job {po.jobNumber || "—"} · {po.status}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Manual PO search */}
                    <details onToggle={e => { if ((e.target as HTMLDetailsElement).open) loadAllPOs(); }}>
                      <summary style={{ fontSize: 12, color: "#1565c0", cursor: "pointer", fontWeight: 600, userSelect: "none" }}>
                        {selectedPO ? "Change PO selection" : "Search for a PO manually"}
                      </summary>
                      <div style={{ marginTop: 10 }}>
                        <input style={{ ...inp, marginBottom: 8 }} placeholder="Search by PO #, vendor, job…"
                          value={poSearch} onChange={e => setPoSearch(e.target.value)} />
                        <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 6 }}>
                          {filteredAll.slice(0, 50).map(po => (
                            <div key={po.id} onClick={() => setSelectedPO(po)} style={{
                              padding: "8px 12px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #f3f4f6",
                              background: selectedPO?.id === po.id ? "#eff6ff" : "#fff",
                              display: "flex", justifyContent: "space-between", alignItems: "center",
                            }}>
                              <span style={{ fontWeight: selectedPO?.id === po.id ? 700 : 400 }}>PO {po.poNumber} · {po.vendor}</span>
                              <span style={{ fontSize: 11, color: "#9ca3af" }}>Job {po.jobNumber || "—"}</span>
                            </div>
                          ))}
                          {filteredAll.length === 0 && <div style={{ padding: "16px 12px", color: "#9ca3af", fontSize: 13, textAlign: "center" }}>No POs found</div>}
                        </div>
                      </div>
                    </details>

                    {selectedPO && (
                      <div style={{ marginTop: 10, padding: "8px 12px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 7, fontSize: 13, color: "#166534", fontWeight: 600 }}>
                        ✓ Will import into PO {selectedPO.poNumber} · {selectedPO.vendor}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Invoice header fields */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: "14px 20px", marginBottom: 18 }}>
                <div><span style={labelS}>Vendor</span>
                  <input style={inp} value={invoice.vendor} onChange={e => setInvoice(p => p ? { ...p, vendor: e.target.value } : p)} /></div>
                <div><span style={labelS}>Invoice #</span>
                  <input style={inp} value={invoice.invoiceNumber} onChange={e => setInvoice(p => p ? { ...p, invoiceNumber: e.target.value } : p)} /></div>
                <div><span style={labelS}>Invoice Date</span>
                  <input style={inp} type="date" value={invoice.date} onChange={e => setInvoice(p => p ? { ...p, date: e.target.value } : p)} /></div>
                <div><span style={labelS}>Subtotal</span>
                  <input style={{ ...inp, background: "#f9fafb" }} value={`$${invoice.subtotal.toFixed(2)}`} readOnly /></div>
                <div><span style={labelS}>{invoice.taxLabel}</span>
                  <input style={{ ...inp, background: "#f9fafb" }} value={`$${invoice.taxAmount.toFixed(2)}`} readOnly /></div>
                <div><span style={labelS}>Grand Total</span>
                  <input style={{ ...inp, background: "#f9fafb", fontWeight: 700 }} value={`$${invoice.grandTotal.toFixed(2)}`} readOnly /></div>
              </div>

              {/* Import items toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 14px", background: "#f0f4ff", border: "1px solid #bfdbfe", borderRadius: 8 }}>
                <input type="checkbox" id="importItems" checked={importItems} onChange={e => setImportItems(e.target.checked)} style={{ width: 15, height: 15, accentColor: "#1565c0" }} />
                <label htmlFor="importItems" style={{ fontSize: 13, fontWeight: 600, color: "#1e40af", cursor: "pointer" }}>Import line items into PO Order tab</label>
              </div>

              {/* Line items table */}
              {editLines.length > 0 ? (
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f9fafb" }}>
                        {["", "Part #", "Description", "Qty", "UOM", "Unit Price", "Total", "Tax"].map((h, i) => (
                          <th key={i} style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: i >= 3 && i <= 5 ? "right" : i === 6 ? "right" : "left", width: i === 0 ? 36 : undefined }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {editLines.map((line, i) => (
                        <tr key={i} style={{ background: line.selected ? "#fff" : "#f9fafb", opacity: line.selected ? 1 : 0.5 }}>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6", textAlign: "center" }}>
                            <input type="checkbox" checked={line.selected} onChange={e => updateLine(i, "selected", e.target.checked)} style={{ width: 14, height: 14, accentColor: "#1565c0" }} />
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6" }}>
                            <input style={{ ...inp, fontSize: 12, padding: "4px 6px" }} value={line.partNo} onChange={e => updateLine(i, "partNo", e.target.value)} />
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6" }}>
                            <input style={{ ...inp, fontSize: 12, padding: "4px 6px" }} value={line.description} onChange={e => updateLine(i, "description", e.target.value)} />
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6" }}>
                            <input style={{ ...inp, fontSize: 12, padding: "4px 6px", textAlign: "right", width: 60 }} type="number" min={0} value={line.qty} onChange={e => updateLine(i, "qty", parseFloat(e.target.value) || 0)} />
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6" }}>
                            <input style={{ ...inp, fontSize: 12, padding: "4px 6px", width: 50 }} value={line.uom} onChange={e => updateLine(i, "uom", e.target.value)} />
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6" }}>
                            <input style={{ ...inp, fontSize: 12, padding: "4px 6px", textAlign: "right", width: 80 }} type="number" min={0} step={0.0001} value={line.unitPrice} onChange={e => updateLine(i, "unitPrice", parseFloat(e.target.value) || 0)} />
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6", textAlign: "right", fontWeight: 600, fontSize: 13 }}>
                            ${line.total.toFixed(2)}
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6", textAlign: "center" }}>
                            <input type="checkbox" checked={line.taxable} onChange={e => updateLine(i, "taxable", e.target.checked)} style={{ width: 14, height: 14, accentColor: "#1565c0" }} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "20px", color: "#9ca3af", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8, background: "#f9fafb" }}>
                  No line items detected. You can still import this invoice as a bill record.
                </div>
              )}

              <button onClick={() => { setInvoice(null); setFile(null); setEditLines([]); setMatchedPOs(null); setSelectedPO(null); }}
                style={{ marginTop: 12, background: "none", border: "none", color: "#6b7280", fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                ← Use a different file
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        {invoice && !parsing && (
          <div style={{ padding: "16px 22px", borderTop: "1px solid #e5e7eb", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {isGlobal && !selectedPO && (
              <span style={{ fontSize: 12, color: "#92400e" }}>Select a PO above before importing</span>
            )}
            {(!isGlobal || selectedPO) && <span />}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={onClose} style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 7, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
              <button onClick={save} disabled={saving || !canSave} style={{
                background: !canSave ? "#d1d5db" : saving ? "#86efac" : "#16a34a",
                color: !canSave ? "#9ca3af" : "#fff", border: "none", borderRadius: 7,
                padding: "9px 24px", fontSize: 13, fontWeight: 800, cursor: canSave ? "pointer" : "default",
              }}>
                {saving ? "Saving…" : "Import Invoice"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
