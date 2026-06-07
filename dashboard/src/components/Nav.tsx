import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { Link, useLocation } from "react-router-dom";
import { auth, db } from "../firebase";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { useRole, canApproveTimeOff } from "../hooks/useRole";

const BASE_LINKS = [
  { to: "/", label: "Dashboard" },
  { to: "/tools", label: "Equipment" },
  { to: "/vehicles", label: "Vehicles" },
  { to: "/bookings", label: "Bookings" },
  { to: "/contacts", label: "Contacts" },
  { to: "/on-call", label: "On-Call" },
];

const RESOURCE_ITEMS = [
  { to: "/pid-tuning", label: "PID Tuning" },
];

const ADMIN_ITEMS = [
  { to: "/categories",      label: "Categories" },
  { to: "/repair-contacts", label: "Manage Contacts" },
  { to: "/users",           label: "Users" },
];

export default function Nav() {
  const { pathname } = useLocation();
  const isAdmin = useIsAdmin();
  const role = useRole();
  const canApprove = canApproveTimeOff(role);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resourcesMenuOpen, setResourcesMenuOpen] = useState(false);
  const [timeOffMenuOpen, setTimeOffMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const resourcesRef = useRef<HTMLDivElement>(null);
  const timeOffRef = useRef<HTMLDivElement>(null);
  const [userName, setUserName] = useState("");
  const [pendingTimeOff, setPendingTimeOff] = useState(0);

  // Listen for pending time-off requests (for approvers)
  useEffect(() => {
    if (!canApprove) return;
    const unsub = onSnapshot(
      query(collection(db, "timeOffRequests"), where("status", "==", "PENDING")),
      (snap) => setPendingTimeOff(snap.size),
      () => setPendingTimeOff(0)
    );
    return unsub;
  }, [canApprove]);

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { setUserName(""); return; }
      try {
        const snap = await getDocs(query(collection(db, "users"), where("uid", "==", user.uid)));
        const name = snap.empty
          ? (user.displayName || user.email?.split("@")[0] || "")
          : (snap.docs[0].data().displayName || user.displayName || user.email?.split("@")[0] || "");
        setUserName(name);
      } catch {
        setUserName(user.displayName || user.email?.split("@")[0] || "");
      }
    });
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (resourcesRef.current && !resourcesRef.current.contains(e.target as Node)) {
        setResourcesMenuOpen(false);
      }
      if (timeOffRef.current && !timeOffRef.current.contains(e.target as Node)) {
        setTimeOffMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close dropdown and mobile menu on route change
  useEffect(() => { setMenuOpen(false); setResourcesMenuOpen(false); setTimeOffMenuOpen(false); setMobileMenuOpen(false); }, [pathname]);

  return (
    <>
    <nav className="no-print" style={styles.nav}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <img
          src="/skysuite_logo.png"
          alt="SkySuite Console"
          style={{ height: 78, objectFit: "contain", filter: "brightness(0) invert(1)" }}
          onError={(e) => { (e.target as HTMLImageElement).src = "/skysuite_logo_white.png"; }}
        />
        {userName && (
          <span className="nav-username" style={styles.userName}>{userName}</span>
        )}
      </div>

      {/* Hamburger button - visible only on mobile via CSS */}
      <button
        className="hamburger-btn"
        onClick={() => setMobileMenuOpen((v) => !v)}
        aria-label="Toggle menu"
      >
        {mobileMenuOpen ? "\u2715" : "\u2630"}
      </button>

      {/* Desktop nav links */}
      <div className="desktop-nav-links" style={styles.links}>
        {/* Base nav links */}
        {BASE_LINKS.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            style={{
              ...styles.link,
              ...(pathname === l.to ? styles.linkActive : {}),
            }}
          >
            {l.label}
          </Link>
        ))}

        {/* Time Off — direct link for users, dropdown for approvers */}
        {canApprove ? (
          <div ref={timeOffRef} style={{ position: "relative" }}>
            <button
              style={{ ...styles.adminBtn, position: "relative" as const, ...(pathname.startsWith("/time-off") ? styles.linkActive : {}) }}
              onClick={() => setTimeOffMenuOpen((v) => !v)}
            >
              Time Off
              {pendingTimeOff > 0 && <span style={styles.badge}>{pendingTimeOff}</span>}
            </button>
            {timeOffMenuOpen && (
              <div style={styles.dropdown}>
                <Link to="/time-off" style={{ ...styles.dropdownItem, ...(pathname === "/time-off" ? styles.dropdownItemActive : {}) }}>
                  My Requests
                </Link>
                <Link
                  to="/time-off/approvals"
                  style={{
                    ...styles.dropdownItem,
                    ...(pathname === "/time-off/approvals" ? styles.dropdownItemActive : {}),
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                  }}
                >
                  Approvals
                  {pendingTimeOff > 0 && <span style={styles.dropdownBadge}>{pendingTimeOff}</span>}
                </Link>
              </div>
            )}
          </div>
        ) : (
          <Link
            to="/time-off"
            style={{
              ...styles.link,
              ...(pathname === "/time-off" ? styles.linkActive : {}),
            }}
          >
            Time Off
          </Link>
        )}

        {/* Resources dropdown */}
        <div ref={resourcesRef} style={{ position: "relative" }}>
          <button
            style={{ ...styles.adminBtn, ...(RESOURCE_ITEMS.some(r => pathname === r.to) ? styles.linkActive : {}) }}
            onClick={() => setResourcesMenuOpen((v) => !v)}
          >
            Resources
          </button>
          {resourcesMenuOpen && (
            <div style={styles.dropdown}>
              {RESOURCE_ITEMS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  style={{
                    ...styles.dropdownItem,
                    ...(pathname === item.to ? styles.dropdownItemActive : {}),
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Admin dropdown */}
        {isAdmin && (
          <div ref={dropdownRef} style={{ position: "relative" }}>
            <button
              style={{ ...styles.adminBtn, ...(pathname === "/categories" || pathname === "/repair-contacts" || pathname === "/users" ? styles.linkActive : {}) }}
              onClick={() => setMenuOpen((v) => !v)}
            >
              Admin
            </button>

            {menuOpen && (
              <div style={styles.dropdown}>
                {ADMIN_ITEMS.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    style={{
                      ...styles.dropdownItem,
                      ...(pathname === item.to ? styles.dropdownItemActive : {}),
                    }}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        <button style={styles.logoutBtn} onClick={() => signOut(auth)}>
          Log Out
        </button>
      </div>
    </nav>

    {/* Mobile nav panel */}
    <div className={`mobile-nav-panel${mobileMenuOpen ? " open" : ""}`}>
      {BASE_LINKS.map((l) => (
        <Link key={l.to} to={l.to} className="mobile-nav-link">
          {l.label}
        </Link>
      ))}
      {canApprove ? (
        <>
          <Link to="/time-off" className="mobile-nav-link">My Requests</Link>
          <Link to="/time-off/approvals" className="mobile-nav-link" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            Approvals
            {pendingTimeOff > 0 && <span style={styles.dropdownBadge}>{pendingTimeOff}</span>}
          </Link>
        </>
      ) : (
        <Link to="/time-off" className="mobile-nav-link">Time Off</Link>
      )}
      {RESOURCE_ITEMS.map((item) => (
        <Link key={item.to} to={item.to} className="mobile-nav-link">
          {item.label}
        </Link>
      ))}
      {isAdmin && ADMIN_ITEMS.map((item) => (
        <Link key={item.to} to={item.to} className="mobile-nav-link">
          {item.label}
        </Link>
      ))}
      <button
        className="mobile-nav-link"
        style={{ background: "none", border: "none", textAlign: "left", cursor: "pointer", fontFamily: "inherit", width: "100%" }}
        onClick={() => signOut(auth)}
      >
        Log Out
      </button>
    </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    background: "linear-gradient(135deg, #0d2e5e, #1565c0)",
    color: "#fff",
    padding: "0 32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 96,
    position: "sticky",
    top: 0,
    zIndex: 100,
  },
  links: { display: "flex", alignItems: "center", gap: 8 },
  userName: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    fontWeight: 500,
    borderLeft: "1px solid rgba(255,255,255,0.2)",
    paddingLeft: 16,
  },
  link: {
    color: "rgba(255,255,255,0.75)",
    textDecoration: "none",
    padding: "6px 14px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
  },
  linkActive: {
    color: "#fff",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  dropdown: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    background: "#fff",
    borderRadius: 10,
    boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
    border: "1px solid #e5e5e5",
    minWidth: 150,
    overflow: "hidden",
    zIndex: 200,
  },
  dropdownItem: {
    display: "block",
    padding: "11px 18px",
    fontSize: 14,
    fontWeight: 600,
    color: "#111",
    textDecoration: "none",
    borderBottom: "1px solid #f0f0f0",
  },
  dropdownItemActive: {
    background: "#eff6ff",
    color: "#1565c0",
  },
  adminBtn: {
    color: "rgba(255,255,255,0.75)",
    padding: "6px 14px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    background: "transparent",
    backgroundColor: "transparent",
    border: "none",
    outline: "none",
    minHeight: 0,
    cursor: "pointer",
    appearance: "none" as const,
    WebkitAppearance: "none" as const,
    fontFamily: "inherit",
  },
  logoutBtn: {
    marginLeft: 8,
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.4)",
    color: "#fff",
    borderRadius: 8,
    padding: "6px 14px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  badge: {
    position: "absolute" as const,
    top: -4,
    right: -4,
    background: "#ef4444",
    color: "#fff",
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 4px",
    lineHeight: 1,
  },
  dropdownBadge: {
    background: "#ef4444",
    color: "#fff",
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 6px",
    lineHeight: 1,
  },
};
