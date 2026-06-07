import * as S from "./pidStyles";
import { buildPIDETable, type PIDParams } from "../../utils/pidCalculations";

interface Props {
  loopTag: string;
  params: PIDParams;
  lambda: number;
  deadTime: number;
  timeConst: number;
  processGain: number;
  onBack: () => void;
  onNext: () => void;
  onPdf: () => void;
}

export default function PidParametersStep({ loopTag, params, lambda, deadTime, timeConst, processGain, onBack, onNext, onPdf }: Props) {
  const rows = buildPIDETable(loopTag, params, lambda, deadTime, timeConst, processGain);

  return (
    <div style={S.panel}>
      <div style={S.panelHeader}>
        <div style={S.panelIcon()}>5</div>
        <div>
          <div style={S.panelTitle}>Studio 5000 PID Parameters</div>
          <div style={S.panelDesc}>Exact values to enter in Logix Designer — with field paths</div>
        </div>
      </div>

      <div style={S.infoBoxSuccess}>
        <strong>Ready to enter these values.</strong> The table below shows the exact Studio 5000 PID field names and where to find them. All values are calculated from your process data and selected {"\u03bb"}.
      </div>

      <div style={S.sectionTitle}>PID Configuration Summary</div>
      <table style={S.resultsTable}>
        <thead>
          <tr>
            <th style={S.resultsTh}>PID Parameter</th>
            <th style={S.resultsTh}>Value to Enter</th>
            <th style={S.resultsTh}>Studio 5000 Location / Tag</th>
            <th style={S.resultsTh}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {params.kc ? rows.map((r, i) => (
            <tr key={i} style={i % 2 === 1 ? { background: "#fafafa" } : {}}>
              <td style={{ ...S.resultsTd, fontWeight: 600, color: "#0d2b19" }}>{r.param}</td>
              <td style={{ ...S.resultsTd, fontWeight: 700, color: "#1e7d3a", fontSize: "1rem" }}>{r.value}</td>
              <td style={S.resultsTd}>
                <code style={{ fontFamily: "'Consolas','Courier New',monospace", background: "#2c3e50", color: "#7fba00", padding: "3px 8px", borderRadius: 3, fontSize: "0.8rem" }}>
                  {r.tagPath}
                </code>
              </td>
              <td style={{ ...S.resultsTd, fontSize: "0.8rem", color: "#7f8c8d" }}>{r.notes}</td>
            </tr>
          )) : (
            <tr>
              <td colSpan={4} style={{ textAlign: "center", color: "#aaa", padding: 20 }}>
                {"\u2190"} Go back to Step 4 and complete the calculation first
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={S.separator} />
      <div style={S.sectionTitle}>How to Enter Parameters in Studio 5000</div>
      <ol style={{ listStyle: "none", padding: 0 }}>
        {INSTRUCTIONS.map((step, i) => (
          <li key={i} style={{ display: "flex", gap: 14, marginBottom: 14, alignItems: "flex-start" }}>
            <span style={stepNum}>{i + 1}</span>
            <span style={{ fontSize: "0.9rem", lineHeight: 1.6, paddingTop: 4 }} dangerouslySetInnerHTML={{ __html: step }} />
          </li>
        ))}
      </ol>

      <div style={S.separator} />
      <div style={S.sectionTitle}>Fine-Tuning Guide (After First Auto Run)</div>
      <table style={S.resultsTable}>
        <thead>
          <tr><th style={S.resultsTh}>What You See</th><th style={S.resultsTh}>What to Change</th><th style={S.resultsTh}>Direction</th></tr>
        </thead>
        <tbody>
          {FINE_TUNE.map((r, i) => (
            <tr key={i} style={i % 2 === 1 ? { background: "#fafafa" } : {}}>
              <td style={S.resultsTd}>{r[0]}</td>
              <td style={S.resultsTd}>{r[1]}</td>
              <td style={S.resultsTd}>{r[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={S.btnRow}>
        <button style={S.btnSecondary} onClick={onBack}>&larr; Back</button>
        <button style={S.btnSuccess} onClick={onNext}>Next: Notes & Log &rarr;</button>
        <button style={S.btnPdf} onClick={onPdf}>{"\u2b07"} Save PDF Report</button>
      </div>
    </div>
  );
}

const stepNum: React.CSSProperties = {
  minWidth: 28, height: 28, background: "#1a4a2e", color: "#fff", borderRadius: "50%",
  fontSize: "0.8rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
};

const INSTRUCTIONS = [
  "<strong>In Logix Designer</strong>, go to your ladder rung containing the PID instruction. Right-click the PID tag \u2192 <strong>Monitor Tag</strong>.",
  "<strong>Switch to Manual mode first</strong> \u2014 confirm <code>.ProgAuto</code> = 0 (Manual) before changing parameters.",
  "<strong>Enter the Gain parameters</strong>. In the PID Properties window, go to the <strong>Configuration</strong> tab. Set <strong>Kp</strong>, <strong>Ki</strong>, and <strong>Kd</strong>.",
  "<strong>Verify PV and SP scaling</strong>. Confirm <code>.PVEUMax</code> and <code>.PVEUMin</code> match your sensor range.",
  "<strong>Set Output limits</strong>. Set <code>.CVMaxClamp</code> = 100.0 and <code>.CVMinClamp</code> = 0.0.",
  "<strong>Set a setpoint ramp rate</strong> (optional). Use <code>.SPProgRatePos</code> to limit how fast the setpoint can change.",
  "<strong>Switch to Auto</strong> and monitor the response on a trend. Watch for no-overshoot response.",
];

const FINE_TUNE = [
  ["Overshoots setpoint", "Increase \u03bb \u2192 recalculate Kc", "Decrease Kp / Increase Ti"],
  ["Too slow to reach setpoint", "Decrease \u03bb (stay \u2265 \u03b8)", "Increase Kp / Decrease Ti"],
  ["Oscillates / hunts at setpoint", "Decrease Kp by 20\u201330%", "Lower Kp only"],
  ["Never quite reaches setpoint", "Decrease Ti slightly", "More integral action"],
  ["Noisy output / chatters", "Enable PV filter \u2014 set .PVFilterTi", "PV filter 0.1\u20130.5 min"],
];
