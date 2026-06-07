/**
 * Category colour badge styles — matches the role-badge pattern from UsersPage.
 * Known categories get a hand-picked palette; unknown ones get a deterministic
 * colour from a fallback ring so every new category still looks good.
 */

type BadgeStyle = {
  backgroundColor: string;
  color: string;
  border: string;
};

const KNOWN: Record<string, BadgeStyle> = {
  "Aerial Lifts": { backgroundColor: "#e0f0ff", color: "#005a8b", border: "1px solid #90c8f055" },
  "Drills":       { backgroundColor: "#fff3e0", color: "#b05a00", border: "1px solid #ffb74d55" },
  "Ladders":      { backgroundColor: "#e8f5e9", color: "#1b5e20", border: "1px solid #66bb6a55" },
  "Job Boxes":    { backgroundColor: "#f3e5f5", color: "#6a1b9a", border: "1px solid #ab47bc55" },
  "Safety":       { backgroundColor: "#fce4ec", color: "#b71c1c", border: "1px solid #ef535055" },
  "Tuggers":      { backgroundColor: "#e0f2f1", color: "#00695c", border: "1px solid #4db6ac55" },
  "Hand Tools":   { backgroundColor: "#fff8e1", color: "#b45309", border: "1px solid #f59e0b55" },
  "Power Tools":  { backgroundColor: "#e8eaf6", color: "#283593", border: "1px solid #5c6bc055" },
};

/** Fallback ring for any categories added by the user that aren't in the map above. */
const FALLBACK: BadgeStyle[] = [
  { backgroundColor: "#fef3c7", color: "#92400e", border: "1px solid #fbbf2455" },
  { backgroundColor: "#dbeafe", color: "#1e40af", border: "1px solid #60a5fa55" },
  { backgroundColor: "#d1fae5", color: "#065f46", border: "1px solid #34d39955" },
  { backgroundColor: "#ede9fe", color: "#5b21b6", border: "1px solid #a78bfa55" },
  { backgroundColor: "#ffe4e6", color: "#9f1239", border: "1px solid #fb718555" },
  { backgroundColor: "#ccfbf1", color: "#134e4a", border: "1px solid #2dd4bf55" },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function getCategoryBadgeStyle(category: string): BadgeStyle {
  if (KNOWN[category]) return KNOWN[category];
  return FALLBACK[hash(category) % FALLBACK.length];
}

/** Shared base style — merge with the colour object above. */
export const categoryBadgeBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 6,
  padding: "4px 12px",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
  minWidth: 100,
  textAlign: "center",
};
