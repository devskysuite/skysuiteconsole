interface SpinnerProps {
  size?: number;
  color?: string;
}

export default function Spinner({ size = 24, color = "#1e7d3a" }: SpinnerProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        border: `3px solid ${color}22`,
        borderTop: `3px solid ${color}`,
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
        display: "inline-block",
      }}
    />
  );
}
