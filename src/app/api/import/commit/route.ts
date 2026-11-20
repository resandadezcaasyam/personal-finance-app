import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { assertSameOrigin, fail } from "@/lib/http";
import { LedgerError } from "@/lib/ledger/errors";
import { normalizeRows, type Table } from "@/lib/imports/table";
import { loadMatcher } from "@/lib/capture/rules";
import { commitStatementImport } from "@/lib/inbox/import-commit";
import { todayWIB } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const col = z.number().int().min(0).max(200).nullable();
const body = z.object({
  fileName: z.string().max(200).nullable(),
  fileHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  kind: z.enum(["csv", "xlsx", "pdf"]),
  scanned: z.boolean().optional(),
  accountId: z.number().int().positive(),
  table: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).max(6000),
  mapping: z.object({
    header_row: z.number().int().min(-1).max(200), date: col, description: col, debit: col, credit: col, amount: col, dc: col, reference: col, balance: col,
    date_format: z.enum(["auto", "dmy", "mdy", "ymd"]), number_format: z.enum(["auto", "id", "en"]), positive_is: z.enum(["income", "expense"]).nullable(),
  }),
});

/** The server re-normalizes the rows from the table + mapping, so the inbox only ever receives rows it validated itself. */
export async function POST(req: Request) {
  const bad = assertSameOrigin(req);
  if (bad) return bad;
  try {
    const b = body.parse(await req.json());
    const today = todayWIB();
    const norm = normalizeRows(b.table as Table, b.mapping, today);
    const db = getDb();
    const s = commitStatementImport(db, { sourceType: b.kind, fileName: b.fileName, fileHash: b.fileHash, accountId: b.accountId, rows: norm.rows, errors: norm.errors, skipped: norm.skipped, ocr: b.scanned, matcher: loadMatcher(db), today });
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true, ...s });
  } catch (e) {
    if (e instanceof LedgerError) return fail(e.message, e.field === "file" ? 409 : 422);
    if (e instanceof z.ZodError) return fail("Data impor tidak valid.", 400);
    console.error("[import/commit]", e);
    return fail("Terjadi kesalahan saat mengimpor. Tidak ada data yang berubah.", 500);
  }
}
