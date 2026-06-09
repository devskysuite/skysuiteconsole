import { useEffect, useState } from "react";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail as fbSendPasswordReset } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db, firebaseConfig } from "../firebase";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { useToast } from "../components/Toast";
import Spinner from "../components/Spinner";

type AppUser = {
  id: string;
  uid: string;
  email: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  department?: string;
  section?: string;
  ext?: string;
  role?: string;
  onCall?: boolean;
  createdAt?: any;
};

/** Format a phone string as (XXX) XXX-XXXX for 10-digit North American numbers. */
function fmtPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return raw;
}

const fns = getFunctions();
const callSendSms           = httpsCallable(fns, "sendTestSms");
const callPasswordReset     = httpsCallable(fns, "sendPasswordResetEmail");
const callGetUidByEmail     = httpsCallable(fns, "getUidByEmail");
const callSendScheduleText  = httpsCallable(fns, "sendScheduleText");
const callSendIcsLink       = httpsCallable(fns, "sendIcsLink");

export default function UsersPage() {
  const isAdmin = useIsAdmin();
  const { toast, confirm } = useToast();
  const [users, setUsers]   = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail]   = useState("");
  const [phone, setPhone]   = useState("");
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState("");
  const [success, setSuccess] = useState("");

  // Inline phone editing
  const [editingPhoneId, setEditingPhoneId] = useState<string | null>(null);
  const [editPhoneValue, setEditPhoneValue] = useState("");

  // Inline name editing
  const [editingNameId,  setEditingNameId]  = useState<string | null>(null);
  const [editNameValue,  setEditNameValue]  = useState("");

  // Inline email editing (add or change)
  const [addingEmailId, setAddingEmailId]   = useState<string | null>(null);
  const [addEmailValue, setAddEmailValue]   = useState("");
  const [addingEmailBusy, setAddingEmailBusy] = useState(false);

  // Action button states
  const [smsLoading, setSmsLoading]           = useState<string | null>(null);
  const [resetLoading, setResetLoading]       = useState<string | null>(null);
  const [icsLoading, setIcsLoading]           = useState<string | null>(null);
  const [mfaLoading, setMfaLoading]           = useState<string | null>(null);
  const [scheduleLoading, setScheduleLoading]   = useState<string | null>(null);
  const [icsLinkLoading, setIcsLinkLoading]     = useState<string | null>(null);

  const [clearing, setClearing]     = useState(false);
  const [clearResult, setClearResult] = useState("");

  const [fixingNames, setFixingNames]   = useState(false);
  const [fixNamesResult, setFixNamesResult] = useState("");

  const isOwner = isAdmin === true; // any admin/owner can manage users

  // Load current user's role from Firestore
  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { setCurrentUserRole(""); return; }
      try {
        const snap = await getDocs(query(collection(db, "users"), where("uid", "==", user.uid)));
        const role = snap.empty ? "" : (snap.docs[0].data().role ?? "");
        setCurrentUserRole(role);
      } catch {
        setCurrentUserRole("");
      }
    });
  }, []);

  async function loadUsers() {
    const snap = await getDocs(collection(db, "users"));
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AppUser));
    // Sort: field first, then office; within each group alphabetically
    all.sort((a, b) => {
      const sa = a.section === "field" ? 0 : 1;
      const sb = b.section === "field" ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return (a.displayName || "").localeCompare(b.displayName || "");
    });
    setUsers(all);
    setLoading(false);
  }

  useEffect(() => { loadUsers(); }, []);

  async function addUser() {
    setError("");
    setSuccess("");
    if (!displayName.trim() || !email.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    setBusy(true);
    try {
      const tempPassword = Math.random().toString(36).slice(-10) + "A1!";

      const secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
      const secondaryAuth = getAuth(secondaryApp);
      const { user: newUser } = await createUserWithEmailAndPassword(secondaryAuth, email.trim(), tempPassword);
      const newUid = newUser.uid;

      await secondaryAuth.signOut();
      await deleteApp(secondaryApp);
      // Non-blocking email
      callPasswordReset({ email: email.trim(), displayName: displayName.trim() }).catch(() => {});

      const existingSnap = await getDocs(
        query(collection(db, "users"), where("displayName", "==", displayName.trim()))
      );
      const existingDoc = existingSnap.docs.find((d) => {
        const data = d.data();
        return !data.uid || data.uid === "" || data.uid === d.id;
      });

      if (existingDoc) {
        await updateDoc(doc(db, "users", existingDoc.id), {
          uid: newUid,
          email: email.trim(),
          phone: phone.trim() || existingDoc.data().phone || "",
        });
      } else {
        await addDoc(collection(db, "users"), {
          uid: newUid,
          email: email.trim(),
          displayName: displayName.trim(),
          phone: phone.trim() || "",
          role: "user",
          createdAt: serverTimestamp(),
        });
      }

      setSuccess(`✓ ${email.trim()} has been added and sent a setup email.`);
      setDisplayName("");
      setEmail("");
      setPhone("");
      await loadUsers();
    } catch (e: any) {
      setError(e?.message ?? "Failed to create user.");
    } finally {
      setBusy(false);
    }
  }

  async function savePhone(u: AppUser) {
    const trimmed = editPhoneValue.trim();
    if (trimmed === (u.phone || "")) { setEditingPhoneId(null); return; }
    try {
      await updateDoc(doc(db, "users", u.id), { phone: trimmed });
      setEditingPhoneId(null);
      await loadUsers();
    } catch (e: any) {
      toast(`Error saving phone: ${e?.message}`, "error");
    }
  }

  async function saveName(u: AppUser) {
    const trimmed = editNameValue.trim();
    if (!trimmed) { setEditingNameId(null); return; }
    if (trimmed === (u.displayName || "")) { setEditingNameId(null); return; }
    try {
      await updateDoc(doc(db, "users", u.id), { displayName: trimmed });
      setEditingNameId(null);
      await loadUsers();
    } catch (e: any) {
      toast(`Error saving name: ${e?.message}`, "error");
    }
  }

  async function addEmailToUser(u: AppUser) {
    const trimmedEmail = addEmailValue.trim();
    if (!trimmedEmail) { toast("Please enter an email.", "error"); return; }
    setAddingEmailBusy(true);
    try {
      let newUid = "";

      try {
        // Try creating a new Auth account
        const tempPassword = Math.random().toString(36).slice(-10) + "A1!";
        const secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
        const secondaryAuth = getAuth(secondaryApp);
        const { user: newUser } = await createUserWithEmailAndPassword(secondaryAuth, trimmedEmail, tempPassword);
        newUid = newUser.uid;
        await secondaryAuth.signOut();
        await deleteApp(secondaryApp);
      } catch (authErr: any) {
        if (authErr.code === "auth/email-already-in-use") {
          // Auth account already exists — save email, uid will auto-link on their first login
          newUid = "";
        } else {
          throw authErr;
        }
      }

      // Save email to Firestore (uid fills in automatically when they first log in)
      const oldUid = u.uid;
      await updateDoc(doc(db, "users", u.id), { uid: newUid, email: trimmedEmail });

      if (oldUid && oldUid !== newUid) {
        const assignSnap = await getDocs(
          query(collection(db, "onCallAssignments"), where("uid", "==", oldUid))
        );
        for (const aDoc of assignSnap.docs) {
          await updateDoc(doc(db, "onCallAssignments", aDoc.id), { uid: newUid });
        }
      }

      // Send Firebase password reset (works on existing accounts, no Cloud Function needed)
      fbSendPasswordReset(auth, trimmedEmail).catch(() => {});
      toast(`✅ Email saved for ${u.displayName}. Password setup link sent to ${trimmedEmail}.`, "success");

      setAddingEmailId(null);
      setAddEmailValue("");
      await loadUsers();
    } catch (e: any) {
      toast(e?.message ?? "Failed to create account.", "error");
    } finally {
      setAddingEmailBusy(false);
    }
  }

  async function sendPasswordReset(u: AppUser) {
    if (!u.email) { toast("No email set for this user.", "error"); return; }
    setResetLoading(u.id);
    try {
      await callPasswordReset({ email: u.email, displayName: u.displayName });
      toast(`Password reset sent to ${u.email}`, "success");
    } catch (e: any) {
      toast(e?.message ?? "Failed to send reset email.", "error");
    } finally {
      setResetLoading(null);
    }
  }

  async function reset2FA(u: AppUser) {
    if (!await confirm(`Reset 2FA for ${u.displayName}?\n\nThey will be asked to set up their authenticator app again on next login.`)) return;
    setMfaLoading(u.id);
    try {
      await updateDoc(doc(db, "users", u.id), { totpSecret: "" });
      toast(`✓ 2FA reset for ${u.displayName}`, "success");
    } catch (e: any) {
      toast(e?.message ?? "Failed to reset 2FA.", "error");
    } finally {
      setMfaLoading(null);
    }
  }

  /** Convert all user displayNames from ALL CAPS → Title Case */
  async function fixAllDisplayNames() {
    if (!isOwner) return;
    if (!await confirm("Convert all user display names from ALL CAPS to Title Case?\n\nExample: JORDAN SIBBICK → Jordan Sibbick\n\nThis only affects how names appear in the app — it will not change login emails or Firebase Auth accounts.")) return;
    setFixingNames(true);
    setFixNamesResult("");
    const toTitle = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    try {
      const snap = await getDocs(collection(db, "users"));
      let updated = 0;
      for (const d of snap.docs) {
        const data = d.data();
        const name: string = data.displayName || "";
        if (!name) continue;
        const fixed = toTitle(name);
        if (fixed === name) continue;
        await updateDoc(doc(db, "users", d.id), { displayName: fixed });
        updated++;
      }
      setFixNamesResult(`✓ Updated ${updated} user${updated !== 1 ? "s" : ""}.`);
      await loadUsers();
    } catch (e: any) {
      setFixNamesResult(`Error: ${e?.message ?? "Unknown error"}`);
    } finally {
      setFixingNames(false);
    }
  }

  async function sendTestSms(u: AppUser) {
    if (!u.phone) { toast("No phone number set for this user.", "error"); return; }
    setSmsLoading(u.id);
    try {
      const result: any = await callSendSms({ to: u.phone, name: u.firstName || u.displayName });
      toast(`✓ SMS sent to ${fmtPhone(u.phone)} (${result?.data?.status || "sent"})`, "success");
    } catch (e: any) {
      toast(e?.message ?? "Failed to send SMS.", "error");
    } finally {
      setSmsLoading(null);
    }
  }

  async function exportIcs(u: AppUser) {
    if (!u.displayName) { toast("No name set.", "error"); return; }
    setIcsLoading(u.id);
    try {
      // Download straight from the working ICS feed endpoint (same one used by the texted link)
      const res = await fetch(`https://skysuite.ca/api/ics?name=${encodeURIComponent(u.displayName)}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const ics = await res.text();
      const count = (ics.match(/BEGIN:VEVENT/g) || []).length;
      if (!count) { toast(`No on-call or vacation events found for ${u.displayName}`, "error"); return; }
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `${(u.displayName || "user").toLowerCase().replace(/\s+/g, "-")}-oncall.ics`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Downloaded ${count} events for ${u.displayName}`, "success");
    } catch (e: any) {
      toast(e?.message ?? "Failed to export ICS.", "error");
    } finally {
      setIcsLoading(null);
    }
  }

  async function sendIcsLink(u: AppUser) {
    if (!u.phone) { toast("No phone number set for this user.", "error"); return; }
    if (!u.displayName) { toast("No name set for this user.", "error"); return; }
    setIcsLinkLoading(u.id);
    try {
      const result: any = await callSendIcsLink({ personName: u.displayName, phone: u.phone });
      toast(`✓ ICS sent to ${fmtPhone(u.phone)} (${result?.data?.count || 0} events)`, "success");
    } catch (e: any) {
      toast(e?.message ?? "Failed to send ICS.", "error");
    } finally {
      setIcsLinkLoading(null);
    }
  }

  async function sendSchedule(u: AppUser) {
    if (!u.phone) { toast("No phone number set for this user.", "error"); return; }
    if (!u.displayName) { toast("No name set for this user.", "error"); return; }
    setScheduleLoading(u.id);
    try {
      const result: any = await callSendScheduleText({ personName: u.displayName, phone: u.phone });
      toast(`✓ Schedule sent to ${fmtPhone(u.phone)} (${result?.data?.count || 0} on-call days)`, "success");
    } catch (e: any) {
      toast(e?.message ?? "Failed to send schedule.", "error");
    } finally {
      setScheduleLoading(null);
    }
  }

  async function changeRole(u: AppUser, newRole: string) {
    if (!isOwner || newRole === (u.role || "user")) return;
    const roleLabels: Record<string, string> = { owner: "Owner", admin: "Admin", manager: "Manager", user: "User" };
    if (!await confirm(`Change ${u.displayName || u.email} to ${roleLabels[newRole]}?`)) return;
    try {
      await updateDoc(doc(db, "users", u.id), { role: newRole });
      await loadUsers();
    } catch (e: any) {
      toast(`Error updating role: ${e?.message}`, "error");
    }
  }

  async function removeUser(userId: string, userEmail: string, userUid: string, userRole: string) {
    if (userRole === "owner") return;
    if (!isOwner) return;
    if (!await confirm(`Remove ${userEmail || userId}?\n\nThis will fully revoke their login access.`)) return;

    try {
      if (userUid) {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) throw new Error("Not authenticated");
        const res = await fetch("/api/delete-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: userUid, idToken }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "Failed to delete from Auth");
        }
      }
      await deleteDoc(doc(db, "users", userId));
      await loadUsers();
    } catch (e: any) {
      toast(`Error removing user: ${e?.message ?? "Unknown error"}`, "error");
    }
  }

  async function clearAllHistoryAndMaintenance() {
    if (!isOwner) return;
    if (!await confirm("This will permanently delete ALL equipment history and maintenance logs for every tool.\n\nThis cannot be undone. Continue?")) return;
    if (!await confirm("Are you absolutely sure? All history and maintenance records will be gone forever.")) return;
    setClearing(true);
    setClearResult("");
    try {
      const toolsSnap = await getDocs(collection(db, "tools"));
      let totalHistory = 0, totalMaintenance = 0;
      for (const tool of toolsSnap.docs) {
        const histSnap = await getDocs(collection(db, "tools", tool.id, "history"));
        for (const d of histSnap.docs) { await deleteDoc(doc(db, "tools", tool.id, "history", d.id)); totalHistory++; }
        const maintSnap = await getDocs(collection(db, "tools", tool.id, "maintenance"));
        for (const d of maintSnap.docs) { await deleteDoc(doc(db, "tools", tool.id, "maintenance", d.id)); totalMaintenance++; }
      }
      setClearResult(`Cleared ${totalHistory} history entries and ${totalMaintenance} maintenance entries across ${toolsSnap.size} tools.`);
    } catch (e: any) {
      setClearResult(`Error: ${e?.message ?? "Unknown error"}`);
    } finally {
      setClearing(false);
    }
  }

  if (isAdmin === null) return <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>;
  if (!isAdmin) return <div style={{ padding: 40, textAlign: "center", color: "#cc0000" }}>Access denied.</div>;

  // Group users
  const fieldUsers  = users.filter(u => u.section === "field" || (!u.section && u.department !== "OFFICE" && u.department !== "AUTOMATION"));
  const officeUsers = users.filter(u => u.section === "office");
  const otherUsers  = users.filter(u => !u.section && u.department !== "OFFICE" && u.department !== "AUTOMATION" && !fieldUsers.includes(u));

  function renderRow(u: AppUser) {
    const isOwnerRow = u.role === "owner";
    const roleBadge  = isOwnerRow ? styles.badgeOwner
      : u.role === "admin"   ? styles.badgeAdmin
      : u.role === "manager" ? styles.badgeManager
      : styles.badgeUser;
    const roleLabel = isOwnerRow ? "Owner"
      : u.role === "admin"   ? "Admin"
      : u.role === "manager" ? "Manager"
      : "User";
    const isSelf = u.uid === auth.currentUser?.uid;

    return (
      <tr key={u.id} style={styles.tr}>
        {/* Name */}
        <td style={styles.td}>
          {editingNameId === u.id ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                style={{ ...styles.input, padding: "4px 8px", fontSize: 13, width: 150 }}
                type="text"
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveName(u); if (e.key === "Escape") setEditingNameId(null); }}
                autoFocus
              />
              <button style={{ ...styles.actionBtn, borderColor: "#1565c0", color: "#1565c0" }} onClick={() => saveName(u)}>Save</button>
              <button style={styles.actionBtn} onClick={() => setEditingNameId(null)}>✕</button>
            </div>
          ) : (
            <div>
              <div
                style={{ fontWeight: 600, fontSize: 13, cursor: isOwner ? "pointer" : "default" }}
                onClick={() => { if (!isOwner) return; setEditingNameId(u.id); setEditNameValue(u.displayName || ""); }}
                title={isOwner ? "Click to edit name" : ""}
              >
                {u.displayName || "—"}
                {isOwner && <span style={{ marginLeft: 4, fontSize: 10, color: "#aaa" }}>✏️</span>}
              </div>
              {u.department && <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{u.department}</div>}
            </div>
          )}
        </td>

        {/* Email */}
        <td style={styles.td}>
          {addingEmailId === u.id ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                style={{ ...styles.input, padding: "4px 8px", fontSize: 13, width: 170 }}
                type="email"
                value={addEmailValue}
                onChange={(e) => setAddEmailValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addEmailToUser(u); if (e.key === "Escape") setAddingEmailId(null); }}
                placeholder="email@example.com"
                autoFocus
                disabled={addingEmailBusy}
              />
              <button style={{ ...styles.actionBtn, borderColor: "#1565c0", color: "#1565c0" }}
                onClick={() => addEmailToUser(u)} disabled={addingEmailBusy}>
                {addingEmailBusy ? "…" : "Save"}
              </button>
              <button style={styles.actionBtn}
                onClick={() => { setAddingEmailId(null); setAddEmailValue(""); }} disabled={addingEmailBusy}>
                ✕
              </button>
            </div>
          ) : u.email ? (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 13 }}>{u.email}</span>
              {isOwner && (
                <button
                  style={{ ...styles.actionBtn, fontSize: 10, padding: "2px 6px", borderColor: "#d1d5db", color: "#6b7280" }}
                  onClick={() => { setAddingEmailId(u.id); setAddEmailValue(u.email || ""); }}
                  title="Change email"
                >Edit</button>
              )}
            </div>
          ) : isOwner ? (
            <button style={{ ...styles.actionBtn, borderColor: "#1565c0", color: "#1565c0", fontSize: 11 }}
              onClick={() => { setAddingEmailId(u.id); setAddEmailValue(""); }}>
              + Add Email
            </button>
          ) : (
            <span style={{ color: "#bbb", fontSize: 13 }}>—</span>
          )}
        </td>

        {/* Phone */}
        <td style={styles.td}>
          {editingPhoneId === u.id ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                style={{ ...styles.input, padding: "4px 8px", fontSize: 13, width: 120 }}
                type="tel"
                value={editPhoneValue}
                onChange={(e) => setEditPhoneValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") savePhone(u); if (e.key === "Escape") setEditingPhoneId(null); }}
                autoFocus
              />
              <button style={{ ...styles.actionBtn, borderColor: "#1565c0", color: "#1565c0" }} onClick={() => savePhone(u)}>Save</button>
            </div>
          ) : (
            <span
              style={{ cursor: isOwner ? "pointer" : "default", color: u.phone ? "#333" : "#bbb", fontSize: 13 }}
              onClick={() => { if (!isOwner) return; setEditingPhoneId(u.id); setEditPhoneValue(u.phone || ""); }}
              title={isOwner ? "Click to edit" : ""}
            >
              {u.phone ? fmtPhone(u.phone) : "—"}
            </span>
          )}
        </td>

        {/* Role */}
        <td style={styles.td}>
          <span style={roleBadge}>{roleLabel}</span>
          {u.onCall && <span style={styles.badgeOnCall}>On-Call</span>}
        </td>

        {/* Actions */}
        <td style={{ ...styles.td, whiteSpace: "nowrap" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {/* Password Reset */}
            {u.email && isOwner && (
              <button
                style={{ ...styles.actionBtn, borderColor: "#1565c0", color: "#1565c0" }}
                onClick={() => sendPasswordReset(u)}
                disabled={resetLoading === u.id}
                title="Send password reset email"
              >
                {resetLoading === u.id ? "…" : "Reset Password"}
              </button>
            )}

            {/* Test SMS */}
            {u.phone && isOwner && (
              <button
                style={{ ...styles.actionBtn, borderColor: "#16a34a", color: "#15803d" }}
                onClick={() => sendTestSms(u)}
                disabled={smsLoading === u.id}
                title="Send test SMS"
              >
                {smsLoading === u.id ? "…" : "Test SMS"}
              </button>
            )}

            {/* Export ICS */}
            {isOwner && (
              <button
                style={{ ...styles.actionBtn, borderColor: "#9333ea", color: "#7c3aed" }}
                onClick={() => exportIcs(u)}
                disabled={icsLoading === u.id}
                title="Download on-call ICS calendar"
              >
                {icsLoading === u.id ? "…" : "Download ICS"}
              </button>
            )}

            {/* Send ICS link via SMS */}
            {u.phone && isOwner && (
              <button
                style={{ ...styles.actionBtn, borderColor: "#0891b2", color: "#0e7490" }}
                onClick={() => sendIcsLink(u)}
                disabled={icsLinkLoading === u.id}
                title="Text ICS calendar download link to this person"
              >
                {icsLinkLoading === u.id ? "…" : "Text ICS"}
              </button>
            )}

            {/* Reset 2FA — show for all users including self */}
            {isOwner && (
              <button
                style={{ ...styles.actionBtn, borderColor: "#f97316", color: "#ea580c" }}
                onClick={() => reset2FA(u)}
                disabled={mfaLoading === u.id}
                title="Reset two-factor authentication — user will re-enroll on next login"
              >
                {mfaLoading === u.id ? "…" : "Reset 2FA"}
              </button>
            )}

            {/* Role select — show for all users including self */}
            {isOwner && (
              <select
                style={styles.roleSelect}
                value={u.role || "user"}
                onChange={(e) => changeRole(u, e.target.value)}
              >
                <option value="user">User</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            )}

            {/* Remove — only for others, never yourself */}
            {isOwner && !isSelf && !isOwnerRow && (
              <button
                style={styles.removeBtn}
                onClick={() => removeUser(u.id, u.email, u.uid, u.role ?? "")}
              >
                Remove
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div>
      <h1 style={styles.h1}>Manage Users</h1>

      {/* ── Add User Form ── */}
      <div style={styles.card}>
        <h2 style={styles.h2}>Add New User</h2>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>Full Name</label>
            <input style={styles.input} value={displayName}
              onChange={(e) => setDisplayName(e.target.value)} placeholder="John Smith" />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input style={styles.input} type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="john@rbtautomate.com" />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Phone (optional)</label>
            <input style={styles.input} type="tel" value={phone}
              onChange={(e) => setPhone(e.target.value)} placeholder="905-555-1234" />
          </div>
        </div>
        {error   && <p style={styles.error}>{error}</p>}
        {success && <p style={styles.success}>{success}</p>}
        <button style={styles.btn} onClick={addUser} disabled={busy}>
          {busy ? "Creating…" : "+ Add User"}
        </button>
      </div>

      {/* ── Danger Zone ── */}
      {isOwner && (
        <div style={{ ...styles.card, borderColor: "#ffcccc" }}>
          <h2 style={{ ...styles.h2, color: "#cc0000" }}>Danger Zone</h2>

          {/* Fix display name casing */}
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
              Convert all user display names from ALL CAPS to Title Case (e.g. JORDAN SIBBICK → Jordan Sibbick).
            </p>
            {fixNamesResult && (
              <p style={{ fontSize: 13, color: fixNamesResult.startsWith("Error") ? "#cc0000" : "#007700", marginBottom: 8 }}>
                {fixNamesResult}
              </p>
            )}
            <button style={{ ...styles.btn, backgroundColor: "#7c3aed" }}
              onClick={fixAllDisplayNames} disabled={fixingNames}>
              {fixingNames ? "Fixing…" : "Fix Display Name Casing"}
            </button>
          </div>

          <p style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>
            Permanently delete all equipment history and maintenance logs from every tool. This cannot be undone.
          </p>
          {clearResult && (
            <p style={{ fontSize: 13, color: clearResult.startsWith("Error") ? "#cc0000" : "#007700", marginBottom: 12 }}>
              {clearResult}
            </p>
          )}
          <button style={{ ...styles.btn, backgroundColor: "#cc0000" }}
            onClick={clearAllHistoryAndMaintenance} disabled={clearing}>
            {clearing ? "Clearing…" : "Clear All History & Maintenance Logs"}
          </button>
        </div>
      )}

      {/* ── Field Employees ── */}
      {fieldUsers.length > 0 && (
        <div style={styles.card}>
          <h2 style={styles.h2}>Field Employees <span style={styles.count}>{fieldUsers.length}</span></h2>
          <UserTable rows={fieldUsers} renderRow={renderRow} />
        </div>
      )}

      {/* ── Office Employees ── */}
      {officeUsers.length > 0 && (
        <div style={styles.card}>
          <h2 style={styles.h2}>Office / Management <span style={styles.count}>{officeUsers.length}</span></h2>
          <UserTable rows={officeUsers} renderRow={renderRow} />
        </div>
      )}

      {/* ── Other (no section set) ── */}
      {otherUsers.length > 0 && (
        <div style={styles.card}>
          <h2 style={styles.h2}>Other <span style={styles.count}>{otherUsers.length}</span></h2>
          <UserTable rows={otherUsers} renderRow={renderRow} />
        </div>
      )}

      {loading && <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>}
    </div>
  );
}

function UserTable({ rows, renderRow }: { rows: AppUser[]; renderRow: (u: AppUser) => JSX.Element }) {
  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Name</th>
          <th style={styles.th}>Email</th>
          <th style={styles.th}>Phone</th>
          <th style={styles.th}>Role</th>
          <th style={styles.th}>Actions</th>
        </tr>
      </thead>
      <tbody>{rows.map(renderRow)}</tbody>
    </table>
  );
}

const styles: Record<string, React.CSSProperties> = {
  h1: { fontSize: 24, fontWeight: 800, marginBottom: 20 },
  h2: { fontSize: 16, fontWeight: 700, marginBottom: 16, color: "#333", display: "flex", alignItems: "center", gap: 8 },
  count: { background: "#e8f0ff", color: "#1565c0", borderRadius: 12, padding: "1px 8px", fontSize: 12, fontWeight: 700 },
  card: {
    border: "1px solid #e5e5e5",
    borderRadius: 12,
    padding: 24,
    marginBottom: 24,
    backgroundColor: "#fff",
  },
  row:   { display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 },
  field: { display: "flex", flexDirection: "column", flex: 1, minWidth: 200 },
  label: { fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#555" },
  input: { border: "1px solid #ddd", borderRadius: 8, padding: "9px 12px", fontSize: 14 },
  btn: {
    backgroundColor: "#1565c0",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 22px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  error:   { color: "#cc0000", fontSize: 13, marginBottom: 12 },
  success: { color: "#007700", fontSize: 13, marginBottom: 12 },
  table:   { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    fontSize: 12,
    fontWeight: 700,
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingBottom: 8,
    borderBottom: "1px solid #eee",
  },
  tr: { borderBottom: "1px solid #f5f5f5" },
  td: { padding: "10px 8px 10px 0", fontSize: 14, color: "#333", verticalAlign: "middle" },
  badgeOwner: {
    backgroundColor: "#fff8e1", color: "#b45309",
    borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700,
    border: "1px solid #f59e0b55",
  },
  badgeAdmin: {
    backgroundColor: "#e8f0ff", color: "#1565c0",
    borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700,
  },
  badgeManager: {
    backgroundColor: "#f0fdf4", color: "#166534",
    borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700,
    border: "1px solid #bbf7d055",
  },
  badgeUser: {
    backgroundColor: "#f5f5f5", color: "#666",
    borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600,
  },
  badgeOnCall: {
    backgroundColor: "#dbeafe", color: "#1d4ed8",
    borderRadius: 4, padding: "2px 6px", fontSize: 10, fontWeight: 700,
    marginLeft: 4, border: "1px solid #bfdbfe",
  },
  roleSelect: {
    border: "1px solid #ddd", borderRadius: 6,
    padding: "3px 6px", fontSize: 12, color: "#333",
    cursor: "pointer", background: "#fff",
  },
  actionBtn: {
    background: "transparent",
    border: "1px solid #ccc",
    color: "#666",
    borderRadius: 6,
    padding: "3px 9px",
    fontSize: 12,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  removeBtn: {
    background: "transparent",
    border: "1px solid #ffcccc",
    color: "#cc0000",
    borderRadius: 6,
    padding: "3px 9px",
    fontSize: 12,
    cursor: "pointer",
  },
};
