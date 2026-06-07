/**
 * CSV export utility.
 * Downloads an array of flat objects as a .csv file.
 */
export function downloadCSV(data: Record<string, string | number>[], filename: string): void {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(","),
    ...data.map(row => headers.map(h => {
      const val = String(row[h] ?? "");
      return val.includes(",") || val.includes("\n") || val.includes('"')
        ? `"${val.replace(/"/g, '""')}"`
        : val;
    }).join(","))
  ];
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
