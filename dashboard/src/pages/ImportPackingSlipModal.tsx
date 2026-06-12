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
  include: boolean;
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

  // Items: web-printed PDFs from Gerrie put each cell on its own line.
  // Strategy: find every "Item #" marker, then scan a context window around it
  // to locate price ($X.XX / EA), QTY Ordered, and description.
  // We capture QTY Ordered only — ship qty intentionally ignored.
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!/item\s*#/i.test(line)) continue;

    // Part # — same line ("Item # 1734-OA4") or next line
    let partNo = "";
    const slM = line.match(/item\s*#:?\s+(\S+)/i);
    if (slM) {
      partNo = slM[1];
    } else {
      const nxt = (lines[li + 1] || "").trim();
      if (nxt && !/^(mfr|price|qty|status|promised|required)/i.test(nxt)) {
        partNo = nxt.split(/\s+/)[0];
      }
    }
    if (!partNo || partNo.length < 3 || /^(message|mfr)/i.test(partNo)) continue;
    if (result.items.find(i => i.partNo === partNo)) continue;

    // Scan a window of 14 lines before "Item #" for price and qty ordered
    const winStart = Math.max(0, li - 14);
    const win = lines.slice(winStart, li + 1);

    // Price: "$X.XX / EA" anywhere in window
    let unitPrice = 0;
    for (const wl of win) {
      const m = wl.match(/\$([\d,]+\.\d{2})\s*\/\s*EA/i);
      if (m) { unitPrice = parseFloat(m[1].replace(/,/g, "")); break; }
    }

    // QTY Ordered: label on one line, value on the next — or same line
    let qty = 0;
    for (let j = 0; j < win.length; j++) {
      const sameLine = win[j].match(/qty\s+ordered\s+(\d+)/i);
      if (sameLine) { qty = parseInt(sameLine[1], 10); break; }
      if (/qty\s+ordered/i.test(win[j])) {
        const nextVal = (win[j + 1] || "").trim().match(/^(\d+)$/);
        if (nextVal) { qty = parseInt(nextVal[1], 10); break; }
      }
    }

    if (unitPrice === 0 || qty === 0) continue;

    // Subtotal: last standalone "$X.XX" in window (not the unit price itself)
    let total = Math.round(unitPrice * qty * 100) / 100;
    for (let j = win.length - 1; j >= 0; j--) {
      const m = win[j].match(/^\$([\d,]+\.\d{2})$/);
      if (m) {
        const v = parseFloat(m[1].replace(/,/g, ""));
        if (v !== unitPrice) { total = v; break; }
      }
    }

    // Description: line that contains the part # (e.g. "Allen-Bradley 1734-OA4")
    let description = "";
    for (const wl of win) {
      if (wl.includes(partNo) && wl.includes(" ")) { description = wl.trim(); break; }
    }
    if (description.toLowerCase().endsWith(partNo.toLowerCase())) {
      description = description.slice(0, -partNo.length).trim();
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
    const matchIdx = existing.findIndex((e: any) =>
      (e.name || "").toLowerCase() === item.partNo.toLowerCase()
    );
    if (matchIdx >= 0) {
      existing[matchIdx] = {
        ...existing[matchIdx],
        quantityOrdered: item.qty,
        ...(!(existing[matchIdx].unitCost) ? { unitCost: item.unitPrice, totalCost: item.total } : {}),
      };
    } else {
      existing.push({
        id: crypto.randomUUID(),
        name: item.partNo, description: item.description,
        quantityOrdered: item.qty, quantityReceived: 0,
        unitCost: item.unitPrice, totalCost: item.total,
        taxable: true, unitOfMeasure: "EA",
        costCode: "Materials", jobCostType: "Materials", revenueType: "Materials",
        fulfillmentStatus: "Pending",
      });
    }
  }

  const subtotal = existing.reduce((s: number, i: any) => s + (i.totalCost || 0), 0);
  await updateDoc(doc(db, "purchaseOrders", poId), { items: existing, subtotal });
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
  const [parsing, setParsing]   = useState(false);
  const [order, setOrder]       = useState<ParsedOrder | null>(null);
  const [items, setItems]       = useState<SlipItem[]>([]);
  const [rawLines, setRawLines] = useState<string[]>([]);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const [allPOs, setAllPOs]         = useState<POStub[]>([]);
  const [poSearch, setPoSearch]     = useState("");
  const [selectedPO, setSelectedPO] = useState<POStub | null>(null);

  const targetPoId = fixedPoId || selectedPO?.id || null;
  const includeCount = items.filter(i => i.include).length;
  const canSave = !!targetPoId && !!order && includeCount > 0 && !saving;

  useEffect(() => {
    if (fixedPoId) return;
    getDocs(query(collection(db, "purchaseOrders"), orderBy("createdAt", "desc")))
      .then(snap => setAllPOs(snap.docs.map(d => ({
        id: d.id, poNumber: String(d.data().poNumber || ""),
        vendor: d.data().vendor || "", jobNumber: d.data().jobNumber || "", status: d.data().status || "",
      }))))
      .catch(() => {});
  }, [fixedPoId]);

  async function handleFile(f: File) {
    if (!f.name.toLowerCase().endsWith(".pdf")) { setError("Please select a PDF file."); return; }
    setError(null); setParsing(true);
    try {
      const lines = await extractLines(f);
      setRawLines(lines);
      const parsed = parseOrderDetails(lines);
      setOrder(parsed);
      setItems(parsed.items);
    } catch (e) { setError("Failed to parse PDF."); console.error(e); }
    setParsing(false);
  }

  async function save() {
    if (!targetPoId || !order) return;
    setSaving(true); setError(null);
    try { await savePackingSlip(targetPoId, items); onClose(); }
    catch (e) { console.error(e); setError("Failed to save. Please try again."); }
    setSaving(false);
  }

  const filteredPOs = allPOs.filter(p => {
    if (!poSearch) return true;
    const q = poSearch.toLowerCase();
    return String(p.poNumber).includes(q) || p.vendor.toLowerCase().includes(q) || p.jobNumber.toLowerCase().includes(q);
  }).slice(0, 8);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "24px 28px", width: "min(860px, 96vw)", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>Import Packing Slip</div>
            {fixedPoNumber && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>PO {fixedPoNumber}</div>}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af" }}>✕</button>
        </div>

        {error && (
          <div style={{ marginBottom: 14, padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 13, color: "#991b1b" }}>{error}</div>
        )}

        {/* File drop / upload */}
        {!order && (
          <div
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            style={{ border: "2px dashed #d1d5db", borderRadius: 10, padding: "40px 20px", textAlign: "center", cursor: "pointer", background: "#f9fafb" }}
          >
            <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            {parsing ? (
              <div style={{ color: "#6b7280", fontSize: 14 }}>Parsing PDF…</div>
            ) : (
              <>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#374151" }}>Drop Gerrie Order Details PDF here</div>
                <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>or click to browse</div>
              </>
            )}
          </div>
        )}

        {order && (
          <>
            {/* Order summary row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "10px 18px", marginBottom: 16, padding: "14px 16px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10 }}>
              <div><span style={labelS}>Order #</span><div style={{ fontSize: 14, fontWeight: 700 }}>{order.orderNumber || "—"}</div></div>
              <div><span style={labelS}>Order Date</span><div style={{ fontSize: 13 }}>{order.orderDate || "—"}</div></div>
              <div><span style={labelS}>Vendor</span><div style={{ fontSize: 13 }}>{order.vendor}</div></div>
              {order.subtotal > 0 && <div><span style={labelS}>Subtotal</span><div style={{ fontSize: 13 }}>{fmtC(order.subtotal)}</div></div>}
              {order.tax > 0 && <div><span style={labelS}>Tax</span><div style={{ fontSize: 13 }}>{fmtC(order.tax)}</div></div>}
              {order.total > 0 && <div><span style={labelS}>Total</span><div style={{ fontSize: 14, fontWeight: 800 }}>{fmtC(order.total)}</div></div>}
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

            {/* Items table */}
            {items.length === 0 && (
              <div style={{ marginBottom: 16, background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 16 }}>⚠️</span>
                  <div style={{ fontSize: 13, color: "#92400e", fontWeight: 600 }}>No items detected. The packing slip will not update any PO items.</div>
                </div>
                <details style={{ borderTop: "1px solid #fcd34d" }}>
                  <summary style={{ padding: "8px 14px", fontSize: 12, color: "#92400e", cursor: "pointer", userSelect: "none" }}>Show extracted PDF text (for debugging)</summary>
                  <pre style={{ margin: 0, padding: "10px 14px", fontSize: 11, color: "#78350f", background: "#fefce8", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 300, overflowY: "auto" }}>
                    {rawLines.join("\n")}
                  </pre>
                </details>
              </div>
            )}

            {items.length > 0 ? (
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
                      <th style={thS}>Part #</th>
                      <th style={thS}>Description</th>
                      <th style={{ ...thS, textAlign: "right" }}>Qty Ordered</th>
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
              <button onClick={() => { setOrder(null); setItems([]); }}
                style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer", color: "#374151" }}>
                ← Different file
              </button>
              <button onClick={onClose} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 8, padding: "9px 18px", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={save} disabled={!canSave}
                style={{ background: canSave ? "#1565c0" : "#93c5fd", color: "#fff", border: "none", borderRadius: 8, padding: "9px 22px", fontSize: 13, fontWeight: 700, cursor: canSave ? "pointer" : "not-allowed" }}>
                {saving ? "Saving…" : `Add ${includeCount} Item${includeCount !== 1 ? "s" : ""} to PO`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
