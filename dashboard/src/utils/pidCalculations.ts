export interface PIDParams {
  kc: number;
  ti: number;
  ki: number;
  td: number;
  kd: number;
}

/** IMC / Lambda tuning: Kc = τ / (Kp × (λ + θ)), Ti = τ, Ki = 1/Ti */
export function calcIMC(
  processGain: number,
  deadTime: number,
  timeConst: number,
  lambda: number
): PIDParams {
  if (!processGain || !timeConst || lambda + deadTime === 0) {
    return { kc: 0, ti: 0, ki: 0, td: 0, kd: 0 };
  }
  const kc = timeConst / (processGain * (lambda + deadTime));
  const ti = timeConst;
  const ki = ti > 0 ? 1 / ti : 0;
  return { kc, ti, ki, td: 0, kd: 0 };
}

/** Process gain from step test: Kp = ΔPV / ΔCO */
export function calcProcessGain(deltaPV: number, deltaCO: number): number {
  if (!deltaCO) return 0;
  return deltaPV / deltaCO;
}

/** τ/θ ratio — indicates control difficulty */
export function calcResponseRatio(timeConst: number, deadTime: number): number {
  if (!deadTime) return 0;
  return timeConst / deadTime;
}

export function getResponseRating(ratio: number): { label: string; color: string; description: string } {
  if (ratio > 5) return { label: "Easy to Control", color: "#27ae60", description: "Large τ/θ ratio — the process responds slowly relative to dead time. Standard IMC tuning will give excellent results." };
  if (ratio >= 2) return { label: "Moderate", color: "#e67e22", description: "Moderate τ/θ ratio — achievable with careful λ selection. Use λ ≥ 1.5× θ for safety." };
  return { label: "Challenging", color: "#c0392b", description: "Low τ/θ ratio — dead time dominates. Use λ ≥ 2× θ and expect slower response. Consider adding PV filtering." };
}

export function getOvershootRisk(lambda: number, deadTime: number): { label: string; color: string } {
  if (!deadTime || !lambda) return { label: "—", color: "#888" };
  const ratio = lambda / deadTime;
  if (ratio < 1) return { label: "HIGH — λ < θ, will overshoot", color: "#c0392b" };
  if (ratio < 1.5) return { label: "LOW — tight tuning", color: "#e67e22" };
  return { label: "NONE — conservative", color: "#27ae60" };
}

export interface PIDERow {
  param: string;
  value: string;
  tagPath: string;
  notes: string;
}

export function buildPIDETable(
  loopTag: string,
  params: PIDParams,
  lambda: number,
  deadTime: number,
  timeConst: number,
  processGain: number
): PIDERow[] {
  const tag = loopTag || "MyPID";
  const rows: PIDERow[] = [
    { param: "Proportional Gain (Kp)", value: params.kc.toFixed(4), tagPath: `${tag}.Kp`, notes: "Controller gain — from IMC calculation" },
    { param: "Integral Gain (Ki)", value: params.ki.toFixed(4), tagPath: `${tag}.Ki`, notes: "1/min — Ki = 1 / Ti" },
    { param: "Derivative Gain (Kd)", value: params.kd.toFixed(4), tagPath: `${tag}.Kd`, notes: "Usually 0 — add only if needed" },
    { param: "Derivative Time (Td)", value: params.td.toFixed(2), tagPath: `${tag}.Td`, notes: "Derivative time (minutes)" },
    { param: "CV High Clamp", value: "100.0", tagPath: `${tag}.CVHLimit`, notes: "Output upper limit (%)" },
    { param: "CV Low Clamp", value: "0.0", tagPath: `${tag}.CVLLimit`, notes: "Output lower limit (%)" },
    { param: "PV Filter Ti", value: "0.0", tagPath: `${tag}.PVFilt`, notes: "Set 0.1–0.5 min if PV is noisy" },
  ];
  return rows;
}

export function generateTextSummary(data: {
  loopTag: string; equipment: string; tunedBy: string; tuneDate: string;
  processType: string; pvDescription: string; actuator: string;
  deadTime: number; timeConst: number; processGain: number;
  lambda: number; params: PIDParams;
  overshot: string; riseTime: string; ssError: string; iterations: string;
  finalKp: string; finalKi: string; finalKd: string; finalLambda: string;
  fieldNotes: string;
}): string {
  const d = data;
  const p = d.params;
  const lines = [
    `PID TUNING RECORD`,
    `${"=".repeat(50)}`,
    `Loop Tag:      ${d.loopTag || "—"}`,
    `Equipment:     ${d.equipment || "—"}`,
    `Tuned By:      ${d.tunedBy || "—"}`,
    `Date:          ${d.tuneDate || "—"}`,
    `Process Type:  ${d.processType || "—"}`,
    `PV:            ${d.pvDescription || "—"}`,
    `Actuator:      ${d.actuator || "—"}`,
    ``,
    `STEP TEST DATA`,
    `${"-".repeat(50)}`,
    `Dead Time (theta):     ${d.deadTime || "—"} min`,
    `Time Constant (tau):   ${d.timeConst || "—"} min`,
    `Process Gain (Kp):     ${d.processGain || "—"}`,
    `tau/theta Ratio:       ${d.deadTime ? (d.timeConst / d.deadTime).toFixed(2) : "—"}`,
    ``,
    `IMC CALCULATION`,
    `${"-".repeat(50)}`,
    `Lambda:     ${d.lambda || "—"} min`,
    `Kc (Gain):  ${p.kc.toFixed(4)}`,
    `Ti (min):   ${p.ti.toFixed(2)}`,
    `Ki (1/min): ${p.ki.toFixed(4)}`,
    `Td:         ${p.td.toFixed(2)}`,
    ``,
    `FIELD RESULTS`,
    `${"-".repeat(50)}`,
    `Overshoot:     ${d.overshot || "—"}`,
    `Rise Time:     ${d.riseTime || "—"} min`,
    `SS Error:      ${d.ssError || "—"}`,
    `Iterations:    ${d.iterations || "—"}`,
    `Final Kp:      ${d.finalKp || "—"}`,
    `Final Ki:      ${d.finalKi || "—"}`,
    `Final Kd:      ${d.finalKd || "—"}`,
    `Final Lambda:  ${d.finalLambda || "—"}`,
    ``,
    `NOTES`,
    `${"-".repeat(50)}`,
    d.fieldNotes || "(none)",
  ];
  return lines.join("\n");
}
