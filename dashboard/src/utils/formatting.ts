import type React from "react";

/**
 * Format a Firestore timestamp to "March 21" style.
 * Used by DashboardPage, ToolsPage, and ToolDetailPage.
 */
export function fmtDateLong(ts: any): string {
  if (!ts?.toDate) return "\u2014";
  return ts.toDate().toLocaleDateString("en-US", { month: "long", day: "2-digit" });
}

/**
 * Format a Firestore timestamp to "March 21, 2026" style (with year).
 * Used by ToolDetailPage for full date display.
 */
export function fmtDateLongWithYear(ts: any): string {
  if (!ts?.toDate) return "\u2014";
  return ts.toDate().toLocaleDateString("en-US", { month: "long", day: "2-digit", year: "numeric" });
}

/**
 * Format a Firestore timestamp to "Mar 21, 2026" style (short month, with year).
 * Used by BookingsPage.
 */
export function fmtDateShort(ts: any): string {
  if (!ts?.toDate) return "\u2014";
  return ts.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Format an ISO date string ("2026-03-23") to "Mar 23, 2026" style.
 * Used by TimeOffPage and TimeOffApprovalsPage.
 */
export function fmtISODate(iso: string): string {
  if (!iso) return "\u2014";
  const [y, m, d] = iso.split("-");
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  return dt.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

/** Base badge styling for time-off status pills. */
const timeOffBadgeBase: React.CSSProperties = {
  borderRadius: 4,
  padding: "2px 8px",
  fontSize: 12,
  fontWeight: 700,
};

/**
 * Return inline styles for a time-off request status badge.
 * Used by TimeOffPage and TimeOffApprovalsPage.
 */
export function timeOffStatusBadge(status: string): React.CSSProperties {
  if (status === "APPROVED") return { ...timeOffBadgeBase, backgroundColor: "#f0fdf4", color: "#166534" };
  if (status === "DENIED") return { ...timeOffBadgeBase, backgroundColor: "#fef2f2", color: "#991b1b" };
  return { ...timeOffBadgeBase, backgroundColor: "#fefce8", color: "#854d0e" };
}

/** Return inline styles for an on-call swap request status badge. */
export function swapStatusBadge(status: string): React.CSSProperties {
  if (status === "ACCEPTED") return { ...timeOffBadgeBase, backgroundColor: "#f0fdf4", color: "#166534" };
  if (status === "DECLINED") return { ...timeOffBadgeBase, backgroundColor: "#fef2f2", color: "#991b1b" };
  return { ...timeOffBadgeBase, backgroundColor: "#fefce8", color: "#854d0e" };
}
