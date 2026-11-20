import { fieldOfHeader, parseDateCell, type Cell, type Table, type Mapping, EMPTY_MAPPING } from "./table";

export interface TextItem { str: string; x: number; y: number; w: number; h: number }
interface PCell { text: string; x0: number; x1: number }

/** Group positioned text fragments into lines (top to bottom) and cells (split where there is a visible gap). */
export function itemsToLines(items: TextItem[]): PCell[][] {
  const real = items.filter((i) => i.str.trim() !== "");
  const sorted = [...real].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItem[][] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    const tol = Math.max(2, (it.h || 8) * 0.4);
    if (last && Math.abs(last[0].y - it.y) <= tol) last.push(it);
    else lines.push([it]);
  }
  return lines.map((line) => {
    const row = [...line].sort((a, b) => a.x - b.x);
    const cells: PCell[] = [];
    for (const it of row) {
      const prev = cells[cells.length - 1];
      const gap = prev ? it.x - prev.x1 : Infinity;
      const thresh = Math.max(5, (it.h || 8) * 0.7);
      if (prev && gap <= thresh) { prev.text += (gap > 1 ? " " : "") + it.str.trim(); prev.x1 = it.x + it.w; }
      else cells.push({ text: it.str.trim(), x0: it.x, x1: it.x + it.w });
    }
    return cells;
  });
}

const isDate = (t: string) => parseDateCell(t) !== null;

/**
 * Rebuild a statement table from positioned text. The header row fixes the column positions; each later cell goes to
 * the nearest header column (by left edge, right edge or centre, so left-, right- and centre-aligned columns all work).
 * Lines that start with a date open a new row; other lines continue the previous description.
 * Returns hasHeader=false when no header was recognised, in which case rows are plain cell lists.
 */
export function linesToTable(pages: PCell[][][]): { table: Table; hasHeader: boolean } {
  const flat = pages.flat();
  const headerIdx = flat.findIndex((cells) => new Set(cells.map((c) => fieldOfHeader(c.text)).filter(Boolean)).size >= 3);
  if (headerIdx < 0) return { table: flat.map((cells) => cells.map((c) => c.text)), hasHeader: false };
  const header = flat[headerIdx];
  const headerKey = header.map((c) => c.text.toLowerCase()).join("|");
  const nearest = (c: PCell) => {
    let best = 0, bestD = Infinity;
    header.forEach((h, i) => {
      const d = Math.min(Math.abs(c.x0 - h.x0), Math.abs(c.x1 - h.x1), Math.abs((c.x0 + c.x1) / 2 - (h.x0 + h.x1) / 2));
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };
  const rows: string[][] = [];
  for (const cells of flat.slice(headerIdx + 1)) {
    if (cells.map((c) => c.text.toLowerCase()).join("|") === headerKey) continue; // header repeated on each page
    const row = Array<string>(header.length).fill("");
    for (const c of cells) { const i = nearest(c); row[i] = row[i] ? `${row[i]} ${c.text}` : c.text; }
    const startsRow = cells.some((c) => isDate(c.text) && nearest(c) === (dateCol(header) ?? 0));
    if (startsRow || rows.length === 0) rows.push(row);
    else {
      const prev = rows[rows.length - 1];
      // Continuation line: only ever extends text columns, never invents amounts.
      row.forEach((v, i) => { if (v && !/^[\d.,\-()\s]+$/.test(v)) prev[i] = prev[i] ? `${prev[i]} ${v}` : v; });
    }
  }
  return { table: [header.map((c) => c.text), ...rows], hasHeader: true };
}

const dateCol = (header: PCell[]) => { const i = header.findIndex((h) => fieldOfHeader(h.text) === "date"); return i < 0 ? null : i; };

/**
 * Fallback for text without usable columns (scanned pages, e-wallet exports): a line that starts with a date becomes
 * [date, description, number, number, ...]. Lines without a date continue the previous description.
 */
export function textLinesToTable(lines: string[]): Table {
  const rows: Cell[][] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{2,4})\s+(.*)$/);
    if (!m) {
      const prev = rows[rows.length - 1];
      if (prev && !/\d{3}/.test(line)) prev[1] = `${prev[1]} ${line}`.trim();
      continue;
    }
    const tokens = m[2].split(/\s+/);
    const numRe = /^(?:rp\.?)?-?\(?\d[\d.,]*\)?(?:\s?(?:db|cr|dr|kr))?$/i;
    let i = tokens.length;
    while (i > 0 && numRe.test(tokens[i - 1]) && /[.,]\d{2,3}|\d{4,}/.test(tokens[i - 1])) i--;
    rows.push([m[1], tokens.slice(0, i).join(" "), ...tokens.slice(i)]);
  }
  const width = Math.max(2, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array<Cell>(width - r.length).fill("")]);
}

/** Mapping for the [date, description, number, number...] shape produced by textLinesToTable. */
export function guessTextTableMapping(table: Table): Mapping {
  const width = table[0]?.length ?? 0;
  const m: Mapping = { ...EMPTY_MAPPING, header_row: -1, date: 0, description: 1 };
  if (width >= 4) { m.amount = 2; m.balance = 3; } else if (width === 3) m.amount = 2;
  return m;
}
