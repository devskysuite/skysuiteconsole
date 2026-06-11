import { useEffect, useRef, useState } from "react";
import { collection, getDocs, limit, query } from "firebase/firestore";
import { db } from "../firebase";
import { useNavigate, useLocation } from "react-router-dom";

// ── Module-level cache (survives component re-mounts within a session) ────────
let cacheLoaded = false;
let cachePromise: Promise<void> | null = null;

const cacheCustomers:  { id: string; name: string }[] = [];
const cacheProperties: { id: string; name: string; customerName: string }[] = [];
const cacheJobs:       { id: string; jobNumber: string; customerName: string; status: string; customerPO: string; invoiceIds: string }[] = [];
const cachePOs: {
  id: string; poNumber: string; vendor: string; jobNumber: string; jobId: string;
  bills: { receiptNumber: string; billNumber: string; vendor: string; poId: string; jobNumber: string; jobId: string }[];
}[] = [];
const cacheVisits: { id: string; jobId: string; jobNumber: string; visitNumber: string; techName: string; title: string }[] = [];

function ensureCache(): Promise<void> {
  if (cacheLoaded) return Promise.resolve();
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    const [cs, ps, js, pos, vs] = await Promise.all([
      getDocs(query(collection(db, "customers"),     limit(250))),
      getDocs(query(collection(db, "properties"),    limit(250))),
      getDocs(query(collection(db, "jobs"),           limit(300))),
      getDocs(query(collection(db, "purchaseOrders"), limit(250))),
      getDocs(query(collection(db, "dispatchVisits"), limit(200))),
    ]);
    cacheCustomers.push(...cs.docs.map(d => ({ id: d.id, name: d.data().name || "" })));
    cacheProperties.push(...ps.docs.map(d => ({
      id: d.id,
      name: d.data().propertyName || "",
      customerName: d.data().customerName || "",
    })));
    cacheJobs.push(...js.docs.map(d => ({
      id: d.id,
      jobNumber:    d.data().jobNumber    || "",
      customerName: d.data().customerName || "",
      status:       d.data().status       || "",
      customerPO:   d.data().customerPO   || "",
      invoiceIds:   d.data().invoiceIds   || "",
    })));
    cachePOs.push(...pos.docs.map(d => {
      const bills = (d.data().bills || []).map((b: Record<string, string>) => ({
        receiptNumber: b.receiptNumber || "",
        billNumber:    b.billNumber    || "",
        vendor:        b.vendor        || "",
        poId:          d.id,
        jobNumber:     d.data().jobNumber || "",
        jobId:         d.data().jobId    || "",
      }));
      return {
        id:        d.id,
        poNumber:  d.data().poNumber  || "",
        vendor:    d.data().vendor    || "",
        jobNumber: d.data().jobNumber || "",
        jobId:     d.data().jobId     || "",
        bills,
      };
    }));
    cacheVisits.push(...vs.docs.map(d => ({
      id:          d.id,
      jobId:       d.data().jobId       || "",
      jobNumber:   d.data().jobNumber   || "",
      visitNumber: String(d.data().visitNumber ?? ""),
      techName:    d.data().techName    || "",
      title:       d.data().title       || "",
    })));
    cacheLoaded = true;
  })();
  return cachePromise;
}

// ── Result types ──────────────────────────────────────────────────────────────
type ResultItem = { type: string; title: string; sub: string; href: string };

const TYPE_ORDER  = ["customer", "property", "job", "visit", "po", "receipt"] as const;
const TYPE_LABELS: Record<string, string> = {
  customer: "Customers",
  property: "Sites / Properties",
  job:      "Jobs",
  visit:    "Job Visits",
  po:       "Purchase Orders",
  receipt:  "Receipts & Bills",
};

function runSearch(q: string): ResultItem[] {
  if (!q || q.trim().length < 2) return [];
  const lq = q.toLowerCase().trim();
  const out: ResultItem[] = [];
  const count = (type: string) => out.filter(r => r.type === type).length;

  for (const c of cacheCustomers) {
    if (count("customer") >= 6) break;
    if (c.name.toLowerCase().includes(lq))
      out.push({ type: "customer", title: c.name, sub: "Customer", href: `/customers/${c.id}` });
  }
  for (const p of cacheProperties) {
    if (count("property") >= 6) break;
    if (p.name.toLowerCase().includes(lq))
      out.push({ type: "property", title: p.name, sub: p.customerName || "Property", href: `/properties/${p.id}` });
  }
  for (const j of cacheJobs) {
    if (count("job") >= 6) break;
    if (
      j.jobNumber.toLowerCase().includes(lq) ||
      j.customerName.toLowerCase().includes(lq) ||
      (j.customerPO && j.customerPO.toLowerCase().includes(lq)) ||
      (j.invoiceIds && j.invoiceIds.toLowerCase().includes(lq))
    )
      out.push({ type: "job", title: j.jobNumber || "(no number)", sub: j.customerName, href: `/jobs/${j.id}` });
  }
  for (const v of cacheVisits) {
    if (count("visit") >= 6) break;
    if (
      v.visitNumber.includes(lq) ||
      v.jobNumber.toLowerCase().includes(lq) ||
      v.techName.toLowerCase().includes(lq) ||
      v.title.toLowerCase().includes(lq)
    )
      out.push({
        type: "visit",
        title: `Visit ${v.visitNumber}${v.jobNumber ? ` — ${v.jobNumber}` : ""}`,
        sub: v.techName || v.title || "Visit",
        href: `/jobs/${v.jobId}/visits/${v.id}`,
      });
  }
  for (const p of cachePOs) {
    if (count("po") >= 6) break;
    if (p.poNumber.toLowerCase().includes(lq) || p.vendor.toLowerCase().includes(lq) || p.jobNumber.toLowerCase().includes(lq))
      out.push({ type: "po", title: `PO ${p.poNumber}`, sub: p.vendor || p.jobNumber || "Purchase Order", href: `/purchase-orders/${p.id}` });
  }
  outer: for (const p of cachePOs) {
    for (const b of p.bills) {
      if (count("receipt") >= 6) break outer;
      if ((b.receiptNumber && b.receiptNumber.toLowerCase().includes(lq)) || (b.billNumber && b.billNumber.toLowerCase().includes(lq)))
        out.push({ type: "receipt", title: `Receipt ${b.receiptNumber || b.billNumber}`, sub: b.vendor || `PO ${p.poNumber}`, href: `/purchase-orders/${p.id}` });
    }
  }
  return out;
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const ICONS: Record<string, React.ReactNode> = {
  customer: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="2" width="18" height="20" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="22"/></svg>,
  property: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/><polyline points="9 21 9 13 15 13 15 21"/></svg>,
  job:      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>,
  visit:    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  po:       <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>,
  receipt:  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="16" y2="13"/></svg>,
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function GlobalSearch() {
  const navigate     = useNavigate();
  const { pathname } = useLocation();
  const [q, setQ]        = useState("");
  const [results, setResults] = useState<ResultItem[]>([]);
  const [open, setOpen]   = useState(false);
  const [cacheReady, setCacheReady] = useState(cacheLoaded);
  const [cacheErr, setCacheErr]     = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);

  // Close on route change
  useEffect(() => { setOpen(false); setQ(""); setResults([]); }, [pathname]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleFocus() {
    setOpen(true);
    if (!cacheReady) {
      try {
        await ensureCache();
        setCacheReady(true);
        if (q.length >= 2) setResults(runSearch(q));
      } catch {
        setCacheErr(true);
      }
    }
  }

  function handleChange(val: string) {
    setQ(val);
    setOpen(true);
    if (cacheReady) setResults(runSearch(val));
  }

  function handleSelect(href: string) {
    setOpen(false);
    setQ("");
    setResults([]);
    navigate(href);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
  }

  const grouped = TYPE_ORDER.map(type => ({
    type,
    label: TYPE_LABELS[type],
    items: results.filter(r => r.type === type),
  })).filter(g => g.items.length > 0);

  const showDropdown = open && q.trim().length >= 2;

  return (
    <div ref={containerRef} style={{ position: "relative", flex: 1, maxWidth: 460, minWidth: 200 }}>
      {/* Input */}
      <div style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.12)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", padding: "0 12px", gap: 8, transition: "border-color 0.15s", ...(open ? { borderColor: "rgba(255,255,255,0.45)" } : {}) }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref={inputRef}
          className="global-search-input"
          type="text"
          value={q}
          onChange={e => handleChange(e.target.value)}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder="Search customers, jobs, POs, receipts…"
          autoComplete="off"
          style={{ background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 13, fontWeight: 500, flex: 1, padding: "9px 0" }}
        />
        {!cacheReady && !cacheErr && open && (
          <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, whiteSpace: "nowrap" }}>Loading…</span>
        )}
        {q && (
          <button
            onClick={() => { setQ(""); setResults([]); inputRef.current?.focus(); }}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 0 1px", flexShrink: 0 }}
          >×</button>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, right: 0, background: "#fff", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.16), 0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb", zIndex: 9999, maxHeight: 480, overflowY: "auto" }}>
          {cacheErr && (
            <div style={{ padding: "20px 16px", textAlign: "center", color: "#ef4444", fontSize: 13 }}>Failed to load search index.</div>
          )}
          {!cacheErr && grouped.length === 0 && cacheReady && (
            <div style={{ padding: "20px 16px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>No results for "<strong>{q}</strong>"</div>
          )}
          {!cacheErr && !cacheReady && (
            <div style={{ padding: "20px 16px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>Preparing search…</div>
          )}
          {grouped.map((group, gi) => (
            <div key={group.type}>
              {gi > 0 && <div style={{ height: 1, background: "#f3f4f6" }} />}
              <div style={{ padding: "8px 14px 2px", fontSize: 10, fontWeight: 800, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.8 }}>
                {group.label}
              </div>
              {group.items.map((item, ii) => (
                <button
                  key={ii}
                  onClick={() => handleSelect(item.href)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#eff6ff"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
                >
                  <span style={{ color: "#6b7280", flexShrink: 0, display: "flex", alignItems: "center" }}>
                    {ICONS[item.type]}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</span>
                    {item.sub && item.sub !== item.title && (
                      <span style={{ display: "block", fontSize: 11, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.sub}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
