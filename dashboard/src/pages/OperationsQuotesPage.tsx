import { useEffect, useState } from "react";
import { collection, doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Link } from "react-router-dom";
import { useIsAdmin } from "../hooks/useIsAdmin";

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  "Draft":            { bg:"#f3f4f6", color:"#374151" },
  "Ready":            { bg:"#dbeafe", color:"#1e40af" },
  "Sent To Customer": { bg:"#fef3c7", color:"#92400e" },
  "Accepted":         { bg:"#dcfce7", color:"#166534" },
  "Rejected":         { bg:"#fee2e2", color:"#991b1b" },
  "Expired":          { bg:"#f3f4f6", color:"#9ca3af" },
};

export default function OperationsQuotesPage() {
  const isAdmin = useIsAdmin();
  const [quotes, setQuotes]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [counterModal, setCounterModal] = useState(false);
  const [counterVal, setCounterVal] = useState("");

  useEffect(() => {
    return onSnapshot(
      collection(db, "quotes"),
      snap => {
        const list = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a: any, b: any) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        setQuotes(list);
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, []);

  async function openCounterModal() {
    const snap = await getDoc(doc(db, "counters", "quotes"));
    setCounterVal(String(snap.exists() ? snap.data().next : 1));
    setCounterModal(true);
  }

  async function saveCounter() {
    const n = parseInt(counterVal);
    if (isNaN(n) || n < 1) return;
    await setDoc(doc(db, "counters", "quotes"), { next: n }, { merge: true });
    setCounterModal(false);
  }

  const filtered = quotes.filter(q => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (q.quoteNumber || "").toLowerCase().includes(s) ||
      (q.title || "").toLowerCase().includes(s) ||
      (q.customerName || "").toLowerCase().includes(s) ||
      (q.propertyName || "").toLowerCase().includes(s) ||
      (q.status || "").toLowerCase().includes(s) ||
      (q.projectManager || "").toLowerCase().includes(s)
    );
  });

  const td: React.CSSProperties = { padding:"9px 12px", fontSize:13, color:"#374151", verticalAlign:"middle", borderBottom:"1px solid #f3f4f6", whiteSpace:"nowrap" };
  const th: React.CSSProperties = { padding:"8px 12px", fontSize:11, fontWeight:700, color:"#6b7280", textTransform:"uppercase", letterSpacing:0.4, whiteSpace:"nowrap", background:"#f9fafb", borderBottom:"1px solid #e5e7eb" };

  return (
    <div style={{ background:"#f9fafb", height:"calc(100vh - 96px)", display:"flex", flexDirection:"column" }}>
      <div style={{ background:"#fff", borderBottom:"1px solid #e5e7eb", padding:"12px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexShrink:0 }}>
        <div>
          <span style={{ fontSize:16, fontWeight:800, color:"#111827" }}>Quotes</span>
          <span style={{ fontSize:12, color:"#9ca3af", marginLeft:10 }}>{filtered.length} of {quotes.length}</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <input
            style={{ border:"1px solid #d1d5db", borderRadius:7, padding:"6px 12px", fontSize:13, outline:"none", width:300 }}
            placeholder="Search quote #, customer, property, status…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {isAdmin && (
            <button onClick={openCounterModal} style={{ background:"#f3f4f6", color:"#374151", border:"1px solid #d1d5db", borderRadius:7, padding:"6px 14px", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}>
              Set Quote # Start
            </button>
          )}
        </div>
      </div>

      <div style={{ flex:1, overflow:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"auto" }}>
          <thead>
            <tr>
              {["Quote #","Customer","Property","Title","Status","Department","Project Manager","Due By","Created"].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody style={{ background:"#fff" }}>
            {loading && <tr><td colSpan={9} style={{ padding:40, textAlign:"center", color:"#9ca3af" }}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={9} style={{ padding:40, textAlign:"center", color:"#9ca3af" }}>
                {search ? "No quotes match your search." : "No quotes yet."}
              </td></tr>
            )}
            {filtered.map(q => {
              const sc = STATUS_COLORS[q.status] || STATUS_COLORS["Draft"];
              return (
                <tr key={q.id}>
                  <td style={{ ...td, fontWeight:700 }}>
                    <Link to={`/quotes/${q.id}`} style={{ color:"#1565c0", textDecoration:"none" }}>{q.quoteNumber}</Link>
                  </td>
                  <td style={td}>{q.customerName || "—"}</td>
                  <td style={td}>{q.propertyName || "—"}</td>
                  <td style={{ ...td, maxWidth:220, overflow:"hidden", textOverflow:"ellipsis" }}>{q.title || "—"}</td>
                  <td style={td}>
                    <span style={{ background:sc.bg, color:sc.color, fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:99 }}>{q.status || "—"}</span>
                  </td>
                  <td style={td}>{q.department || "—"}</td>
                  <td style={td}>{q.projectManager || "—"}</td>
                  <td style={td}>{q.quoteDueBy || "—"}</td>
                  <td style={td}>{q.createdAt ? new Date(q.createdAt).toLocaleDateString("en-CA") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {counterModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
          <div style={{ background:"#fff", borderRadius:12, padding:28, width:340, boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize:15, fontWeight:700, color:"#111827", marginBottom:6 }}>Set Quote # Start</div>
            <p style={{ fontSize:13, color:"#6b7280", marginBottom:16 }}>The next quote created will use this number. Use this to import old quotes before resuming normal numbering.</p>
            <label style={{ fontSize:12, fontWeight:600, color:"#374151", display:"block", marginBottom:6 }}>Next Quote Number</label>
            <input
              type="number"
              min={1}
              style={{ width:"100%", border:"1px solid #d1d5db", borderRadius:7, padding:"8px 12px", fontSize:14, outline:"none", boxSizing:"border-box" }}
              value={counterVal}
              onChange={e => setCounterVal(e.target.value)}
            />
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:18 }}>
              <button onClick={() => setCounterModal(false)} style={{ background:"#f3f4f6", color:"#374151", border:"1px solid #d1d5db", borderRadius:7, padding:"8px 16px", fontSize:13, fontWeight:600, cursor:"pointer" }}>Cancel</button>
              <button onClick={saveCounter} style={{ background:"#1565c0", color:"#fff", border:"none", borderRadius:7, padding:"8px 16px", fontSize:13, fontWeight:600, cursor:"pointer" }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
