type Status = "IN_SHOP" | "CHECKED_OUT" | "OVERDUE" | string;

export default function StatusBadge({ status }: { status: Status }) {
  const map: Record<string, React.CSSProperties> = {
    IN_SHOP: { background: "#edfaf1", border: "1px solid #34c759", color: "#1a7a3c" },
    CHECKED_OUT: { background: "#fff4e6", border: "1px solid #ff9500", color: "#b05a00" },
    OVERDUE:  { background: "#ffeaea", border: "1px solid #d32f2f", color: "#a80000" },
    DAMAGED:  { background: "#f3e5f5", border: "1px solid #9c27b0", color: "#6a0080" },
  };
  const style = map[status] ?? { background: "#f0f0f0", border: "1px solid #ccc", color: "#555" };
  const labelMap: Record<string, string> = {
    IN_SHOP: "In Shop",
    CHECKED_OUT: "Checked Out",
    OVERDUE: "Overdue",
    DAMAGED: "Damaged",
  };
  const label = labelMap[status] ?? status;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "4px 12px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "nowrap",
        minWidth: 100,
        textAlign: "center",
        ...style,
      }}
    >
      {label}
    </span>
  );
}
