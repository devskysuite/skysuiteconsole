import { useState } from "react";
import ToolsTabs from "../components/ToolsTabs";
import { useRepairContacts } from "../hooks/useRepairContacts";
import { CONTACT_TYPES, type ContactType } from "../hooks/useRepairContacts";
import Spinner from "../components/Spinner";

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

export default function ContactsPage() {
  const contacts = useRepairContacts();
  const [selectedType, setSelectedType] = useState<ContactType | "">("");

  const loading = contacts.length === 0;

  // Group contacts by type (default to "Equipment Repair" for legacy contacts)
  const grouped: Record<string, typeof contacts> = {};
  for (const c of contacts) {
    const type = c.contactType ?? "Equipment Repair";
    if (selectedType && type !== selectedType) continue;
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(c);
  }

  // Display types in the order defined in CONTACT_TYPES
  const orderedTypes = CONTACT_TYPES.filter((t) => grouped[t] && grouped[t].length > 0);

  const totalVisible = orderedTypes.reduce((sum, t) => sum + grouped[t].length, 0);

  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      <ToolsTabs />
      <h1 style={styles.pageTitle}>Contacts</h1>

      {/* Type filter */}
      <div style={styles.filterRow}>
        <label style={styles.filterLabel}>Filter by Type:</label>
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value as ContactType | "")}
          style={styles.select}
        >
          <option value="">All Types</option>
          {CONTACT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center" }}>
          <Spinner />
        </div>
      ) : totalVisible === 0 ? (
        <div style={styles.emptyBox}>
          {selectedType
            ? `No contacts found for "${selectedType}"`
            : "No contacts available"}
        </div>
      ) : (
        <div>
          {orderedTypes.map((type) => (
            <div key={type} style={{ marginBottom: 28 }}>
              <h2 style={styles.sectionHeader}>{type}</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {grouped[type].map((c) => (
                  <div key={c.id} style={styles.contactCard}>
                    <p style={styles.header}>{c.header}</p>
                    {c.company && (
                      <p style={styles.field}>
                        <strong>Company:</strong> {c.company}
                      </p>
                    )}
                    {c.contact && (
                      <p style={styles.field}>
                        <strong>Contact:</strong> {c.contact}
                      </p>
                    )}
                    {c.phone && (
                      <p style={styles.field}>
                        <strong>Phone:</strong>{" "}
                        <a href={`tel:${c.phone}`} style={styles.phoneLink}>
                          {c.phone}
                        </a>
                      </p>
                    )}
                    {c.address && (
                      <div style={{ margin: "3px 0" }}>
                        <p style={{ ...styles.field, margin: 0 }}>
                          <strong>Address:</strong> {c.address}
                        </p>
                        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                          {isIOS && (
                            <a
                              href={`https://maps.apple.com/?q=${encodeURIComponent(c.address)}`}
                              target="_blank"
                              rel="noreferrer"
                              style={styles.mapLink}
                            >
                              Apple Maps
                            </a>
                          )}
                          <a
                            href={`https://maps.google.com/?q=${encodeURIComponent(c.address)}`}
                            target="_blank"
                            rel="noreferrer"
                            style={styles.mapLink}
                          >
                            Google Maps
                          </a>
                        </div>
                      </div>
                    )}
                    {c.categories && c.categories.length > 0 && (
                      <div
                        style={{
                          marginTop: 8,
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 5,
                        }}
                      >
                        {c.categories.map((cat) => (
                          <span key={cat} style={styles.catChip}>
                            {cat}
                          </span>
                        ))}
                      </div>
                    )}
                    {c.notes && (
                      <p style={styles.notes}><strong>Notes:</strong> {c.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageTitle: {
    fontSize: 28,
    fontWeight: 900,
    color: "#1e7d3a",
    marginBottom: 24,
  },
  filterRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: 700,
    color: "#333",
  },
  select: {
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 14,
    minWidth: 180,
    background: "#fff",
  },
  emptyBox: {
    background: "#f8f9fa",
    border: "1px solid #e5e5e5",
    borderRadius: 10,
    padding: "16px 20px",
    color: "#888",
    fontWeight: 600,
    maxWidth: 680,
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: 800,
    color: "#1e7d3a",
    marginBottom: 10,
    paddingBottom: 6,
    borderBottom: "2px solid #e5e5e5",
  },
  contactCard: {
    background: "#fff",
    borderRadius: 10,
    padding: "14px 16px",
    border: "1px solid #e5e5e5",
    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
  },
  header: {
    fontWeight: 800,
    fontSize: 14,
    marginBottom: 6,
    color: "#111",
  },
  field: {
    fontSize: 13,
    color: "#555",
    margin: "3px 0",
  },
  phoneLink: {
    color: "#1e7d3a",
    textDecoration: "none",
    fontWeight: 600,
  },
  mapLink: {
    fontSize: 12,
    color: "#1e7d3a",
    textDecoration: "none",
    fontWeight: 600,
    background: "#eef2f7",
    border: "1px solid #c5d3e8",
    borderRadius: 6,
    padding: "2px 8px",
  },
  catChip: {
    background: "#eef2f7",
    color: "#1e7d3a",
    border: "1px solid #c5d3e8",
    borderRadius: 12,
    padding: "2px 10px",
    fontSize: 12,
    fontWeight: 600,
  },
  notes: {
    fontSize: 13,
    color: "#555",
    marginTop: 8,
  },
};
