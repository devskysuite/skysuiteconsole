import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { collection, doc, getDoc, getDocs, orderBy, query, updateDoc } from "firebase/firestore";
import { db } from "../firebase";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// ── Types ──────────────────────────────────────────────────────────────────────
interface SlipItem {
  partNo: string; description: string;
  qty: number; unitPrice: number; total: number; uom: string;
  include: boolean; source?: string;
}

interface ParsedOrder {
  orderNumber: string; orderDate: string; vendor: string;
  items: SlipItem[]; subtotal: number; tax: number; total: number;
}

interface POStub { id: string; poNumber: string; vendor: string; jobNumber: string; status: string; }

// ── PDF Extraction ─────────────────────────────────────────────────────────────
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
    const sorted = [...byY.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, items] of sorted) {
      const text = items.sort((a, b) => a.x - b.x).map(i => i.str).join(" ").trim();
      if (text) allLines.push(text);
    }
  }
  return allLines;
}

// ── Parser ─────────────────────────────────────────────────────────────────────
function normalizeDate(raw: string): string {
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return raw;
}

function parseOrderDetails(lines: string[]): ParsedOrder {
  const result: ParsedOrder = {
    orderNumber: "", orderDate: "", vendor: "Gerrie Electric",
    items: [], subtotal: 0, tax: 0, total: 0,
  };

  // Order number
  for (const line of lines) {
    const m = line.match(/Order\s+#(\S+)/i);
    if (m) { result.orderNumber = m[1]; break; }
  }

  // Order date (first M/D/YYYY)
  for (const line of lines) {
    const m = line.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (m) { result.orderDate = normalizeDate(m[1]); break; }
  }

  // Totals
  for (const line of lines) {
    const sm = line.match(/^subtotal\s+\$([\d,]+\.\d{2})/i);
    if (sm) result.subtotal = parseFloat(sm[1].replace(/,/g, ""));
    const tm = line.match(/^tax\s+\$([\d,]+\.\d{2})/i);
    if (tm) result.tax = parseFloat(tm[1].replace(/,/g, ""));
    const gm = line.match(/^total\s+\$([\d,]+\.\d{2})/i);
    if (gm) result.total = parseFloat(gm[1].replace(/,/g, ""));
  }

  // Gerrie Order Details layout (web-printed PDF):
  // Each item ends with: "Item # MFR Part #:" on one line,
  // then "{GERRIE_PART} {MFR_PART} Promised Date Required Date Status" on the next.
  // Price + QTY Ordered are on a line "$X.XX / EA {QTY} ..." a few lines above.
  for (let li = 0; li < lines.length; li++) {
    if (!/item\s*#/i.test(lines[li])) continue;

    // Part # is always on the NEXT line, first token
    // e.g. "1734-OA4 1734-OA4 Promised Date Required Date Status"
    const nextLine = (lines[li + 1] || "").trim();
    const partNo = nextLine.split(/\s+/)[0];
    if (!partNo || partNo.length < 2) continue;
    if (/^(message|mfr|promised|required|status)/i.test(partNo)) continue;
    if (/^\d+$/.test(partNo)) continue; // skip the placeholder "Item #\n0\nMESSAGE" block

    // Scan 6 lines above this marker — price line is always within that window
    const win = lines.slice(Math.max(0, li - 6), li);

    // Price line: "$X.XX / EA {QTY_ORDERED} [Backordered] ... ${SUBTOTAL}"
    let unitPrice = 0, qty = 0, total = 0;
    for (let j = win.length - 1; j >= 0; j--) {
      const m = win[j].match(/\$([\d,]+\.\d{2})\s*\/\s*EA\s+(\d+)/i);
      if (!m) continue;
      unitPrice = parseFloat(m[1].replace(/,/g, ""));
      qty = parseInt(m[2], 10);
      // Subtotal is the last dollar amount on the same line
      const allAmts = [...win[j].matchAll(/\$([\d,]+\.\d{2})/g)];
      total = allAmts.length >= 2
        ? parseFloat(allAmts[allAmts.length - 1][1].replace(/,/g, ""))
        : Math.round(unitPrice * qty * 100) / 100;
      break;
    }

    if (unitPrice === 0 || qty === 0) continue;

    // Description: line in the window that contains the part # with surrounding text
    // e.g. "Allen-Bradley 1734-OA4" → strip trailing part# → "Allen-Bradley"
    let description = "";
    for (let j = win.length - 1; j >= 0; j--) {
      if (win[j].includes(partNo) && win[j].trim() !== partNo) {
        description = win[j].trim();
        if (description.toLowerCase().endsWith(partNo.toLowerCase())) {
          description = description.slice(0, -partNo.length).trim();
        }
        break;
      }
    }

    result.items.push({ partNo, description, qty, unitPrice, total, uom: "EA", include: true });
  }

  return result;
}

// ── Save ───────────────────────────────────────────────────────────────────────
async function savePackingSlip(poId: string, items: SlipItem[]) {
  const poSnap = await getDoc(doc(db, "purchaseOrders", poId));
  const existing: any[] = ((poSnap.data()?.items) || []).map((i: any) => ({ ...i }));

  for (const item of items) {
    if (!item.include) continue;
    const pn = item.partNo.toLowerCase().trim();
    // Match existing item by name: exact → name-contains-partno → partno-contains-name
    const matchIdx = existing.findIndex((e: any) => {
      const en = (e.name || "").toLowerCase().trim();
      return en === pn || (en.includes(pn) && pn.length >= 4) || (pn.includes(en) && en.length >= 4);
    });
    if (matchIdx >= 0) {
      // Packing slip confirms receipt — increment quantityReceived
      const e = existing[matchIdx];
      const newQtyRec = (e.quantityReceived || 0) + item.qty;
      const fulfilled = (e.quantityOrdered || 0) > 0 && newQtyRec >= (e.quantityOrdered || 0);
      existing[matchIdx] = {
        ...e,
        quantityReceived: newQtyRec,
        fulfillmentStatus: fulfilled ? "Fulfilled" : "Pending",
        ...(!e.unitCost ? { unitCost: item.unitPrice, totalCost: item.total } : {}),
      };
    } else {
      // No prior invoice for this item — add it as fully received
      existing.push({
        id: crypto.randomUUID(),
        name: item.partNo, description: item.description,
        quantityOrdered: item.qty, quantityReceived: item.qty,
        unitCost: item.unitPrice, totalCost: item.total,
        taxable: true, unitOfMeasure: item.uom || "EA",
        costCode: "Materials", jobCostType: "Materials", revenueType: "Materials",
        fulfillmentStatus: "Fulfilled",
      });
    }
  }

  const subtotal = existing.reduce((s: number, i: any) => s + (i.totalCost || 0), 0);
  const hasBills = (poSnap.data()?.bills?.length || 0) > 0;
  const allFulfilled = existing.length > 0 && existing.every((i: any) => i.fulfillmentStatus === "Fulfilled") && hasBills;
  const curStatus = poSnap.data()?.status || "Open";
  const updates: Record<string, any> = { items: existing, subtotal };
  if (!["Cancelled", "Draft"].includes(curStatus)) {
    updates.status = existing.length === 0 ? "Open" : allFulfilled ? "Fulfilled" : "Waiting on Material";
  }
  await updateDoc(doc(db, "purchaseOrders", poId), updates);
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtC(n: number) { return `$${(n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
const inp: React.CSSProperties = { border: "1px solid #d1d5db", borderRadius: 6, padding: "7px 10px", fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" };
const labelS: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 };
const thS: React.CSSProperties = { padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", textAlign: "left", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" };
const tdS: React.CSSProperties = { padding: "7px 10px", fontSize: 13, borderBottom: "1px solid #f3f4f6" };

// ── Modal ──────────────────────────────────────────────────────────────────────
export default function ImportPackingSlipModal({
  poId: fixedPoId, poNumber: fixedPoNumber, onClose,
}: {
  poId?: string; poNumber?: string; onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing]     = useState(false);
  const [orders, setOrders]       = useState<Array<{ fileName: string; parsed: ParsedOrder }>>([]);
  const [items, setItems]         = useState<SlipItem[]>([]);
  const [rawLines, setRawLines]   = useState<string[]>([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [allPOs, setAllPOs]         = useState<POStub[]>([]);
  const [poSearch, setPoSearch]     = useState("");
  const [selectedPO, setSelectedPO] = useState<POStub | null>(null);

  const targetPoId   = fixedPoId || selectedPO?.id || null;
  const includeCount = items.filter(i => i.include).length;
  const hasOrders    = orders.length > 0;
  const multiSource  = orders.length > 1;
  const canReview    = !!targetPoId && hasOrders && includeCount > 0 && !saving;

  useEffect(() => {
    if (fixedPoId) return;
    getDocs(query(collection(db, "purchaseOrders"), orderBy("createdAt", "desc")))
      .then(snap => setAllPOs(snap.docs.map(d => ({
        id: d.id, poNumber: String(d.data().poNumber || ""),
        vendor: d.data().vendor || "", jobNumber: d.data().jobNumber || "", status: d.data().status || "",
      }))))
      .catch(() => {});
  }, [fixedPoId]);

  async function handleFiles(files: FileList) {
    const pdfs = Array.from(files).filter(f => f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) { setError("Please select PDF files."); return; }
    setError(null); setParsing(true);
    try {
      const newOrders: typeof orders = [];
      const allItems: SlipItem[]     = [];
      const allRaw:   string[]       = [];
      for (const file of pdfs) {
        const lines = await extractLines(file);
        allRaw.push(...lines);
        const parsed = parseOrderDetails(lines);
        newOrders.push({ fileName: file.name, parsed });
        allItems.push(...parsed.items.map(item => ({ ...item, source: parsed.orderNumber || file.name })));
      }
      setRawLines(allRaw);
      setOrders(newOrders);
      setItems(allItems);
    } catch (e) { setError("Failed to parse PDF."); console.error(e); }
    setParsing(false);
  }

  async function save() {
    if (!targetPoId) return;
    setSaving(true); setError(null);
    try { await savePackingSlip(targetPoId, items); onClose(); }
    catch (e) { console.error(e); setError("Failed to save. Please try again."); setSaving(false); setConfirming(false); }
  }

  function reset() { setOrders([]); setItems([]); setRawLines([]); setConfirming(false); }

  const filteredPOs = allPOs.filter(p => {
    if (!poSearch) return true;
    const q = poSearch.toLowerCase();
    return String(p.poNumber).includes(q) || p.vendor.toLowerCase().includes(q) || p.jobNumber.toLowerCase().includes(q);
  }).slice(0, 8);

  const targetLabel = fixedPoNumber ? `PO ${fixedPoNumber}` : selectedPO ? `PO ${selectedPO.poNumber} · ${selectedPO.vendor}` : "";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "24px 28px", width: "min(900px, 96vw)", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>
              {confirming ? "Confirm Import" : "Import Packing Slip"}
            </div>
            {fixedPoNumber && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>PO {fixedPoNumber}</div>}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af" }}>✕</button>
        </div>

        {error && (
          <div style={{ marginBottom: 14, padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 13, color: "#991b1b" }}>{error}</div>
        )}

        {/* ── Confirmation screen ── */}
        {confirming && (
          <>
            <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "16px 18px", marginBottom: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#166534", marginBottom: 6 }}>Ready to import into {targetLabel}</div>
              <div style={{ fontSize: 13, color: "#374151" }}>
                {includeCount} item{includeCount !== 1 ? "s" : ""} from {orders.length} file{orders.length !== 1 ? "s" : ""} will be added or updated.
              </div>
              {orders.map((o, oi) => {
                const orderItems = items.filter(i => i.include && (i as any).source === (o.parsed.orderNumber || o.fileName));
                if (!orderItems.length) return null;
                return (
                  <div key={oi} style={{ marginTop: 10, fontSize: 12, color: "#166534" }}>
                    <strong>Order #{o.parsed.orderNumber || o.fileName}</strong> — {orderItems.length} item{orderItems.length !== 1 ? "s" : ""}
                    {orderItems.map((it, ii) => (
                      <div key={ii} style={{ paddingLeft: 12, color: "#374151" }}>• {it.partNo} × {it.qty} {it.description ? `— ${it.description}` : ""}</div>
                    ))}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirming(false)} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer" }}>
                ← Back to Review
              </button>
              <button onClick={onClose} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={save} disabled={saving}
                style={{ background: saving ? "#86efac" : "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "9px 22px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                {saving ? "Importing…" : `Confirm — Import ${includeCount} Item${includeCount !== 1 ? "s" : ""}`}
              </button>
            </div>
          </>
        )}

        {/* ── Review screen ── */}
        {!confirming && (
          <>
            {/* File drop / upload */}
            {!hasOrders && (
              <div
                onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); }}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileRef.current?.click()}
                style={{ border: "2px dashed #d1d5db", borderRadius: 10, padding: "40px 20px", textAlign: "center", cursor: "pointer", background: "#f9fafb" }}
              >
                <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: "none" }}
                  onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); }} />
                {parsing ? (
                  <div style={{ color: "#6b7280", fontSize: 14 }}>Parsing PDFs…</div>
                ) : (
                  <>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#374151" }}>Drop one or more Gerrie Order Details PDFs</div>
                    <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>or click to browse — multiple files supported</div>
                  </>
                )}
              </div>
            )}

            {hasOrders && (
              <>
                {/* Orders summary */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                  {orders.map((o, oi) => (
                    <div key={oi} style={{ background: "#f0f4ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "8px 14px", fontSize: 12 }}>
                      <span style={{ fontWeight: 700, color: "#1e40af" }}>Order #{o.parsed.orderNumber || "—"}</span>
                      <span style={{ color: "#6b7280", marginLeft: 8 }}>{o.fileName}</span>
                      {o.parsed.total > 0 && <span style={{ color: "#374151", marginLeft: 8, fontWeight: 600 }}>{fmtC(o.parsed.total)}</span>}
                    </div>
                  ))}
                  <button onClick={reset} style={{ background: "none", border: "1px dashed #d1d5db", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#6b7280", cursor: "pointer" }}>
                    + Add more files
                  </button>
                </div>

                {/* PO selector (global mode only) */}
                {!fixedPoId && (
                  <div style={{ marginBottom: 16, padding: "14px 16px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Select Target PO</div>
                    {selectedPO ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 7 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#166534" }}>✓ PO {selectedPO.poNumber} · {selectedPO.vendor}</span>
                        <button onClick={() => setSelectedPO(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 12 }}>change</button>
                      </div>
                    ) : (
                      <>
                        <input style={{ ...inp, marginBottom: 8 }} placeholder="Search PO #, vendor, job…" value={poSearch} onChange={e => setPoSearch(e.target.value)} />
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto" }}>
                          {filteredPOs.map(p => (
                            <button key={p.id} onClick={() => { setSelectedPO(p); setPoSearch(""); }}
                              style={{ textAlign: "left", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 7, padding: "8px 12px", fontSize: 13, cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }}>
                              <span style={{ fontWeight: 700, color: "#1565c0" }}>PO {p.poNumber}</span>
                              <span style={{ color: "#6b7280" }}>{p.vendor}</span>
                              {p.jobNumber && <span style={{ color: "#9ca3af" }}>· {p.jobNumber}</span>}
                              <span style={{ marginLeft: "auto", fontSize: 11, color: "#9ca3af" }}>{p.status}</span>
                            </button>
                          ))}
                          {filteredPOs.length === 0 && <div style={{ fontSize: 12, color: "#9ca3af" }}>No POs found.</div>}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* No items warning */}
                {items.length === 0 && (
                  <div style={{ marginBottom: 16, background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, overflow: "hidden" }}>
                    <div style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 16 }}>⚠️</span>
                      <div style={{ fontSize: 13, color: "#92400e", fontWeight: 600 }}>No items detected in any of the uploaded files.</div>
                    </div>
                    <details style={{ borderTop: "1px solid #fcd34d" }}>
                      <summary style={{ padding: "8px 14px", fontSize: 12, color: "#92400e", cursor: "pointer", userSelect: "none" }}>Show extracted PDF text</summary>
                      <pre style={{ margin: 0, padding: "10px 14px", fontSize: 11, color: "#78350f", background: "#fefce8", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 300, overflowY: "auto" }}>
                        {rawLines.join("\n")}
                      </pre>
                    </details>
                  </div>
                )}

                {/* Items table */}
                {items.length > 0 && (
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", marginBottom: 16 }}>
                    <div style={{ padding: "10px 14px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5 }}>
                        {includeCount} of {items.length} items selected
                      </span>
                      <button onClick={() => setItems(p => p.map(i => ({ ...i, include: true })))} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 12, color: "#1565c0", cursor: "pointer", fontWeight: 600 }}>Select all</button>
                      <button onClick={() => setItems(p => p.map(i => ({ ...i, include: false })))} style={{ background: "none", border: "none", fontSize: 12, color: "#6b7280", cursor: "pointer" }}>None</button>
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={{ ...thS, width: 36, textAlign: "center" }}></th>
                          {multiSource && <th style={thS}>Order #</th>}
                          <th style={thS}>Part #</th>
                          <th style={thS}>Description</th>
                          <th style={{ ...thS, textAlign: "right" }}>Qty</th>
                          <th style={{ ...thS, textAlign: "right" }}>Unit $</th>
                          <th style={{ ...thS, textAlign: "right" }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, i) => (
                          <tr key={i} style={{ opacity: item.include ? 1 : 0.4, background: item.include ? "#fff" : "#f9fafb" }}>
                            <td style={{ ...tdS, textAlign: "center" }}>
                              <input type="checkbox" checked={item.include} onChange={e => setItems(p => p.map((it, idx) => idx === i ? { ...it, include: e.target.checked } : it))} />
                            </td>
                            {multiSource && <td style={{ ...tdS, fontSize: 11, color: "#6b7280" }}>{(item as any).source || "—"}</td>}
                            <td style={{ ...tdS, fontWeight: 700 }}>{item.partNo}</td>
                            <td style={{ ...tdS, color: "#6b7280", fontSize: 12 }}>{item.description || "—"}</td>
                            <td style={{ ...tdS, textAlign: "right", fontWeight: 700 }}>{item.qty}</td>
                            <td style={{ ...tdS, textAlign: "right" }}>{fmtC(item.unitPrice)}</td>
                            <td style={{ ...tdS, textAlign: "right", fontWeight: 600 }}>{fmtC(item.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
                  <button onClick={reset} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer", color: "#374151" }}>
                    ← Different files
                  </button>
                  <button onClick={onClose} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer" }}>Cancel</button>
                  <button onClick={() => setConfirming(true)} disabled={!canReview}
                    style={{ background: canReview ? "#1565c0" : "#93c5fd", color: "#fff", border: "none", borderRadius: 8, padding: "9px 22px", fontSize: 13, fontWeight: 700, cursor: canReview ? "pointer" : "not-allowed" }}>
                    Review & Confirm →
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
