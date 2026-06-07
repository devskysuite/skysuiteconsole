import { useEffect, useState } from "react";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
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
  phone?: string;
  role?: string;
  createdAt?: any;
};

/** Format a phone string as (XXX) XXX-XXXX for 10-digit North American numbers. */
function fmtPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return raw; // return as-is if not a standard NA number
}

export default function UsersPage() {
  const isAdmin = useIsAdmin();
  const { toast, confirm } = useToast();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Inline phone editing
  const [editingPhoneId, setEditingPhoneId] = useState<string | null>(null);
  const [editPhoneValue, setEditPhoneValue] = useState("");

  // Inline email/account setup
  const [addingEmailId, setAddingEmailId] = useState<string | null>(null);
  const [addEmailValue, setAddEmailValue] = useState("");
  const [addingEmailBusy, setAddingEmailBusy] = useState(false);

  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState("");

  const isOwner = currentUserRole === "owner";

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
    all.sort((a, b) => {
      const ta = a.createdAt?.toDate?.()?.getTime?.() ?? 0;
      const tb = b.createdAt?.toDate?.()?.getTime?.() ?? 0;
      return tb - ta;
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

      await fetch("/api/send-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), type: "setup" }),
      });
      await secondaryAuth.signOut();
      await deleteApp(secondaryApp);

      // Check if a Firestore doc already exists for this employee (from bulk import)
      const existingSnap = await getDocs(
        query(collection(db, "users"), where("displayName", "==", displayName.trim()))
      );
      const existingDoc = existingSnap.docs.find((d) => {
        const data = d.data();
        // Match if uid is empty or equals the doc ID (placeholder from bulk import)
        return !data.uid || data.uid === "" || data.uid === d.id;
      });

      if (existingDoc) {
        // Link existing doc to the new Auth account
        const oldUid = existingDoc.data().uid || "";
        await updateDoc(doc(db, "users", existingDoc.id), {
          uid: newUid,
          email: email.trim(),
          phone: phone.trim() || existingDoc.data().phone || "",
        });

        // Update on-call assignments that referenced the old placeholder uid
        if (oldUid && oldUid !== newUid) {
          const assignSnap = await getDocs(
            query(collection(db, "onCallAssignments"), where("uid", "==", oldUid))
          );
          for (const aDoc of assignSnap.docs) {
            await updateDoc(doc(db, "onCallAssignments", aDoc.id), { uid: newUid });
          }
        }
      } else {
        // No existing doc — create a new one
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
    if (trimmed === (u.phone || "")) {
      setEditingPhoneId(null);
      return;
    }
    try {
      await updateDoc(doc(db, "users", u.id), { phone: trimmed });
      setEditingPhoneId(null);
      await loadUsers();
    } catch (e: any) {
      toast(`Error saving phone: ${e?.message}`, "error");
    }
  }

  async function addEmailToUser(u: AppUser) {
    const trimmedEmail = addEmailValue.trim();
    if (!trimmedEmail) { toast("Please enter an email.", "error"); return; }
    setAddingEmailBusy(true);
    try {
      const tempPassword = Math.random().toString(36).slice(-10) + "A1!";
      const secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
      const secondaryAuth = getAuth(secondaryApp);
      const { user: newUser } = await createUserWithEmailAndPassword(secondaryAuth, trimmedEmail, tempPassword);
      const newUid = newUser.uid;

      await fetch("/api/send-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, type: "setup" }),
      });
      await secondaryAuth.signOut();
      await deleteApp(secondaryApp);

      const oldUid = u.uid;
      await updateDoc(doc(db, "users", u.id), { uid: newUid, email: trimmedEmail });

      // Update on-call assignments that referenced the old placeholder uid
      if (oldUid && oldUid !== newUid) {
        const assignSnap = await getDocs(
          query(collection(db, "onCallAssignments"), where("uid", "==", oldUid))
        );
        for (const aDoc of assignSnap.docs) {
          await updateDoc(doc(db, "onCallAssignments", aDoc.id), { uid: newUid });
        }
      }

      toast(`Account created for ${u.displayName}. Setup email sent to ${trimmedEmail}.`, "success");
      setAddingEmailId(null);
      setAddEmailValue("");
      await loadUsers();
    } catch (e: any) {
      toast(e?.message ?? "Failed to create account.", "error");
    } finally {
      setAddingEmailBusy(false);
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
    if (userRole === "owner") return;  // owners cannot be deleted
    if (!isOwner) return;
    if (!await confirm(`Remove ${userEmail}?\n\nThis will fully revoke their login access.`)) return;

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error("Not authenticated");

      if (userUid) {
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
      let totalHistory = 0;
      let totalMaintenance = 0;
      for (const tool of toolsSnap.docs) {
        const histSnap = await getDocs(collection(db, "tools", tool.id, "history"));
        for (const d of histSnap.docs) {
          await deleteDoc(doc(db, "tools", tool.id, "history", d.id));
          totalHistory++;
        }
        const maintSnap = await getDocs(collection(db, "tools", tool.id, "maintenance"));
        for (const d of maintSnap.docs) {
          await deleteDoc(doc(db, "tools", tool.id, "maintenance", d.id));
          totalMaintenance++;
        }
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

  return (
    <div>
      <h1 style={styles.h1}>Manage Users</h1>

      {/* ── Add User Form ── */}
      <div style={styles.card}>
        <h2 style={styles.h2}>Add New User</h2>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>Full Name</label>
            <input
              style={styles.input}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="John Smith"
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input
              style={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@rbtautomate.com"
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Phone (optional)</label>
            <input
              style={styles.input}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="905-555-1234"
            />
          </div>
        </div>

        {error && <p style={styles.error}>{error}</p>}
        {success && <p style={styles.success}>{success}</p>}

        <button style={styles.btn} onClick={addUser} disabled={busy}>
          {busy ? "Creating…" : "+ Add User"}
        </button>
      </div>

      {/* ── Danger Zone ── */}
      {isOwner && (
        <div style={{ ...styles.card, borderColor: "#ffcccc" }}>
          <h2 style={{ ...styles.h2, color: "#cc0000" }}>Danger Zone</h2>
          <p style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>
            Permanently delete all equipment history and maintenance logs from every tool. This cannot be undone.
          </p>
          {clearResult && (
            <p style={{ fontSize: 13, color: clearResult.startsWith("Error") ? "#cc0000" : "#007700", marginBottom: 12 }}>
              {clearResult}
            </p>
          )}
          <button
            style={{ ...styles.btn, backgroundColor: "#cc0000" }}
            onClick={clearAllHistoryAndMaintenance}
            disabled={clearing}
          >
            {clearing ? "Clearing…" : "Clear All History & Maintenance Logs"}
          </button>
        </div>
      )}

      {/* ── Users List ── */}
      <div style={styles.card}>
        <h2 style={styles.h2}>Current Users</h2>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>
        ) : users.length === 0 ? (
          <p style={{ color: "#888", fontSize: 14 }}>No users added yet.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Phone</th>
                <th style={styles.th}>Role</th>
                <th style={styles.th}>Added</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isOwnerRow = u.role === "owner";
                const roleBadge = isOwnerRow ? styles.badgeOwner
                  : u.role === "admin" ? styles.badgeAdmin
                  : u.role === "manager" ? styles.badgeManager
                  : styles.badgeUser;
                const roleLabel = isOwnerRow ? "Owner"
                  : u.role === "admin" ? "Admin"
                  : u.role === "manager" ? "Manager"
                  : "User";
                // Don't show action buttons on the current user's own row
                const isSelf = u.uid === auth.currentUser?.uid;
                return (
                <tr key={u.id} style={styles.tr}>
                  <td style={styles.td}>{u.displayName || "—"}</td>
                  <td style={styles.td}>
                    {u.email ? (
                      u.email
                    ) : addingEmailId === u.id ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <input
                          style={{ ...styles.input, padding: "4px 8px", fontSize: 13, width: 160 }}
                          type="email"
                          value={addEmailValue}
                          onChange={(e) => setAddEmailValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") addEmailToUser(u); if (e.key === "Escape") setAddingEmailId(null); }}
                          placeholder="email@example.com"
                          autoFocus
                          disabled={addingEmailBusy}
                        />
                        <button
                          style={{ ...styles.promoteBtn, padding: "3px 8px", fontSize: 11 }}
                          onClick={() => addEmailToUser(u)}
                          disabled={addingEmailBusy}
                        >
                          {addingEmailBusy ? "…" : "Go"}
                        </button>
                        <button
                          style={{ ...styles.demoteBtn, padding: "3px 8px", fontSize: 11 }}
                          onClick={() => { setAddingEmailId(null); setAddEmailValue(""); }}
                          disabled={addingEmailBusy}
                        >
                          ✕
                        </button>
                      </div>
                    ) : isOwner ? (
                      <button
                        style={{ ...styles.promoteBtn, padding: "3px 10px", fontSize: 12 }}
                        onClick={() => { setAddingEmailId(u.id); setAddEmailValue(""); }}
                      >
                        + Add Email
                      </button>
                    ) : (
                      <span style={{ color: "#bbb" }}>—</span>
                    )}
                  </td>
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
                        <button style={{ ...styles.promoteBtn, padding: "3px 8px", fontSize: 11 }} onClick={() => savePhone(u)}>Save</button>
                      </div>
                    ) : (
                      <span
                        style={{ cursor: isOwner ? "pointer" : "default", color: u.phone ? "#333" : "#bbb" }}
                        onClick={() => { if (!isOwner) return; setEditingPhoneId(u.id); setEditPhoneValue(u.phone || ""); }}
                        title={isOwner ? "Click to edit" : ""}
                      >
                        {u.phone ? fmtPhone(u.phone) : "—"}
                      </span>
                    )}
                  </td>
                  <td style={styles.td}>
                    <span style={roleBadge}>{roleLabel}</span>
                  </td>
                  <td style={styles.td}>
                    {u.createdAt?.toDate
                      ? u.createdAt.toDate().toLocaleDateString("en-US", {
                          month: "long",
                          day: "2-digit",
                          year: "numeric",
                        })
                      : "—"}
                  </td>
                  <td style={{ ...styles.td, display: "flex", gap: 8, alignItems: "center" }}>
                    {isOwner && !isSelf && (
                      <>
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
                        {!isOwnerRow && (
                          <button
                            style={styles.removeBtn}
                            onClick={() => removeUser(u.id, u.email, u.uid, u.role ?? "")}
                          >
                            Remove
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  h1: { fontSize: 24, fontWeight: 800, marginBottom: 20 },
  h2: { fontSize: 16, fontWeight: 700, marginBottom: 16, color: "#333" },
  card: {
    border: "1px solid #e5e5e5",
    borderRadius: 12,
    padding: 24,
    marginBottom: 24,
    backgroundColor: "#fff",
  },
  row: { display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 },
  field: { display: "flex", flexDirection: "column", flex: 1, minWidth: 200 },
  label: { fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#555" },
  input: { border: "1px solid #ddd", borderRadius: 8, padding: "9px 12px", fontSize: 14 },
  btn: {
    backgroundColor: "#1e7d3a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 22px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  error: { color: "#cc0000", fontSize: 13, marginBottom: 12 },
  success: { color: "#007700", fontSize: 13, marginBottom: 12 },
  table: { width: "100%", borderCollapse: "collapse" },
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
  td: { padding: "12px 8px 12px 0", fontSize: 14, color: "#333" },
  badgeOwner: {
    backgroundColor: "#fff8e1",
    color: "#b45309",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 12,
    fontWeight: 700,
    border: "1px solid #f59e0b55",
  },
  badgeAdmin: {
    backgroundColor: "#e8f0ff",
    color: "#1e7d3a",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 12,
    fontWeight: 700,
  },
  badgeManager: {
    backgroundColor: "#f0fdf4",
    color: "#166534",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 12,
    fontWeight: 700,
    border: "1px solid #bbf7d055",
  },
  badgeUser: {
    backgroundColor: "#f5f5f5",
    color: "#666",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 12,
    fontWeight: 600,
  },
  roleSelect: {
    border: "1px solid #ddd",
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: 13,
    color: "#333",
    cursor: "pointer",
    background: "#fff",
  },
  promoteBtn: {
    background: "transparent",
    border: "1px solid #1e7d3a",
    color: "#1e7d3a",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
  },
  demoteBtn: {
    background: "transparent",
    border: "1px solid #888",
    color: "#666",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
  },
  removeBtn: {
    background: "transparent",
    border: "1px solid #ffcccc",
    color: "#cc0000",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
  },
};
