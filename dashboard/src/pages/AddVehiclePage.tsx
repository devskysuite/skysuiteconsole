import { useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { useIsAdmin } from "../hooks/useIsAdmin";

export default function AddVehiclePage() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const [vehicleId, setVehicleId] = useState("");
  const [name, setName]           = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");

  if (isAdmin === null) return <p>Loading…</p>;
  if (!isAdmin) return <p style={{ color: "#d32f2f", fontWeight: 700 }}>Access denied. Admins only.</p>;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const id = vehicleId.trim();
    const nm = name.trim();
    if (!id || !nm) { setError("Both Vehicle ID and Vehicle Name are required."); return; }

    try {
      setSaving(true);
      // Safety check in case of collision
      const existing = await getDoc(doc(db, "vehicles", id));
      if (existing.exists()) { setError(`Vehicle ID "${id}" already exists.`); return; }

      await setDoc(doc(db, "vehicles", id), {
        vehicleId: id,
        name: nm,
        status: "IN_SHOP",
      });

      navigate(`/vehicles/${encodeURIComponent(id)}`);
    } catch (err: any) {
      setError(err?.message ?? "Failed to create vehicle");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 style={styles.pageTitle}>Add New Vehicle</h1>

      <div style={styles.card}>
        <form onSubmit={handleSubmit}>
          <label style={styles.label}>Vehicle ID</label>
          <input
            style={styles.input}
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            placeholder="e.g. V-001, PLATE-ABC"
            autoFocus
          />

          <label style={styles.label}>Vehicle Name</label>
          <input
            style={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 2024 Ford F-150"
          />

          {error && <p style={styles.error}>{error}</p>}

          <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
            <button type="submit" style={styles.btn} disabled={saving}>
              {saving ? "Creating…" : "Create Vehicle"}
            </button>
            <button type="button" style={styles.btnOutline} onClick={() => navigate("/vehicles")}>
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
  input:     { width: "100%", border: "1px solid #ddd", borderRadius: 8, padding: "10px 12px", fontSize: 15, boxSizing: "border-box" as const, background: "#fff" },
  btn:       { background: "#1e7d3a", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  btnOutline:{ background: "#fff", color: "#1e7d3a", border: "1px solid #1e7d3a", borderRadius: 8, padding: "10px 24px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  error:     { color: "#d32f2f", fontSize: 13, marginTop: 10 },
};
