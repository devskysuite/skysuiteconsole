import { Link, useLocation } from "react-router-dom";

const TABS = [
  { to: "/tools",    label: "🔧 Equipment" },
  { to: "/vehicles", label: "🚗 Vehicles"  },
  { to: "/bookings", label: "📅 Bookings"  },
  { to: "/contacts", label: "👥 Contacts"  },
];

export default function ToolsTabs() {
  const { pathname } = useLocation();

  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "2px solid #e5e7eb" }}>
      {TABS.map(t => {
        const active = pathname === t.to || pathname.startsWith(t.to + "/");
        return (
          <Link
            key={t.to}
            to={t.to}
            style={{
              padding: "8px 20px",
              fontWeight: 600,
              fontSize: 14,
              textDecoration: "none",
              borderBottom: active ? "3px solid #1565c0" : "3px solid transparent",
              color: active ? "#1565c0" : "#6b7280",
              marginBottom: -2,
              whiteSpace: "nowrap",
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
