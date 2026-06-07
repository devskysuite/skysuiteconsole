import * as S from "./pidStyles";

export interface PreTestData {
  coStart: string; coStep: string; pvStart: string; pvFinal: string;
}

interface Props {
  data: PreTestData;
  onChange: (patch: Partial<PreTestData>) => void;
  onBack: () => void;
  onNext: () => void;
}

export default function StepTestStep({ data, onChange, onBack, onNext }: Props) {
  const set = (key: keyof PreTestData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ [key]: e.target.value });

  return (
    <div style={S.panel}>
      <div style={S.panelHeader}>
        <div style={S.panelIcon()}>2</div>
        <div>
          <div style={S.panelTitle}>Open-Loop Step Test Procedure</div>
          <div style={S.panelDesc}>How to collect the process data you need to calculate tuning parameters</div>
        </div>
      </div>

      <div style={S.infoBox}>
        <strong>What is an open-loop step test?</strong> You manually set the controller output to a fixed value, let the process variable (PV) stabilise, then bump the output to a new fixed value and record how the PV responds. This tells you <em>how fast</em> the process moves, <em>how much</em> it moves, and <em>how long it delays</em> — the three numbers that drive every PID calculation.
      </div>

      <div style={S.infoBoxWarn}>
        <strong>Safety first:</strong> Put the PID in Manual mode before starting. Make sure the output cannot exceed safe limits for your equipment, process, or personnel during the test.
      </div>

      <div style={S.sectionTitle}>What You Need</div>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {[
          "Your controller software open with a trend window on the PV and CO (controller output)",
          "PID tag placed in Manual mode",
          "Process at a stable, representative starting condition",
          "A way to record time and PV (trend screenshot, data log, or paper)",
          "Patience — slow processes like temperature or level can take many minutes to settle",
        ].map((item, i) => (
          <li key={i} style={{ padding: "5px 0", fontSize: "0.88rem", display: "flex", alignItems: "flex-start", gap: 8 }}>
            <span style={{ color: "#27ae60", fontWeight: 700, flexShrink: 0 }}>{"\u2713"}</span>
            {item}
          </li>
        ))}
      </ul>

      <div style={S.separator} />
      <div style={S.sectionTitle}>Step-by-Step Procedure</div>
      <ol style={{ listStyle: "none", padding: 0, counterReset: "step-counter" }}>
        {PROCEDURE_STEPS.map((step, i) => (
          <li key={i} style={{ display: "flex", gap: 14, marginBottom: 14, alignItems: "flex-start" }}>
            <span style={styles.stepNum}>{i + 1}</span>
            <span style={{ fontSize: "0.9rem", lineHeight: 1.6, paddingTop: 4 }} dangerouslySetInnerHTML={{ __html: step }} />
          </li>
        ))}
      </ol>

      <div style={S.separator} />
      <div style={S.sectionTitle}>How to Read Your Step Test Curve</div>

      {/* SVG Step Test Diagram */}
      <div style={{ background: "#0d2b19", borderRadius: 8, padding: "20px 16px 12px", margin: "16px 0" }}>
        <svg viewBox="0 0 760 260" xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", display: "block", fontFamily: "'Open Sans','Segoe UI',Arial,sans-serif" }}>
          <rect width="760" height="260" fill="#0d2b19" rx="6"/>
          <text x="10" y="130" fill="#7f8c8d" fontSize="12" textAnchor="middle" transform="rotate(-90,10,130)">PV (any units)</text>
          <text x="710" y="252" fill="#7f8c8d" fontSize="12">{"Time \u2192"}</text>
          <g stroke="#1a4a2e" strokeWidth="1">
            <line x1="55" y1="30" x2="730" y2="30"/><line x1="55" y1="80" x2="730" y2="80"/>
            <line x1="55" y1="130" x2="730" y2="130"/><line x1="55" y1="180" x2="730" y2="180"/>
            <line x1="145" y1="25" x2="145" y2="230"/><line x1="280" y1="25" x2="280" y2="230"/>
            <line x1="450" y1="25" x2="450" y2="230"/><line x1="610" y1="25" x2="610" y2="230"/>
          </g>
          <line x1="55" y1="25" x2="55" y2="230" stroke="#7f8c8d" strokeWidth="2"/>
          <line x1="55" y1="230" x2="740" y2="230" stroke="#7f8c8d" strokeWidth="2"/>
          {/* Output (CO) line */}
          <line x1="55" y1="185" x2="200" y2="185" stroke="#e67e22" strokeWidth="2" strokeDasharray="6,4"/>
          <line x1="200" y1="185" x2="200" y2="140" stroke="#e67e22" strokeWidth="2" strokeDasharray="6,4"/>
          <line x1="200" y1="140" x2="730" y2="140" stroke="#e67e22" strokeWidth="2" strokeDasharray="6,4"/>
          <text x="62" y="178" fill="#e67e22" fontSize="13" fontWeight="600">Output (CO)</text>
          <text x="210" y="133" fill="#e67e22" fontSize="12">{"\u2191 Step change"}</text>
          {/* PV Curve */}
          <path d="M 55,195 L 260,195 C 280,195 300,192 320,185 C 350,172 380,145 420,110 C 460,75 510,52 570,46 C 620,42 660,42 730,42" fill="none" stroke="#27ae60" strokeWidth="3" strokeLinecap="round"/>
          <text x="628" y="38" fill="#27ae60" fontSize="13" fontWeight="600">PV (any EU)</text>
          {/* Dead Time annotation */}
          <line x1="200" y1="215" x2="260" y2="215" stroke="#e74c3c" strokeWidth="2"/>
          <line x1="200" y1="210" x2="200" y2="220" stroke="#e74c3c" strokeWidth="2"/>
          <line x1="260" y1="210" x2="260" y2="220" stroke="#e74c3c" strokeWidth="2"/>
          <text x="215" y="228" fill="#e74c3c" fontSize="12" fontWeight="700">{"\u2460 \u03b8  Dead Time"}</text>
          {/* Time Constant annotation */}
          <line x1="260" y1="98" x2="415" y2="98" stroke="#2ecc71" strokeWidth="1.5" strokeDasharray="4,3"/>
          <line x1="415" y1="98" x2="415" y2="195" stroke="#2ecc71" strokeWidth="1.5" strokeDasharray="4,3"/>
          <line x1="260" y1="205" x2="415" y2="205" stroke="#2ecc71" strokeWidth="2"/>
          <line x1="260" y1="200" x2="260" y2="210" stroke="#2ecc71" strokeWidth="2"/>
          <line x1="415" y1="200" x2="415" y2="210" stroke="#2ecc71" strokeWidth="2"/>
          <text x="300" y="200" fill="#2ecc71" fontSize="11" fontWeight="700">{"\u2461 \u03c4 (to 63.2% of rise)"}</text>
          <circle cx="415" cy="98" r="5" fill="#2ecc71"/>
          <text x="422" y="95" fill="#2ecc71" fontSize="11">{"63.2% of \u0394PV"}</text>
          {/* Process Gain annotation */}
          <line x1="680" y1="42" x2="680" y2="195" stroke="#9b59b6" strokeWidth="2"/>
          <line x1="675" y1="42" x2="685" y2="42" stroke="#9b59b6" strokeWidth="2"/>
          <line x1="675" y1="195" x2="685" y2="195" stroke="#9b59b6" strokeWidth="2"/>
          <text x="688" y="90" fill="#9b59b6" fontSize="12" fontWeight="700">{"\u2462 \u0394PV"}</text>
          <text x="688" y="108" fill="#9b59b6" fontSize="11">{"(for Kp ="}</text>
          <text x="688" y="124" fill="#9b59b6" fontSize="11">{"\u0394PV \u00f7 \u0394CO)"}</text>
          <line x1="170" y1="140" x2="170" y2="185" stroke="#9b59b6" strokeWidth="1.5"/>
          <line x1="165" y1="140" x2="175" y2="140" stroke="#9b59b6" strokeWidth="1.5"/>
          <line x1="165" y1="185" x2="175" y2="185" stroke="#9b59b6" strokeWidth="1.5"/>
          <text x="118" y="167" fill="#9b59b6" fontSize="11" fontWeight="600">{"\u0394CO %"}</text>
          {/* Legend */}
          <rect x="56" y="30" width="140" height="58" fill="#091c10" rx="4" opacity="0.9"/>
          <line x1="64" y1="46" x2="82" y2="46" stroke="#27ae60" strokeWidth="3"/>
          <text x="87" y="50" fill="#27ae60" fontSize="11">PV (Process)</text>
          <line x1="64" y1="63" x2="82" y2="63" stroke="#e67e22" strokeWidth="2" strokeDasharray="5,3"/>
          <text x="87" y="67" fill="#e67e22" fontSize="11">Output (CO)</text>
          <rect x="63" y="74" width="10" height="10" fill="#2ecc71" rx="2"/>
          <text x="78" y="84" fill="#2ecc71" fontSize="10">63.2% point</text>
        </svg>
      </div>

      <div style={S.formGrid}>
        <div style={S.infoBox}><strong>{"\u2460 Dead Time (\u03b8)"}</strong><br/>The time from when you made the output step until the PV first starts to move.</div>
        <div style={S.infoBox}><strong>{"\u2461 Time Constant (\u03c4)"}</strong><br/>From the end of dead time, the time for the PV to reach 63.2% of its total change.</div>
        <div style={S.infoBox}><strong>{"\u2462 Process Gain (Kp)"}</strong><br/>Kp = (Change in PV) / (Change in Output %)</div>
        <div style={S.infoBox}><strong>Tangent Line Method:</strong><br/>Draw a straight line at the steepest point. Where it crosses the baseline = dead time end. Where it crosses the final value = dead time + time constant.</div>
      </div>

      <div style={S.separator} />
      <div style={S.sectionTitle}>Pre-Test Checklist</div>
      <div style={S.formGrid}>
        <Field label="Initial Output (CO Start) — %">
          <input style={S.input} type="number" value={data.coStart} onChange={set("coStart")} placeholder="e.g. 30" />
        </Field>
        <Field label="Step Output (CO After Step) — %">
          <input style={S.input} type="number" value={data.coStep} onChange={set("coStep")} placeholder="e.g. 45" />
        </Field>
        <Field label="Initial PV (at Start of Test)">
          <input style={S.input} type="number" value={data.pvStart} onChange={set("pvStart")} placeholder="e.g. 80" step="0.1" />
        </Field>
        <Field label="Final PV (at New Steady State)">
          <input style={S.input} type="number" value={data.pvFinal} onChange={set("pvFinal")} placeholder="e.g. 95" step="0.1" />
        </Field>
      </div>

      <div style={S.btnRow}>
        <button style={S.btnSecondary} onClick={onBack}>&larr; Back</button>
        <button style={S.btnPrimary} onClick={onNext}>Next: Enter Process Data &rarr;</button>
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

const styles: Record<string, React.CSSProperties> = {
  stepNum: {
    minWidth: 28, height: 28, background: "#1a4a2e", color: "#fff", borderRadius: "50%",
    fontSize: "0.8rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
};

const PROCEDURE_STEPS = [
  "<strong>Set PID to Manual.</strong> In Studio 5000, right-click your PID tag \u2192 Monitor. Set <code>.Oper</code> to 1 (Manual) or use your HMI manual button.",
  "<strong>Set a stable initial output.</strong> Set the manual output (CO) to a value that holds the PV steady near your normal operating range. Wait until the PV is completely flat.",
  "<strong>Start your trend recording.</strong> Open a trend with both your PV tag and CO tag. Set your timebase wide enough \u2014 at least 3\u00d7 how long you expect the process to settle.",
  "<strong>Make your step change.</strong> Bump the output up by 10\u201320% of full range. Note the exact time. Do NOT change it again.",
  "<strong>Wait for the new steady state.</strong> Watch the PV. Wait until it is completely flat again. Do not cut this short.",
  "<strong>Record the three key values</strong> from the trend: dead time (\u03b8), time constant (\u03c4), and process gain (Kp).",
];
