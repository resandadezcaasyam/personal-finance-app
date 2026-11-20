import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { assertSameOrigin, fail, requireSession } from "@/lib/http";
import { detectKind, MAX_FILE_BYTES, MAX_ROWS, readPdf, readSpreadsheet } from "@/lib/imports/files";
import { ocrImage } from "@/lib/imports/ocr";
import { guessMapping, headerSignature, parseCsv, type Mapping, type Table } from "@/lib/imports/table";
import { guessTextTableMapping, textLinesToTable } from "@/lib/imports/pdf-table";
import { listImportTemplates } from "@/lib/imports/templates";
import { fileHash } from "@/lib/inbox/fingerprint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function decode(bytes: Buffer): string {
  const utf8 = bytes.toString("utf8");
  return utf8.includes("\uFFFD") ? new TextDecoder("windows-1252").decode(bytes) : utf8; // many Indonesian bank exports are not UTF-8
}

export async function POST(req: Request) {
  const locked = requireSession();
  if (locked) return locked;
  const bad = assertSameOrigin(req);
  if (bad) return bad;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail("Pilih sebuah file.");
    if (file.size > MAX_FILE_BYTES) return fail(`File terlalu besar (maksimal ${MAX_FILE_BYTES / 1024 / 1024} MB).`, 413);
    const bytes = Buffer.from(await file.arrayBuffer());
    const kind = detectKind(file.name, bytes);
    if (!kind) return fail("Format file tidak didukung. Gunakan CSV, XLSX, atau PDF.", 415);

    let table: Table;
    let mapping: Mapping;
    let scanned = false;
    let note: string | null = null;
    if (kind === "csv") { table = parseCsv(decode(bytes)); mapping = guessMapping(table); }
    else if (kind === "xlsx") { table = await readSpreadsheet(bytes); mapping = guessMapping(table); }
    else if (kind === "pdf") { const r = await readPdf(bytes); ({ table, mapping, scanned, note } = r); }
    else {
      const { text } = await ocrImage(bytes);
      table = textLinesToTable(text.split(/\r?\n/)); mapping = guessTextTableMapping(table); scanned = true;
      note = "Gambar dibaca dengan OCR. Periksa setiap baris sebelum disetujui.";
    }
    if (table.length === 0) return fail("Tidak ada data yang terbaca dari file ini.", 422);
    const truncated = table.length > MAX_ROWS + 50;
    if (truncated) table = table.slice(0, MAX_ROWS + 50);

    const signature = headerSignature(table, mapping);
    const saved = listImportTemplates(getDb()).find((t) => t.header_signature === signature && signature.length > 0);
    return NextResponse.json({
      ok: true, fileName: file.name, fileHash: fileHash(bytes), kind: kind === "image" ? "pdf" : kind, scanned, note: truncated ? `${note ?? ""} Hanya ${MAX_ROWS} baris pertama yang dibaca.`.trim() : note,
      table, mapping: saved ? saved.mapping : mapping, signature, usedTemplate: saved ? saved.name : null,
      templates: listImportTemplates(getDb()).map((t) => ({ id: t.id, name: t.name, mapping: t.mapping })),
    });
  } catch (e) {
    console.error("[import/parse]", e);
    return fail(e instanceof Error ? `Gagal membaca file: ${e.message}` : "Gagal membaca file.", 422);
  }
}
