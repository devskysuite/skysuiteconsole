import { useRef, useState, useCallback, useEffect } from "react";
import * as S from "./pidStyles";
import { calcProcessGain, calcResponseRatio, getResponseRating } from "../../utils/pidCalculations";

export interface ProcessData {
  deadTime: string; timeConst: string; processGain: string;
  deltaCO: string; deltaPV: string; dataSource: string;
}

interface Props {
  data: ProcessData;
  preTest: { coStart: string; coStep: string; pvStart: string; pvFinal: string };
  onChange: (patch: Partial<ProcessData>) => void;
  onBack: () => void;
  onNext: () => void;
}

type MarkKey = "left" | "right" | "costep" | "pvmove" | "tau63";

const MODE_LABELS: Record<MarkKey, string> = {
  left: "Chart Left Edge", right: "Chart Right Edge",
  costep: "CO Step", pvmove: "PV Starts Moving", tau63: "63.2% Point",
};
const MODE_COLORS: Record<MarkKey, string> = {
  left: "#888", right: "#888", costep: "#e67e22", pvmove: "#58d68d", tau63: "#1e7d3a",
};

export default function ProcessDataStep({ data, preTest, onChange, onBack, onNext }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [marks, setMarks] = useState<Record<MarkKey, number | null>>({ left: null, right: null, costep: null, pvmove: null, tau63: null });
  const [mode, setMode] = useState<MarkKey | null>(null);
  const [mTimeSpan, setMTimeSpan] = useState("");
  const [mDeltaCO, setMDeltaCO] = useState("");
  const [mDeltaPV, setMDeltaPV] = useState("");
  const [measured, setMeasured] = useState<{ theta: string; tau: string; kp: string; status: string }>({ theta: "", tau: "", kp: "", status: "Mark all 4 points" });

  const set = (key: keyof ProcessData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ [key]: e.target.value });

  // Recalculate from marks
  const recalc = useCallback((m: typeof marks, ts: string, dc: string, dp: string) => {
    const timeSpan = parseFloat(ts);
    const dCO = parseFloat(dc);
    const dPV = parseFloat(dp);
    if (!m.left || !m.right || !timeSpan || m.left >= m.right) {
      setMeasured({ theta: "", tau: "", kp: "", status: "Mark edges + enter chart params" });
      return;
    }
    const pxPerMin = (m.right - m.left) / timeSpan;
    let theta = "", tau = "", kp = "";
    let status = "";
    if (m.costep !== null && m.pvmove !== null && pxPerMin > 0) {
      const thetaVal = (m.pvmove - m.costep) / pxPerMin;
      theta = thetaVal.toFixed(2);
      status += `\u03b8=${theta}min `;
    }
    if (m.pvmove !== null && m.tau63 !== null && pxPerMin > 0) {
      const tauVal = (m.tau63 - m.pvmove) / pxPerMin;
      tau = tauVal.toFixed(2);
      status += `\u03c4=${tau}min `;
    }
    if (dCO && dPV) {
      const kpVal = dPV / dCO;
      kp = kpVal.toFixed(3);
      status += `Kp=${kp}`;
    }
    const complete = theta && tau && kp;
    setMeasured({ theta, tau, kp, status: complete ? "Ready — click Apply" : status || "Mark more points" });
  }, []);

  // Redraw canvas with marks
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const drawVLine = (x: number | null, color: string, label: string) => {
      if (x === null) return;
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      ctx.font = "bold 11px sans-serif";
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = color;
      const lx = Math.min(x + 3, canvas.width - tw - 10);
      ctx.fillRect(lx, 6, tw + 8, 18);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, lx + 4, 19);
      ctx.restore();
    };

    drawVLine(marks.left, MODE_COLORS.left, "L");
    drawVLine(marks.right, MODE_COLORS.right, "R");
    drawVLine(marks.costep, MODE_COLORS.costep, "CO Step");
    drawVLine(marks.pvmove, MODE_COLORS.pvmove, "PV Moves");
    drawVLine(marks.tau63, MODE_COLORS.tau63, "63.2%");

    // Bracket for theta
    if (marks.costep !== null && marks.pvmove !== null) {
      const y = canvas.height - 22;
      ctx.strokeStyle = MODE_COLORS.costep; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(marks.costep, y); ctx.lineTo(marks.pvmove, y); ctx.stroke();
      ctx.font = "bold 11px sans-serif"; ctx.fillStyle = MODE_COLORS.costep;
      ctx.fillText("\u03b8", (marks.costep + marks.pvmove) / 2 - 3, y - 4);
    }
    // Bracket for tau
    if (marks.pvmove !== null && marks.tau63 !== null) {
      const y = canvas.height - 38;
      ctx.strokeStyle = "#2ecc71"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(marks.pvmove, y); ctx.lineTo(marks.tau63, y); ctx.stroke();
      ctx.font = "bold 11px sans-serif"; ctx.fillStyle = "#2ecc71";
      ctx.fillText("\u03c4", (marks.pvmove + marks.tau63) / 2 - 3, y - 4);
    }
  }, [img, marks]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const newImg = new Image();
      newImg.onload = () => {
        setImg(newImg);
        const canvas = canvasRef.current;
        if (canvas) { canvas.width = newImg.width; canvas.height = newImg.height; }
        setMarks({ left: null, right: null, costep: null, pvmove: null, tau63: null });
        setMode(null);
      };
      newImg.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!mode || !img) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const x = (e.clientX - rect.left) * scaleX;
    const newMarks = { ...marks, [mode]: x };
    setMarks(newMarks);
    recalc(newMarks, mTimeSpan, mDeltaCO, mDeltaPV);
  };

  const applyMeasured = () => {
    const patch: Partial<ProcessData> = {};
    if (measured.theta) patch.deadTime = measured.theta;
    if (measured.tau) patch.timeConst = measured.tau;
    if (measured.kp) patch.processGain = measured.kp;
    onChange(patch);
  };

  const autoFillGain = () => {
    const dco = parseFloat(data.deltaCO);
    const dpv = parseFloat(data.deltaPV);
    if (dco && dpv) {
      onChange({ processGain: (dpv / dco).toFixed(4) });
    }
  };

  const pullFromStep2 = () => {
    const coS = parseFloat(preTest.coStart);
    const coE = parseFloat(preTest.coStep);
    const pvS = parseFloat(preTest.pvStart);
    const pvF = parseFloat(preTest.pvFinal);
    const patch: Partial<ProcessData> = {};
    if (!isNaN(coS) && !isNaN(coE)) patch.deltaCO = (coE - coS).toString();
    if (!isNaN(pvS) && !isNaN(pvF)) patch.deltaPV = (pvF - pvS).toString();
    onChange(patch);
  };

  // Derived values
  const dt = parseFloat(data.deadTime);
  const tc = parseFloat(data.timeConst);
  const pg = parseFloat(data.processGain);
  const ratio = dt && tc ? calcResponseRatio(tc, dt) : 0;
  const rating = ratio ? getResponseRating(ratio) : null;
  const calcKp = parseFloat(data.deltaCO) && parseFloat(data.deltaPV)
    ? calcProcessGain(parseFloat(data.deltaPV), parseFloat(data.deltaCO)) : null;

  return (
    <div style={S.panel}>
      <div style={S.panelHeader}>
        <div style={S.panelIcon("#e67e22")}>3</div>
        <div>
          <div style={S.panelTitle}>Process Data — Measured Values</div>
          <div style={S.panelDesc}>Enter what you measured from your step test trend</div>
        </div>
      </div>

      {/* Click-to-Measure Panel */}
      <div style={aiPanelStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span style={{ background: "#1e7d3a", color: "#fff", fontSize: "0.72rem", fontWeight: 700, padding: "3px 10px", borderRadius: 12, textTransform: "uppercase", letterSpacing: 1 }}>
            {"\ud83d\udcd0"}
          </span>
          <div>
            <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "#fff" }}>Click-to-Measure Trend Analysis</div>
            <div style={{ fontSize: "0.82rem", color: "#7dc99a", marginTop: 2 }}>Upload your step test screenshot and click the chart to extract \u03b8, \u03c4, and Kp</div>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={aiLabel}>Trend Screenshot</label>
          <input type="file" accept="image/*" onChange={handleFileUpload}
            style={{ padding: "7px 10px", fontSize: "0.82rem", color: "#c0e8cc", cursor: "pointer", background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(39,174,96,0.5)", borderRadius: 6, width: "100%" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
          <AiField label="Chart Time Span (min)">
            <input style={aiInput} type="number" value={mTimeSpan} onChange={e => { setMTimeSpan(e.target.value); recalc(marks, e.target.value, mDeltaCO, mDeltaPV); }} placeholder="e.g. 20" step="0.1" />
          </AiField>
          <AiField label={"\u0394CO Step Size (%)"}>
            <input style={aiInput} type="number" value={mDeltaCO} onChange={e => { setMDeltaCO(e.target.value); recalc(marks, mTimeSpan, e.target.value, mDeltaPV); }} placeholder="e.g. 10" step="0.1" />
          </AiField>
          <AiField label={"\u0394PV Total Change (EU)"}>
            <input style={aiInput} type="number" value={mDeltaPV} onChange={e => { setMDeltaPV(e.target.value); recalc(marks, mTimeSpan, mDeltaCO, e.target.value); }} placeholder="e.g. 15" step="0.1" />
          </AiField>
        </div>

        {img && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              {(Object.keys(MODE_LABELS) as MarkKey[]).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  style={{ ...modeBtn, ...(mode === m ? modeBtnActive : {}) }}>
                  {MODE_LABELS[m]}
                </button>
              ))}
              <button style={{ ...modeBtn, background: "rgba(192,57,43,0.15)", borderColor: "rgba(192,57,43,0.4)", color: "#f1948a" }}
                onClick={() => { setMarks({ left: null, right: null, costep: null, pvmove: null, tau63: null }); setMode(null); setMeasured({ theta: "", tau: "", kp: "", status: "Mark all 4 points" }); }}>
                {"\u21ba Reset"}
              </button>
            </div>

            <div style={{ position: "relative", margin: "8px 0 14px", border: "1px solid rgba(39,174,96,0.4)", borderRadius: 6, overflow: "hidden", cursor: "crosshair" }}>
              <canvas ref={canvasRef} onClick={handleCanvasClick} style={{ display: "block", maxWidth: "100%", height: "auto" }} />
              <div style={{ position: "absolute", top: 6, right: 10, background: "rgba(0,0,0,0.7)", color: "#f0f0f0", fontSize: "0.75rem", padding: "3px 10px", borderRadius: 4, pointerEvents: "none" }}>
                {mode ? `Click to mark: ${MODE_LABELS[mode]}` : "Select a mode button, then click"}
              </div>
            </div>

            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: "#7dc99a", marginBottom: 8 }}>Measured Values</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
                <AiField label="Dead Time \u03b8 (min)"><input style={{ ...aiInput, fontWeight: 700 }} value={measured.theta} readOnly placeholder="\u2014" /></AiField>
                <AiField label="Time Constant \u03c4 (min)"><input style={{ ...aiInput, fontWeight: 700 }} value={measured.tau} readOnly placeholder="\u2014" /></AiField>
                <AiField label="Process Gain Kp"><input style={{ ...aiInput, fontWeight: 700 }} value={measured.kp} readOnly placeholder="\u2014" /></AiField>
                <AiField label="Status"><input style={{ ...aiInput, fontWeight: 600, fontSize: "0.82rem" }} value={measured.status} readOnly /></AiField>
              </div>
              {measured.theta && measured.tau && measured.kp && (
                <button style={{ ...S.btnSuccess, fontSize: "0.88rem", padding: "9px 20px", marginTop: 10 }} onClick={applyMeasured}>
                  {"\u2193 Apply These Values to Tuning Fields"}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0 14px" }}>
        <div style={{ flex: 1, height: 1, background: "#dde" }} />
        <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#aaa", letterSpacing: 1, textTransform: "uppercase" }}>Or Enter Values Manually</span>
        <div style={{ flex: 1, height: 1, background: "#dde" }} />
      </div>

      <div style={S.sectionTitle}>Step Test Results</div>
      <div style={S.formGrid3}>
        <Field label={"Dead Time \u2014 \u03b8 (minutes)"} hint="Time from output step until PV first moves">
          <input style={S.inputHighlight} type="number" value={data.deadTime} onChange={set("deadTime")} placeholder="e.g. 2.5" step="0.1" />
        </Field>
        <Field label={"Time Constant \u2014 \u03c4 (minutes)"} hint="Time to reach 63.2% of total PV change">
          <input style={S.inputHighlight} type="number" value={data.timeConst} onChange={set("timeConst")} placeholder="e.g. 12.0" step="0.1" />
        </Field>
        <Field label={"Process Gain \u2014 Kp (EU / % output)"} hint={"\u0394PV \u00f7 \u0394Output% \u2014 or use auto-fill below"}>
          <input style={S.inputHighlight} type="number" value={data.processGain} onChange={set("processGain")} placeholder="e.g. 1.5" step="0.01" />
        </Field>
      </div>

      <div style={S.separator} />
      <div style={S.sectionTitle}>Auto-Calculate Process Gain</div>
      <div style={S.infoBox}>
        If you filled in the Step 2 pre-test checklist, your process gain can be calculated automatically.
      </div>
      <div style={S.formGrid}>
        <Field label={"\u0394Output (CO Step \u2013 CO Start) \u2014 %"} hint="Difference in output % you applied">
          <input style={S.input} type="number" value={data.deltaCO} onChange={set("deltaCO")} placeholder="e.g. 15" step="0.1" />
        </Field>
        <Field label={"\u0394PV (Final PV \u2013 Initial PV)"} hint="Total PV change at new steady state (in EU)">
          <input style={S.input} type="number" value={data.deltaPV} onChange={set("deltaPV")} placeholder="e.g. 15" step="0.1" />
        </Field>
      </div>
      <div style={S.btnRow}>
        <button style={S.btnSecondary} onClick={autoFillGain}>Auto-Fill Process Gain from \u0394PV / \u0394CO</button>
        <button style={S.btnSecondary} onClick={pullFromStep2}>Pull Values from Step 2 Fields</button>
      </div>

      <div style={S.separator} />
      <div style={S.sectionTitle}>Estimated Gain Calculated</div>
      <div style={S.formGrid3}>
        <Field label="Calculated Kp">
          <input style={S.inputResult} value={calcKp !== null ? calcKp.toFixed(4) : ""} readOnly placeholder="\u2014" />
        </Field>
        <Field label={"Process Response Ratio (\u03c4/\u03b8)"} hint="> 5 = easy to control | < 2 = difficult">
          <input style={S.inputResult} value={ratio ? ratio.toFixed(2) : ""} readOnly placeholder="\u2014" />
        </Field>
        <Field label="Data Source">
          <select style={S.input} value={data.dataSource} onChange={set("dataSource")}>
            <option>Live step test — measured today</option>
            <option>Click-to-measure trend analysis</option>
            <option>Estimated from existing trend</option>
            <option>Previous tuning record</option>
            <option>Estimated / best guess</option>
          </select>
        </Field>
      </div>

      {rating && (
        <div style={{ ...S.infoBox, marginTop: 12, borderLeftColor: rating.color }}>
          <strong style={{ color: rating.color }}>{rating.label}</strong> — {rating.description}
        </div>
      )}

      <div style={S.btnRow}>
        <button style={S.btnSecondary} onClick={onBack}>&larr; Back</button>
        <button style={S.btnPrimary} onClick={onNext}>Next: Calculate Tuning &rarr;</button>
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

function AiField({ label: lbl, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={S.field}>
      <label style={aiLabel}>{lbl}</label>
      {children}
    </div>
  );
}

const aiPanelStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, #091c10 0%, #112a1c 100%)",
  border: "2px solid #27ae60",
  borderRadius: 10,
  padding: "22px 26px",
  marginBottom: 20,
};

const aiLabel: React.CSSProperties = {
  fontSize: "0.75rem", fontWeight: 700, color: "#7dc99a",
  textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 4,
};

const aiInput: React.CSSProperties = {
  width: "100%", padding: "9px 11px",
  background: "rgba(255,255,255,0.08)",
  border: "1.5px solid rgba(39,174,96,0.5)",
  borderRadius: 6, color: "#7fdbaa", fontSize: "1rem",
  fontWeight: 400, fontFamily: "'Open Sans', sans-serif",
  boxSizing: "border-box",
};

const modeBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(39,174,96,0.4)",
  color: "#c0e8cc", borderRadius: 6,
  padding: "7px 13px", fontSize: "0.82rem",
  fontWeight: 600, fontFamily: "inherit",
  cursor: "pointer",
};

const modeBtnActive: React.CSSProperties = {
  background: "#1e7d3a",
  borderColor: "#58d68d",
  color: "#fff",
  boxShadow: "0 0 0 2px rgba(88,214,141,0.4)",
};
