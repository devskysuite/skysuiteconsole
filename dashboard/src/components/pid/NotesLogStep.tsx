import { useState } from "react";
import * as S from "./pidStyles";
import { generateTextSummary, type PIDParams } from "../../utils/pidCalculations";

export interface NotesData {
  overshot: string; riseTime: string; ssError: string; iterations: string;
  finalKp: string; finalKi: string; finalKd: string; finalLambda: string;
  finalRampRate: string; finalPVFilter: string; fieldNotes: string;
}

interface Props {
  data: NotesData;
  onChange: (patch: Partial<NotesData>) => void;
  systemInfo: { loopTag: string; equipment: string; tunedBy: string; tuneDate: string; processType: string; pvDescription: string; actuator: string };
  processData: { deadTime: number; timeConst: number; processGain: number };
  lambda: number;
  params: PIDParams;
  onBack: () => void;
  onPdf: () => void;
}

export default function NotesLogStep({ data, onChange, systemInfo, processData, lambda, params, onBack, onPdf }: Props) {
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [summaryText, setSummaryText] = useState("");

  const set = (key: keyof NotesData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ [key]: e.target.value });

  const genSummary = () => {
    const text = generateTextSummary({
      ...systemInfo,
      deadTime: processData.deadTime,
      timeConst: processData.timeConst,
      processGain: processData.processGain,
      lambda,
      params,
      overshot: data.overshot,
      riseTime: data.riseTime,
      ssError: data.ssError,
      iterations: data.iterations,
      finalKp: data.finalKp,
      finalKi: data.finalKi,
      finalKd: data.finalKd,
      finalLambda: data.finalLambda,
      fieldNotes: data.fieldNotes,
    });
    setSummaryText(text);
    setSummaryVisible(true);
  };

  return (
    <div style={S.panel}>
      <div style={S.panelHeader}>
        <div style={S.panelIcon()}>6</div>
        <div>
          <div style={S.panelTitle}>Tuning Notes & Field Log</div>
          <div style={S.panelDesc}>Record observations, iterations, and final accepted parameters</div>
        </div>
      </div>

      <div style={S.infoBox}>
        Use this section to document what happened after you put the loop in Auto — how it responded, any adjustments made, and the final accepted tune. This becomes your commissioning record.
      </div>

      <div style={S.sectionTitle}>Response Observations</div>
      <div style={S.formGrid}>
        <Field label="First Auto Run — Did it Overshoot?">
          <select style={S.input} value={data.overshot} onChange={set("overshot")}>
            <option value="">-- Select --</option>
            <option>No — reached SP cleanly</option>
            <option>{"Minor overshoot (< 1% of span)"}</option>
            <option>Moderate overshoot (1-5% of span)</option>
            <option>{"Significant overshoot (> 5% of span)"}</option>
          </select>
        </Field>
        <Field label="Rise Time — Time to Reach Setpoint (minutes)">
          <input style={S.input} type="number" value={data.riseTime} onChange={set("riseTime")} placeholder="e.g. 18" step="0.5" />
        </Field>
        <Field label="Steady-State Error at SP">
          <input style={S.input} value={data.ssError} onChange={set("ssError")} placeholder="e.g. \u00b10.5\u00b0C" />
        </Field>
        <Field label="Number of Tune Iterations">
          <input style={S.input} type="number" value={data.iterations} onChange={set("iterations")} placeholder="e.g. 2" min="1" />
        </Field>
      </div>

      <div style={S.separator} />
      <div style={S.sectionTitle}>Final Accepted Tuning Parameters</div>
      <div style={S.formGrid3}>
        <Field label="Final Kp (Controller Gain)">
          <input style={S.inputHighlight} type="number" value={data.finalKp} onChange={set("finalKp")} placeholder="\u2014" step="0.001" />
        </Field>
        <Field label="Final Ki (Integral Gain, 1/min)">
          <input style={S.inputHighlight} type="number" value={data.finalKi} onChange={set("finalKi")} placeholder="\u2014" step="0.001" />
        </Field>
        <Field label="Final Kd (Derivative Gain)">
          <input style={S.inputHighlight} type="number" value={data.finalKd} onChange={set("finalKd")} placeholder="\u2014" step="0.001" />
        </Field>
        <Field label={`Final \u03bb Used (minutes)`}>
          <input style={S.input} type="number" value={data.finalLambda} onChange={set("finalLambda")} placeholder="\u2014" step="0.1" />
        </Field>
        <Field label="SP Ramp Rate Used (EU/min)">
          <input style={S.input} type="number" value={data.finalRampRate} onChange={set("finalRampRate")} placeholder="e.g. 2.0" step="0.1" />
        </Field>
        <Field label="PV Filter Ti (if used)">
          <input style={S.input} type="number" value={data.finalPVFilter} onChange={set("finalPVFilter")} placeholder="0 = none" step="0.05" />
        </Field>
      </div>

      <div style={S.separator} />
      <div style={S.sectionTitle}>Additional Notes</div>
      <div style={S.field}>
        <label style={S.label}>Field Notes / Observations</label>
        <textarea
          style={{ padding: 10, border: "1.5px solid #bdc3c7", borderRadius: 6, fontSize: "0.9rem", fontFamily: "'Open Sans','Segoe UI',Arial,sans-serif", resize: "vertical", width: "100%", boxSizing: "border-box", minHeight: 100 }}
          value={data.fieldNotes}
          onChange={set("fieldNotes")}
          placeholder="e.g. Flow loop responds faster than expected — reduced lambda from 3.0 to 1.5 min. First run was clean with no overshoot."
          rows={5}
        />
      </div>

      <div style={S.separator} />
      <div style={S.sectionTitle}>Export / Save</div>
      <div style={S.infoBoxWarn}>
        <strong>This tool does not auto-save.</strong> Use the buttons below to save your data. Print to PDF to create a permanent record, or copy the summary to paste into a project document.
      </div>

      {summaryVisible && (
        <div style={S.infoBoxSuccess}>
          <strong>Summary ready — copy below:</strong>
          <pre style={{ fontSize: "0.8rem", marginTop: 8, whiteSpace: "pre-wrap", fontFamily: "'Consolas','Courier New',monospace" }}>{summaryText}</pre>
        </div>
      )}

      <div style={S.btnRow}>
        <button style={S.btnSecondary} onClick={onBack}>&larr; Back</button>
        <button style={S.btnSuccess} onClick={genSummary}>Generate Text Summary</button>
        <button style={S.btnPdf} onClick={onPdf}>{"\u2b07"} Save PDF Report</button>
      </div>
    </div>
  );
}

function Field({ label: lbl, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={S.field}>
      <label style={S.label}>{lbl}</label>
      {children}
    </div>
  );
}
