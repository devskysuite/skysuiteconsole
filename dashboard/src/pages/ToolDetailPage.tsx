// v2
import { useEffect, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs,
  onSnapshot, orderBy, query, serverTimestamp, Timestamp, updateDoc, where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate, useParams } from "react-router-dom";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import { auth, db, storage } from "../firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { useCategories } from "../hooks/useCategories";
import { useRepairContacts } from "../hooks/useRepairContacts";
import { calcRental } from "../hooks/useRentalRates";
import StatusBadge from "../components/StatusBadge";
import Spinner from "../components/Spinner";
import { useToast } from "../components/Toast";
import { fmtDateLong, fmtDateLongWithYear } from "../utils/formatting";
import type { Tool, HistoryEntry, Booking, MaintenanceEntry } from "../types";

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);


const REPAIR_STATUSES = [
  { value: "WAITING",        label: "Waiting for Repair", color: "#d97706", bg: "#fffbeb" },
  { value: "OUT_FOR_REPAIR", label: "Out for Repair",     color: "#2563eb", bg: "#eff6ff" },
  { value: "NOT_REPAIRABLE", label: "Not Repairable",     color: "#dc2626", bg: "#fef2f2" },
];

/** Job number must be at least ##-#### (2+ digits, dash, 4+ digits) */
const JOB_NUMBER_RE = /^\d{2,}-\d{4,}$/;

/** Count calendar or business days between two dates. Minimum 1 (same-day return = 1 day for billing). */
function countDays(start: Date, end: Date, excludeWeekends: boolean): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  if (!excludeWeekends) return Math.max(1, Math.round((end.getTime() - start.getTime()) / msPerDay));
  let count = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const finish = new Date(end);
  finish.setHours(0, 0, 0, 0);
  while (cur < finish) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, count);
}

function dueDateToTimestamp(dateStr: string) {
  const d = new Date(dateStr + "T17:00:00");
  return Timestamp.fromDate(d);
}

const ACTION_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  CHECKED_OUT: { label: "Checked Out", color: "#b05a00", bg: "#fff8f0" },
  RETURNED:    { label: "Returned",    color: "#1a7a3c", bg: "#edfaf1" },
  DAMAGED:     { label: "Damaged",     color: "#6a0080", bg: "#fdf6ff" },
  REPAIRED:    { label: "Repaired",    color: "#1e7d3a", bg: "#f0f4ff" },
};

const todayStr = new Date().toISOString().split("T")[0];
const tomorrowStr = (() => {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
})();

export default function ToolDetailPage() {
  const { toolId } = useParams<{ toolId: string }>();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const { toast, confirm } = useToast();
  const categories     = useCategories();
  const repairContacts = useRepairContacts();

  // Per-tool rental rate editing
  const [editingRates, setEditingRates] = useState(false);
  const [editDayRate,   setEditDayRate]   = useState("");
  const [editWeekRate,  setEditWeekRate]  = useState("");
  const [editMonthRate, setEditMonthRate] = useState("");

  const [tool, setTool] = useState<Tool | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Photo upload
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");

  // Current logged-in user
  const [currentUserName, setCurrentUserName] = useState("");
  const [currentUserUid, setCurrentUserUid] = useState("");
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [isOwner, setIsOwner] = useState(false);

  // Edit name
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");

  // Edit category (admin only)
  const [editingCategory, setEditingCategory] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");

  // Checkout fields
  const [employee, setEmployee] = useState("");
  const [job, setJob] = useState("");
  const [customer, setCustomer] = useState("");
  const [jobError, setJobError] = useState("");

  // Return confirmation
  const [showReturnConfirm, setShowReturnConfirm] = useState(false);
  const [returnExcludeWeekends, setReturnExcludeWeekends] = useState(false);
  const [dueDate, setDueDate] = useState("");

  // Extend
  const [extendDate, setExtendDate] = useState("");

  // Damage report
  const [showDamageForm, setShowDamageForm] = useState(false);
  const [damageNote, setDamageNote] = useState("");
  const [damageReporter, setDamageReporter] = useState("");
  const [damageRepairStatus, setDamageRepairStatus] = useState("WAITING");
  const [cardRepairStatus, setCardRepairStatus] = useState("WAITING");
  const [damagePhoto, setDamagePhoto] = useState<File | null>(null);
  const [damagePhotoUploading, setDamagePhotoUploading] = useState(false);

  // History
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState("");

  // Bookings
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [showBookForm, setShowBookForm] = useState(false);
  const [bookEmployee, setBookEmployee] = useState("");
  const [bookJob, setBookJob] = useState("");
  const [bookStartDate, setBookStartDate] = useState("");
  const [bookEndDate, setBookEndDate] = useState("");
  const [bookingError, setBookingError] = useState("");

  // Maintenance log
  const [maintenanceLogs, setMaintenanceLogs] = useState<MaintenanceEntry[]>([]);
  const [loadingMaintenance, setLoadingMaintenance] = useState(false);
  const [showMaintForm, setShowMaintForm] = useState(false);
  const [maintDate, setMaintDate] = useState(todayStr);
  const [maintDescription, setMaintDescription] = useState("");
  const [maintPerformedBy, setMaintPerformedBy] = useState("");
  const [maintCost, setMaintCost] = useState("");
  const [maintError, setMaintError] = useState("");

  // Annual inspection (Aerial Lifts)
  const [editingInspection, setEditingInspection] = useState(false);
  const [inspectionDate, setInspectionDate] = useState("");
  const [savingInspection, setSavingInspection] = useState(false);

  // Model / Serial # / Notes
  const [editingDetails, setEditingDetails] = useState(false);
  const [editModel, setEditModel] = useState("");
  const [editSerial, setEditSerial] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);

  // Admin user name list for dropdowns
  const [userNames, setUserNames] = useState<string[]>([]);

  // Look up current user's display name from Firestore
  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      setCurrentUserUid(user.uid);
      setCurrentUserEmail(user.email ?? "");
      try {
        const snap = await getDocs(query(collection(db, "users"), where("uid", "==", user.uid)));
        const data = snap.empty ? {} : snap.docs[0].data();
        const name = data.displayName || user.displayName || user.email?.split("@")[0] || "";
        setCurrentUserName(name);
        setBookEmployee(name);
        setIsOwner(data.role === "owner");
      } catch {
        const name = user.displayName || user.email?.split("@")[0] || "";
        setCurrentUserName(name);
        setBookEmployee(name);
        setIsOwner(false);
      }
    });
  }, []);

  // Once we know the user name AND admin status, pre-fill checkout + damage reporter
  useEffect(() => {
    if (currentUserName && isAdmin !== null) {
      setEmployee(currentUserName);
      setDamageReporter(currentUserName);
    }
  }, [currentUserName, isAdmin]);

  // Load all user display names for admin dropdowns
  useEffect(() => {
    if (!isAdmin) return;
    getDocs(collection(db, "users")).then((snap) => {
      const names = snap.docs
        .map((d) => d.data().displayName as string)
        .filter(Boolean)
        .sort();
      setUserNames(names);
    }).catch(() => {});
  }, [isAdmin]);

  // load() and loadBookings() are now handled by onSnapshot listeners in the useEffect below

  async function loadHistory() {
    if (!toolId) return;
    setLoadingHistory(true);
    try {
      const q = query(collection(db, "tools", toolId, "history"), orderBy("recordedAt", "desc"));
      const snap = await getDocs(q);
      setHistory(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as HistoryEntry))
          .filter((h) => h.action !== "BOOKED")
      );
    } catch { }
    finally { setLoadingHistory(false); }
  }

  function toggleHistory() {
    if (!showHistory && history.length === 0) loadHistory();
    setShowHistory((v) => !v);
  }

  async function loadMaintenanceLogs() {
    if (!toolId) return;
    setLoadingMaintenance(true);
    try {
      const q = query(collection(db, "tools", toolId, "maintenance"), orderBy("date", "desc"));
      const snap = await getDocs(q);
      setMaintenanceLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceEntry)));
    } catch { }
    finally { setLoadingMaintenance(false); }
  }

  async function addMaintenanceLog() {
    if (!toolId || !isAdmin) return;
    if (!maintDate || !maintDescription.trim() || !maintPerformedBy.trim()) {
      setMaintError("Please fill in date, description, and performed by.");
      return;
    }
    setMaintError("");
    setSaving(true);
    try {
      await addDoc(collection(db, "tools", toolId, "maintenance"), {
        date: maintDate,
        description: maintDescription.trim(),
        performedBy: maintPerformedBy.trim(),
        ...(maintCost !== "" ? { cost: parseFloat(maintCost) } : {}),
        createdAt: serverTimestamp(),
        createdByUid: currentUserUid,
      });
      setMaintDescription("");
      setMaintCost("");
      setMaintDate(todayStr);
      setShowMaintForm(false);
      await loadMaintenanceLogs();
    } catch (e: any) {
      setMaintError(e?.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteMaintenanceLog(entryId: string) {
    if (!toolId || !isAdmin) return;
    if (!await confirm("Delete this maintenance entry?")) return;
    try {
      await deleteDoc(doc(db, "tools", toolId, "maintenance", entryId));
      await loadMaintenanceLogs();
    } catch (e: any) {
      toast(`Error deleting entry: ${e?.message}`, "error");
    }
  }

  async function saveDetails() {
    if (!toolId) return;
    setSavingDetails(true);
    try {
      await updateDoc(doc(db, "tools", toolId), {
        model: editModel.trim(),
        serialNumber: editSerial.trim(),
        notes: editNotes.trim(),
      });
      setEditingDetails(false);
    } catch (e: any) {
      toast(`Error saving details: ${e?.message}`, "error");
    } finally {
      setSavingDetails(false);
    }
  }

  async function saveInspectionDate() {
    if (!toolId || !inspectionDate) return;
    setSavingInspection(true);
    try {
      await updateDoc(doc(db, "tools", toolId), { lastInspectionDate: inspectionDate });
      setEditingInspection(false);
    } catch (e: any) {
      toast(`Error saving inspection date: ${e?.message}`, "error");
    } finally {
      setSavingInspection(false);
    }
  }

  useEffect(() => {
    if (!toolId) return;

    // Live listener for tool document
    const unsubTool = onSnapshot(doc(db, "tools", toolId), (snap) => {
      if (!snap.exists()) { setTool(null); setLoading(false); return; }
      const data = snap.data() as Tool;
      setTool(data);
      setNewName(data.name ?? "");
      setSelectedCategory(data.category ?? "");
      setCardRepairStatus(data.repairStatus ?? "WAITING");
      setLoading(false);
    }, (err) => {
      setError(err?.message ?? "Failed to load tool");
      setLoading(false);
    });

    // Live listener for bookings subcollection
    const bookingsQuery = query(collection(db, "tools", toolId, "bookings"), orderBy("startDate", "asc"));
    const unsubBookings = onSnapshot(bookingsQuery, (snap) => {
      const now = new Date();
      setBookings(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Booking))
          .filter((b) => b.status === "UPCOMING" && b.endDate?.toDate?.() >= now)
      );
      setLoadingBookings(false);
    }, () => { setLoadingBookings(false); });

    // Maintenance logs stay as one-time load
    loadMaintenanceLogs();

    return () => { unsubTool(); unsubBookings(); };
  }, [toolId]);

  const status = tool?.status ?? "UNKNOWN";
  const isCheckedOut = status === "CHECKED_OUT";
  const isDamaged = status === "DAMAGED";
  const now = new Date();
  const isOverdue = isCheckedOut && tool?.dueBackAt?.toDate?.() < now;
  const displayStatus = isOverdue ? "OVERDUE" : status;

  async function saveName() {
    if (!toolId || !newName.trim()) return;
    setSaving(true);
    try { await updateDoc(doc(db, "tools", toolId), { name: newName.trim() }); setEditingName(false); }
    catch (e: any) { setError(e?.message); }
    finally { setSaving(false); }
  }

  async function saveCategory() {
    if (!toolId) return;
    setSaving(true);
    try { await updateDoc(doc(db, "tools", toolId), { category: selectedCategory }); setEditingCategory(false); }
    catch (e: any) { setError(e?.message); }
    finally { setSaving(false); }
  }

  async function checkout() {
    if (!toolId) return;
    if (!employee.trim() || !job.trim() || !dueDate) { setError("Fill in all checkout fields."); return; }
    if (!JOB_NUMBER_RE.test(job.trim())) {
      setJobError("Job number must be in ##-#### format (e.g. 25-1234).");
      return;
    }
    setJobError("");
    setSaving(true); setError("");
    try {
      await updateDoc(doc(db, "tools", toolId), {
        status: "CHECKED_OUT",
        checkedOutToEmployeeName: employee.trim(),
        checkedOutToJobName: job.trim(),
        checkedOutToCustomer: customer.trim(),
        checkedOutAt: serverTimestamp(),
        dueBackAt: dueDateToTimestamp(dueDate),
      });
      await addDoc(collection(db, "tools", toolId, "history"), {
        action: "CHECKED_OUT",
        employeeName: employee.trim(),
        jobName: job.trim(),
        customer: customer.trim(),
        dueBackAt: dueDateToTimestamp(dueDate),
        recordedAt: serverTimestamp(),
      });
      setHistory([]);
      setJob(""); setCustomer(""); setJobError("");
    } catch (e: any) { setError(e?.message); }
    finally { setSaving(false); }
  }

  async function returnTool(excludeWeekends: boolean) {
    if (!toolId) return;
    const empName    = tool?.checkedOutToEmployeeName ?? "";
    const jobName    = tool?.checkedOutToJobName ?? "";
    const custName   = tool?.checkedOutToCustomer ?? "";
    const checkedOut = tool?.checkedOutAt?.toDate?.() as Date | undefined;
    const days       = checkedOut ? countDays(checkedOut, new Date(), excludeWeekends) : undefined;
    setSaving(true); setError("");
    try {
      await updateDoc(doc(db, "tools", toolId), {
        status: "IN_SHOP",
        checkedOutToEmployeeName: "",
        checkedOutToJobName: "",
        checkedOutToCustomer: "",
        checkedOutAt: null,
        dueBackAt: null,
        overdueNotifiedAt: null,
      });
      await addDoc(collection(db, "tools", toolId, "history"), {
        action: "RETURNED",
        employeeName: empName,
        jobName: jobName,
        customer: custName,
        ...(days !== undefined ? { daysOnJob: days, excludedWeekends: excludeWeekends } : {}),
        recordedAt: serverTimestamp(),
      });
      setHistory([]);
      setShowReturnConfirm(false);
      setReturnExcludeWeekends(false);
    } catch (e: any) { setError(e?.message); }
    finally { setSaving(false); }
  }

  async function extendDueDate() {
    if (!toolId || !extendDate) { setError("Choose a new due date."); return; }
    setSaving(true); setError("");
    try {
      await updateDoc(doc(db, "tools", toolId), {
        dueBackAt: dueDateToTimestamp(extendDate),
        overdueNotifiedAt: null,
      });
      setExtendDate("");
    } catch (e: any) { setError(e?.message); }
    finally { setSaving(false); }
  }

  async function reportDamage() {
    if (!toolId || !damageNote.trim()) { setError("Please describe the damage."); return; }
    setSaving(true); setError("");
    try {
      let photoUrl = "";
      if (damagePhoto) {
        const photoRef = ref(storage, `tools/${toolId}/damage-photo`);
        await uploadBytes(photoRef, damagePhoto);
        photoUrl = await getDownloadURL(photoRef);
      }
      await updateDoc(doc(db, "tools", toolId), {
        status: "DAMAGED",
        damagedNote: damageNote.trim(),
        damagedReportedBy: damageReporter.trim(),
        damagedPhotoUrl: photoUrl,
        damagedReportedAt: serverTimestamp(),
        repairStatus: damageRepairStatus,
      });
      await addDoc(collection(db, "tools", toolId, "history"), {
        action: "DAMAGED",
        note: damageNote.trim(),
        reportedBy: damageReporter.trim(),
        recordedAt: serverTimestamp(),
      });
      setHistory([]);
      setShowDamageForm(false); setDamageNote(""); setDamageReporter(""); setDamageRepairStatus("WAITING"); setDamagePhoto(null);
    } catch (e: any) {
      setError(e?.message || e?.code || "Failed to save damage report.");
    } finally { setSaving(false); }
  }

  async function uploadDamagePhoto(file: File) {
    if (!toolId) return;
    setDamagePhotoUploading(true);
    try {
      const photoRef = ref(storage, `tools/${toolId}/damage-photo`);
      await uploadBytes(photoRef, file);
      const url = await getDownloadURL(photoRef);
      await updateDoc(doc(db, "tools", toolId), { damagedPhotoUrl: url });
    } catch (e: any) {
      setError(e?.message || "Failed to upload damage photo.");
    } finally { setDamagePhotoUploading(false); }
  }

  async function markRepaired() {
    if (!toolId || !await confirm("Mark this equipment as repaired and return it to the shop?")) return;
    setSaving(true); setError("");
    try {
      await updateDoc(doc(db, "tools", toolId), {
        status: "IN_SHOP",
        damagedNote: "", damagedReportedBy: "", damagedPhotoUrl: "", damagedReportedAt: null, repairStatus: "",
      });
      await addDoc(collection(db, "tools", toolId, "history"), {
        action: "REPAIRED",
        recordedAt: serverTimestamp(),
      });
      setHistory([]);
    } catch (e: any) { setError(e?.message); }
    finally { setSaving(false); }
  }

  async function updateRepairStatus(val: string) {
    if (!toolId) return;
    setCardRepairStatus(val);
    try { await updateDoc(doc(db, "tools", toolId), { repairStatus: val }); }
    catch (e: any) { setError(e?.message); }
  }

  async function saveToolRates() {
    if (!toolId || !isOwner) return;
    const d = parseFloat(editDayRate);
    const w = parseFloat(editWeekRate);
    const m = parseFloat(editMonthRate);
    if (isNaN(d) || isNaN(w) || isNaN(m) || d < 0 || w < 0 || m < 0) {
      setError("Please enter valid positive numbers for all rates.");
      return;
    }
    setSaving(true); setError("");
    try {
      await updateDoc(doc(db, "tools", toolId), { dayRate: d, weekRate: w, monthRate: m });
      setEditingRates(false);
    } catch (e: any) { setError(e?.message); }
    finally { setSaving(false); }
  }

  async function createBooking() {
    if (!toolId || !bookEmployee.trim() || !bookJob.trim() || !bookStartDate || !bookEndDate) {
      setBookingError("Fill in all booking fields."); return;
    }
    const start = new Date(bookStartDate + "T08:00:00");
    const end   = new Date(bookEndDate   + "T17:00:00");
    if (end <= start) { setBookingError("End date must be after start date."); return; }

    // Check for overlapping bookings (two ranges overlap if start1 < end2 AND end1 > start2)
    const conflict = bookings.find((b) => {
      const bStart = b.startDate?.toDate?.();
      const bEnd   = b.endDate?.toDate?.();
      if (!bStart || !bEnd) return false;
      return start < bEnd && end > bStart;
    });
    if (conflict) {
      setBookingError(
        `Already booked ${fmtDateLong(conflict.startDate)} → ${fmtDateLong(conflict.endDate)} ` +
        `(${conflict.employeeName} / ${conflict.jobName}). Choose different dates.`
      );
      return;
    }

    setSaving(true); setBookingError("");
    try {
      await addDoc(collection(db, "tools", toolId, "bookings"), {
        employeeName: bookEmployee.trim(),
        jobName: bookJob.trim(),
        startDate: Timestamp.fromDate(start),
        endDate:   Timestamp.fromDate(end),
        createdAt: serverTimestamp(),
        createdByUid: auth.currentUser?.uid ?? "",
        status: "UPCOMING",
      });
      setShowBookForm(false);
      setBookJob("");
      setBookStartDate("");
      setBookEndDate("");
      setBookingError("");
      setHistory([]);
    } catch (e: any) { setBookingError(e?.message); }
    finally { setSaving(false); }
  }

  async function cancelBooking(bookingId: string) {
    if (!toolId) return;
    try {
      await updateDoc(doc(db, "tools", toolId, "bookings", bookingId), { status: "CANCELLED" });
    } catch (e: any) { setError(e?.message); }
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !toolId) return;
    setPhotoError("");
    setPhotoUploading(true);
    try {
      const storageRef = ref(storage, `tools/${toolId}/photo`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, "tools", toolId), { photoURL: url });
      toast("Photo uploaded", "success");
    } catch (err: any) {
      const msg = err?.message ?? "Failed to upload photo.";
      setPhotoError(msg);
      toast(msg, "error");
    } finally {
      setPhotoUploading(false);
      e.target.value = "";
    }
  }

  async function handlePhotoDelete() {
    if (!toolId) return;
    if (!await confirm("Remove this tool photo?")) return;
    await updateDoc(doc(db, "tools", toolId), { photoURL: "" });
    setTool((prev) => prev ? { ...prev, photoURL: "" } : prev);
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>;
  if (!tool) return (
    <div>
      <p>Equipment not found.</p>
      <button style={s.btnOutline} onClick={() => navigate("/tools")}>← Back to Equipment</button>
    </div>
  );

  const qrValue = tool.toolId || toolId || "";
  const qrName  = tool.name || "Unnamed Equipment";

  async function printLabel() {
    const canvas = document.getElementById("qr-print-canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    const qrDataUrl = canvas.toDataURL("image/png");
    let logoDataUrl = "";
    try {
      const resp = await fetch("/rbt_logo.png");
      const blob = await resp.blob();
      logoDataUrl = await new Promise<string>((res) => {
        const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob);
      });
    } catch { }
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Print Label</title><style>
  @page { margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100vh; font-family: Arial, sans-serif; text-align: center; gap: 2vh; background: #fff; }
  img.logo { height: 9vh; object-fit: contain; max-width: 80vw; }
  img.qr   { width: min(62vh, 86vw); height: min(62vh, 86vw); display: block; }
  p.tool-id   { font-weight: 900; font-size: 5.5vh; color: #1e7d3a; letter-spacing: 2px; }
  p.tool-name { font-size: 3.5vh; color: #555; }
</style></head><body>
  ${logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="RBT" />` : ""}
  <img class="qr" src="${qrDataUrl}" alt="QR Code" />
  <p class="tool-id">${qrValue}</p>
  ${qrName ? `<p class="tool-name">${qrName}</p>` : ""}
  <script>
    window.addEventListener('load', function () {
      var imgs = Array.from(document.querySelectorAll('img'));
      var pending = imgs.filter(function(i){ return !i.complete; }).length;
      if (pending === 0) { setTimeout(function(){ window.print(); }, 150); return; }
      imgs.forEach(function(img){ img.addEventListener('load', check); img.addEventListener('error', check); });
      function check() { pending--; if (pending <= 0) setTimeout(function(){ window.print(); }, 150); }
    });
  <\/script>
</body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noreferrer";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <>
      {isAdmin && (
        <div style={{ position: "absolute", left: -9999 }}>
          <QRCodeCanvas id="qr-print-canvas" value={qrValue} size={220} level="M" />
        </div>
      )}

      <div>
        <button style={s.backBtn} onClick={() => navigate("/tools")}>← Back to Equipment</button>

        {/* ── Tool info card ── */}
        <div style={s.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
            <div style={{ flex: 1 }}>
              {editingName ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input style={{ ...s.input, width: 280 }} value={newName} onChange={(e) => setNewName(e.target.value)} />
                  <button style={s.btn} onClick={saveName} disabled={saving}>Save</button>
                  <button style={s.btnOutline} onClick={() => setEditingName(false)}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h2 style={s.toolName}>{tool.name || "Unnamed Equipment"}</h2>
                  <button style={s.editBtn} onClick={() => setEditingName(true)}>✏ Edit</button>
                </div>
              )}
              <p style={s.toolId}>ID: {tool.toolId || toolId}</p>
              <div style={{ marginTop: 10 }}><StatusBadge status={displayStatus} /></div>

              {/* Category row */}
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ color: "#888", fontWeight: 600, fontSize: 13 }}>Category:</span>
                {editingCategory ? (
                  <>
                    <select
                      style={{ ...s.input, width: "auto", maxWidth: 220, padding: "5px 10px", fontSize: 13 }}
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                    >
                      <option value="">No category</option>
                      {categories.filter((c) => c.toLowerCase() !== "vehicles").map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <button style={{ ...s.btn, padding: "5px 14px", fontSize: 13 }} onClick={saveCategory} disabled={saving}>Save</button>
                    <button style={{ ...s.btnOutline, padding: "5px 14px", fontSize: 13 }}
                      onClick={() => { setEditingCategory(false); setSelectedCategory(tool.category ?? ""); }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 14, color: "#333", fontWeight: 500 }}>{tool.category || "—"}</span>
                    {isAdmin && (
                      <button style={s.editBtn} onClick={() => setEditingCategory(true)}>✏ Edit</button>
                    )}
                  </>
                )}
              </div>

              {/* ── Model / Serial # / Notes ── */}
              {(tool.model || tool.serialNumber || tool.notes || isAdmin) && (
                <div style={{ marginTop: 14 }}>
                  {editingDetails ? (
                    <div style={{ background: "#f8f9fa", borderRadius: 10, padding: 14, border: "1px solid #e5e5e5" }}>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ flex: "1 1 150px" }}>
                          <label style={s.label}>Model</label>
                          <input style={s.input} value={editModel} onChange={(e) => setEditModel(e.target.value)} placeholder="e.g. Fluke 117" />
                        </div>
                        <div style={{ flex: "1 1 150px" }}>
                          <label style={s.label}>Serial #</label>
                          <input style={s.input} value={editSerial} onChange={(e) => setEditSerial(e.target.value)} placeholder="e.g. SN-12345" />
                        </div>
                      </div>
                      <label style={{ ...s.label, marginTop: 10 }}>Notes</label>
                      <textarea
                        style={{ ...s.input, minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        placeholder="Any special notes about this equipment…"
                      />
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button style={s.btn} onClick={saveDetails} disabled={savingDetails}>{savingDetails ? "Saving…" : "Save"}</button>
                        <button style={s.btnOutline} onClick={() => setEditingDetails(false)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
                      {tool.model && (
                        <div>
                          <span style={{ color: "#888", fontSize: 12, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 0.4 }}>Model</span>
                          <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 600, color: "#222" }}>{tool.model}</p>
                        </div>
                      )}
                      {tool.serialNumber && (
                        <div>
                          <span style={{ color: "#888", fontSize: 12, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 0.4 }}>Serial #</span>
                          <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 600, color: "#222" }}>{tool.serialNumber}</p>
                        </div>
                      )}
                      {tool.notes && (
                        <div style={{ flex: "1 1 200px" }}>
                          <span style={{ color: "#888", fontSize: 12, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 0.4 }}>Notes</span>
                          <p style={{ margin: "2px 0 0", fontSize: 14, color: "#555" }}>{tool.notes}</p>
                        </div>
                      )}
                      {isAdmin && (
                        <button style={s.editBtn} onClick={() => { setEditModel(tool.model ?? ""); setEditSerial(tool.serialNumber ?? ""); setEditNotes(tool.notes ?? ""); setEditingDetails(true); }}>
                          {tool.model || tool.serialNumber || tool.notes ? "✏ Edit Details" : "+ Add Details"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {isAdmin && (
                  <button style={s.printBtn} onClick={printLabel}>🖨 Print QR Label</button>
                )}
                <button style={s.historyBtn} onClick={toggleHistory}>
                  {showHistory ? "▲ Hide History" : "🕐 View History"}
                </button>
              </div>
            </div>
            {/* ── Repair Contacts (middle column) ── */}
            {(() => {
              const visible = repairContacts.filter((rc) =>
                rc.contactType === "Equipment Repair" &&
                (!rc.categories || rc.categories.length === 0 || rc.categories.includes(tool.category ?? ""))
              );
              if (visible.length === 0) return null;
              return (
                <div style={{ minWidth: 180, maxWidth: 240, flex: "0 0 auto" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Repair Contacts</p>
                  {visible.map((rc) => (
                    <div key={rc.id} style={{ marginBottom: 10 }}>
                      <p style={{ fontWeight: 700, fontSize: 13, color: "#111", marginBottom: 2 }}>{rc.header}</p>
                      {rc.company && <p style={{ fontSize: 12, color: "#555", margin: "1px 0" }}>{rc.company}</p>}
                      {rc.contact && <p style={{ fontSize: 12, color: "#555", margin: "1px 0" }}>{rc.contact}</p>}
                      {rc.phone && (
                        <a href={`tel:${rc.phone.replace(/\s/g, "")}`} style={{ fontSize: 12, color: "#1e7d3a", textDecoration: "none", display: "block", margin: "1px 0" }}>{rc.phone}</a>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* ── Tool Photo (compact, next to QR) ── */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              {tool.photoURL ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <img
                    src={tool.photoURL}
                    alt={tool.name || "Tool photo"}
                    style={{ width: 180, maxHeight: 200, borderRadius: 8, border: "1px solid #e5e5e5", objectFit: "contain" }}
                  />
                  {isAdmin && (
                    <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
                      <label style={{ ...s.editBtn, cursor: "pointer", fontSize: 11, padding: "2px 8px" }}>
                        {photoUploading ? "…" : "Replace"}
                        <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handlePhotoUpload} disabled={photoUploading} />
                      </label>
                      <button style={{ ...s.editBtn, color: "#cc0000", borderColor: "#ffcccc", fontSize: 11, padding: "2px 8px" }} onClick={handlePhotoDelete}>Remove</button>
                    </div>
                  )}
                </div>
              ) : (
                isAdmin && (
                  <label style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 180, height: 140, cursor: "pointer", border: "2px dashed #ccc", borderRadius: 8, color: "#888", fontSize: 13, fontWeight: 600, textAlign: "center" as const }}>
                    {photoUploading ? "Uploading…" : "📷 Add Photo"}
                    <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handlePhotoUpload} disabled={photoUploading} />
                  </label>
                )
              )}
              {photoError && <p style={{ color: "#cc0000", fontSize: 11, marginTop: 2 }}>{photoError}</p>}
            </div>

            {isAdmin && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <QRCodeSVG value={qrValue} size={130} level="M" />
                <p style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>{qrValue}</p>
              </div>
            )}
          </div>

          {/* History panel */}
          {showHistory && (
            <div style={s.historyPanel}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
                <h3 style={{ ...s.sectionTitle, marginBottom: 0 }}>Equipment History</h3>
                {history.length > 0 && (
                  <input
                    style={{ ...s.input, width: "auto", flex: "1 1 200px", maxWidth: 280, fontSize: 13, padding: "6px 10px" }}
                    placeholder="Search by customer or job number…"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                  />
                )}
              </div>
              {loadingHistory ? (
                <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>
              ) : history.length === 0 ? (
                <p style={{ color: "#aaa", fontSize: 14 }}>No history recorded yet. History is tracked from this point forward.</p>
              ) : (() => {
                const q = historySearch.trim().toLowerCase();
                const filtered = q
                  ? history.filter((h) =>
                      h.jobName?.toLowerCase().includes(q) ||
                      h.customer?.toLowerCase().includes(q)
                    )
                  : history;
                return filtered.length === 0 ? (
                  <p style={{ color: "#aaa", fontSize: 14 }}>No history matches "{historySearch.trim()}".</p>
                ) : (
                <div style={s.timeline}>
                  {filtered.map((h) => {
                    const style = ACTION_LABELS[h.action] ?? { label: h.action, color: "#555", bg: "#f8f9fa" };
                    return (
                      <div key={h.id} style={{ ...s.timelineItem, background: style.bg, borderLeft: `3px solid ${style.color}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                          <span style={{ fontWeight: 800, color: style.color, fontSize: 13 }}>{style.label}</span>
                          <span style={{ fontSize: 12, color: "#aaa" }}>{fmtDateLongWithYear(h.recordedAt)}</span>
                        </div>
                        {h.employeeName && <div style={s.historyDetail}><span style={s.historyLabel}>Employee</span>{h.employeeName}</div>}
                        {h.jobName      && <div style={s.historyDetail}><span style={s.historyLabel}>Job Number</span>{h.jobName}</div>}
                        {h.customer     && <div style={s.historyDetail}><span style={s.historyLabel}>Customer</span>{h.customer}</div>}
                        {h.note         && <div style={s.historyDetail}><span style={s.historyLabel}>Note</span>{h.note}</div>}
                        {h.reportedBy   && <div style={s.historyDetail}><span style={s.historyLabel}>Reported by</span>{h.reportedBy}</div>}
                        {h.daysOnJob !== undefined && (
                          <div style={s.historyDetail}>
                            <span style={s.historyLabel}>Time on job</span>
                            {h.daysOnJob} day{h.daysOnJob !== 1 ? "s" : ""}{h.excludedWeekends ? " (weekdays only)" : ""}
                          </div>
                        )}
                        {isAdmin && h.action === "RETURNED" && h.daysOnJob !== undefined && tool.dayRate !== undefined && (() => {
                          const toolRates = { dayRate: tool.dayRate!, weekRate: tool.weekRate ?? 0, monthRate: tool.monthRate ?? 0 };
                          const amount = calcRental(h.daysOnJob, toolRates);
                          const tier = h.daysOnJob <= 4 ? "day rate" : h.daysOnJob <= 15 ? "week rate" : "month rate";
                          return (
                            <div style={{ ...s.historyDetail, marginTop: 6, paddingTop: 6, borderTop: "1px dashed #e0e0e0" }}>
                              <span style={{ ...s.historyLabel, color: "#1a7a3c" }}>Est. Rental</span>
                              <span style={{ fontWeight: 700, color: "#1a7a3c" }}>
                                ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                <span style={{ fontWeight: 400, color: "#888", fontSize: 12, marginLeft: 6 }}>({tier})</span>
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* ── RENTAL RATES (admin only) ── */}
        {isAdmin && (
          <div style={s.card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <h3 style={{ ...s.sectionTitle, marginBottom: 0 }}>Rental Rates</h3>
              {isOwner && !editingRates && (
                <button style={s.editBtn} onClick={() => {
                  setEditDayRate(String(tool?.dayRate ?? ""));
                  setEditWeekRate(String(tool?.weekRate ?? ""));
                  setEditMonthRate(String(tool?.monthRate ?? ""));
                  setEditingRates(true);
                }}>✏ Edit</button>
              )}
            </div>
            {!editingRates ? (
              tool?.dayRate === undefined ? (
                <p style={{ color: "#aaa", fontSize: 13, margin: 0 }}>No rates set for this tool yet.{isOwner ? " Click Edit to configure." : ""}</p>
              ) : (
                <div style={s.infoGrid}>
                  <span style={s.infoLabel}>Day rate</span>
                  <span>${tool.dayRate.toLocaleString()} / day &nbsp;<span style={{ color: "#888", fontSize: 12 }}>(1–4 days)</span></span>
                  <span style={s.infoLabel}>Week rate</span>
                  <span>${tool.weekRate?.toLocaleString()} / week &nbsp;<span style={{ color: "#888", fontSize: 12 }}>(5–15 days)</span></span>
                  <span style={s.infoLabel}>Month rate</span>
                  <span>${tool.monthRate?.toLocaleString()} / month &nbsp;<span style={{ color: "#888", fontSize: 12 }}>(16+ days)</span></span>
                </div>
              )
            ) : (
              <>
                <label style={s.label}>Day Rate ($ per day · 1–4 days)</label>
                <input style={s.input} type="number" min="0" step="0.01" value={editDayRate}
                  onChange={(e) => setEditDayRate(e.target.value)} placeholder="e.g. 150" />
                <label style={s.label}>Week Rate ($ flat · 5–15 days)</label>
                <input style={s.input} type="number" min="0" step="0.01" value={editWeekRate}
                  onChange={(e) => setEditWeekRate(e.target.value)} placeholder="e.g. 500" />
                <label style={s.label}>Month Rate ($ flat · 16+ days)</label>
                <input style={s.input} type="number" min="0" step="0.01" value={editMonthRate}
                  onChange={(e) => setEditMonthRate(e.target.value)} placeholder="e.g. 1500" />
                <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                  <button style={s.btn} onClick={saveToolRates} disabled={saving}>{saving ? "Saving…" : "Save Rates"}</button>
                  <button style={s.btnOutline} onClick={() => setEditingRates(false)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── UPCOMING BOOKINGS ── */}
        <div style={s.card}>
            <h3 style={s.sectionTitle}>
              Upcoming Bookings
              {bookings.length > 0 && (
                <span style={s.bookingCount}>{bookings.length}</span>
              )}
            </h3>

            {/* Bookings list */}
            {loadingBookings ? (
              <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>
            ) : bookings.length === 0 && !showBookForm ? (
              <p style={{ color: "#bbb", fontSize: 14 }}>No upcoming bookings</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {bookings.map((b) => {
                  const canCancel = isAdmin || b.createdByUid === currentUserUid;
                  return (
                    <div key={b.id} style={s.bookingItem}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{b.employeeName}</div>
                      <div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>{b.jobName}</div>
                      <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
                        {fmtDateLong(b.startDate)} → {fmtDateLong(b.endDate)}
                      </div>
                      {canCancel && (
                        <button style={s.cancelBookingBtn} onClick={() => cancelBooking(b.id)}>
                          Cancel Booking
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Book form */}
            {showBookForm && (
              <div style={{ borderTop: "1px solid #eee", marginTop: 16, paddingTop: 16 }}>
                <label style={s.label}>Employee</label>
                {isAdmin ? (
                  <>
                    <input list="booking-users" style={s.input} value={bookEmployee} onChange={(e) => setBookEmployee(e.target.value)} placeholder="Select or type a name" />
                    <datalist id="booking-users">{userNames.map((n) => <option key={n} value={n} />)}</datalist>
                  </>
                ) : (
                  <div>
                    <input style={{ ...s.input, background: "#f8f9fa", color: "#444", cursor: "default" }} value={bookEmployee} readOnly />
                    <p style={{ fontSize: 12, color: "#aaa", marginTop: 4 }}>Booking as your account</p>
                  </div>
                )}
                <label style={s.label}>Job / Site</label>
                <input style={s.input} value={bookJob} onChange={(e) => setBookJob(e.target.value)} placeholder="e.g. Unilever Bulk Line" />

                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <label style={s.label}>Start Date</label>
                    <input type="date" style={s.input} value={bookStartDate} min={tomorrowStr}
                      onChange={(e) => { setBookStartDate(e.target.value); if (bookEndDate && bookEndDate < e.target.value) setBookEndDate(""); }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <label style={s.label}>End Date</label>
                    <input type="date" style={s.input} value={bookEndDate} min={bookStartDate || tomorrowStr}
                      onChange={(e) => setBookEndDate(e.target.value)} />
                  </div>
                </div>
                {bookingError && <p style={{ ...s.error, marginTop: 12 }}>{bookingError}</p>}
                <button
                  style={{ ...s.btn, marginTop: 12, background: "#8b6800" }}
                  onClick={createBooking}
                  disabled={saving || !bookEmployee || !bookJob || !bookStartDate || !bookEndDate}
                >
                  {saving ? "Saving…" : "Confirm Booking"}
                </button>
              </div>
            )}

            {/* Book for Future button — always at bottom */}
            <div style={{ marginTop: 16, borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
              <button
                style={showBookForm ? s.btnOutline : s.bookBtn}
                onClick={() => { setShowBookForm((v) => !v); setBookingError(""); }}
              >
                {showBookForm ? "Cancel" : "Book for Future"}
              </button>
            </div>
        </div>

        {error && <p style={s.error}>{error}</p>}

        {/* ── DAMAGED card ── */}
        {isDamaged && (
          <div style={{ ...s.card, borderColor: "#9c27b0", backgroundColor: "#fdf6ff" }}>
            <div style={s.damagedBanner}>🔧 THIS EQUIPMENT IS DAMAGED</div>
            <h3 style={s.sectionTitle}>Damage Report</h3>
            {/* Repair status badge + inline selector */}
            {(() => {
              const rs = REPAIR_STATUSES.find((r) => r.value === cardRepairStatus) ?? REPAIR_STATUSES[0];
              return (
                <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{
                    display: "inline-block", padding: "4px 12px", borderRadius: 20,
                    background: rs.bg, color: rs.color, fontWeight: 700, fontSize: 13,
                    border: `1px solid ${rs.color}44`,
                  }}>{rs.label}</span>
                  <select
                    style={{ fontSize: 13, padding: "4px 8px", borderRadius: 6, border: "1px solid #ccc", cursor: "pointer" }}
                    value={cardRepairStatus}
                    onChange={(e) => updateRepairStatus(e.target.value)}
                  >
                    {REPAIR_STATUSES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
              );
            })()}
            <div style={s.infoGrid}>
              {tool.damagedReportedBy && (<><span style={s.infoLabel}>Reported by</span><span>{tool.damagedReportedBy}</span></>)}
              <span style={s.infoLabel}>Date reported</span><span>{fmtDateLongWithYear(tool.damagedReportedAt)}</span>
              {tool.damagedNote && (<><span style={s.infoLabel}>Description</span><span>{tool.damagedNote}</span></>)}
            </div>
            {tool.damagedPhotoUrl ? (
              <div style={{ marginTop: 16 }}>
                <a href={tool.damagedPhotoUrl} target="_blank" rel="noreferrer">
                  <img src={tool.damagedPhotoUrl} alt="Damage photo"
                    style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 8, border: "1px solid #ddd", cursor: "pointer", display: "block" }} />
                </a>
                <p style={{ fontSize: 12, color: "#888", marginTop: 4 }}>Click photo to view full size</p>
              </div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <label style={{ ...s.btnOutline, borderColor: "#6a0080", color: "#6a0080", display: "inline-block", cursor: "pointer" }}>
                  {damagePhotoUploading ? "Uploading…" : "📷 Add Photo"}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDamagePhoto(f); }}
                    disabled={damagePhotoUploading}
                  />
                </label>
              </div>
            )}
            <button style={{ ...s.btnOutline, marginTop: 16, borderColor: "#1a7a3c", color: "#1a7a3c" }} onClick={markRepaired} disabled={saving}>
              {saving ? "Saving…" : "✓ Mark as Repaired"}
            </button>
          </div>
        )}

        {/* ── CHECKED OUT card ── */}
        {isCheckedOut && (
          <div style={{ ...s.card, ...(isOverdue ? s.cardOverdue : {}) }}>
            {isOverdue && <div style={s.overdueBanner}>⚠ THIS EQUIPMENT IS OVERDUE</div>}
            <h3 style={s.sectionTitle}>Checked Out</h3>
            <div style={s.infoGrid}>
              <span style={s.infoLabel}>Employee</span><span>{tool.checkedOutToEmployeeName || "—"}</span>
              <span style={s.infoLabel}>Job Number</span><span>{tool.checkedOutToJobName || "—"}</span>
              {tool.checkedOutToCustomer && (<><span style={s.infoLabel}>Customer</span><span>{tool.checkedOutToCustomer}</span></>)}
              <span style={s.infoLabel}>Checked out</span><span>{fmtDateLongWithYear(tool.checkedOutAt)}</span>
              <span style={s.infoLabel}>Due back</span>
              <span style={isOverdue ? { color: "#a80000", fontWeight: 700 } : {}}>{fmtDateLong(tool.dueBackAt)}</span>
              {isAdmin && tool.dayRate !== undefined && tool.checkedOutAt?.toDate && (() => {
                const toolRates = { dayRate: tool.dayRate!, weekRate: tool.weekRate ?? 0, monthRate: tool.monthRate ?? 0 };
                const days = countDays(tool.checkedOutAt.toDate(), new Date(), false);
                const amount = calcRental(days, toolRates);
                const tier = days <= 4 ? "day rate" : days <= 15 ? "week rate" : "month rate";
                return (
                  <>
                    <span style={s.infoLabel}>Est. Rental</span>
                    <span style={{ fontWeight: 700, color: "#1a7a3c" }}>
                      ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      <span style={{ fontWeight: 400, color: "#888", fontSize: 12, marginLeft: 6 }}>({days}d · {tier})</span>
                    </span>
                  </>
                );
              })()}
            </div>

            {/* Return confirmation flow */}
            {!showReturnConfirm ? (
              <button style={{ ...s.btnOutline, marginTop: 16 }} onClick={() => setShowReturnConfirm(true)} disabled={saving}>
                Return Equipment
              </button>
            ) : (
              <div style={{ marginTop: 16, padding: "14px 16px", background: "#f8f9fa", borderRadius: 8, border: "1px solid #e0e0e0" }}>
                {(() => {
                  const checkedOut = tool.checkedOutAt?.toDate?.() as Date | undefined;
                  const days = checkedOut ? countDays(checkedOut, new Date(), returnExcludeWeekends) : null;
                  return (
                    <>
                      <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 600 }}>
                        {days !== null
                          ? `This equipment was on the job for ${days} day${days !== 1 ? "s" : ""}${returnExcludeWeekends ? " (weekdays only)" : ""}.`
                          : "Confirm return"}
                      </p>
                      {isAdmin && tool.dayRate !== undefined && days !== null && (() => {
                        const toolRates = { dayRate: tool.dayRate!, weekRate: tool.weekRate ?? 0, monthRate: tool.monthRate ?? 0 };
                        const amount = calcRental(days, toolRates);
                        const tier = days <= 4 ? "day rate" : days <= 15 ? "week rate" : "month rate";
                        return (
                          <p style={{ margin: "0 0 12px", fontSize: 14 }}>
                            <span style={{ color: "#888" }}>Estimated rental: </span>
                            <span style={{ fontWeight: 700, color: "#1a7a3c" }}>
                              ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span style={{ color: "#888", fontSize: 12, marginLeft: 6 }}>({tier})</span>
                          </p>
                        );
                      })()}
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", marginBottom: 12 }}>
                        <input
                          type="checkbox"
                          checked={returnExcludeWeekends}
                          onChange={(e) => setReturnExcludeWeekends(e.target.checked)}
                        />
                        Exclude weekends from day count
                      </label>
                      <div style={{ display: "flex", gap: 10 }}>
                        <button style={{ ...s.btn, fontSize: 13, padding: "8px 18px" }} onClick={() => returnTool(returnExcludeWeekends)} disabled={saving}>
                          {saving ? "Saving…" : "Confirm Return"}
                        </button>
                        <button style={{ ...s.btnOutline, fontSize: 13, padding: "8px 14px" }} onClick={() => setShowReturnConfirm(false)}>
                          Cancel
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
            {isOverdue && (
              <div style={{ marginTop: 20, borderTop: "1px solid #e5e5e5", paddingTop: 16 }}>
                <h3 style={s.sectionTitle}>Extend Due Date</h3>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                  <input type="date" style={s.input} value={extendDate} onChange={(e) => setExtendDate(e.target.value)} min={todayStr} />
                  <button style={s.btn} onClick={extendDueDate} disabled={saving || !extendDate}>
                    {saving ? "Saving…" : "Extend"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CHECK OUT form (only when IN_SHOP) ── */}
        {!isCheckedOut && !isDamaged && (
          <div style={s.card}>
            <h3 style={s.sectionTitle}>Check Out</h3>
            <label style={s.label}>Employee</label>
            {isAdmin ? (
              <>
                <input list="checkout-users" style={s.input} value={employee} onChange={(e) => setEmployee(e.target.value)} placeholder="Select or type a name" />
                <datalist id="checkout-users">{userNames.map((n) => <option key={n} value={n} />)}</datalist>
              </>
            ) : (
              <div>
                <input style={{ ...s.input, background: "#f8f9fa", color: "#444", cursor: "default" }} value={employee} readOnly />
              </div>
            )}
            <label style={s.label}>Job Number</label>
            <input
              style={{ ...s.input, ...(jobError ? { borderColor: "#cc0000" } : {}) }}
              value={job}
              onChange={(e) => { setJob(e.target.value); setJobError(""); }}
              placeholder="e.g. 25-1234"
            />
            {jobError && <p style={{ fontSize: 12, color: "#cc0000", margin: "4px 0 0" }}>{jobError}</p>}
            <label style={s.label}>Customer</label>
            <input style={s.input} value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="e.g. Unilever" />
            <label style={s.label}>Due back date</label>
            <input type="date" style={s.input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} min={todayStr} />
            <button style={{ ...s.btn, marginTop: 28 }} onClick={checkout} disabled={saving || !employee || !job || !dueDate}>
              {saving ? "Saving…" : "Check Out"}
            </button>
          </div>
        )}

        {/* ── ANNUAL INSPECTION (Aerial Lifts only) ── */}
        {tool?.category?.toLowerCase().includes("lift") && (() => {
          const last = tool.lastInspectionDate;
          const nextDue = last
            ? new Date(last + "T00:00:00").setFullYear(new Date(last + "T00:00:00").getFullYear() + 1)
            : null;
          const daysUntil = nextDue ? Math.ceil((nextDue - Date.now()) / 86400000) : null;
          const isOverdueInspection = daysUntil !== null && daysUntil < 0;
          const isDueSoon = daysUntil !== null && daysUntil >= 0 && daysUntil <= 30;
          return (
            <div style={{ ...s.card, borderColor: isOverdueInspection ? "#cc0000" : isDueSoon ? "#d97706" : "#e5e5e5" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h3 style={{ ...s.sectionTitle, marginBottom: 0 }}>🔍 Annual Inspection</h3>
                {isAdmin && !editingInspection && (
                  <button style={s.editBtn} onClick={() => { setInspectionDate(last ?? todayStr); setEditingInspection(true); }}>
                    {last ? "✏ Update" : "+ Set Date"}
                  </button>
                )}
              </div>

              {isOverdueInspection && (
                <div style={{ background: "#fff0f0", border: "1px solid #ffcccc", borderRadius: 8, padding: "8px 14px", marginBottom: 12, fontSize: 13, color: "#cc0000", fontWeight: 600 }}>
                  ⚠ OVERDUE — inspection was due {Math.abs(daysUntil!)} day{Math.abs(daysUntil!) !== 1 ? "s" : ""} ago
                </div>
              )}
              {isDueSoon && (
                <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 14px", marginBottom: 12, fontSize: 13, color: "#b45309", fontWeight: 600 }}>
                  ⚠ Due in {daysUntil} day{daysUntil !== 1 ? "s" : ""}
                </div>
              )}

              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 14 }}>
                <div>
                  <span style={{ color: "#888", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Last Inspection</span>
                  <p style={{ margin: "4px 0 0", fontWeight: 600, color: "#333" }}>
                    {last ? new Date(last + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "Not recorded"}
                  </p>
                </div>
                {nextDue && (
                  <div>
                    <span style={{ color: "#888", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Next Due</span>
                    <p style={{ margin: "4px 0 0", fontWeight: 600, color: isOverdueInspection ? "#cc0000" : isDueSoon ? "#b45309" : "#333" }}>
                      {new Date(nextDue).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                      {!isOverdueInspection && daysUntil !== null && daysUntil > 30 && (
                        <span style={{ fontWeight: 400, color: "#888", marginLeft: 8 }}>({daysUntil} days)</span>
                      )}
                    </p>
                  </div>
                )}
              </div>

              {editingInspection && (
                <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="date"
                    style={{ ...s.input, width: "auto" }}
                    value={inspectionDate}
                    max={todayStr}
                    onChange={(e) => setInspectionDate(e.target.value)}
                  />
                  <button style={s.btn} onClick={saveInspectionDate} disabled={savingInspection || !inspectionDate}>
                    {savingInspection ? "Saving…" : "Save"}
                  </button>
                  <button style={s.btnOutline} onClick={() => setEditingInspection(false)}>Cancel</button>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── MAINTENANCE LOG ── */}
        <div style={s.card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ ...s.sectionTitle, marginBottom: 0 }}>
              🔩 Maintenance Log
              {maintenanceLogs.length > 0 && (
                <span style={s.bookingCount}>{maintenanceLogs.length}</span>
              )}
            </h3>
            {isAdmin && !showMaintForm && (
              <button style={s.editBtn} onClick={() => { setShowMaintForm(true); setMaintPerformedBy(currentUserName); setMaintDate(todayStr); setMaintError(""); }}>
                + Add Entry
              </button>
            )}
          </div>

          {/* Add form */}
          {showMaintForm && (
            <div style={{ background: "#f8f9fa", borderRadius: 10, padding: 16, marginBottom: 16, border: "1px solid #e5e5e5" }}>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 160px" }}>
                  <label style={s.label}>Date</label>
                  <input type="date" style={s.input} value={maintDate} max={todayStr} onChange={(e) => setMaintDate(e.target.value)} />
                </div>
                <div style={{ flex: "2 1 200px" }}>
                  <label style={s.label}>Performed By</label>
                  <input list="maint-users" style={s.input} value={maintPerformedBy} onChange={(e) => setMaintPerformedBy(e.target.value)} placeholder="Select or type a name" />
                  <datalist id="maint-users">{userNames.map((n) => <option key={n} value={n} />)}</datalist>
                </div>
                <div style={{ flex: "1 1 120px" }}>
                  <label style={s.label}>Cost (optional)</label>
                  <input type="number" min="0" step="0.01" style={s.input} value={maintCost} onChange={(e) => setMaintCost(e.target.value)} placeholder="e.g. 250" />
                </div>
              </div>
              <label style={s.label}>Description *</label>
              <textarea
                style={{ ...s.input, minHeight: 72, resize: "vertical", fontFamily: "inherit", maxWidth: "100%" }}
                value={maintDescription}
                onChange={(e) => setMaintDescription(e.target.value)}
                placeholder="e.g. Replaced hydraulic seals, greased fittings, tested operation…"
              />
              {maintError && <p style={{ ...s.error, marginTop: 8 }}>{maintError}</p>}
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button style={s.btn} onClick={addMaintenanceLog} disabled={saving}>
                  {saving ? "Saving…" : "Save Entry"}
                </button>
                <button style={s.btnOutline} onClick={() => { setShowMaintForm(false); setMaintError(""); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Log table */}
          {loadingMaintenance ? (
            <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>
          ) : maintenanceLogs.length === 0 ? (
            <p style={{ color: "#bbb", fontSize: 14 }}>No maintenance entries yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={s.maintTh}>Date</th>
                    <th style={s.maintTh}>Description</th>
                    <th style={s.maintTh}>Performed By</th>
                    <th style={s.maintTh}>Cost</th>
                    {isAdmin && <th style={s.maintTh}></th>}
                  </tr>
                </thead>
                <tbody>
                  {maintenanceLogs.map((entry) => (
                    <tr key={entry.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={s.maintTd}>
                        {entry.date
                          ? new Date(entry.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                          : "—"}
                      </td>
                      <td style={{ ...s.maintTd, maxWidth: 320 }}>{entry.description}</td>
                      <td style={s.maintTd}>{entry.performedBy}</td>
                      <td style={s.maintTd}>
                        {entry.cost !== undefined
                          ? `$${entry.cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : "—"}
                      </td>
                      {isAdmin && (
                        <td style={s.maintTd}>
                          <button
                            style={{ background: "none", border: "none", color: "#cc0000", cursor: "pointer", fontSize: 13, padding: "2px 6px" }}
                            onClick={() => deleteMaintenanceLog(entry.id)}
                          >
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── REPORT DAMAGE ── */}
        {!isDamaged && (
          <div style={s.card}>
            {!showDamageForm ? (
              <button style={{ ...s.btnOutline, borderColor: "#9c27b0", color: "#6a0080" }} onClick={() => setShowDamageForm(true)}>
                🔧 Report Damage
              </button>
            ) : (
              <>
                <h3 style={s.sectionTitle}>Report Damage</h3>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>

                  {/* Left: form fields */}
                  <div style={{ flex: "2 1 260px" }}>
                    <label style={s.label}>Name</label>
                    {isAdmin ? (
                      <>
                        <input list="damage-users" style={s.input} value={damageReporter} onChange={(e) => setDamageReporter(e.target.value)} placeholder="Select or type a name" />
                        <datalist id="damage-users">{userNames.map((n) => <option key={n} value={n} />)}</datalist>
                      </>
                    ) : (
                      <input style={{ ...s.input, background: "#f8f9fa", color: "#444", cursor: "default" }} value={damageReporter} readOnly />
                    )}
                    <label style={s.label}>Details of Damage *</label>
                    <textarea
                      style={{ ...s.input, minHeight: 80, resize: "vertical", fontFamily: "inherit" }}
                      value={damageNote}
                      onChange={(e) => setDamageNote(e.target.value)}
                      placeholder="e.g. Cracked housing, missing part, won't power on…"
                    />
                    <label style={s.label}>Repair Status</label>
                    <select
                      style={s.input}
                      value={damageRepairStatus}
                      onChange={(e) => setDamageRepairStatus(e.target.value)}
                    >
                      {REPAIR_STATUSES.map((rs) => (
                        <option key={rs.value} value={rs.value}>{rs.label}</option>
                      ))}
                    </select>
                    <label style={s.label}>Photo (optional)</label>
                    {damagePhoto ? (
                      <div style={{ position: "relative", display: "inline-block", marginTop: 4 }}>
                        <img
                          src={URL.createObjectURL(damagePhoto)}
                          alt="Preview"
                          style={{ maxWidth: 220, maxHeight: 160, borderRadius: 10, border: "1px solid #ddd", display: "block" }}
                        />
                        <button
                          type="button"
                          onClick={() => setDamagePhoto(null)}
                          style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.55)", color: "#fff", border: "none", borderRadius: "50%", width: 24, height: 24, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
                        >✕</button>
                      </div>
                    ) : (
                      <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "20px 16px", border: "2px dashed #ccc", borderRadius: 10, cursor: "pointer", background: "#fafafa", marginTop: 4, transition: "border-color 0.15s" }}>
                        <span style={{ fontSize: 28, marginBottom: 4 }}>📷</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>Tap to add photo</span>
                        <span style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>or drag and drop</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => setDamagePhoto(e.target.files?.[0] ?? null)}
                          style={{ display: "none" }}
                        />
                      </label>
                    )}
                    <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                      <button
                        style={{ ...s.btn, background: "#6a0080" }}
                        onClick={reportDamage}
                        disabled={saving || !damageNote.trim() || !damageReporter.trim()}
                      >
                        {saving ? "Saving…" : "Submit Report"}
                      </button>
                      <button style={s.btnOutline} onClick={() => { setShowDamageForm(false); setDamageNote(""); setDamageReporter(currentUserName); setDamagePhoto(null); }}>
                        Cancel
                      </button>
                    </div>
                  </div>

                  {/* Right: repair contacts — filtered by tool category */}
                  {(() => {
                    const toolCat = tool.category ?? "";
                    const visible = repairContacts.filter((rc) =>
                      rc.categories && rc.categories.length > 0 && rc.categories.includes(toolCat)
                    );
                    if (visible.length === 0) return null;
                    return (
                      <div style={{ flex: "1 1 180px" }}>
                        {visible.map((rc) => (
                          <div key={rc.id} style={s.repairContactCard}>
                            <p style={s.repairContactHeader}>{rc.header}</p>
                            {rc.company && <p style={s.repairContactLine}><span style={s.repairContactKey}>Company:</span> {rc.company}</p>}
                            {rc.contact && <p style={s.repairContactLine}><span style={s.repairContactKey}>Contact:</span> {rc.contact}</p>}
                            {rc.phone   && <p style={s.repairContactLine}><span style={s.repairContactKey}>Phone:</span> <a href={`tel:${rc.phone.replace(/\s/g, "")}`} style={{ color: "#1e7d3a", textDecoration: "none" }}>{rc.phone}</a></p>}
                            {rc.address && (
                              <div style={{ margin: "2px 0" }}>
                                <p style={{ ...s.repairContactLine, margin: 0 }}><span style={s.repairContactKey}>Address:</span> {rc.address}</p>
                                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                                  {isIOS && <a href={`https://maps.apple.com/?q=${encodeURIComponent(rc.address)}`} target="_blank" rel="noreferrer" style={s.mapLink}>Apple Maps</a>}
                                  <a href={`https://maps.google.com/?q=${encodeURIComponent(rc.address)}`} target="_blank" rel="noreferrer" style={s.mapLink}>Google Maps</a>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  backBtn:         { background: "none", border: "none", color: "#1e7d3a", fontWeight: 700, fontSize: 14, padding: "0 0 16px", cursor: "pointer" },
  card:            { background: "#fff", borderRadius: 12, padding: 24, marginBottom: 16, boxShadow: "0 1px 6px rgba(0,0,0,0.06)", border: "1px solid #e5e5e5" },
  cardOverdue:     { borderColor: "#d32f2f", backgroundColor: "#fff8f8" },
  overdueBanner:   { background: "#ffeaea", border: "1px solid #d32f2f", borderRadius: 8, padding: "10px 16px", color: "#a80000", fontWeight: 900, letterSpacing: 1, textAlign: "center", marginBottom: 16 },
  damagedBanner:   { background: "#f3e5f5", border: "1px solid #9c27b0", borderRadius: 8, padding: "10px 16px", color: "#6a0080", fontWeight: 900, letterSpacing: 1, textAlign: "center", marginBottom: 16 },
  toolName:        { fontSize: 24, fontWeight: 900, color: "#111" },
  toolId:          { color: "#888", fontSize: 14, marginTop: 4 },
  sectionTitle:    { fontSize: 16, fontWeight: 800, marginBottom: 12, color: "#333", display: "flex", alignItems: "center", gap: 8 },
  infoGrid:        { display: "grid", gridTemplateColumns: "140px 1fr", gap: "8px 12px", fontSize: 14 },
  infoLabel:       { color: "#888", fontWeight: 600 },
  label:           { display: "block", fontSize: 13, fontWeight: 700, color: "#333", marginTop: 14, marginBottom: 4 },
  input:           { border: "1px solid #ddd", borderRadius: 8, padding: "9px 12px", fontSize: 14, width: "100%", maxWidth: 380 },
  btn:             { background: "#1e7d3a", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  maintTh:         { textAlign: "left" as const, fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.5, paddingBottom: 8, borderBottom: "1px solid #eee", paddingRight: 12 },
  maintTd:         { padding: "10px 12px 10px 0", verticalAlign: "top" as const, color: "#333" },
  btnOutline:      { background: "#fff", color: "#1e7d3a", border: "1px solid #1e7d3a", borderRadius: 8, padding: "9px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  editBtn:         { background: "none", border: "1px solid #ccc", borderRadius: 6, padding: "4px 10px", fontSize: 12, color: "#555", cursor: "pointer" },
  printBtn:        { background: "#f0f4ff", color: "#1e7d3a", border: "1px solid #c0d0ff", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  historyBtn:      { background: "#f5f5f5", color: "#555", border: "1px solid #ddd", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  bookBtn:         { background: "#fffbea", color: "#8b6800", border: "1px solid #e6c800", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  bookingCount:    { background: "#fffbea", color: "#8b6800", border: "1px solid #e6c800", borderRadius: 6, padding: "2px 8px", fontSize: 13, fontWeight: 700 },
  bookingItem:     { background: "#fffbea", border: "1px solid #f0e088", borderRadius: 8, padding: "12px 14px" },
  cancelBookingBtn:{ background: "none", border: "1px solid #e53e3e", borderRadius: 6, padding: "6px 0", fontSize: 13, color: "#e53e3e", cursor: "pointer", marginTop: 10, width: "100%", fontWeight: 600 },
  historyPanel:    { marginTop: 20, borderTop: "1px solid #eee", paddingTop: 18 },
  timeline:        { display: "flex", flexDirection: "column", gap: 10 },
  timelineItem:    { borderRadius: 8, padding: "12px 14px", fontSize: 14 },
  historyDetail:   { marginTop: 4, fontSize: 13, color: "#444" },
  historyLabel:    { color: "#888", fontWeight: 600, marginRight: 6 },
  error:           { color: "#d32f2f", fontSize: 13, margin: "8px 0" },
  repairContactCard:   { background: "#f8f9fa", borderRadius: 8, padding: "12px 14px", border: "1px solid #e5e5e5", marginBottom: 12 },
  repairContactHeader: { fontWeight: 800, fontSize: 13, marginBottom: 6, color: "#111" },
  repairContactLine:   { fontSize: 13, color: "#555", margin: "2px 0" },
  repairContactKey:    { fontWeight: 600 },
  mapLink:             { fontSize: 11, color: "#1e7d3a", textDecoration: "none", fontWeight: 600, background: "#eef2f7", border: "1px solid #c5d3e8", borderRadius: 6, padding: "2px 7px" },
};
