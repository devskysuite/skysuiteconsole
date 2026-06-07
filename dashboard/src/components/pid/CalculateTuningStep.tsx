import { useMemo } from "react";
import * as S from "./pidStyles";
import { calcIMC, getOvershootRisk, type PIDParams } from "../../utils/pidCalculations";

interface Props {
  deadTime: number;
  timeConst: number;
  processGain: number;
  processType: string;
  lambda: number;
  onLambdaChange: (v: number) => void;
  onBack: () => void;
  onNext: (params: PIDParams) => void;
}

export default function CalculateTuningStep({ deadTime, timeConst, processGain, processType, lambda, onLambdaChange, onBack, onNext }: Props) {
  const params = useMemo(() => calcIMC(processGain, deadTime, timeConst, lambda), [processGain, deadTime, timeConst, lambda]);
  const overshoot = useMemo(() => getOvershootRisk(lambda, deadTime), [lambda, deadTime]);
  const lambdaMultiple = deadTime ? (lambda / deadTime).toFixed(2) : "\u2014";
  const showWarning = deadTime > 0 && lambda < deadTime;

  const derivNote = getDerivativeNote(processType);

  return (
    <div style={S.panel}>
      <div style={S.panelHeader}>
        <div style={S.panelIcon("#27ae60")}>4</div>
        <div>
          <div style={S.panelTitle}>Tuning Method & Calculation</div>
          <div style={S.panelDesc}>IMC / Lambda tuning — optimised for fast response with no overshoot</div>
        </div>
      </div>

      <div style={S.infoBoxSuccess}>
        <strong>Why IMC (Lambda) Tuning?</strong> Lambda tuning works for virtually any self-regulating process. You set a single "closed-loop speed" parameter ({"\u03bb"}) and it automatically calculates P and I. Lower {"\u03bb"} = faster but more aggressive. Higher {"\u03bb"} = slower but very stable. For no overshoot: <strong>{"\u03bb"} must be {"\u2265"} {"\u03b8"} (dead time)</strong>.
      </div>

      <div style={S.sectionTitle}>Method Comparison <span style={{ background: "#d5f5e3", color: "#27ae60", padding: "2px 8px", borderRadius: 3, fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", marginLeft: 8 }}>IMC Recommended</span></div>
      <table style={S.resultsTable}>
        <thead>
          <tr><th style={S.resultsTh}>Method</th><th style={S.resultsTh}>Overshoot</th><th style={S.resultsTh}>Speed</th><th style={S.resultsTh}>Notes</th></tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...S.resultsTd, fontWeight: 600 }}>IMC / Lambda <span style={{ background: "#d5f5e3", color: "#27ae60", padding: "2px 8px", borderRadius: 3, fontSize: "0.72rem", fontWeight: 700, marginLeft: 4 }}>{"\u2713"} Selected</span></td>
            <td style={{ ...S.resultsTd, color: "#27ae60" }}>None (tunable)</td>
            <td style={S.resultsTd}>Fast to moderate</td>
            <td style={S.resultsTd}>Works for any process type — predictable, safe</td>
          </tr>
          <tr>
            <td style={{ ...S.resultsTd, fontWeight: 600 }}>Ziegler-Nichols</td>
            <td style={{ ...S.resultsTd, color: "#c0392b" }}>25-40% typical</td>
            <td style={S.resultsTd}>Very fast</td>
            <td style={S.resultsTd}>Not suitable — almost always overshoots</td>
          </tr>
          <tr>
            <td style={{ ...S.resultsTd, fontWeight: 600 }}>Cohen-Coon</td>
            <td style={{ ...S.resultsTd, color: "#e67e22" }}>10-20%</td>
            <td style={S.resultsTd}>Fast</td>
            <td style={S.resultsTd}>Moderate overshoot — not ideal here</td>
          </tr>
          <tr>
            <td style={{ ...S.resultsTd, fontWeight: 600 }}>Trial and Error</td>
            <td style={{ ...S.resultsTd, color: "#e67e22" }}>Varies</td>
            <td style={S.resultsTd}>Varies</td>
            <td style={S.resultsTd}>Unpredictable — use only as fine-tuning</td>
          </tr>
        </tbody>
      </table>

      <div style={S.separator} />
      <div style={S.sectionTitle}>{"\u03bb"} (Lambda) — Closed-Loop Time Constant</div>
      <div style={S.infoBox}>
        Drag the slider to set {"\u03bb"}. The minimum recommended value for no overshoot is equal to your dead time ({"\u03b8"}). A value of 1{"\u00d7"} - 2{"\u00d7"} {"\u03b8"} gives the fastest possible response without overshoot.
      </div>

      <div style={S.formGrid}>
        <Field label={"Dead Time \u03b8 (from Step 3)"}>
          <input style={S.inputResult} value={deadTime || ""} readOnly placeholder="\u2014" />
        </Field>
        <Field label={"\u03bb Minimum (= \u03b8, no overshoot boundary)"}>
          <input style={S.inputResult} value={deadTime || ""} readOnly placeholder="\u2014" />
        </Field>
      </div>

      <div style={{ ...S.sectionTitle, marginTop: 16 }}>Set Your {"\u03bb"} Value</div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "10px 0" }}>
        <span style={{ fontSize: "0.8rem", color: "#888", whiteSpace: "nowrap" }}>{"Faster \u2190"}</span>
        <input type="range" min="0.1" max="30" step="0.1" value={lambda}
          onChange={e => onLambdaChange(parseFloat(e.target.value))}
          style={{ flex: 1, height: 6, accentColor: "#c0392b" }} />
        <span style={{ fontSize: "0.8rem", color: "#888", whiteSpace: "nowrap" }}>{"\u2192 Slower"}</span>
        <div style={{ minWidth: 60, fontWeight: 700, fontSize: "1rem", color: "#c0392b", textAlign: "center" }}>{lambda.toFixed(1)} min</div>
      </div>

      <div style={S.formGrid3}>
        <Field label={"\u03bb (minutes)"} hint="Type directly or use slider">
          <input style={S.inputHighlight} type="number" value={lambda} onChange={e => onLambdaChange(parseFloat(e.target.value) || 0)} step="0.1" />
        </Field>
        <Field label={"\u03bb as Multiple of \u03b8"}>
          <input style={S.inputResult} value={lambdaMultiple} readOnly placeholder="\u2014" />
        </Field>
        <Field label="Overshoot Risk">
          <input style={{ ...S.inputResult, color: overshoot.color }} value={overshoot.label} readOnly placeholder="\u2014" />
        </Field>
      </div>

      {showWarning && (
        <div style={{ ...S.infoBoxWarn, marginTop: 12 }}>
          {"\u26a0"} <strong>Warning:</strong> Your {"\u03bb"} is less than {"\u03b8"}. This will likely cause overshoot. Increase {"\u03bb"} to at least the dead time value.
        </div>
      )}

      <div style={S.separator} />
      <div style={S.sectionTitle}>IMC Calculated Raw Parameters</div>
      <div style={S.formGrid3}>
        <Field label="Controller Gain — Kc" hint="Proportional gain">
          <input style={S.inputResultGreen} value={params.kc ? params.kc.toFixed(4) : ""} readOnly placeholder="\u2014" />
        </Field>
        <Field label="Integral Time — Ti (minutes)" hint={"= \u03c4 (time constant)"}>
          <input style={S.inputResultGreen} value={params.ti ? params.ti.toFixed(2) : ""} readOnly placeholder="\u2014" />
        </Field>
        <Field label="Derivative — Td" hint="Usually 0 — see note below">
          <input style={S.inputResultGreen} value="0" readOnly />
        </Field>
      </div>

      <div style={{ ...S.infoBox, marginTop: 12 }}>
        <strong>Note on Derivative (Td):</strong> {derivNote}
      </div>

      <div style={S.btnRow}>
        <button style={S.btnSecondary} onClick={onBack}>&larr; Back</button>
        <button style={S.btnPrimary} onClick={() => onNext(params)}>Next: PID Parameters &rarr;</button>
      </div>
    </div>
  );
}

function Field({ label: lbl, hint: h, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={S.field}>
      <label style={S.label}>{lbl}</label>
      {children}
      {h && <span style={S.hint}>{h}</span>}
    </div>
  );
}

function getDerivativeNote(processType: string): string {
  switch (processType) {
    case "temperature": return "Temperature loops: Start with Td = 0. Temperature sensors are often noisy — adding derivative will amplify noise. Only consider Td after P+I alone, and always enable PV filtering first.";
    case "flow": return "Flow loops: Fast-responding — rarely needs derivative. Start with Td = 0.";
    case "pressure": return "Pressure loops: Usually fast enough with P+I only. Td = 0 recommended.";
    case "level": return "Level loops: Almost never needs derivative. Td = 0 recommended.";
    case "speed": return "Speed loops: VFD speed control may benefit from small Td if load disturbances are rapid, but start with 0.";
    case "position": return "Position loops: May benefit from derivative if mechanical delays are present. Consider small Td with PV filtering.";
    case "ph": return "pH loops: Highly nonlinear — derivative is not recommended. Use Td = 0 and consider gain scheduling.";
    default: return "For most processes, start with Td = 0. Only add derivative if P+I alone doesn't give adequate response, and always filter the PV first.";
  }
}
