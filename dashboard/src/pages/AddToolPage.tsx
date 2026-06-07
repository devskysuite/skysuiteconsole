import { useState, useEffect } from "react";
import { collection, getDocs, doc, getDoc, setDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { useCategories } from "../hooks/useCategories";

export default function AddToolPage() {
  const navigate = useNavigate();
  const [toolId, setToolId]     = useState("");
  const [name, setName]         = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [loadingId, setLoadingId] = useState(true);
  const categories = useCategories();

  // Auto-generate the next Equipment ID on mount
  useEffect(() => {
    async function generateNextId() {
      try {
        const snap = await getDocs(collection(db, "tools"));
        const nums = snap.docs
          .map((d) => d.id)
          .filter((id) => /^TL-\d+$/i.test(id))
          .map((id) => parseInt(id.replace(/^TL-/i, ""), 10))
          .filter((n) => !isNaN(n));
        const max = nums.length > 0 ? Math.max(...nums) : 0;
        const next = String(max + 1).padStart(4, "0");
        setToolId(`TL-${next}`);
      } catch {
        setToolId("TL-0001");
      } finally {
        setLoadingId(false);
      }
    }
    generateNextId();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const id = toolId.trim();
    const nm = name.trim();
    if (!id || !nm)       { setError("Equipment name is required."); return; }
    if (!category)        { setError("Please select a category."); return; }

    try {
      setSaving(true);
      // Safety check in case of collision
      const existing = await getDoc(doc(db, "tools", id));
      if (existing.exists()) { setError(`Equipment ID "${id}" already exists.`); return; }

      await setDoc(doc(db, "tools", id), {
        toolId: id,
        name: nm,
        category,
        status: "IN_SHOP",
      });

      navigate(`/tools/${encodeURIComponent(id)}`);
    } catch (err: any) {
      setError(err?.message ?? "Failed to create equipment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 style={styles.pageTitle}>Add New Equipment</h1>

      <div style={styles.card}>
        <form onSubmit={handleSubmit}>
          <label style={styles.label}>Equipment ID</label>
          <div style={styles.idDisplay}>
            <span style={styles.idText}>
              {loadingId ? "Generating…" : toolId}
            </span>
          </div>

          <label style={styles.label}>Equipment Name</label>
          <input
            style={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hammer Drill"
            autoFocus
          />

          <label style={styles.label}>Category</label>
          <select
            style={styles.input}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Select a category…</option>
            {categories.filter((c) => c.toLowerCase() !== "vehicles").map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {error && <p style={styles.error}>{error}</p>}

          <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
            <button type="submit" style={styles.btn} disabled={saving || loadingId}>
              {saving ? "Creating…" : "Create Equipment"}
            </button>
            <button type="button" style={styles.btnOutline} onClick={() => navigate("/tools")}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageTitle: { fontSize: 28, fontWeight: 900, color: "#1e7d3a", marginBottom: 24 },
  card:      { background: "#fff", borderRadius: 12, padding: 28, maxWidth: 480, boxShadow: "0 1px 6px rgba(0,0,0,0.06)", border: "1px solid #e5e5e5" },
  label:     { display: "block", fontSize: 13, fontWeight: 700, color: "#333", marginTop: 18, marginBottom: 4 },
  idDisplay: { display: "flex", alignItems: "center", gap: 10, background: "#f7f9fc", border: "1px solid #ddd", borderRadius: 8, padding: "10px 14px" },
  idText:    { fontSize: 16, fontWeight: 700, color: "#1e7d3a", letterSpacing: 1, flex: 1 },
  input:     { width: "100%", border: "1px solid #ddd", borderRadius: 8, padding: "10px 12px", fontSize: 15, boxSizing: "border-box" as const, background: "#fff" },
  btn:       { background: "#1e7d3a", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  btnOutline:{ background: "#fff", color: "#1e7d3a", border: "1px solid #1e7d3a", borderRadius: 8, padding: "10px 24px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  error:     { color: "#d32f2f", fontSize: 13, marginTop: 10 },
};
