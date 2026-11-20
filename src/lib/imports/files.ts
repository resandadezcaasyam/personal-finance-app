import { PNG } from "pngjs";
import { ocrImage } from "./ocr";
import { itemsToLines, linesToTable, textLinesToTable, guessTextTableMapping, type TextItem } from "./pdf-table";
import { guessMapping, type Cell, type Mapping, type Table } from "./table";

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_ROWS = 5000;
const MAX_OCR_PAGES = 12;

export type FileKind = "csv" | "xlsx" | "pdf" | "image";

export function detectKind(name: string, bytes: Buffer): FileKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (bytes.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && ["xlsx", "xlsm"].includes(ext)) return "xlsx";
  if (["csv", "tsv", "txt"].includes(ext)) return "csv";
  if (bytes.subarray(1, 4).toString("latin1") === "PNG" || (bytes[0] === 0xff && bytes[1] === 0xd8) || ["png", "jpg", "jpeg", "bmp", "webp"].includes(ext)) return "image";
  return null;
}

export async function readSpreadsheet(bytes: Buffer): Promise<Table> {
  const { default: readXlsxFile } = await import("read-excel-file/node");
  const sheets = (await readXlsxFile(bytes)) as unknown as { sheet: string; data: unknown[][] }[] | unknown[][];
  const list = Array.isArray(sheets) && sheets.length && !Array.isArray(sheets[0]) ? (sheets as { data: unknown[][] }[]).map((s) => s.data) : [sheets as unknown[][]];
  const biggest = list.sort((a, b) => b.length - a.length)[0] ?? [];
  const cell = (v: unknown): Cell => {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (typeof v === "number") return v;
    return String(v).trim();
  };
  return biggest.map((r) => r.map(cell)).filter((r) => r.some((c) => c !== null)).slice(0, MAX_ROWS + 50);
}

interface PdfOutcome { table: Table; mapping: Mapping; scanned: boolean; pages: number; note: string | null }

export async function readPdf(bytes: Buffer): Promise<PdfOutcome> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
  const pageLines = [];
  let chars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const items: TextItem[] = [];
    for (const it of tc.items as { str?: string; transform: number[]; width: number }[]) {
      if (typeof it.str !== "string") continue;
      chars += it.str.trim().length;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.hypot(it.transform[2], it.transform[3]) });
    }
    pageLines.push(itemsToLines(items));
  }
  const pages = doc.numPages;
  await doc.destroy();

  if (chars >= 30) {
    const { table, hasHeader } = linesToTable(pageLines);
    if (hasHeader) return { table, mapping: guessMapping(table), scanned: false, pages, note: null };
    const t = textLinesToTable(table.map((r) => r.map(String).join("  ")));
    return { table: t, mapping: guessTextTableMapping(t), scanned: false, pages, note: "Kolom tabel tidak dikenali di PDF ini. Periksa pemetaan kolom dengan teliti." };
  }

  // No text layer: render each page and run OCR (slower, and less exact than a text PDF).
  const lines: string[] = [];
  for (const png of await renderPdfPages(bytes, MAX_OCR_PAGES)) lines.push(...(await ocrImage(png)).text.split(/\r?\n/));
  const t = textLinesToTable(lines);
  return { table: t, mapping: guessTextTableMapping(t), scanned: true, pages, note: "PDF hasil pindai dibaca dengan OCR. Periksa setiap baris sebelum disetujui." };
}

/** Render PDF pages to PNG with PDFium (WebAssembly, offline). */
export async function renderPdfPages(bytes: Buffer, maxPages: number): Promise<Buffer[]> {
  const { PDFiumLibrary } = await import("@hyzyla/pdfium");
  const lib = await PDFiumLibrary.init();
  try {
    const doc = await lib.loadDocument(bytes);
    const out: Buffer[] = [];
    try {
      const n = Math.min(doc.getPageCount(), maxPages);
      for (let i = 0; i < n; i++) {
        const img = await doc.getPage(i).render({ scale: 2, render: "bitmap" });
        const png = new PNG({ width: img.width, height: img.height });
        const src = img.data;
        for (let p = 0; p < img.width * img.height; p++) { // PDFium bitmaps are BGRA
          png.data[p * 4] = src[p * 4 + 2]; png.data[p * 4 + 1] = src[p * 4 + 1]; png.data[p * 4 + 2] = src[p * 4]; png.data[p * 4 + 3] = 255;
        }
        out.push(PNG.sync.write(png));
      }
    } finally { doc.destroy(); }
    return out;
  } finally { lib.destroy(); }
}
