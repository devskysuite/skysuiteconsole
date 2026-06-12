import { useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { arrayUnion, doc, getDoc, runTransaction, updateDoc } from "firebase/firestore";
import { auth, db, storage } from "../firebase";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// ── Types ──────────────────────────────────────────────────────────────────────
interface ParsedLine {
  partNo: string;
  description: string;
  qty: number;
  uom: string;
  unitPrice: number;
  total: number;
  taxable: boolean;
  selected: boolean;
}

interface ParsedInvoice {
  invoiceNumber: string;
  poNumber: string;
  vendor: string;
  date: string;
  lines: ParsedLine[];
  subtotal: number;
  taxAmount: number;
  grandTotal: number;
  taxLabel: string;
}

// ── PDF Text Extraction ────────────────────────────────────────────────────────
async function extractLines(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const allLines: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // group by rounded y-coordinate to reconstruct visual lines
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
      const sorted = byY.get(y)!.sort((a, b) => a.x - b.x);
      const line = sorted.map(i => i.str).join(" ").replace(/\s{2,}/g, " ").trim();
      if (line) allLines.push(line);
    }
  }
  return allLines;
}

// ── Invoice Parser ─────────────────────────────────────────────────────────────
function parseInvoice(lines: string[]): ParsedInvoice {
  const result: ParsedInvoice = {
    invoiceNumber: "",
    poNumber: "",
    vendor: "",
    date: "",
    lines: [],
    subtotal: 0,
    taxAmount: 0,
    grandTotal: 0,
    taxLabel: "Tax",
  };

  // Join all lines into one searchable string for field detection
  const full = lines.join("\n");

  // Invoice number
  const invMatch = full.match(/invoice\s*(?:no\.?|number|#)?\s*:?\s*(\d{5,})/i);
  if (invMatch) result.invoiceNumber = invMatch[1];

  // PO number — try "CUSTOMER P.O. NO" first, then generic PO patterns
  const custPoMatch = full.match(/customer\s+p\.?o\.?\s+no\.?\s*[:\s]+([0-9A-Z-]+)/i);
  if (custPoMatch) result.poNumber = custPoMatch[1];
  else {
    const poMatch = full.match(/(?:purchase\s+order|p\.?o\.?)\s*(?:no\.?|number|#)?\s*:?\s*([0-9-]+)/i);
    if (poMatch) result.poNumber = poMatch[1];
  }

  // Date — try "DATE dd/mm/yyyy" or "INVOICE DATE: yyyy-mm-dd"
  const dateMatch = full.match(/(?:invoice\s+)?date\s*:?\s*(\d{1,4}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (dateMatch) {
    const raw = dateMatch[1];
    // Normalize to yyyy-mm-dd for <input type="date">
    const parts = raw.split(/[\/\-]/);
    if (parts[0].length === 4) {
      result.date = `${parts[0]}-${parts[1].padStart(2,"0")}-${parts[2].padStart(2,"0")}`;
    } else if (parts[2].length === 4) {
      result.date = `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`;
    } else {
      result.date = raw;
    }
  }

  // Vendor name — first non-empty line is usually the company header
  if (lines.length > 0) result.vendor = lines[0];

  // Subtotal / Tax / Total
  for (const line of lines) {
    const subMatch = line.match(/^sub\s*total\s+(\d[\d,]*\.?\d*)$/i);
    if (subMatch) { result.subtotal = parseFloat(subMatch[1].replace(/,/g, "")); continue; }

    const taxMatch = line.match(/^(hst|gst|pst|qst|tax(?:\s*\d+%?)?)\s+(\d[\d,]*\.\d+)$/i);
    if (taxMatch) {
      result.taxLabel = taxMatch[1].toUpperCase();
      result.taxAmount = parseFloat(taxMatch[2].replace(/,/g, ""));
      continue;
    }

    const totalMatch = line.match(/^(?:grand\s+)?total\s+(\d[\d,]*\.\d+)$/i);
    if (totalMatch) { result.grandTotal = parseFloat(totalMatch[1].replace(/,/g, "")); continue; }
  }

  // Line items: detect lines ending with qty UOM unitprice total
  // Pattern: <anything> <qty> <UOM> <unit-price> <total>
  const UOMS = /^(EA|EACH|PC|PCS|LB|FT|M|L|KG|BOX|RL|BAG|HR|SET|PR|CS|GAL|TON|YD|ROLL|CAN|PAIR)$/i;
  const skipPatterns = /^(ship|bill|invoice|date|p\.?o|purchase|customer|sub|total|hst|gst|tax|page|line|qty|description|unit|amount|price|receipt)/i;

  for (const line of lines) {
    if (skipPatterns.test(line)) continue;

    // Try to match: ...text qty UOM unitPrice total (all at end)
    const m = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,6})\s+(\d[\d,]*\.\d+)\s+(\d[\d,]*\.\d+)\s*$/i);
    if (!m) continue;

    const [, raw, qtyStr, uom, upStr, totStr] = m;
    if (!UOMS.test(uom)) continue;

    const qty = parseFloat(qtyStr);
    const unitPrice = parseFloat(upStr.replace(/,/g, ""));
    const total = parseFloat(totStr.replace(/,/g, ""));

    // sanity check: qty * unitPrice ≈ total (within 5%)
    if (qty > 0 && unitPrice > 0 && Math.abs(qty * unitPrice - total) > total * 0.05 + 0.1) continue;

    // Split raw into part# (first token) and description (rest)
    const rawTrimmed = raw.trim();
    const spaceIdx = rawTrimmed.indexOf(" ");
    const partNo = spaceIdx > 0 ? rawTrimmed.slice(0, spaceIdx) : rawTrimmed;
    const description = spaceIdx > 0 ? rawTrimmed.slice(spaceIdx + 1).trim() : "";

    result.lines.push({ partNo, description, qty, uom: uom.toUpperCase(), unitPrice, total, taxable: true, selected: true });
  }

  return result;
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

// ── Main Modal ─────────────────────────────────────────────────────────────────
export default function ImportBillModal({
  poId,
  poNumber,
  vendor,
  onClose,
}: {
  poId: string;
  poNumber: string;
  vendor: string;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [invoice, setInvoice] = useState<ParsedInvoice | null>(null);
  const [editLines, setEditLines] = useState<ParsedLine[]>([]);
  const [importItems, setImportItems] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inp: React.CSSProperties = {
    padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13,
    outline: "none", width: "100%", boxSizing: "border-box" as const,
  };
  const labelS: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase",
    letterSpacing: 0.6, marginBottom: 3, display: "block",
  };

  async function handleFile(f: File) {
    if (!f.name.toLowerCase().endsWith(".pdf")) { setError("Please select a PDF file."); return; }
    setFile(f);
    setError(null);
    setParsing(true);
    try {
      const lines = await extractLines(f);
      const parsed = parseInvoice(lines);
      setInvoice(parsed);
      setEditLines(parsed.lines.map(l => ({ ...l })));
    } catch (e) {
      setError("Failed to parse PDF. Please check the file and try again.");
      console.error(e);
    }
    setParsing(false);
  }

  function updateLine(i: number, field: keyof ParsedLine, value: string | number | boolean) {
    setEditLines(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value } as ParsedLine;
      return next;
    });
  }

  async function save() {
    if (!invoice || !file) return;
    setSaving(true);
    setError(null);
    try {
      // 1. Auto-generate bill number
      const billNumber = await getNextBillNumber();

      // 2. Upload PDF to Firebase Storage
      const fileName = `bills/${billNumber}.pdf`;
      const sRef = storageRef(storage, fileName);
      await uploadBytes(sRef, file, { contentType: "application/pdf" });
      const pdfUrl = await getDownloadURL(sRef);

      // 3. Build the bill record
      const bill = {
        id: crypto.randomUUID(),
        billNumber,
        receiptNumber: invoice.invoiceNumber,
        vendor: invoice.vendor || vendor,
        dateIssued: invoice.date || new Date().toISOString().slice(0, 10),
        total: invoice.grandTotal || invoice.subtotal + invoice.taxAmount,
        pdfUrl,
        createdBy: auth.currentUser?.displayName || auth.currentUser?.email || "Unknown",
      };

      // 4. Optionally add line items to PO
      if (importItems && editLines.some(l => l.selected)) {
        const poSnap = await getDoc(doc(db, "purchaseOrders", poId));
        const poData = poSnap.data();
        const existingItems: any[] = poData?.items || [];

        const newItems = editLines
          .filter(l => l.selected)
          .map(l => ({
            id: crypto.randomUUID(),
            name: l.partNo || l.description,
            description: l.partNo && l.description ? l.description : "",
            fulfillmentStatus: "Pending",
            quantityOrdered: l.qty,
            quantityReceived: 0,
            unitCost: l.unitPrice,
            totalCost: l.total,
            taxable: l.taxable,
            unitOfMeasure: l.uom,
            costCode: "Materials",
            jobCostType: "Materials",
            revenueType: "Materials",
          }));

        const allItems = [...existingItems, ...newItems];
        const newSubtotal = allItems.reduce((s: number, i: any) => s + (i.totalCost || 0), 0);
        const poTaxPct = ({ "GST (5%)": 0.05, "HST ON (13%)": 0.13, "HST BC (12%)": 0.12, "PST (7%)": 0.07 } as Record<string, number>)[poData?.taxRate || ""] ?? 0;
        const newTaxAmt = allItems.filter((i: any) => i.taxable).reduce((s: number, i: any) => s + (i.totalCost || 0), 0) * poTaxPct;

        await updateDoc(doc(db, "purchaseOrders", poId), {
          bills: arrayUnion(bill),
          items: allItems,
          subtotal: newSubtotal,
          taxAmount: newTaxAmt,
          total: newSubtotal + newTaxAmt,
        });
      } else {
        await updateDoc(doc(db, "purchaseOrders", poId), { bills: arrayUnion(bill) });
      }

      onClose();
    } catch (e) {
      console.error(e);
      setError("Failed to save. Please try again.");
    }
    setSaving(false);
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#fff", borderRadius: 14, width: 860, maxWidth: "95vw",
        maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid #e5e7eb", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#111827" }}>Import Supplier Invoice</div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>PO {poNumber} · {vendor}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af", lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: "22px", flex: 1, overflowY: "auto" }}>

          {/* File upload */}
          {!invoice && (
            <div
              style={{
                border: "2px dashed #d1d5db", borderRadius: 10, padding: "40px 24px",
                textAlign: "center", cursor: "pointer", background: file ? "#f0fdf4" : "#f9fafb",
                transition: "border-color 0.15s",
              }}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            >
              <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#374151", marginBottom: 4 }}>
                {file ? file.name : "Drop supplier invoice PDF here"}
              </div>
              <div style={{ fontSize: 12, color: "#9ca3af" }}>
                {parsing ? "Parsing PDF…" : "or click to browse"}
              </div>
              <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
          )}

          {parsing && (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#6b7280", fontSize: 14 }}>
              Parsing PDF…
            </div>
          )}

          {error && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", color: "#991b1b", fontSize: 13, marginTop: 12 }}>
              {error}
            </div>
          )}

          {/* Parsed Invoice preview */}
          {invoice && !parsing && (
            <>
              {/* Invoice header fields */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "14px 20px", marginBottom: 20 }}>
                <div>
                  <span style={labelS}>Vendor</span>
                  <input style={inp} value={invoice.vendor} onChange={e => setInvoice(p => p ? { ...p, vendor: e.target.value } : p)} />
                </div>
                <div>
                  <span style={labelS}>Invoice #</span>
                  <input style={inp} value={invoice.invoiceNumber} onChange={e => setInvoice(p => p ? { ...p, invoiceNumber: e.target.value } : p)} />
                </div>
                <div>
                  <span style={labelS}>Invoice Date</span>
                  <input style={inp} type="date" value={invoice.date} onChange={e => setInvoice(p => p ? { ...p, date: e.target.value } : p)} />
                </div>
                <div>
                  <span style={labelS}>PO # (on invoice)</span>
                  <input style={{ ...inp, background: "#f9fafb" }} value={invoice.poNumber} readOnly />
                </div>
                <div>
                  <span style={labelS}>Subtotal</span>
                  <input style={{ ...inp, background: "#f9fafb" }} value={`$${invoice.subtotal.toFixed(2)}`} readOnly />
                </div>
                <div>
                  <span style={labelS}>{invoice.taxLabel}</span>
                  <input style={{ ...inp, background: "#f9fafb" }} value={`$${invoice.taxAmount.toFixed(2)}`} readOnly />
                </div>
                <div>
                  <span style={labelS}>Grand Total</span>
                  <input style={{ ...inp, background: "#f9fafb", fontWeight: 700 }} value={`$${invoice.grandTotal.toFixed(2)}`} readOnly />
                </div>
              </div>

              {/* Import items toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 14px", background: "#f0f4ff", border: "1px solid #bfdbfe", borderRadius: 8 }}>
                <input type="checkbox" id="importItems" checked={importItems} onChange={e => setImportItems(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: "#1565c0" }} />
                <label htmlFor="importItems" style={{ fontSize: 13, fontWeight: 600, color: "#1e40af", cursor: "pointer" }}>
                  Import line items into PO Order tab
                </label>
              </div>

              {/* Line items table */}
              {editLines.length > 0 ? (
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f9fafb" }}>
                        <th style={{ width: 36, padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}></th>
                        <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "left" }}>Part #</th>
                        <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "left" }}>Description</th>
                        <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right" }}>Qty</th>
                        <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>UOM</th>
                        <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right" }}>Unit Price</th>
                        <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "right" }}>Total</th>
                        <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "center" }}>Tax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editLines.map((line, i) => (
                        <tr key={i} style={{ background: line.selected ? "#fff" : "#f9fafb", opacity: line.selected ? 1 : 0.5 }}>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6", textAlign: "center" }}>
                            <input type="checkbox" checked={line.selected} onChange={e => updateLine(i, "selected", e.target.checked)}
                              style={{ width: 14, height: 14, accentColor: "#1565c0" }} />
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6" }}>
                            <input style={{ ...inp, fontSize: 12, padding: "4px 6px" }} value={line.partNo}
                              onChange={e => updateLine(i, "partNo", e.target.value)} />
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6" }}>
                            <input style={{ ...inp, fontSize: 12, padding: "4px 6px" }} value={line.description}
                              onChange={e => updateLine(i, "description", e.target.value)} />
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>
                            <input style={{ ...inp, fontSize: 12, padding: "4px 6px", textAlign: "right", width: 60 }}
                              type="number" min={0} value={line.qty}
                              onChange={e => updateLine(i, "qty", parseFloat(e.target.value) || 0)} />
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6" }}>
                            <input style={{ ...inp, fontSize: 12, padding: "4px 6px", width: 50 }} value={line.uom}
                              onChange={e => updateLine(i, "uom", e.target.value)} />
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>
                            <input style={{ ...inp, fontSize: 12, padding: "4px 6px", textAlign: "right", width: 80 }}
                              type="number" min={0} step={0.0001} value={line.unitPrice}
                              onChange={e => updateLine(i, "unitPrice", parseFloat(e.target.value) || 0)} />
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6", textAlign: "right", fontWeight: 600, fontSize: 13 }}>
                            ${line.total.toFixed(2)}
                          </td>
                          <td style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6", textAlign: "center" }}>
                            <input type="checkbox" checked={line.taxable} onChange={e => updateLine(i, "taxable", e.target.checked)}
                              style={{ width: 14, height: 14, accentColor: "#1565c0" }} />
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

              {/* Change file link */}
              <button
                onClick={() => { setInvoice(null); setFile(null); setEditLines([]); }}
                style={{ marginTop: 12, background: "none", border: "none", color: "#6b7280", fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: 0 }}
              >
                ← Use a different file
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        {invoice && !parsing && (
          <div style={{ padding: "16px 22px", borderTop: "1px solid #e5e7eb", flexShrink: 0, display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={onClose} style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 7, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              Cancel
            </button>
            <button onClick={save} disabled={saving} style={{
              background: saving ? "#86efac" : "#16a34a", color: "#fff", border: "none",
              borderRadius: 7, padding: "9px 24px", fontSize: 13, fontWeight: 800, cursor: "pointer",
            }}>
              {saving ? "Saving…" : "Import Invoice"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
