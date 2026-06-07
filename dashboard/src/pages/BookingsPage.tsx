import { useEffect, useMemo, useState } from "react";
import { collection, collectionGroup, doc, getDoc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { Link } from "react-router-dom";
import { auth, db } from "../firebase";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { useToast } from "../components/Toast";
import Spinner from "../components/Spinner";
import EquipmentCalendar from "../components/EquipmentCalendar";
import { fmtDateShort } from "../utils/formatting";
import { downloadCSV } from "../utils/export";
import type { Booking, Tool, Vehicle } from "../types";
import type { CalendarEvent } from "../components/EquipmentCalendar";

export default function BookingsPage() {
  const isAdmin = useIsAdmin();
  const { toast, confirm } = useToast();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [checkedOutTools, setCheckedOutTools] = useState<Tool[]>([]);
  const [checkedOutVehicles, setCheckedOutVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserUid, setCurrentUserUid] = useState("");
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "calendar">("calendar");
  const [sourceFilter, setSourceFilter] = useState<"all" | "tool" | "vehicle">("all");
  const [itemFilter, setItemFilter] = useState("");

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      if (user) setCurrentUserUid(user.uid);
    });
  }, []);

  // Fetch bookings
  useEffect(() => {
    const q = query(collectionGroup(db, "bookings"));
    const unsub = onSnapshot(q, async (snap) => {
      try {
        const now = new Date();

        // Collect unique parent IDs, separated by collection
        const toolIds = new Set<string>();
        const vehicleIds = new Set<string>();
        snap.docs.forEach((d) => {
          const parentRef = d.ref.parent.parent;
          if (!parentRef) return;
          const collName = parentRef.path.split("/")[0];
          if (collName === "vehicles") vehicleIds.add(parentRef.id);
          else toolIds.add(parentRef.id);
        });

        const toolNames: Record<string, string> = {};
        const vehicleNames: Record<string, string> = {};
        await Promise.all([
          ...[...toolIds].map(async (id) => {
            const snap = await getDoc(doc(db, "tools", id));
            if (snap.exists()) toolNames[id] = snap.data().name || id;
          }),
          ...[...vehicleIds].map(async (id) => {
            const snap = await getDoc(doc(db, "vehicles", id));
            if (snap.exists()) vehicleNames[id] = snap.data().name || id;
          }),
        ]);

        setBookings(
          snap.docs
            .map((d) => {
              const data = d.data();
              const parentRef = d.ref.parent.parent;
              const parentPath = parentRef?.path ?? "";
              const collName = parentPath.split("/")[0];
              const parentId = parentRef?.id ?? "";
              const isVehicle = collName === "vehicles";
              const name = isVehicle
                ? (vehicleNames[parentId] || parentId)
                : (toolNames[parentId] || parentId);
              return { id: d.id, toolId: parentId, toolName: name, source: isVehicle ? "vehicle" as const : "tool" as const, ...data } as Booking;
            })
            .filter((b) => b.status === "UPCOMING" && b.endDate?.toDate?.() >= now)
            .sort((a, b) => (a.startDate?.toDate?.()?.getTime() ?? 0) - (b.startDate?.toDate?.()?.getTime() ?? 0))
        );
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  // Fetch checked-out tools for calendar view
  useEffect(() => {
    const q = query(collection(db, "tools"), where("status", "==", "CHECKED_OUT"));
    const unsub = onSnapshot(q, (snap) => {
      setCheckedOutTools(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as Tool))
      );
    });
    return unsub;
  }, []);

  // Fetch checked-out vehicles for calendar view
  useEffect(() => {
    const q = query(collection(db, "vehicles"), where("status", "==", "CHECKED_OUT"));
    const unsub = onSnapshot(q, (snap) => {
      setCheckedOutVehicles(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as Vehicle))
      );
    });
    return unsub;
  }, []);

  // Unique item names for the filter dropdown
  const itemNames = useMemo(() => {
    const sourceBookings = sourceFilter === "all" ? bookings : bookings.filter((b) => b.source === sourceFilter);
    const names = new Set(sourceBookings.map((b) => b.toolName || b.toolId));
    // Also add checked-out tool/vehicle names
    if (sourceFilter !== "vehicle") checkedOutTools.forEach((t) => names.add(t.name || t.id));
    if (sourceFilter !== "tool") checkedOutVehicles.forEach((v) => names.add(v.name || v.id));
    return [...names].sort();
  }, [bookings, checkedOutTools, checkedOutVehicles, sourceFilter]);

  // Filter bookings by source + item
  const filteredBookings = useMemo(() => {
    let result = bookings;
    if (sourceFilter !== "all") result = result.filter((b) => b.source === sourceFilter);
    if (itemFilter) result = result.filter((b) => (b.toolName || b.toolId) === itemFilter);
    return result;
  }, [bookings, sourceFilter, itemFilter]);

  // Build calendar events from bookings + checked-out tools/vehicles
  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const events: CalendarEvent[] = [];

    // Map bookings to calendar events
    for (const b of filteredBookings) {
      const start = b.startDate?.toDate?.();
      const end = b.endDate?.toDate?.();
      if (!start || !end) continue;
      events.push({
        id: `booking-${b.id}`,
        toolName: b.toolName || b.toolId,
        type: "booking",
        employeeName: b.employeeName || "",
        jobName: b.jobName || "",
        startDate: start,
        endDate: end,
      });
    }

    // Map checked-out tools to calendar events
    const now = new Date();
    if (sourceFilter !== "vehicle") {
      for (const t of checkedOutTools) {
        const name = t.name || t.id;
        if (itemFilter && name !== itemFilter) continue;
        const start = t.checkedOutAt?.toDate?.();
        if (!start) continue;
        const end = t.dueBackAt?.toDate?.() ?? now;
        const isOverdue = t.dueBackAt?.toDate?.() ? t.dueBackAt.toDate() < now : false;
        events.push({
          id: `checkout-${t.id}`,
          toolName: name,
          type: "checkout",
          employeeName: t.checkedOutToEmployeeName || "",
          jobName: t.checkedOutToJobName || "",
          startDate: start,
          endDate: end,
          isOverdue,
        });
      }
    }

    // Map checked-out vehicles to calendar events
    if (sourceFilter !== "tool") {
      for (const v of checkedOutVehicles) {
        const name = v.name || v.id;
        if (itemFilter && name !== itemFilter) continue;
        const start = v.checkedOutAt?.toDate?.();
        if (!start) continue;
        const end = v.dueBackAt?.toDate?.() ?? now;
        const isOverdue = v.dueBackAt?.toDate?.() ? v.dueBackAt.toDate() < now : false;
        events.push({
          id: `checkout-vehicle-${v.id}`,
          toolName: name,
          type: "checkout",
          employeeName: v.checkedOutToEmployeeName || "",
          jobName: v.checkedOutToJobName || "",
          startDate: start,
          endDate: end,
          isOverdue,
        });
      }
    }

    return events;
  }, [filteredBookings, checkedOutTools, checkedOutVehicles, sourceFilter, itemFilter]);

  async function cancelBooking(b: Booking) {
    if (!await confirm("Cancel this booking?")) return;
    setCancelling(b.id);
    try {
      const collPath = b.source === "vehicle" ? "vehicles" : "tools";
      await updateDoc(doc(db, collPath, b.toolId, "bookings", b.id), { status: "CANCELLED" });
    } catch (e: any) {
      toast(e?.message ?? "Failed to cancel booking", "error");
    } finally {
      setCancelling(null);
    }
  }

  function exportCSV() {
    const today = new Date().toISOString().slice(0, 10);
    const rows = filteredBookings.map((b) => ({
      Tool: b.toolName || b.toolId,
      Employee: b.employeeName || "",
      Job: b.jobName || "",
      "Start Date": fmtDateShort(b.startDate),
      "End Date": fmtDateShort(b.endDate),
    }));
    downloadCSV(rows, `bookings-${today}.csv`);
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: "#111", margin: 0 }}>
          Upcoming Bookings
          {filteredBookings.length > 0 && (
            <span style={s.countBadge}>{filteredBookings.length}</span>
          )}
        </h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {view === "list" && filteredBookings.length > 0 && (
            <button style={s.exportBtn} onClick={exportCSV}>Export CSV</button>
          )}
        </div>
      </div>

      {/* View toggle + source filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <button
          style={view === "list" ? s.filterActive : s.filterBtn}
          onClick={() => setView("list")}
        >
          List View
        </button>
        <button
          style={view === "calendar" ? s.filterActive : s.filterBtn}
          onClick={() => setView("calendar")}
        >
          Calendar View
        </button>
        <span style={{ width: 1, height: 24, background: "#ddd", margin: "0 4px" }} />
        <button
          style={sourceFilter === "all" ? s.filterActive : s.filterBtn}
          onClick={() => { setSourceFilter("all"); setItemFilter(""); }}
        >
          All
        </button>
        <button
          style={sourceFilter === "tool" ? s.filterActive : s.filterBtn}
          onClick={() => { setSourceFilter("tool"); setItemFilter(""); }}
        >
          Equipment
        </button>
        <button
          style={sourceFilter === "vehicle" ? s.filterActive : s.filterBtn}
          onClick={() => { setSourceFilter("vehicle"); setItemFilter(""); }}
        >
          Vehicles
        </button>
        <span style={{ width: 1, height: 24, background: "#ddd", margin: "0 4px" }} />
        <select
          value={itemFilter}
          onChange={(e) => setItemFilter(e.target.value)}
          style={{ border: "1px solid #ddd", borderRadius: 8, padding: "6px 12px", fontSize: 13, color: "#333", background: "#fff", cursor: "pointer", minWidth: 160 }}
        >
          <option value="">All Items</option>
          {itemNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>

      {view === "calendar" ? (
        <EquipmentCalendar events={calendarEvents} />
      ) : (
        <>
          {filteredBookings.length === 0 ? (
            <div style={s.emptyCard}>
              <p style={{ color: "#bbb", fontSize: 14 }}>
                {sourceFilter === "all" ? "No upcoming bookings." : `No upcoming ${sourceFilter === "tool" ? "equipment" : "vehicle"} bookings.`}
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {filteredBookings.map((b) => {
                const canCancel = isAdmin || b.createdByUid === currentUserUid;
                return (
                  <div key={b.id} style={s.card}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                      <div>
                        <Link to={b.source === "vehicle" ? `/vehicles/${b.toolId}` : `/tools/${b.toolId}`} style={s.toolLink}>{b.toolName}</Link>
                        <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>ID: {b.toolId}</div>
                        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "90px 1fr", gap: "6px 12px", fontSize: 14 }}>
                          <span style={s.infoLabel}>Employee</span><span>{b.employeeName}</span>
                          <span style={s.infoLabel}>Job / Site</span><span>{b.jobName}</span>
                          <span style={s.infoLabel}>Dates</span>
                          <span style={{ color: "#8b6800", fontWeight: 700 }}>
                            {fmtDateShort(b.startDate)} &rarr; {fmtDateShort(b.endDate)}
                          </span>
                        </div>
                      </div>
                      {canCancel && (
                        <button
                          style={s.cancelBtn}
                          onClick={() => cancelBooking(b)}
                          disabled={cancelling === b.id}
                        >
                          {cancelling === b.id ? "Cancelling\u2026" : "Cancel"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  countBadge:  { background: "#fffbea", color: "#8b6800", border: "1px solid #e6c800", borderRadius: 6, padding: "2px 10px", fontSize: 14, fontWeight: 700, marginLeft: 12 },
  card:        { background: "#fffbea", borderRadius: 12, padding: 20, boxShadow: "0 1px 6px rgba(0,0,0,0.06)", border: "1px solid #f0e088" },
  emptyCard:   { background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 6px rgba(0,0,0,0.06)", border: "1px solid #e5e5e5" },
  toolLink:    { fontSize: 17, fontWeight: 800, color: "#1e7d3a", textDecoration: "none" },
  infoLabel:   { color: "#888", fontWeight: 600 },
  cancelBtn:   { background: "none", border: "1px solid #ccc", borderRadius: 8, padding: "6px 14px", fontSize: 13, color: "#888", cursor: "pointer", whiteSpace: "nowrap" },
  exportBtn:   { background: "#f8f9fa", border: "1px solid #ddd", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, color: "#555", cursor: "pointer", whiteSpace: "nowrap" },
  filterBtn: {
    background: "transparent",
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "6px 16px",
    fontSize: 13,
    cursor: "pointer",
    color: "#555",
  },
  filterActive: {
    backgroundColor: "#1e7d3a",
    border: "1px solid #1e7d3a",
    borderRadius: 8,
    padding: "6px 16px",
    fontSize: 13,
    cursor: "pointer",
    color: "#fff",
    fontWeight: 600,
  },
};
