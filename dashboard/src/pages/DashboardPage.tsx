// Dashboard page
import { useEffect, useState } from "react";
import { collection, collectionGroup, doc, getDoc, onSnapshot, query } from "firebase/firestore";
import { Link } from "react-router-dom";
import { db } from "../firebase";
import Spinner from "../components/Spinner";
import { getCategoryBadgeStyle, categoryBadgeBase } from "../utils/categoryColors";
import { fmtDateLong } from "../utils/formatting";
import { downloadCSV } from "../utils/export";
import type { Tool, Booking } from "../types";

const REPAIR_STATUSES: Record<string, { label: string; color: string; bg: string }> = {
  WAITING:        { label: "Waiting for Repair", color: "#d97706", bg: "#fffbeb" },
  OUT_FOR_REPAIR: { label: "Out for Repair",     color: "#2563eb", bg: "#eff6ff" },
  NOT_REPAIRABLE: { label: "Not Repairable",     color: "#dc2626", bg: "#fef2f2" },
};

/** Collapsible section wrapper used for each dashboard table. */
function CollapsibleSection({
  title, badge, badgeStyle, defaultOpen = true, onExport, children,
}: {
  title: string;
  badge?: React.ReactNode;
  badgeStyle?: React.CSSProperties;
  defaultOpen?: boolean;
  onExport?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 28 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={styles.collapseBtn}
      >
        <span style={styles.collapsTitle}>{title}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {onExport && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onExport(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onExport(); } }}
              style={styles.sectionExportBtn}
            >Export CSV</span>
          )}
          {badge !== undefined && (
            <span style={{ ...styles.baseBadge, ...badgeStyle }}>{badge}</span>
          )}
          <span style={{
            fontSize: 12, color: "#999",
            transform: open ? "rotate(180deg)" : "none",
            display: "inline-block", transition: "transform 0.2s",
          }}>▼</span>
        </div>
      </button>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubTools = onSnapshot(collection(db, "tools"), (toolsSnap) => {
      setTools(toolsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Tool)));
      setLoading(false);
    });

    const unsubBookings = onSnapshot(query(collectionGroup(db, "bookings")), async (bookingsSnap) => {
      try {
        const now = new Date();
        const toolIdSet = new Set<string>();
        const vehicleIdSet = new Set<string>();
        bookingsSnap.docs.forEach((d) => {
          const parentRef = d.ref.parent.parent;
          if (!parentRef) return;
          const collName = parentRef.path.split("/")[0];
          if (collName === "vehicles") vehicleIdSet.add(parentRef.id);
          else toolIdSet.add(parentRef.id);
        });
        const toolNames: Record<string, string> = {};
        const vehicleNames: Record<string, string> = {};
        await Promise.all([
          ...[...toolIdSet].map(async (tid) => {
            const snap = await getDoc(doc(db, "tools", tid));
            if (snap.exists()) toolNames[tid] = snap.data().name || tid;
          }),
          ...[...vehicleIdSet].map(async (vid) => {
            const snap = await getDoc(doc(db, "vehicles", vid));
            if (snap.exists()) vehicleNames[vid] = snap.data().name || vid;
          }),
        ]);
        setBookings(
          bookingsSnap.docs
            .map((d) => {
              const data = d.data();
              const parentRef = d.ref.parent.parent;
              const parentPath = parentRef?.path ?? "";
              const collName = parentPath.split("/")[0];
              const parentId = parentRef?.id ?? "";
              const isVehicle = collName === "vehicles";
              const name = isVehicle ? (vehicleNames[parentId] || parentId) : (toolNames[parentId] || parentId);
              return { id: d.id, toolId: parentId, toolName: name, source: isVehicle ? "vehicle" as const : "tool" as const, ...data } as Booking;
            })
            .filter((b) => b.status === "UPCOMING" && b.endDate?.toDate?.() >= now)
            .sort((a, b) => (a.startDate?.toDate?.()?.getTime() ?? 0) - (b.startDate?.toDate?.()?.getTime() ?? 0))
        );
      } catch (e) {
        console.error("Bookings query failed:", e);
      }
    });

    return () => { unsubTools(); unsubBookings(); };
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>;

  const now = new Date();
  const total       = tools.length;
  const checkedOut  = tools.filter((t) => t.status === "CHECKED_OUT");
  const overdue     = checkedOut.filter((t) => t.dueBackAt?.toDate?.() < now);
  const inShopTools = tools.filter((t) => t.status === "IN_SHOP").sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const inShop      = inShopTools.length;
  const damaged     = tools.filter((t) => t.status === "DAMAGED");

  const checkedOutSorted = [...checkedOut].sort((a, b) => {
    const aOv = a.dueBackAt?.toDate?.() < now;
    const bOv = b.dueBackAt?.toDate?.() < now;
    if (aOv && !bOv) return -1;
    if (!aOv && bOv) return 1;
    const aDate = a.dueBackAt?.toDate?.()?.getTime() ?? Infinity;
    const bDate = b.dueBackAt?.toDate?.()?.getTime() ?? Infinity;
    return aDate - bDate;
  });

  const today = new Date().toISOString().slice(0, 10);

  function exportDamaged() {
    const rs: Record<string, string> = { WAITING: "Waiting for Repair", OUT_FOR_REPAIR: "Out for Repair", NOT_REPAIRABLE: "Not Repairable" };
    downloadCSV(damaged.map((t) => ({
      Name: t.name || "",
      ID: t.toolId || t.id,
      "Reported By": t.damagedReportedBy || "",
      Date: fmtDateLong(t.damagedReportedAt),
      "Repair Status": rs[t.repairStatus ?? "WAITING"] || t.repairStatus || "",
      Description: t.damagedNote || "",
    })), `damaged-equipment-${today}.csv`);
  }

  function exportOverdue() {
    downloadCSV(overdue.map((t) => ({
      Name: t.name || "",
      ID: t.toolId || t.id,
      Employee: t.checkedOutToEmployeeName || "",
      Job: t.checkedOutToJobName || "",
      "Due Date": fmtDateLong(t.dueBackAt),
    })), `overdue-equipment-${today}.csv`);
  }

  function exportBookings() {
    downloadCSV(bookings.map((b) => ({
      Tool: b.toolName || b.toolId,
      Employee: b.employeeName || "",
      Job: b.jobName || "",
      Start: fmtDateLong(b.startDate),
      End: fmtDateLong(b.endDate),
    })), `upcoming-bookings-${today}.csv`);
  }

  function exportCheckedOut() {
    downloadCSV(checkedOutSorted.map((t) => ({
      Name: t.name || "",
      ID: t.toolId || t.id,
      Employee: t.checkedOutToEmployeeName || "",
      Job: t.checkedOutToJobName || "",
      "Due Date": fmtDateLong(t.dueBackAt),
    })), `checked-out-equipment-${today}.csv`);
  }

  function exportInShop() {
    downloadCSV(inShopTools.map((t) => ({
      Name: t.name || "",
      ID: t.toolId || t.id,
      Category: t.category || "",
    })), `in-shop-equipment-${today}.csv`);
  }

  return (
    <div>
      <h1 style={styles.pageTitle}>Dashboard</h1>

      {/* Stats */}
      <div style={styles.statsRow}>
        {[
          { label: "In Shop",            value: inShop,            color: inShop       > 0 ? "#0d5a2a" : "#888", link: "/tools?filter=IN_SHOP" },
          { label: "Checked Out",        value: checkedOut.length, color: checkedOut.length > 0 ? "#b05a00" : "#888", link: "/tools?filter=CHECKED_OUT" },
          { label: "Overdue",            value: overdue.length,    color: overdue.length    > 0 ? "#a80000" : "#888", link: "/tools?filter=OVERDUE" },
          { label: "Damaged",            value: damaged.length,    color: damaged.length    > 0 ? "#6a0080" : "#888", link: "/tools?filter=DAMAGED" },
          { label: "Upcoming Bookings",  value: bookings.length,   color: bookings.length   > 0 ? "#005a8b" : "#888", link: "/bookings" },
        ].map((s) => (
          <Link key={s.label} to={s.link} style={{ textDecoration: "none", flex: "1 1 130px" }}>
            <div style={styles.statCard}>
              <div className="stat-value" style={{ ...styles.statValue, color: s.color }}>{s.value}</div>
              <div style={styles.statLabel}>{s.label}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* ── Checked Out Equipment ── */}
      <CollapsibleSection
        title="Checked Out Equipment"
        badge={checkedOut.length}
        badgeStyle={checkedOut.length > 0 ? styles.neutralCount : styles.zeroCount}
        onExport={checkedOut.length > 0 ? exportCheckedOut : undefined}
      >
        {checkedOut.length === 0 ? (
          <div style={styles.emptyBox}>✓ No equipment currently checked out</div>
        ) : (
          <div className="table-scroll">
            <table style={styles.table}>
              <thead>
                <tr>
                  {[["Equipment","28%"],["ID","12%"],["Employee","20%"],["Job","22%"],["Due Date","18%"]].map(([h,w]) => (
                    <th key={h} style={{ ...styles.th, width: w }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {checkedOutSorted.map((t) => {
                  const isOverdue = t.dueBackAt?.toDate?.() < now;
                  return (
                    <tr key={t.id} style={isOverdue ? styles.trOverdue : {}}>
                      <td style={styles.td}><strong>{t.name || "—"}</strong></td>
                      <td style={styles.td}>
                        <Link to={`/tools/${encodeURIComponent(t.id)}`} style={styles.idLink}>
                          {t.toolId || t.id}
                        </Link>
                      </td>
                      <td style={styles.td}>{t.checkedOutToEmployeeName || "—"}</td>
                      <td style={styles.td}>{t.checkedOutToJobName || "—"}</td>
                      <td style={isOverdue ? { ...styles.td, color: "#a80000", fontWeight: 700 } : styles.td}>
                        {fmtDateLong(t.dueBackAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      {/* ── Damaged Equipment ── */}
      <CollapsibleSection
        title="Damaged Equipment"
        badge={damaged.length}
        badgeStyle={damaged.length > 0 ? styles.damagedCount : styles.zeroCount}
        onExport={damaged.length > 0 ? exportDamaged : undefined}
      >
        {damaged.length === 0 ? (
          <div style={styles.emptyBox}>✓ No damaged equipment right now</div>
        ) : (
          <div className="table-scroll">
            <table style={styles.table}>
              <thead>
                <tr>
                  {[["Equipment","28%"],["ID","12%"],["Reported By","15%"],["Date","12%"],["Repair Status","15%"],["Description","18%"]].map(([h,w]) => (
                    <th key={h} style={{ ...styles.th, width: w }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {damaged.map((t) => {
                  const rs = REPAIR_STATUSES[t.repairStatus ?? "WAITING"] ?? REPAIR_STATUSES["WAITING"];
                  return (
                  <tr key={t.id} style={styles.trDamaged}>
                    <td style={styles.td}><strong>{t.name || "—"}</strong></td>
                    <td style={styles.td}>
                      <Link to={`/tools/${encodeURIComponent(t.id)}`} style={styles.idLink}>
                        {t.toolId || t.id}
                      </Link>
                    </td>
                    <td style={styles.td}>{t.damagedReportedBy || "—"}</td>
                    <td style={styles.td}>{fmtDateLong(t.damagedReportedAt)}</td>
                    <td style={styles.td}>
                      <span style={{
                        display: "inline-block", padding: "2px 10px", borderRadius: 20,
                        background: rs.bg, color: rs.color, fontWeight: 700, fontSize: 12,
                        border: `1px solid ${rs.color}44`, whiteSpace: "nowrap",
                      }}>{rs.label}</span>
                    </td>
                    <td style={{ ...styles.td, color: "#555", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.damagedNote || "—"}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      {/* ── Overdue Equipment ── */}
      <CollapsibleSection
        title="Overdue Equipment"
        badge={overdue.length}
        badgeStyle={overdue.length > 0 ? styles.overdueCount : styles.zeroCount}
        onExport={overdue.length > 0 ? exportOverdue : undefined}
      >
        {overdue.length === 0 ? (
          <div style={styles.emptyBox}>✓ No overdue equipment right now</div>
        ) : (
          <div className="table-scroll">
            <table style={styles.table}>
              <thead>
                <tr>
                  {[["Equipment","28%"],["ID","12%"],["Employee","20%"],["Job","22%"],["Due Date","18%"]].map(([h,w]) => (
                    <th key={h} style={{ ...styles.th, width: w }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overdue.map((t) => (
                  <tr key={t.id} style={styles.trOverdue}>
                    <td style={styles.td}><strong>{t.name || "—"}</strong></td>
                    <td style={styles.td}>
                      <Link to={`/tools/${encodeURIComponent(t.id)}`} style={styles.idLink}>
                        {t.toolId || t.id}
                      </Link>
                    </td>
                    <td style={styles.td}>{t.checkedOutToEmployeeName || "—"}</td>
                    <td style={styles.td}>{t.checkedOutToJobName || "—"}</td>
                    <td style={{ ...styles.td, color: "#a80000", fontWeight: 700 }}>{fmtDateLong(t.dueBackAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      {/* ── Upcoming Bookings ── */}
      <CollapsibleSection
        title="Upcoming Bookings"
        badge={bookings.length}
        badgeStyle={bookings.length > 0 ? styles.bookingCount : styles.zeroCount}
        onExport={bookings.length > 0 ? exportBookings : undefined}
      >
        {bookings.length === 0 ? (
          <div style={styles.emptyBox}>✓ No upcoming bookings</div>
        ) : (
          <div className="table-scroll">
            <table style={styles.table}>
              <thead>
                <tr>
                  {[["Equipment","28%"],["ID","12%"],["Employee","20%"],["Job","20%"],["Start","10%"],["End","10%"]].map(([h,w]) => (
                    <th key={h} style={{ ...styles.th, width: w }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id}>
                    <td style={styles.td}><strong>{b.toolName}</strong></td>
                    <td style={styles.td}>
                      <Link to={`/tools/${encodeURIComponent(b.toolId)}`} style={styles.idLink}>
                        {b.toolId}
                      </Link>
                    </td>
                    <td style={styles.td}>{b.employeeName || "—"}</td>
                    <td style={styles.td}>{b.jobName || "—"}</td>
                    <td style={{ ...styles.td, color: "#b05a00", fontWeight: 700 }}>{fmtDateLong(b.startDate)}</td>
                    <td style={{ ...styles.td, color: "#b05a00", fontWeight: 700 }}>{fmtDateLong(b.endDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      {/* ── Equipment at the Shop ── */}
      <CollapsibleSection
        title="Equipment at the Shop"
        badge={inShop}
        badgeStyle={inShop > 0 ? styles.inShopCount : styles.zeroCount}
        onExport={inShop > 0 ? exportInShop : undefined}
      >
        {inShop === 0 ? (
          <div style={styles.emptyBox}>No equipment currently in the shop</div>
        ) : (
          <div className="table-scroll">
            <table style={styles.table}>
              <thead>
                <tr>
                  {[["Equipment","28%"],["ID","12%"],["Category","60%"]].map(([h,w]) => (
                    <th key={h} style={{ ...styles.th, width: w }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inShopTools.map((t) => (
                  <tr key={t.id}>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageTitle:    { fontSize: 28, fontWeight: 900, color: "#1e7d3a", marginBottom: 24 },
  statsRow:     { display: "flex", gap: 16, marginBottom: 36, flexWrap: "wrap" },
  statCard:     { background: "#fff", borderRadius: 12, padding: "20px 24px", boxShadow: "0 1px 6px rgba(0,0,0,0.06)", border: "1px solid #e5e5e5", height: "100%" },
  statValue:    { fontSize: 40, fontWeight: 900, lineHeight: 1 },
  statLabel:    { fontSize: 13, color: "#888", marginTop: 6, fontWeight: 600 },

  // Collapsible section header button
  collapseBtn:  { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", padding: "4px 0", cursor: "pointer", textAlign: "left" as const },
  collapsTitle: { fontSize: 18, fontWeight: 800, color: "#111" },
  baseBadge:    { borderRadius: 6, padding: "2px 8px", fontSize: 13, fontWeight: 700 },
  sectionExportBtn: { background: "#f8f9fa", border: "1px solid #ddd", borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 600, color: "#555", cursor: "pointer", whiteSpace: "nowrap" },

  // Badge colours (reused as badgeStyle overrides)
  zeroCount:    { background: "#f0f0f0", color: "#aaa",    border: "1px solid #ddd" },
  inShopCount:  { background: "#fff8e1", color: "#7a4f00", border: "1px solid #f0c040" },
  neutralCount: { background: "#eef2f7", color: "#1e7d3a", border: "1px solid #c5d3e8" },
  overdueCount: { background: "#ffeaea", color: "#a80000", border: "1px solid #d32f2f" },
  damagedCount: { background: "#f3e5f5", color: "#6a0080", border: "1px solid #9c27b0" },
  bookingCount: { background: "#e0f0ff", color: "#005a8b", border: "1px solid #90c8f0" },

  emptyBox:     { background: "#edfaf1", border: "1px solid #34c759", borderRadius: 10, padding: "16px 20px", color: "#1a7a3c", fontWeight: 600 },
  table:        { width: "100%", borderCollapse: "collapse", tableLayout: "fixed", background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" },
  th:           { background: "#1a4a2e", padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#fff", borderBottom: "1px solid #0d2b19", textTransform: "uppercase", letterSpacing: 0.5 },
  td:           { padding: "12px 14px", borderBottom: "1px solid #f0f0f0", fontSize: 14 },
  trOverdue:    { backgroundColor: "#fff8f8" },
  trDamaged:    { backgroundColor: "#fdf6ff" },
  trBooking:    { backgroundColor: "#f0f7ff" },
  idLink:       { color: "#1e7d3a", fontWeight: 700, textDecoration: "none", fontSize: 13 },
};
