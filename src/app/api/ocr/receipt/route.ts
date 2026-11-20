import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { assertSameOrigin, fail, requireSession } from "@/lib/http";
import { LedgerError } from "@/lib/ledger/errors";
import { detectKind } from "@/lib/imports/files";
import { ocrImage } from "@/lib/imports/ocr";
import { extractReceipt } from "@/lib/capture/receipt";
import { loadMatcher } from "@/lib/capture/rules";
import { commitReceipt } from "@/lib/inbox/import-commit";
import { fileHash } from "@/lib/inbox/fingerprint";
import { todayWIB } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** One image per request (the page sends a batch one by one, so progress and failures are per file). */
export async function POST(req: Request) {
  const locked = requireSession();
  if (locked) return locked;
  const bad = assertSameOrigin(req);
  if (bad) return bad;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail("Pilih gambar struk atau screenshot.");
    if (file.size > MAX_IMAGE_BYTES) return fail("Gambar terlalu besar (maksimal 10 MB).", 413);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (detectKind(file.name, bytes) !== "image") return fail("File ini bukan gambar (PNG/JPG).", 415);
    const hash = fileHash(bytes);
    const db = getDb();
    const dup = db.prepare("SELECT id, created_at FROM import_batches WHERE file_hash = ?").get(hash) as { id: number; created_at: string } | undefined;
    if (dup) return NextResponse.json({ ok: false, duplicate: true, error: `Gambar ini sudah pernah diproses pada ${dup.created_at.slice(0, 10)}.` }, { status: 409 });

    const { text, confidence } = await ocrImage(bytes);
    const today = todayWIB();
    const ex = extractReceipt(text, { today, ocrConfidence: confidence });
    const r = commitReceipt(db, { fileName: file.name, fileHash: hash, extraction: ex, ocrText: text, matcher: loadMatcher(db), today });
    revalidatePath("/", "layout");
    return NextResponse.json({
      ok: true, created: r.created, itemId: r.itemId, ocrConfidence: Math.round(confidence),
      result: { amount: ex.amount, fee: ex.fee, date: ex.occurred_on, merchant: ex.merchant, reference: ex.reference, method: ex.payment_method, confidence: ex.confidence, issues: ex.issues },
      message: r.created ? null : "Struk dengan nomor referensi yang sama sudah ada di kotak masuk.",
    });
  } catch (e) {
    if (e instanceof LedgerError) return fail(e.message, 409);
    console.error("[ocr/receipt]", e);
    return fail(e instanceof Error ? `Gagal membaca gambar: ${e.message}` : "Gagal membaca gambar.", 422);
  }
}
