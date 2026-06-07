const STEPS = [
  "System Info",
  "Step Test Procedure",
  "Process Data",
  "Calculate Tuning",
  "PID Parameters",
  "Notes & Log",
];

interface Props {
  current: number;
  onStep: (n: number) => void;
  completed: Set<number>;
}

export default function PidStepNav({ current, onStep, completed }: Props) {
  return (
    <nav style={styles.nav}>
      {STEPS.map((label, i) => {
        const step = i + 1;
        const isActive = step === current;
        const isDone = completed.has(step);
        return (
          <button
            key={step}
            onClick={() => onStep(step)}
            style={{
              ...styles.btn,
              color: isActive ? "#fff" : isDone ? "#7fba00" : "#aaa",
              borderBottomColor: isActive ? "#27ae60" : "transparent",
            }}
          >
            <span
              style={{
                ...styles.num,
                background: isActive ? "#1e7d3a" : isDone ? "#27ae60" : "#555",
              }}
            >
              {isDone && !isActive ? "\u2713" : step}
            </span>
            {label}
          </button>
        );
      })}
    </nav>
  );
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    background: "#1a4a2e",
    padding: "0 32px",
    display: "flex",
    gap: 0,
    overflowX: "auto",
    width: "100vw",
    marginLeft: "calc(-50vw + 50%)",
    boxSizing: "border-box",
    justifyContent: "center",
  },
  btn: {
    padding: "14px 20px",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "0.82rem",
    fontWeight: 500,
    borderBottom: "3px solid transparent",
    whiteSpace: "nowrap",
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "inherit",
    transition: "all 0.2s",
  },
  num: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    color: "#fff",
    fontSize: "0.7rem",
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
};
