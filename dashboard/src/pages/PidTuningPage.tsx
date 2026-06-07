import { useState, useCallback, useRef } from "react";
import PidStepNav from "../components/pid/PidStepNav";
import SystemInfoStep, { type SystemInfo } from "../components/pid/SystemInfoStep";
import StepTestStep, { type PreTestData } from "../components/pid/StepTestStep";
import ProcessDataStep, { type ProcessData } from "../components/pid/ProcessDataStep";
import CalculateTuningStep from "../components/pid/CalculateTuningStep";
import PidParametersStep from "../components/pid/PidParametersStep";
import NotesLogStep, { type NotesData } from "../components/pid/NotesLogStep";
import { calcIMC, type PIDParams } from "../utils/pidCalculations";

const today = new Date().toISOString().split("T")[0];

export default function PidTuningPage() {
  const [step, setStep] = useState(1);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const contentRef = useRef<HTMLDivElement>(null);

  // Step 1
  const [systemInfo, setSystemInfo] = useState<SystemInfo>({
    loopTag: "", equipment: "", tunedBy: "", tuneDate: today,
    processType: "", pvDescription: "", actuator: "",
    fluid: "", controllerPlatform: "studio5000", processNotes: "",
    pvLow: "", pvHigh: "", targetSP: "", engUnits: "",
    outputRange: "", outputType: "",
  });

  // Step 2
  const [preTest, setPreTest] = useState<PreTestData>({
    coStart: "", coStep: "", pvStart: "", pvFinal: "",
  });

  // Step 3
  const [processData, setProcessData] = useState<ProcessData>({
    deadTime: "", timeConst: "", processGain: "",
    deltaCO: "", deltaPV: "", dataSource: "Live step test — measured today",
  });

  // Step 4
  const [lambda, setLambda] = useState(3);
  const [lastParams, setLastParams] = useState<PIDParams>({ kc: 0, ti: 0, ki: 0, td: 0, kd: 0 });

  // Step 6
  const [notes, setNotes] = useState<NotesData>({
    overshot: "", riseTime: "", ssError: "", iterations: "",
    finalKp: "", finalKi: "", finalKd: "", finalLambda: "",
    finalRampRate: "", finalPVFilter: "", fieldNotes: "",
  });

  const goStep = useCallback((n: number) => {
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const markDone = useCallback((n: number) => {
    setCompleted(prev => new Set(prev).add(n));
  }, []);

  const dt = parseFloat(processData.deadTime) || 0;
  const tc = parseFloat(processData.timeConst) || 0;
  const pg = parseFloat(processData.processGain) || 0;
  const currentParams = calcIMC(pg, dt, tc, lambda);

  const handleStep4Next = (params: PIDParams) => {
    setLastParams(params);
    // Auto-fill final params in step 6
    setNotes(prev => ({
      ...prev,
      finalKp: params.kc ? params.kc.toFixed(4) : prev.finalKp,
      finalKi: params.ki ? params.ki.toFixed(4) : prev.finalKi,
      finalKd: params.kd ? params.kd.toFixed(4) : prev.finalKd,
      finalLambda: lambda ? lambda.toString() : prev.finalLambda,
    }));
    markDone(4);
    goStep(5);
  };

  const generatePdf = async () => {
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const w = 210;
      let y = 20;

      const safe = (s: string) => s.replace(/θ/g, "theta").replace(/τ/g, "tau").replace(/λ/g, "lambda").replace(/Δ/g, "D");

      // Header
      doc.setFillColor(13, 43, 25);
      doc.rect(0, 0, w, 28, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.text("PID TUNING REPORT", 14, 12);
      doc.setFontSize(9);
      doc.text("RBT Electrical & Automation — IMC / Lambda Method", 14, 20);
      doc.text(systemInfo.tuneDate || today, w - 14, 12, { align: "right" });
      doc.text(systemInfo.loopTag || "No tag", w - 14, 20, { align: "right" });
      y = 36;

      const section = (title: string) => {
        if (y > 260) { doc.addPage(); y = 20; }
        doc.setFillColor(26, 74, 46);
        doc.rect(14, y, w - 28, 7, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.text(title, 16, y + 5);
        y += 12;
        doc.setTextColor(44, 62, 80);
      };

      const row = (label: string, val: string) => {
        if (y > 275) { doc.addPage(); y = 20; }
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.text(safe(label), 16, y);
        doc.setFont("helvetica", "bold");
        doc.text(safe(val || "—"), 90, y);
        doc.setFont("helvetica", "normal");
        y += 6;
      };

      // Identification
      section("IDENTIFICATION");
      row("Loop Tag:", systemInfo.loopTag);
      row("Equipment:", systemInfo.equipment);
      row("Tuned By:", systemInfo.tunedBy);
      row("Date:", systemInfo.tuneDate);
      row("Process Type:", systemInfo.processType);
      row("PV Description:", systemInfo.pvDescription);
      row("Actuator:", systemInfo.actuator);
      y += 4;

      // Step Test Data
      section("STEP TEST DATA");
      row("Dead Time (theta):", `${processData.deadTime || "—"} min`);
      row("Time Constant (tau):", `${processData.timeConst || "—"} min`);
      row("Process Gain (Kp):", processData.processGain || "—");
      row("tau/theta Ratio:", dt ? (tc / dt).toFixed(2) : "—");
      row("Data Source:", processData.dataSource);
      y += 4;

      // IMC Calculation
      section("IMC CALCULATION");
      row("Lambda:", `${lambda} min`);
      row("Controller Gain (Kc):", currentParams.kc.toFixed(4));
      row("Integral Time (Ti):", `${currentParams.ti.toFixed(2)} min`);
      row("Integral Gain (Ki):", `${currentParams.ki.toFixed(4)} 1/min`);
      row("Derivative (Td):", "0");
      y += 4;

      // Field Results
      section("FIELD RESULTS");
      row("Overshoot:", notes.overshot);
      row("Rise Time:", `${notes.riseTime || "—"} min`);
      row("Steady-State Error:", notes.ssError);
      row("Iterations:", notes.iterations);
      row("Final Kp:", notes.finalKp);
      row("Final Ki:", notes.finalKi);
      row("Final Kd:", notes.finalKd);
      row("Final Lambda:", `${notes.finalLambda || "—"} min`);
      y += 4;

      // Notes
      if (notes.fieldNotes) {
        section("FIELD NOTES");
        doc.setFontSize(9);
        const lines = doc.splitTextToSize(safe(notes.fieldNotes), w - 32);
        for (const line of lines) {
          if (y > 275) { doc.addPage(); y = 20; }
          doc.text(line, 16, y);
          y += 5;
        }
      }

      // Footer
      doc.setFillColor(13, 43, 25);
      doc.rect(0, 287, w, 10, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(7);
      doc.text("Generated by RBT Hub — Universal PID Tuning Tool", 14, 293);
      doc.text("IMC / Lambda Method", w - 14, 293, { align: "right" });

      const tag = systemInfo.loopTag || "PID";
      const date = (systemInfo.tuneDate || today).replace(/-/g, "");
      doc.save(`PID_Tune_${tag}_${date}.pdf`);
    } catch {
      alert("PDF generation failed. Please try again.");
    }
  };

  return (
    <div style={{ margin: "-24px -32px", minHeight: "calc(100vh - 96px)" }}>
      <PidStepNav current={step} onStep={goStep} completed={completed} />
      <div ref={contentRef} style={{ maxWidth: 900, margin: "30px auto", padding: "0 20px 60px" }}>
        {step === 1 && (
          <SystemInfoStep
            data={systemInfo}
            onChange={p => setSystemInfo(prev => ({ ...prev, ...p }))}
            onNext={() => { markDone(1); goStep(2); }}
          />
        )}
        {step === 2 && (
          <StepTestStep
            data={preTest}
            onChange={p => setPreTest(prev => ({ ...prev, ...p }))}
            onBack={() => goStep(1)}
            onNext={() => { markDone(2); goStep(3); }}
          />
        )}
        {step === 3 && (
          <ProcessDataStep
            data={processData}
            preTest={preTest}
            onChange={p => setProcessData(prev => ({ ...prev, ...p }))}
            onBack={() => goStep(2)}
            onNext={() => { markDone(3); goStep(4); }}
          />
        )}
        {step === 4 && (
          <CalculateTuningStep
            deadTime={dt}
            timeConst={tc}
            processGain={pg}
            processType={systemInfo.processType}
            lambda={lambda}
            onLambdaChange={setLambda}
            onBack={() => goStep(3)}
            onNext={handleStep4Next}
          />
        )}
        {step === 5 && (
          <PidParametersStep
            loopTag={systemInfo.loopTag}
            params={currentParams}
            lambda={lambda}
            deadTime={dt}
            timeConst={tc}
            processGain={pg}
            onBack={() => goStep(4)}
            onNext={() => { markDone(5); goStep(6); }}
            onPdf={generatePdf}
          />
        )}
        {step === 6 && (
          <NotesLogStep
            data={notes}
            onChange={p => setNotes(prev => ({ ...prev, ...p }))}
            systemInfo={systemInfo}
            processData={{ deadTime: dt, timeConst: tc, processGain: pg }}
            lambda={lambda}
            params={currentParams}
            onBack={() => goStep(5)}
            onPdf={generatePdf}
          />
        )}
      </div>
    </div>
  );
}
