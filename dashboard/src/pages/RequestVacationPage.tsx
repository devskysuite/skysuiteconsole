import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { addDoc, collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useToast } from "../components/Toast";
import { auth, db } from "../firebase";

const callNotifyApprovers = httpsCallable(getFunctions(), "notifyApproversSms");

const lbl: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#555" };
const inp: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 8, padding: "9px 12px", fontSize: 14, width: "100%", boxSizing: "border-box" };
const btnS = (bg: string): React.CSSProperties => ({ background: bg, color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" });

export default function RequestVacationPage() {
  const { confirm } = useToast();

  const [currentUser, setCurrentUser] = useState<{ uid: string; email: string; displayName: string } | null>(null);
  const [myRequests, setMyRequests] = useState<any[]>([]);

  const [singleDay, setSingleDay] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { setCurrentUser(null); return; }
      try {
        const snap = await getDocs(query(collection(db, "users"), where("uid", "==", user.uid)));
        const data = snap.empty ? null : snap.docs[0].data();
        setCurrentUser({ uid: user.uid, email: user.email ?? "", displayName: data?.displayName ?? user.email ?? "" });
      } catch {
        setCurrentUser({ uid: user.uid, email: user.email ?? "", displayName: user.email ?? "" });
      }
    });
  }, []);

  useEffect(() => { if (currentUser) loadMyRequests(); }, [currentUser]);

  async function loadMyRequests() {
    if (!currentUser) return;
    const snap = await getDocs(query(collection(db, "timeOffRequests"), where("uid", "==", currentUser.uid)));
    const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const now = today;
    for (const r of results as any[]) {
      if (r.status === "PENDING" && r.startDate < now) {
        updateDoc(doc(db, "timeOffRequests", r.id), { status: "DENIED" }).catch(() => {});
        r.status = "DENIED";
      }
    }
    setMyRequests(results);
  }

  async function submitRequest() {
    setError(""); setSuccess("");
    const effectiveEnd = singleDay ? startDate : endDate;
    if (!startDate || (!singleDay && !endDate)) { setError(singleDay ? "Please select a date." : "Please select start and end dates."); return; }
    if (effectiveEnd < startDate) { setError("End date cannot be before start date."); return; }
    if (!currentUser) { setError("Not logged in."); return; }
    const overlap = (myRequests as any[]).find(r => r.status !== "DENIED" && startDate <= r.endDate && effectiveEnd >= r.startDate);
    if (overlap) { setError(`You already have a ${overlap.status.toLowerCase()} request for ${overlap.startDate} – ${overlap.endDate}.`); return; }
    const deniedOverlap = (myRequests as any[]).find(r => r.status === "DENIED" && startDate <= r.endDate && effectiveEnd >= r.startDate);
    if (deniedOverlap && !await confirm("This time was previously denied. Request anyway?")) return;
    setBusy(true);
    try {
      await addDoc(collection(db, "timeOffRequests"), {
        uid: currentUser.uid, employeeName: currentUser.displayName, employeeEmail: currentUser.email,
        startDate, endDate: effectiveEnd, reason: reason.trim(), status: "PENDING", createdAt: new Date(),
      });
      try {
        const nSnap = await getDoc(doc(db, "settings", "timeOffNotify"));
        const notify = nSnap.data() || {};
        if (notify.sms) {
          callNotifyApprovers({ employeeName: currentUser.displayName, startDate, endDate: effectiveEnd }).catch(() => {});
        }
        if (notify.email) {
          const idToken = await auth.currentUser?.getIdToken() ?? "";
          fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken, type: "time-off", payload: { employee_name: currentUser.displayName, employee_email: currentUser.email, start_date: startDate, end_date: effectiveEnd, reason: reason.trim() || "No reason provided" } }) }).catch(() => {});
        }
      } catch {}
      setSuccess("Vacation request submitted successfully.");
      setStartDate(""); setEndDate(""); setReason("");
      await loadMyRequests();
    } catch (e: any) { setError(e?.message ?? "Failed to submit."); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: "24px 0 32px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0d2e5e", margin: 0 }}>Request Vacation</h1>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: 28, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", maxWidth: 560 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: singleDay ? "#aaa" : "#333" }}>Multiple Days</span>
          <div
            onClick={() => { setSingleDay(!singleDay); setEndDate(""); }}
            style={{ width: 44, height: 24, borderRadius: 12, cursor: "pointer", backgroundColor: singleDay ? "#1565c0" : "#ccc", position: "relative", transition: "background-color 0.2s" }}
          >
            <div style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff", position: "absolute", top: 2, left: singleDay ? 22 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: singleDay ? "#333" : "#aaa" }}>Single Day</span>
        </div>

        <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 160 }}>
            <label style={lbl}>{singleDay ? "Date" : "Start Date"}</label>
            <input type="date" style={inp} min={today} value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          {!singleDay && (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 160 }}>
              <label style={lbl}>End Date</label>
              <input type="date" style={inp} min={startDate || today} value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginBottom: 16 }}>
          <label style={lbl}>Reason (optional)</label>
          <textarea style={{ ...inp, resize: "vertical", minHeight: 80, fontFamily: "inherit" }} value={reason} onChange={e => setReason(e.target.value)} placeholder="Any additional details…" />
        </div>

        {error   && <p style={{ color: "#cc0000", fontSize: 13, marginBottom: 12 }}>{error}</p>}
        {success && <p style={{ color: "#007700", fontSize: 13, marginBottom: 12 }}>{success}</p>}

        <button style={btnS("#1565c0")} onClick={submitRequest} disabled={busy}>
          {busy ? "Submitting…" : "Submit Request"}
        </button>
      </div>
    </div>
  );
}
