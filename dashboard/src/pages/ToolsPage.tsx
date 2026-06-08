import { useEffect, useState } from "react";
import { collection, onSnapshot, updateDoc, doc, addDoc, serverTimestamp } from "firebase/firestore";
import { Link, useSearchParams } from "react-router-dom";
import ToolsTabs from "../components/ToolsTabs";
import { db } from "../firebase";
import StatusBadge from "../components/StatusBadge";
import Spinner from "../components/Spinner";
import { useToast } from "../components/Toast";
import { useCategories } from "../hooks/useCategories";
import { getCategoryBadgeStyle, categoryBadgeBase } from "../utils/categoryColors";
import { fmtDateLong } from "../utils/formatting";
import { downloadCSV } from "../utils/export";
import type { Tool } from "../types";

type Filter = "ALL" | "IN_SHOP" | "CHECKED_OUT" | "OVERDUE" | "DAMAGED";

export default function ToolsPage() {
  const [searchParams] = useSearchParams();
  const [tools, setTools]             = useState<Tool[]>([]);
  const [loading, setLoading]         = useState(true);
  const [filter, setFilter]           = useState<Filter>((searchParams.get("filter") as Filter) || "ALL");
  const [search, setSearch]           = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectMode, setSelectMode]   = useState(false);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState("");
  const categories = useCategories();
  const { toast, confirm } = useToast();

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "tools"), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Tool));
      const now = new Date();
      rows.sort((a, b) => {
        const aOv = a.status === "CHECKED_OUT" && a.dueBackAt?.toDate?.() < now;
        const bOv = b.status === "CHECKED_OUT" && b.dueBackAt?.toDate?.() < now;
        if (aOv && !bOv) return -1;
        if (!aOv && bOv) return 1;
        if (a.status === "CHECKED_OUT" && b.status !== "CHECKED_OUT") return -1;
        if (a.status !== "CHECKED_OUT" && b.status === "CHECKED_OUT") return 1;
        return (a.name ?? "").localeCompare(b.name ?? "");
      });
      setTools(rows);
      setLoading(false);
    });
    return unsub;
  }, []);

  const now = new Date();
  const q = search.trim().toLowerCase();

  const filtered = tools.filter((t) => {
    // Status filter
    const isOverdue = t.status === "CHECKED_OUT" && t.dueBackAt?.toDate?.() < now;
    if (filter === "OVERDUE"     && !isOverdue) return false;
    if (filter === "CHECKED_OUT" && !(t.status === "CHECKED_OUT" && !isOverdue)) return false;
    if (filter === "IN_SHOP"     && t.status !== "IN_SHOP") return false;
    if (filter === "DAMAGED"     && t.status !== "DAMAGED") return false;

    // Category filter
    if (categoryFilter && t.category !== categoryFilter) return false;

    // Search filter — name, ID, job number, or employee
    if (q) {
      const nameMatch = (t.name                      ?? "").toLowerCase().includes(q);
      const idMatch   = (t.toolId                    ?? "").toLowerCase().includes(q);
      const jobMatch  = (t.checkedOutToJobName        ?? "").toLowerCase().includes(q);
      const empMatch  = (t.checkedOutToEmployeeName   ?? "").toLowerCase().includes(q);
      if (!nameMatch && !idMatch && !jobMatch && !empMatch) return false;
    }

    return true;
  });

  function exportCSV() {
    const today = new Date().toISOString().slice(0, 10);
    const rows = filtered.map((t) => {
      const isOverdue = t.status === "CHECKED_OUT" && t.dueBackAt?.toDate?.() < now;
      return {
        Name: t.name || "",
        ID: t.toolId || t.id,
        Category: t.category || "",
        Status: isOverdue ? "OVERDUE" : t.status || "",
        Employee: t.checkedOutToEmployeeName || "",
        Job: t.checkedOutToJobName || "",
        "Due Date": fmtDateLong(t.dueBackAt),
      };
    });
    downloadCSV(rows, `equipment-${filter.toLowerCase()}-${today}.csv`);
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const visibleIds = filtered.map((t) => t.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of visibleIds) next.add(id);
        return next;
      });
    }
  }

  async function bulkReturn() {
    const checkedOutIds = [...selected].filter((id) => {
      const tool = tools.find((t) => t.id === id);
      return tool?.status === "CHECKED_OUT";
    });
    if (checkedOutIds.length === 0) {
      toast("No checked-out tools selected", "error");
      return;
    }
    if (!await confirm(`Return ${checkedOutIds.length} tool(s) to the shop?`)) return;

    setBulkProcessing(true);
    let succeeded = 0;
    for (const id of checkedOutIds) {
      try {
        const tool = tools.find((t) => t.id === id)!;
        await updateDoc(doc(db, "tools", id), {
          status: "IN_SHOP",
          checkedOutToEmployeeName: "",
          checkedOutToJobName: "",
          checkedOutToCustomer: "",
          checkedOutAt: null,
          dueBackAt: null,
          overdueNotifiedAt: null,
        });
        await addDoc(collection(db, "tools", id, "history"), {
          action: "RETURNED",
          employeeName: tool.checkedOutToEmployeeName ?? "",
          jobName: tool.checkedOutToJobName ?? "",
          customer: tool.checkedOutToCustomer ?? "",
          recordedAt: serverTimestamp(),
        });
        succeeded++;
      } catch (e) {
        console.error(`Failed to return tool ${id}:`, e);
      }
    }
    toast(`Returned ${succeeded} of ${checkedOutIds.length} tools`, "success");
    setSelected(new Set());
    setSelectMode(false);
    setBulkProcessing(false);
  }

  const counts = {
    ALL:         tools.length,
    IN_SHOP:     tools.filter((t) => t.status === "IN_SHOP").length,
    CHECKED_OUT: tools.filter((t) => t.status === "CHECKED_OUT" && !(t.dueBackAt?.toDate?.() < now)).length,
    OVERDUE:     tools.filter((t) => t.status === "CHECKED_OUT" && t.dueBackAt?.toDate?.() < now).length,
    DAMAGED:     tools.filter((t) => t.status === "DAMAGED").length,
  };

  const TABS: { key: Filter; label: string }[] = [
    { key: "ALL",         label: `All (${counts.ALL})` },
    { key: "IN_SHOP",     label: `In Shop (${counts.IN_SHOP})` },
    { key: "CHECKED_OUT", label: `Out (${counts.CHECKED_OUT})` },
    { key: "OVERDUE",     label: `Overdue (${counts.OVERDUE})` },
    { key: "DAMAGED",     label: `Damaged (${counts.DAMAGED})` },
  ];

  return (
    <div>
      <ToolsTabs />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <h1 style={styles.pageTitle}>Equipment</h1>
        <Link to="/tools/new" style={styles.addBtn}>+ Add Equipment</Link>
      </div>

      {/* Status filter tabs */}
      <div style={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.key}
            style={{ ...styles.tab, ...(filter === t.key ? styles.tabActive : {}) }}
            onClick={() => setFilter(t.key)}
          >
            {t.label}
          </button>
        ))}
        <span style={{ ...styles.refreshBtn, cursor: "default", opacity: 0.6 }} title="Data updates automatically">↻ Live</span>
      </div>

      {/* Category + Search row */}
      <div style={styles.filterRow}>
        <select
          style={styles.catSelect}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <div style={styles.searchWrap}>
          <input
            type="text"
            placeholder="Search by name, ID, job number, or employee…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.searchInput}
          />
          {search && (
            <button style={styles.clearBtn} onClick={() => setSearch("")}>✕</button>
          )}
        </div>

        {filtered.length > 0 && (
          <button style={styles.exportBtn} onClick={exportCSV}>Export CSV</button>
        )}

        <button
          style={styles.exportBtn}
          onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
        >
          {selectMode ? "Cancel" : "Select"}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>
      ) : filtered.length === 0 ? (
        <div style={styles.empty}>
          {q
            ? `No equipment matching "${search}"`
            : categoryFilter
            ? `No equipment in category "${categoryFilter}"${filter !== "ALL" ? ` with status filter applied` : ""}.`
            : "No equipment found."}
        </div>
      ) : (
        <div className="table-scroll">
          <table style={styles.table}>
            <thead>
              <tr>
                {selectMode && (
                  <th style={{ ...styles.th, width: 40, textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every((t) => selected.has(t.id))}
                      onChange={toggleSelectAll}
                    />
                  </th>
                )}
                {["", "Equipment Name", "ID", "Category", "Status", "Employee", "Job", "Check Out Date", "Due Date"].map((h) => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const isOverdue = t.status === "CHECKED_OUT" && t.dueBackAt?.toDate?.() < now;
                const isDamaged = t.status === "DAMAGED";
                const displayStatus = isOverdue ? "OVERDUE" : t.status ?? "UNKNOWN";
                const rowStyle = isOverdue ? styles.trOverdue : isDamaged ? styles.trDamaged : {};
                return (
                  <tr key={t.id} style={rowStyle}>
                    {selectMode && (
                      <td style={{ ...styles.td, width: 40, textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={selected.has(t.id)}
                          onChange={() => toggleSelected(t.id)}
                        />
                      </td>
                    )}
                    <td style={{ ...styles.td, width: 52, padding: "8px 6px 8px 14px" }}>
                      {t.photoURL ? (
                        <img src={t.photoURL} alt="" onClick={() => setLightboxUrl(t.photoURL!)} style={{ width: 44, height: 44, borderRadius: 6, objectFit: "contain", border: "1px solid #e5e5e5", background: "#fff", cursor: "pointer" }} />
                      ) : (
                        <div style={{ width: 44, height: 44, borderRadius: 6, background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#ccc" }}>📷</div>
                      )}
                    </td>
                    <td style={styles.td}><strong>{t.name || "—"}</strong></td>
                    <td style={styles.td}>
                      <Link to={`/tools/${encodeURIComponent(t.id)}`} style={styles.idLink}>
                        {t.toolId || t.id}
                      </Link>
                    </td>
                    <td style={styles.td}>
                      {t.category ? (
                        <span style={{ ...categoryBadgeBase, ...getCategoryBadgeStyle(t.category) }}>
                          {t.category}
                        </span>
                      ) : "—"}
                    </td>
                    <td style={styles.td}><StatusBadge status={displayStatus} /></td>
                    <td style={styles.td}>{t.checkedOutToEmployeeName || "—"}</td>
                    <td style={styles.td}>{t.checkedOutToJobName || "—"}</td>
                    <td style={styles.td}>{fmtDateLong(t.checkedOutAt)}</td>
                    <td style={{ ...styles.td, ...(isOverdue ? { color: "#a80000", fontWeight: 700 } : {}) }}>
                      {fmtDateLong(t.dueBackAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Floating action bar for bulk operations */}
      {selectMode && selected.size > 0 && (
        <div style={actionBarStyle}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {selected.size} selected
          </span>
          <button
            style={{
              background: "#fff",
              color: "#1e7d3a",
              border: "none",
              borderRadius: 8,
              padding: "8px 20px",
              fontWeight: 700,
              fontSize: 14,
              cursor: bulkProcessing ? "not-allowed" : "pointer",
              opacity: bulkProcessing ? 0.6 : 1,
            }}
            onClick={bulkReturn}
            disabled={bulkProcessing}
          >
            {bulkProcessing ? "Processing..." : "Bulk Return"}
          </button>
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl("")}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "pointer" }}
        >
          <img src={lightboxUrl} alt="" style={{ maxWidth: "90vw", maxHeight: "85vh", borderRadius: 12, objectFit: "contain", boxShadow: "0 8px 40px rgba(0,0,0,0.4)" }} />
          <button
            onClick={() => setLightboxUrl("")}
            style={{ position: "absolute", top: 20, right: 20, background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", borderRadius: "50%", width: 36, height: 36, fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >✕</button>
        </div>
      )}
    </div>
  );
}

const actionBarStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 0,
  left: 0,
  right: 0,
  background: "#1e7d3a",
  color: "#fff",
  padding: "12px 24px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  boxShadow: "0 -2px 10px rgba(0,0,0,0.15)",
  zIndex: 50,
};

const styles: Record<string, React.CSSProperties> = {
  pageTitle:   { fontSize: 28, fontWeight: 900, color: "#1e7d3a" },
  addBtn:      { background: "#1e7d3a", color: "#fff", textDecoration: "none", padding: "9px 18px", borderRadius: 8, fontWeight: 700, fontSize: 14 },
  tabs:        { display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" },
  tab:         { padding: "7px 16px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 13, fontWeight: 600, color: "#555", cursor: "pointer" },
  tabActive:   { background: "#1e7d3a", color: "#fff", borderColor: "#1e7d3a" },
  refreshBtn:  { marginLeft: "auto", padding: "7px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 13, fontWeight: 600, color: "#555", cursor: "pointer" },
  filterRow:   { display: "flex", gap: 10, alignItems: "center", marginBottom: 20, flexWrap: "wrap" },
  catSelect:   { border: "1px solid #ddd", borderRadius: 10, padding: "10px 14px", fontSize: 14, color: "#111", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", cursor: "pointer", minWidth: 160 },
  searchWrap:  { display: "flex", alignItems: "center", background: "#fff", border: "1px solid #ddd", borderRadius: 10, padding: "0 12px", flex: 1, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" },
  searchInput: { flex: 1, border: "none", outline: "none", fontSize: 14, padding: "11px 0", background: "transparent", color: "#111" },
  clearBtn:    { background: "none", border: "none", cursor: "pointer", color: "#aaa", fontSize: 16, padding: "0 0 0 8px" },
  exportBtn:   { background: "#f8f9fa", border: "1px solid #ddd", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, color: "#555", cursor: "pointer", whiteSpace: "nowrap" },
  empty:       { background: "#f8f9fa", borderRadius: 10, padding: "20px", color: "#888", textAlign: "center" },
  table:       { width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" },
  th:          { background: "#1a4a2e", padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#fff", borderBottom: "1px solid #0d2b19", textTransform: "uppercase", letterSpacing: 0.5 },
  td:          { padding: "12px 14px", borderBottom: "1px solid #f0f0f0", fontSize: 14 },
  trOverdue:   { backgroundColor: "#fff8f8" },
  trDamaged:   { backgroundColor: "#fdf6ff" },
  idLink:      { color: "#1e7d3a", fontWeight: 700, textDecoration: "none", fontSize: 13 },
};
