import * as S from "./pidStyles";

export interface SystemInfo {
  loopTag: string; equipment: string; tunedBy: string; tuneDate: string;
  processType: string; pvDescription: string; actuator: string;
  fluid: string; controllerPlatform: string; processNotes: string;
  pvLow: string; pvHigh: string; targetSP: string; engUnits: string;
  outputRange: string; outputType: string;
}

interface Props {
  data: SystemInfo;
  onChange: (patch: Partial<SystemInfo>) => void;
  onNext: () => void;
}

export default function SystemInfoStep({ data, onChange, onNext }: Props) {
  const set = (key: keyof SystemInfo) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ [key]: e.target.value });

  return (
    <div style={S.panel}>
      <div style={S.panelHeader}>
        <div style={S.panelIcon()}>1</div>
        <div>
          <div style={S.panelTitle}>System Information</div>
          <div style={S.panelDesc}>Record the basic details of your process and loop before starting</div>
        </div>
      </div>

      <div style={S.infoBox}>
        <strong>Before you begin:</strong> Fill in what you know. These fields don't affect the calculations — they create a permanent record so you can come back to this document later and know exactly what system and conditions this tune applies to.
      </div>

      <div style={S.sectionTitle}>Identification</div>
      <div style={S.formGrid}>
        <Field label="Loop Tag / PLC Tag Name" hint="As it appears in your Studio 5000 program">
          <input style={S.input} value={data.loopTag} onChange={set("loopTag")} placeholder="e.g. FC101_PID, TC202, PC_Zone3" />
        </Field>
        <Field label="Equipment / Area Description">
          <input style={S.input} value={data.equipment} onChange={set("equipment")} placeholder="e.g. Cooling Water Flow — Zone 3 Inlet" />
        </Field>
        <Field label="Tuned By">
          <input style={S.input} value={data.tunedBy} onChange={set("tunedBy")} placeholder="Your name" />
        </Field>
        <Field label="Date">
          <input style={S.input} type="date" value={data.tuneDate} onChange={set("tuneDate")} />
        </Field>
      </div>

      <div style={S.separator} />
      <div style={S.sectionTitle}>Process Description</div>
      <div style={S.formGrid3}>
        <Field label="Process Type" hint="What variable is this loop controlling?">
          <select style={S.input} value={data.processType} onChange={set("processType")}>
            <option value="">-- Select --</option>
            <option value="temperature">Temperature</option>
            <option value="flow">Flow</option>
            <option value="pressure">Pressure</option>
            <option value="level">Level</option>
            <option value="speed">Speed / RPM</option>
            <option value="position">Position</option>
            <option value="ph">pH / Conductivity</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Process Variable (PV) Description" hint="What is actually being measured?">
          <input style={S.input} value={data.pvDescription} onChange={set("pvDescription")} placeholder="e.g. Outlet water temperature" />
        </Field>
        <Field label="Actuator / Output Device" hint="What does the controller output drive?">
          <input style={S.input} value={data.actuator} onChange={set("actuator")} placeholder="e.g. VFD, control valve, heater SSR" />
        </Field>
        <Field label="Process Medium / Material">
          <input style={S.input} value={data.fluid} onChange={set("fluid")} placeholder="e.g. Water, natural gas, product X" />
        </Field>
        <Field label="Controller Platform">
          <select style={S.input} value={data.controllerPlatform} onChange={set("controllerPlatform")}>
            <option value="studio5000">Allen-Bradley Studio 5000 (PIDE)</option>
            <option value="rslogix500">Allen-Bradley RSLogix 500 (PID)</option>
            <option value="siemens">Siemens TIA Portal</option>
            <option value="standalone">Standalone Controller</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Process Notes" hint="Any known characteristics of this loop">
          <input style={S.input} value={data.processNotes} onChange={set("processNotes")} placeholder="e.g. Slow thermal, self-regulating" />
        </Field>
      </div>

      <div style={S.separator} />
      <div style={S.sectionTitle}>Control Range</div>
      <div style={S.formGrid3}>
        <Field label="PV Low Range" hint="Sensor / PID PV Min (in EU)">
          <input style={S.input} type="number" value={data.pvLow} onChange={set("pvLow")} placeholder="e.g. 0" />
        </Field>
        <Field label="PV High Range" hint="Sensor / PID PV Max (in EU)">
          <input style={S.input} type="number" value={data.pvHigh} onChange={set("pvHigh")} placeholder="e.g. 200" />
        </Field>
        <Field label="Target Setpoint" hint="Normal operating setpoint (in EU)">
          <input style={S.input} type="number" value={data.targetSP} onChange={set("targetSP")} placeholder="e.g. 120" />
        </Field>
        <Field label="Engineering Units (EU)" hint="Units for PV and SP values above">
          <input style={S.input} value={data.engUnits} onChange={set("engUnits")} placeholder="e.g. C, %, GPM, PSI, RPM" />
        </Field>
        <Field label="Output Range">
          <select style={S.input} value={data.outputRange} onChange={set("outputRange")}>
            <option value="">-- Select --</option>
            <option value="100">0-100% (PID default)</option>
            <option value="1">0-1 (Tieback scaling)</option>
            <option value="custom">Custom</option>
          </select>
        </Field>
        <Field label="PID Output Type">
          <select style={S.input} value={data.outputType} onChange={set("outputType")}>
            <option value="">-- Select --</option>
            <option>0-10V Analog</option>
            <option>4-20mA Analog</option>
            <option>PWM (Duty Cycle)</option>
            <option>On/Off Relay via PID</option>
            <option>Digital (VFD Speed Ref)</option>
          </select>
        </Field>
      </div>

      <div style={S.btnRow}>
        <button style={S.btnPrimary} onClick={onNext}>Next: Step Test Procedure &rarr;</button>
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
