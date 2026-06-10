import { useEffect, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { useIsAdmin } from "../hooks/useIsAdmin";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PricebookItem {
  name: string;
  description: string;
  taxable: boolean;
  unitCost: number;
  materialMarkup: string;
  totalMarkup: string;
  unitPrice: number;
  markupUsed: string;
}

interface Pricebook {
  id: string;
  name: string;
  year: number | null;
  isDefault: boolean;
  createdAt: string;
  items: PricebookItem[];
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function parsePricebookCSV(text: string): PricebookItem[] {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  // Row 0 is header — skip it
  const items: PricebookItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    // Simple comma split (fields shouldn't contain commas based on format spec)
    const cols = line.split(",");
    // Format: Name,Description,Taxable,Unit Cost,Material Markup,Total Markup,Unit Price,Markup Used,
    const name          = (cols[0] ?? "").trim();
    if (!name) continue;
    const description   = (cols[1] ?? "").trim();
    const taxableRaw    = (cols[2] ?? "").trim().toLowerCase();
    const taxable       = taxableRaw === "true";
    const unitCost      = parseFloat((cols[3] ?? "").replace(/[$,]/g, "")) || 0;
    const materialMarkup = (cols[4] ?? "").trim();
    const totalMarkup   = (cols[5] ?? "").trim();
    const unitPrice     = parseFloat((cols[6] ?? "").replace(/[$,]/g, "")) || 0;
    const markupUsed    = (cols[7] ?? "").trim();
    items.push({ name, description, taxable, unitCost, materialMarkup, totalMarkup, unitPrice, markupUsed });
  }
  return items;
}

function inferNameFromFilename(filename: string): { name: string; year: number | null } {
  // Strip prefix: "BuildOps - Pricebook[_: ]+"
  let clean = filename.replace(/\.csv$/i, "");
  clean = clean.replace(/^BuildOps\s*[-–]\s*Pricebook[_:\s]+/i, "").trim();
  // Try to extract year (4-digit number)
  const yearMatch = clean.match(/\b(20\d{2})\b/);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;
  return { name: clean || filename.replace(/\.csv$/i, ""), year };
}

function fmt$(n: number): string {
  return "$" + n.toFixed(2);
}

// ── Styles ────────────────────────────────────────────────────────────────────
const btnS = (bg: string, extra?: React.CSSProperties): React.CSSProperties => ({
  background: bg, color: "#fff", border: "none", borderRadius: 8,
  padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
  ...extra,
});

const th: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left" as const,
  fontSize: 11,
  fontWeight: 700,
  color: "#6b7280",
  textTransform: "uppercase" as const,
  letterSpacing: 0.4,
  whiteSpace: "nowrap" as const,
  background: "#f9fafb",
  borderBottom: "2px solid #e5e7eb",
  position: "sticky" as const,
  top: 0,
  zIndex: 2,
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  color: "#374151",
  verticalAlign: "middle" as const,
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PricebookPage() {
  const isAdmin = useIsAdmin();
  const [pricebooks, setPricebooks] = useState<Pricebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Import state
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<{
    name: string;
    year: number | null;
    items: PricebookItem[];
  } | null>(null);
  const [importing, setImporting] = useState(false);

  // Load pricebooks with real-time updates
  useEffect(() => {
    return onSnapshot(
      collection(db, "pricebooks"),
      snap => {
        const books = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as Pricebook))
          .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
        setPricebooks(books);
        setLoading(false);
        // Set active tab to default pricebook on first load
        setActiveId(prev => {
          if (prev && books.find(b => b.id === prev)) return prev;
          const def = books.find(b => b.isDefault);
          return def ? def.id : (books[0]?.id ?? null);
        });
      },
      () => setLoading(false)
    );
  }, []);

  const activePricebook = pricebooks.find(b => b.id === activeId) ?? null;

  // ── Set as default ────────────────────────────────────────────────────────
  async function setAsDefault(targetId: string) {
    const batch = writeBatch(db);
    for (const b of pricebooks) {
      batch.update(doc(db, "pricebooks", b.id), { isDefault: b.id === targetId });
    }
    await batch.commit();
  }

  // ── Delete pricebook ──────────────────────────────────────────────────────
  async function deletePricebook(book: Pricebook) {
    if (!confirm(`Delete "${book.name}"? This cannot be undone.`)) return;
    await deleteDoc(doc(db, "pricebooks", book.id));
  }

  // ── CSV file selected ─────────────────────────────────────────────────────
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const { name, year } = inferNameFromFilename(file.name);
    file.text().then(text => {
      const items = parsePricebookCSV(text);
      setPendingImport({ name, year, items });
    });
    e.target.value = "";
  }

  // ── Confirm import ────────────────────────────────────────────────────────
  async function confirmImport() {
    if (!pendingImport) return;
    setImporting(true);
    try {
      const ref = await addDoc(collection(db, "pricebooks"), {
        name: pendingImport.name,
        year: pendingImport.year,
        isDefault: pricebooks.length === 0,
        createdAt: new Date().toISOString(),
        items: pendingImport.items,
      });
      setActiveId(ref.id);
    } catch (err) {
      console.error("Failed to import pricebook", err);
    }
    setImporting(false);
    setPendingImport(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "20px 24px 16px", marginBottom: 0, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: "#9ca3af", fontWeight: 500, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Directory</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0d2e5e", margin: 0 }}>Pricebook</h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {isAdmin && (
            <>
              <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleFileChange} />
              <button
                onClick={() => fileRef.current?.click()}
                style={btnS("#6b7280", { display: "flex", alignItems: "center", gap: 6 })}
              >
                ↑ Import CSV
              </button>
            </>
          )}
          {isAdmin && activePricebook && !activePricebook.isDefault && (
            <button
              onClick={() => setAsDefault(activePricebook.id)}
              style={btnS("#1565c0")}
            >
              Set as Default
            </button>
          )}
          {isAdmin && activePricebook && pricebooks.length > 1 && (
            <button
              onClick={() => deletePricebook(activePricebook)}
              title="Delete this pricebook"
              style={{ background: "none", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/>
                <path d="M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Inline import confirmation bar */}
      {pendingImport && (
        <div style={{ flexShrink: 0, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, margin: "0 24px 12px", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1e40af" }}>Importing:</span>
          <input
            value={pendingImport.name}
            onChange={e => setPendingImport(p => p ? { ...p, name: e.target.value } : p)}
            style={{ padding: "6px 10px", border: "1px solid #93c5fd", borderRadius: 6, fontSize: 13, color: "#1e3a5f", minWidth: 220 }}
          />
          <span style={{ fontSize: 13, color: "#3b82f6", fontWeight: 500 }}>
            {pendingImport.items.length} item{pendingImport.items.length !== 1 ? "s" : ""}
          </span>
          <button
            onClick={confirmImport}
            disabled={importing || !pendingImport.name.trim()}
            style={{ ...btnS("#1565c0"), opacity: importing || !pendingImport.name.trim() ? 0.6 : 1 }}
          >
            {importing ? "Importing…" : "Import"}
          </button>
          <button
            onClick={() => setPendingImport(null)}
            style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 12px", fontSize: 13, color: "#6b7280", cursor: "pointer", fontWeight: 500 }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && pricebooks.length === 0 && !pendingImport && (
        <div style={{ textAlign: "center", padding: 80 }}>
          <div style={{ fontSize: 48, marginBottom: 14 }}>📋</div>
          <h3 style={{ color: "#374151", marginBottom: 8, fontSize: 18, fontWeight: 700 }}>No pricebooks yet</h3>
          <p style={{ color: "#9ca3af", fontSize: 14, maxWidth: 360, margin: "0 auto 24px" }}>
            Import a CSV to get started.
          </p>
          {isAdmin && (
            <button onClick={() => fileRef.current?.click()} style={btnS("#1565c0")}>
              ↑ Import CSV
            </button>
          )}
        </div>
      )}

      {/* Pricebook tabs */}
      {pricebooks.length > 0 && (
        <div style={{ flexShrink: 0, display: "flex", borderBottom: "2px solid #e5e7eb", marginBottom: 0, overflowX: "auto", padding: "0 24px" }}>
          {pricebooks.map(book => (
            <button
              key={book.id}
              onClick={() => setActiveId(book.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "10px 18px", fontWeight: 600, fontSize: 14, cursor: "pointer",
                background: "none", border: "none",
                borderBottom: activeId === book.id ? "2px solid #1565c0" : "2px solid transparent",
                color: activeId === book.id ? "#1565c0" : "#6b7280",
                marginBottom: -2, whiteSpace: "nowrap",
              }}
            >
              {book.name}
              {book.isDefault && (
                <span style={{
                  background: "#1565c0", color: "#fff",
                  fontSize: 9, fontWeight: 700, padding: "2px 6px",
                  borderRadius: 99, letterSpacing: 0.5, textTransform: "uppercase" as const,
                }}>
                  DEFAULT
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Items table */}
      {activePricebook && (
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 250px)", borderTop: "1px solid #e5e7eb", background: "#fff" }}>
          {activePricebook.items.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>
              No items in this pricebook.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={th}>Name</th>
                  <th style={{ ...th, minWidth: 220 }}>Description</th>
                  <th style={{ ...th, textAlign: "center" as const }}>Taxable</th>
                  <th style={{ ...th, textAlign: "right" as const }}>Unit Cost</th>
                  <th style={th}>Material Markup</th>
                  <th style={th}>Total Markup</th>
                  <th style={{ ...th, textAlign: "right" as const }}>Unit Price</th>
                  <th style={th}>Markup Used</th>
                </tr>
              </thead>
              <tbody>
                {activePricebook.items.map((item, idx) => (
                  <tr
                    key={idx}
                    style={{ borderBottom: "1px solid #f3f4f6", transition: "background 0.1s" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}
                  >
                    <td style={{ ...td, fontWeight: 600, color: "#0d2e5e" }}>{item.name}</td>
                    <td style={{ ...td, color: "#6b7280", fontSize: 12 }}>{item.description || "—"}</td>
                    <td style={{ ...td, textAlign: "center" as const }}>
                      {item.taxable
                        ? <span style={{ background: "#dcfce7", color: "#166534", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>Yes</span>
                        : <span style={{ background: "#f3f4f6", color: "#6b7280", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>No</span>
                      }
                    </td>
                    <td style={{ ...td, textAlign: "right" as const }}>{fmt$(item.unitCost)}</td>
                    <td style={td}>{item.materialMarkup || "—"}</td>
                    <td style={td}>{item.totalMarkup || "—"}</td>
                    <td style={{ ...td, textAlign: "right" as const, fontWeight: 600 }}>{fmt$(item.unitPrice)}</td>
                    <td style={td}>
                      {item.markupUsed === "Custom"
                        ? <span style={{ background: "#dbeafe", color: "#1e40af", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>Custom</span>
                        : item.markupUsed
                          ? <span style={{ background: "#f3f4f6", color: "#6b7280", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>Default</span>
                          : <span style={{ color: "#d1d5db" }}>—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
