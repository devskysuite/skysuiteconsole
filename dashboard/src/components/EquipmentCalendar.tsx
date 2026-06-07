import { useState, useMemo } from "react";

export type CalendarEvent = {
  id: string;
  toolName: string;
  type: "booking" | "checkout";
  employeeName: string;
  jobName: string;
  startDate: Date;
  endDate: Date;
  isOverdue?: boolean;
};

type Props = {
  events: CalendarEvent[];
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MAX_VISIBLE = 2;

/** Normalise a Date to midnight (local time) for date-only comparisons. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function EquipmentCalendar({ events }: Props) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  /* ---- calendar grid maths ---- */
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const lastOfMonth = new Date(viewYear, viewMonth + 1, 0);
  const startDow = firstOfMonth.getDay(); // 0=Sun
  const daysInMonth = lastOfMonth.getDate();

  // Build array of day-cells including padding from prev/next month
  const cells: Date[] = [];
  // Leading padding days (previous month)
  for (let i = startDow - 1; i >= 0; i--) {
    cells.push(new Date(viewYear, viewMonth, -i));
  }
  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(viewYear, viewMonth, d));
  }
  // Trailing padding to fill last row
  while (cells.length % 7 !== 0) {
    const next = cells.length - startDow - daysInMonth + 1;
    cells.push(new Date(viewYear, viewMonth + 1, next));
  }

  /* ---- event lookup by day ---- */
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const start = startOfDay(ev.startDate);
      const end = startOfDay(ev.endDate);
      // Walk each day the event spans
      const cur = new Date(start);
      while (cur <= end) {
        const key = `${cur.getFullYear()}-${cur.getMonth()}-${cur.getDate()}`;
        const arr = map.get(key) ?? [];
        arr.push(ev);
        map.set(key, arr);
        cur.setDate(cur.getDate() + 1);
      }
    }
    return map;
  }, [events]);

  function eventsForDay(d: Date): CalendarEvent[] {
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    return eventsByDay.get(key) ?? [];
  }

  /* ---- navigation helpers ---- */
  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
    setSelectedDay(null);
  }
  function goToday() {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setSelectedDay(null);
  }

  /* ---- event bar colour ---- */
  function barColor(ev: CalendarEvent): string {
    if (ev.isOverdue) return "#ef4444";
    if (ev.type === "booking") return "#f59e0b";
    return "#3b82f6";
  }

  /* ---- event type label ---- */
  function typeLabel(ev: CalendarEvent): string {
    if (ev.isOverdue) return "Overdue";
    if (ev.type === "booking") return "Booking";
    return "Checked Out";
  }

  /* ---- detail panel for selected day ---- */
  const selectedEvents = selectedDay ? eventsForDay(selectedDay) : [];

  /* ---- truncate tool name ---- */
  function truncate(name: string, max: number): string {
    return name.length > max ? name.slice(0, max) + "\u2026" : name;
  }

  const isCurrentMonth = (d: Date) =>
    d.getMonth() === viewMonth && d.getFullYear() === viewYear;

  return (
    <div>
      {/* ---- header / navigation ---- */}
      <div style={cs.navRow}>
        <button style={cs.navBtn} onClick={prevMonth}>&larr;</button>
        <button style={cs.todayBtn} onClick={goToday}>Today</button>
        <button style={cs.navBtn} onClick={nextMonth}>&rarr;</button>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <select
            value={viewMonth}
            onChange={(e) => { setViewMonth(Number(e.target.value)); setSelectedDay(null); }}
            style={cs.selectInput}
          >
            {MONTH_NAMES.map((m, i) => (
              <option key={i} value={i}>{m}</option>
            ))}
          </select>
          <select
            value={viewYear}
            onChange={(e) => { setViewYear(Number(e.target.value)); setSelectedDay(null); }}
            style={cs.selectInput}
          >
            {Array.from({ length: 7 }, (_, i) => today.getFullYear() - 1 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ---- legend ---- */}
      <div style={cs.legend}>
        <span style={cs.legendItem}>
          <span style={{ ...cs.legendDot, background: "#3b82f6" }} /> Checked Out
        </span>
        <span style={cs.legendItem}>
          <span style={{ ...cs.legendDot, background: "#f59e0b" }} /> Booking
        </span>
        <span style={cs.legendItem}>
          <span style={{ ...cs.legendDot, background: "#ef4444" }} /> Overdue
        </span>
      </div>

      {/* ---- day-of-week header ---- */}
      <div style={cs.grid}>
        {DAY_NAMES.map((dn) => (
          <div key={dn} style={cs.dowHeader}>{dn}</div>
        ))}

        {/* ---- day cells ---- */}
        {cells.map((day, i) => {
          const dayEvents = eventsForDay(day);
          const isCur = isCurrentMonth(day);
          const isToday = sameDay(day, today);
          const isSelected = selectedDay !== null && sameDay(day, selectedDay);
          const visible = dayEvents.slice(0, MAX_VISIBLE);
          const overflow = dayEvents.length - MAX_VISIBLE;

          return (
            <div
              key={i}
              style={{
                ...cs.cell,
                background: isSelected ? "#f0f7ff" : isCur ? "#fff" : "#fafafa",
                opacity: isCur ? 1 : 0.45,
                cursor: dayEvents.length > 0 ? "pointer" : "default",
              }}
              onClick={() => {
                if (dayEvents.length > 0) {
                  setSelectedDay(isSelected ? null : day);
                } else {
                  setSelectedDay(null);
                }
              }}
            >
              {/* day number */}
              <div
                style={{
                  ...cs.dayNum,
                  ...(isToday ? cs.todayRing : {}),
                }}
              >
                {day.getDate()}
              </div>

              {/* event bars */}
              {visible.map((ev) => (
                <div
                  key={ev.id}
                  style={{
                    ...cs.eventBar,
                    background: barColor(ev),
                  }}
                  title={`${ev.toolName} - ${ev.employeeName}`}
                >
                  {truncate(ev.toolName, 15)}
                </div>
              ))}
              {overflow > 0 && (
                <div style={cs.moreLink}>+{overflow} more</div>
              )}
            </div>
          );
        })}
      </div>

      {/* ---- detail panel ---- */}
      {selectedDay && selectedEvents.length > 0 && (
        <div style={cs.detailPanel}>
          <div style={cs.detailHeader}>
            {selectedDay.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
            <button
              style={cs.detailClose}
              onClick={() => setSelectedDay(null)}
            >
              Close
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {selectedEvents.map((ev) => (
              <div
                key={ev.id}
                style={{
                  ...cs.detailCard,
                  borderLeft: `4px solid ${barColor(ev)}`,
                }}
              >
                <div style={cs.detailToolName}>{ev.toolName}</div>
                <div style={cs.detailType}>{typeLabel(ev)}</div>
                <div style={cs.detailRow}>
                  <span style={cs.detailLabel}>Employee</span>
                  <span>{ev.employeeName}</span>
                </div>
                <div style={cs.detailRow}>
                  <span style={cs.detailLabel}>Job / Site</span>
                  <span>{ev.jobName}</span>
                </div>
                <div style={cs.detailRow}>
                  <span style={cs.detailLabel}>Dates</span>
                  <span>
                    {ev.startDate.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}{" "}
                    &rarr;{" "}
                    {ev.endDate.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- styles ---- */
const cs: Record<string, React.CSSProperties> = {
  navRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  navBtn: {
    background: "#1e7d3a",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "6px 14px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  },
  todayBtn: {
    background: "#f8f9fa",
    border: "1px solid #ddd",
    borderRadius: 6,
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: 600,
    color: "#1e7d3a",
    cursor: "pointer",
  },
  monthLabel: {
    fontSize: 18,
    fontWeight: 800,
    color: "#111",
    marginLeft: 8,
  },
  selectInput: {
    fontSize: 15,
    fontWeight: 700,
    color: "#111",
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
    background: "#fff",
    fontFamily: "inherit",
  },
  legend: {
    display: "flex",
    gap: 16,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    color: "#555",
  },
  legendDot: {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
  },
  dowHeader: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: 700,
    color: "#888",
    textTransform: "uppercase",
    padding: "6px 0",
    borderBottom: "1px solid #ddd",
  },
  cell: {
    minHeight: 80,
    border: "1px solid #eee",
    padding: 4,
    overflow: "hidden",
  },
  dayNum: {
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 2,
    width: 24,
    height: 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
  },
  todayRing: {
    border: "2px solid #3b82f6",
    color: "#3b82f6",
    fontWeight: 800,
  },
  eventBar: {
    fontSize: 11,
    padding: "2px 4px",
    borderRadius: 3,
    marginBottom: 1,
    color: "#fff",
    cursor: "pointer",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  moreLink: {
    fontSize: 10,
    color: "#1e7d3a",
    fontWeight: 600,
    cursor: "pointer",
    padding: "1px 4px",
  },
  /* detail panel */
  detailPanel: {
    marginTop: 16,
    border: "1px solid #e5e5e5",
    borderRadius: 12,
    padding: 20,
    backgroundColor: "#fff",
  },
  detailHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    fontSize: 16,
    fontWeight: 700,
    color: "#111",
  },
  detailClose: {
    background: "transparent",
    border: "1px solid #ccc",
    borderRadius: 6,
    padding: "4px 12px",
    fontSize: 12,
    color: "#555",
    cursor: "pointer",
  },
  detailCard: {
    padding: "10px 14px",
    borderRadius: 8,
    background: "#fafafa",
  },
  detailToolName: {
    fontSize: 15,
    fontWeight: 800,
    color: "#1e7d3a",
    marginBottom: 2,
  },
  detailType: {
    fontSize: 11,
    fontWeight: 700,
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  detailRow: {
    display: "grid",
    gridTemplateColumns: "90px 1fr",
    gap: "2px 12px",
    fontSize: 13,
    color: "#333",
  },
  detailLabel: {
    color: "#888",
    fontWeight: 600,
  },
};
