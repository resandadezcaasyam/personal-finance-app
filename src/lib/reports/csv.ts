/**
 * CSV for spreadsheets. Cells that start with = + - @ (or a tab/CR) are prefixed with an apostrophe so a spreadsheet never
 * runs them as a formula ("CSV injection"); numbers are written as plain integers. UTF-8 with a BOM so Excel reads accents.
 */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  let s = v.replace(/\r?\n/g, " ");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return `\uFEFF${[headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
