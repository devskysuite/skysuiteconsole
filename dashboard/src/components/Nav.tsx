import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { Link, useLocation } from "react-router-dom";
import { auth, db } from "../firebase";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { useRole, canApproveTimeOff } from "../hooks/useRole";

// ── Inline SVG icons ──────────────────────────────────────────────────────────
function IconTag() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
      <line x1="7" y1="7" x2="7.01" y2="7"/>
    </svg>
  );
}
function IconContacts() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  );
}
function IconUsers() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}
function IconPhone() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.16h3a2 2 0 0 1 2 1.72c.127.96.36 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.9a16 16 0 0 0 6.03 6.03l1.11-.78a2 2 0 0 1 2.11-.45c.907.34 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  );
}
function IconSliders() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4"  y1="21" x2="4"  y2="14"/>
      <line x1="4"  y1="10" x2="4"  y2="3"/>
      <line x1="12" y1="21" x2="12" y2="12"/>
      <line x1="12" y1="8"  x2="12" y2="3"/>
      <line x1="20" y1="21" x2="20" y2="16"/>
      <line x1="20" y1="12" x2="20" y2="3"/>
      <line x1="1"  y1="14" x2="7"  y2="14"/>
      <line x1="9"  y1="8"  x2="15" y2="8"/>
      <line x1="17" y1="16" x2="23" y2="16"/>
    </svg>
  );
}
function IconBuilding() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="2" width="18" height="20" rx="1"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="3" y1="15" x2="21" y2="15"/>
      <line x1="9" y1="9" x2="9" y2="22"/>
      <line x1="15" y1="9" x2="15" y2="22"/>
    </svg>
  );
}
function IconHome() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
      <polyline points="9 21 9 13 15 13 15 21"/>
    </svg>
  );
}

// ── Nav data ──────────────────────────────────────────────────────────────────
const BASE_LINKS = [
  { to: "/dashboard", label: "Tools" },
  { to: "/on-call",   label: "On-Call" },
  { to: "/dispatch",  label: "Dispatch" },
];

const DIRECTORY_ITEMS: { to: string; label: string; icon: React.ReactNode }[] = [
  { to: "/customers",  label: "Customers",  icon: <IconBuilding /> },
  { to: "/properties", label: "Properties", icon: <IconHome /> },
];

const RESOURCE_ITEMS: { to: string; label: string; icon: React.ReactNode }[] = [
  { to: "/pid-tuning", label: "PID Tuning", icon: <IconSliders /> },
];

const ADMIN_ITEMS: { to: string; label: string; icon: React.ReactNode }[] = [
  { to: "/categories",      label: "Categories",       icon: <IconTag /> },
  { to: "/repair-contacts", label: "Manage Contacts",  icon: <IconContacts /> },
  { to: "/users",           label: "Users",            icon: <IconUsers /> },
  { to: "/twilio",          label: "Twilio SMS",       icon: <IconPhone /> },
];

// Caret icon — rotates when open
function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)", marginLeft: 4 }}
    >
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}

export default function Nav() {
  const { pathname } = useLocation();
  const isAdmin = useIsAdmin();
  const role = useRole();
  const canApprove = canApproveTimeOff(role);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resourcesMenuOpen, setResourcesMenuOpen] = useState(false);
  const [directoryMenuOpen, setDirectoryMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef    = useRef<HTMLDivElement>(null);
  const resourcesRef   = useRef<HTMLDivElement>(null);
  const directoryRef   = useRef<HTMLDivElement>(null);
  const [userName, setUserName] = useState("");
  const [pendingTimeOff, setPendingTimeOff] = useState(0);

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

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (resourcesRef.current && !resourcesRef.current.contains(e.target as Node)) setResourcesMenuOpen(false);
      if (directoryRef.current && !directoryRef.current.contains(e.target as Node)) setDirectoryMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setResourcesMenuOpen(false);
    setDirectoryMenuOpen(false);
    setMobileMenuOpen(false);
  }, [pathname]);

  function doLogout() {
    Object.keys(localStorage).filter(k => k.startsWith("skysuite_2fa_")).forEach(k => localStorage.removeItem(k));
    signOut(auth);
  }

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
        {userName && <span className="nav-username" style={styles.userName}>{userName}</span>}
      </div>

      {/* Hamburger */}
      <button className="hamburger-btn" onClick={() => setMobileMenuOpen(v => !v)} aria-label="Toggle menu">
        {mobileMenuOpen ? "✕" : "☰"}
      </button>

      {/* Desktop links */}
      <div className="desktop-nav-links" style={styles.links}>
        {BASE_LINKS.map(l => (
          <Link key={l.to} to={l.to} style={{
            ...styles.link,
            ...(pathname === l.to || pathname.startsWith(l.to + "/") || (l.to === "/dashboard" && (pathname === "/tools" || pathname.startsWith("/tools/") || pathname === "/vehicles" || pathname.startsWith("/vehicles/") || pathname === "/bookings" || pathname === "/contacts")) ? styles.linkActive : {}),
          }}>
            {l.label}
          </Link>
        ))}

        {/* Vacation */}
        <Link to="/time-off" style={{ ...styles.link, ...(pathname.startsWith("/time-off") ? styles.linkActive : {}), position: "relative" as const }}>
          Vacation
          {pendingTimeOff > 0 && <span style={styles.badge}>{pendingTimeOff}</span>}
        </Link>

        {/* Directory dropdown */}
        <div ref={directoryRef} style={{ position: "relative" }}>
          <button
            style={{ ...styles.dropBtn, ...(DIRECTORY_ITEMS.some(i => pathname === i.to || pathname.startsWith(i.to + "/")) ? styles.linkActive : {}) }}
            onClick={() => setDirectoryMenuOpen(v => !v)}
          >
            Directory <Caret open={directoryMenuOpen} />
          </button>
          {directoryMenuOpen && (
            <div style={styles.dropdown}>
              <div style={styles.dropdownInner}>
                {DIRECTORY_ITEMS.map(item => (
                  <Link key={item.to} to={item.to} style={{ ...styles.dropdownItem, ...(pathname === item.to || pathname.startsWith(item.to + "/") ? styles.dropdownItemActive : {}) }}>
                    <span style={{ ...styles.itemIcon, color: pathname.startsWith(item.to) ? "#1565c0" : "#6b7280" }}>{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Resources dropdown */}
        <div ref={resourcesRef} style={{ position: "relative" }}>
          <button
            style={{ ...styles.dropBtn, ...(RESOURCE_ITEMS.some(r => pathname === r.to) ? styles.linkActive : {}) }}
            onClick={() => setResourcesMenuOpen(v => !v)}
          >
            Resources <Caret open={resourcesMenuOpen} />
          </button>
          {resourcesMenuOpen && (
            <div style={styles.dropdown}>
              <div style={styles.dropdownInner}>
                {RESOURCE_ITEMS.map(item => (
                  <Link key={item.to} to={item.to} style={{ ...styles.dropdownItem, ...(pathname === item.to ? styles.dropdownItemActive : {}) }}>
                    <span style={{ ...styles.itemIcon, color: pathname === item.to ? "#1565c0" : "#6b7280" }}>{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Admin dropdown */}
        {isAdmin && (
          <div ref={dropdownRef} style={{ position: "relative" }}>
            <button
              style={{ ...styles.dropBtn, ...(ADMIN_ITEMS.some(i => pathname === i.to) ? styles.linkActive : {}) }}
              onClick={() => setMenuOpen(v => !v)}
            >
              Admin <Caret open={menuOpen} />
            </button>
            {menuOpen && (
              <div style={styles.dropdown}>
                <div style={styles.dropdownInner}>
                  {ADMIN_ITEMS.map(item => (
                    <Link key={item.to} to={item.to} style={{ ...styles.dropdownItem, ...(pathname === item.to ? styles.dropdownItemActive : {}) }}>
                      <span style={{ ...styles.itemIcon, color: pathname === item.to ? "#1565c0" : "#6b7280" }}>{item.icon}</span>
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <button style={styles.logoutBtn} onClick={doLogout}>Log Out</button>
      </div>
    </nav>

    {/* Mobile panel */}
    <div className={`mobile-nav-panel${mobileMenuOpen ? " open" : ""}`}>
      {BASE_LINKS.map(l => <Link key={l.to} to={l.to} className="mobile-nav-link">{l.label}</Link>)}
      <Link to="/time-off" className="mobile-nav-link">Vacation</Link>
      {DIRECTORY_ITEMS.map(item => <Link key={item.to} to={item.to} className="mobile-nav-link">{item.label}</Link>)}
      {RESOURCE_ITEMS.map(item => <Link key={item.to} to={item.to} className="mobile-nav-link">{item.label}</Link>)}
      {isAdmin && ADMIN_ITEMS.map(item => <Link key={item.to} to={item.to} className="mobile-nav-link">{item.label}</Link>)}
      <button
        className="mobile-nav-link"
        style={{ background: "none", border: "none", textAlign: "left", cursor: "pointer", fontFamily: "inherit", width: "100%" }}
        onClick={doLogout}
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
  links: { display: "flex", alignItems: "center", gap: 4 },
  userName: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    fontWeight: 500,
    borderLeft: "1px solid rgba(255,255,255,0.2)",
    paddingLeft: 16,
  },
  link: {
    color: "rgba(255,255,255,0.80)",
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
  // Button that triggers a dropdown — same look as link but is a <button>
  dropBtn: {
    display: "inline-flex",
    alignItems: "center",
    color: "rgba(255,255,255,0.80)",
    padding: "6px 14px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    background: "transparent",
    backgroundColor: "transparent",
    border: "none",
    outline: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    appearance: "none" as const,
    WebkitAppearance: "none" as const,
    MozAppearance: "none" as const,
    boxShadow: "none",
  },
  dropdown: {
    position: "absolute",
    top: "calc(100% + 10px)",
    right: 0,
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 8px 28px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.06)",
    border: "1px solid #e8eaed",
    minWidth: 200,
    overflow: "hidden",
    zIndex: 200,
  },
  dropdownInner: {
    padding: "6px 0",
  },
  dropdownItem: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 500,
    color: "#1a1a2e",
    textDecoration: "none",
    transition: "background 0.12s",
  },
  dropdownItemActive: {
    background: "#eff6ff",
    color: "#1565c0",
    fontWeight: 600,
  },
  itemIcon: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
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
};
