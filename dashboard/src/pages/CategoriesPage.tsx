import { useEffect, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import { useToast } from "../components/Toast";
import Spinner from "../components/Spinner";

const DEFAULT_CATEGORIES = ["Aerial Lifts", "Hand Tools", "Job Boxes", "Ladders", "Power Tools"];

type Category = { id: string; name: string };

export default function CategoriesPage() {
  const { confirm } = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading]       = useState(true);
  const [newName, setNewName]       = useState("");
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");

  async function load() {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "categories"), orderBy("name", "asc")));
      if (snap.empty) {
        // Seed default categories on first visit
        await Promise.all(
          DEFAULT_CATEGORIES.map((name) =>
            addDoc(collection(db, "categories"), {
              name,
              createdAt: serverTimestamp(),
              createdByUid: auth.currentUser?.uid ?? "",
            })
          )
        );
        const seeded = await getDocs(query(collection(db, "categories"), orderBy("name", "asc")));
        setCategories(seeded.docs.map((d) => ({ id: d.id, name: d.data().name })));
      } else {
        setCategories(snap.docs.map((d) => ({ id: d.id, name: d.data().name })));
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load categories");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function addCategory() {
    const name = newName.trim();
    if (!name) return;
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setError(`"${name}" already exists.`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await addDoc(collection(db, "categories"), {
        name,
        createdAt: serverTimestamp(),
        createdByUid: auth.currentUser?.uid ?? "",
      });
      setNewName("");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Failed to add category");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCategory(id: string, name: string) {
    if (!await confirm(`Delete category "${name}"?\n\nEquipment assigned this category will show "\u2014" until updated.`)) return;
    try {
      await deleteDoc(doc(db, "categories", id));
      setCategories((prev) => prev.filter((c) => c.id !== id));
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete category");
    }
  }

  return (
    <div>
      <h1 style={styles.pageTitle}>Categories</h1>

      {/* Add category */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>Add Category</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            style={styles.input}
            placeholder="e.g. Compressors"
            value={newName}
            onChange={(e) => { setNewName(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && addCategory()}
          />
          <button style={styles.btn} onClick={addCategory} disabled={saving || !newName.trim()}>
            {saving ? "Adding…" : "+ Add"}
          </button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
      </div>

      {/* Category list */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>
          All Categories
          {!loading && <span style={styles.countBadge}>{categories.length}</span>}
        </h2>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>
        ) : categories.length === 0 ? (
          <p style={{ color: "#aaa", fontSize: 14 }}>No categories yet.</p>
        ) : (
          <ul style={styles.list}>
            {categories.map((c) => (
              <li key={c.id} style={styles.listItem}>
                <span style={styles.catName}>{c.name}</span>
                <button style={styles.deleteBtn} onClick={() => deleteCategory(c.id, c.name)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageTitle:    { fontSize: 28, fontWeight: 900, color: "#1e7d3a", marginBottom: 24 },
  card:         { background: "#fff", borderRadius: 12, padding: 24, marginBottom: 20, boxShadow: "0 1px 6px rgba(0,0,0,0.06)", border: "1px solid #e5e5e5", maxWidth: 540 },
  sectionTitle: { fontSize: 16, fontWeight: 800, color: "#111", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 },
  input:        { flex: 1, border: "1px solid #ddd", borderRadius: 8, padding: "9px 12px", fontSize: 14, maxWidth: 320, outline: "none" },
  btn:          { background: "#1e7d3a", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" as const },
  error:        { color: "#d32f2f", fontSize: 13, marginTop: 10 },
  list:         { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 },
  listItem:     { display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f8f9fa", borderRadius: 8, padding: "10px 14px", border: "1px solid #e5e5e5" },
  catName:      { fontWeight: 600, fontSize: 14, color: "#111" },
  deleteBtn:    { background: "none", border: "1px solid #e53e3e", color: "#e53e3e", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  countBadge:   { background: "#eef2f7", color: "#1e7d3a", border: "1px solid #c5d3e8", borderRadius: 6, padding: "2px 8px", fontSize: 13 },
};
