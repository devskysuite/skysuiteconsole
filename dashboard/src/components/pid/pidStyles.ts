import type { CSSProperties } from "react";

export const panel: CSSProperties = {
  background: "#fff",
  borderRadius: 10,
  boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
  padding: "28px 32px",
  marginBottom: 20,
};

export const panelHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginBottom: 20,
  paddingBottom: 14,
  borderBottom: "2px solid #ecf0f1",
};

export const panelIcon = (color?: string): CSSProperties => ({
  width: 40,
  height: 40,
  borderRadius: 8,
  background: color || "#1e7d3a",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "1.2rem",
  fontWeight: 700,
  flexShrink: 0,
});

export const panelTitle: CSSProperties = {
  fontSize: "1.15rem",
  fontWeight: 700,
  color: "#0d2b19",
};

export const panelDesc: CSSProperties = {
  fontSize: "0.82rem",
  color: "#7f8c8d",
  marginTop: 2,
};

export const sectionTitle: CSSProperties = {
  fontSize: "0.78rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 1,
  color: "#c0392b",
  margin: "20px 0 10px",
};

export const formGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 16,
};

export const formGrid3: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: 16,
};

export const field: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
};

export const label: CSSProperties = {
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "#555",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

export const input: CSSProperties = {
  padding: "10px 12px",
  border: "1.5px solid #bdc3c7",
  borderRadius: 6,
  fontSize: "0.95rem",
  color: "#0d2b19",
  background: "#fafafa",
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};

export const inputHighlight: CSSProperties = {
  ...input,
  borderColor: "#e67e22",
  background: "#fffbf5",
};

export const inputResult: CSSProperties = {
  ...input,
  background: "#f0faf4",
  borderColor: "#1e7d3a",
  fontWeight: 700,
  color: "#1e7d3a",
  fontSize: "1.1rem",
};

export const inputResultGreen: CSSProperties = {
  ...input,
  background: "#f0fff4",
  borderColor: "#27ae60",
  fontWeight: 700,
  color: "#27ae60",
  fontSize: "1.1rem",
};

export const hint: CSSProperties = {
  fontSize: "0.75rem",
  color: "#95a5a6",
  fontStyle: "italic",
};

export const infoBox: CSSProperties = {
  background: "#eaf5ee",
  borderLeft: "4px solid #1e7d3a",
  borderRadius: "0 6px 6px 0",
  padding: "14px 16px",
  fontSize: "0.88rem",
  lineHeight: 1.6,
  marginBottom: 18,
  color: "#2c3e50",
};

export const infoBoxWarn: CSSProperties = {
  ...infoBox,
  background: "#fef9e7",
  borderLeftColor: "#e67e22",
};

export const infoBoxSuccess: CSSProperties = {
  ...infoBox,
  background: "#eafaf1",
  borderLeftColor: "#27ae60",
};

export const infoBoxDanger: CSSProperties = {
  ...infoBox,
  background: "#fdedec",
  borderLeftColor: "#c0392b",
};

export const separator: CSSProperties = {
  height: 1,
  background: "#ecf0f1",
  margin: "18px 0",
};

export const btnPrimary: CSSProperties = {
  padding: "11px 24px",
  border: "none",
  borderRadius: 6,
  fontSize: "0.9rem",
  fontWeight: 600,
  cursor: "pointer",
  background: "#1e7d3a",
  color: "#fff",
  fontFamily: "inherit",
};

export const btnSecondary: CSSProperties = {
  ...btnPrimary,
  background: "#1a4a2e",
};

export const btnSuccess: CSSProperties = {
  ...btnPrimary,
  background: "#27ae60",
};

export const btnPdf: CSSProperties = {
  ...btnPrimary,
  background: "#8e44ad",
};

export const btnRow: CSSProperties = {
  display: "flex",
  gap: 12,
  marginTop: 20,
  flexWrap: "wrap",
};

export const resultsTable: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  margin: "16px 0",
};

export const resultsTh: CSSProperties = {
  background: "#1a4a2e",
  color: "#fff",
  padding: "10px 14px",
  fontSize: "0.82rem",
  textAlign: "left",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

export const resultsTd: CSSProperties = {
  padding: "10px 14px",
  fontSize: "0.92rem",
  borderBottom: "1px solid #ecf0f1",
};
