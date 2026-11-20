import fs from "node:fs";
import { NextResponse } from "next/server";
import { backupDir } from "@/lib/db/paths";
import { safeBackupPath } from "@/lib/backup/backup";
import { LedgerError } from "@/lib/ledger/errors";
import { requireSession } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download one backup file (for keeping a copy elsewhere). Only plain file names inside the backup folder are accepted. */
export async function GET(req: Request) {
  const locked = requireSession();
  if (locked) return locked;
  try {
    const name = new URL(req.url).searchParams.get("name") ?? "";
    const file = safeBackupPath(backupDir(), name);
    return new NextResponse(fs.readFileSync(file), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof LedgerError ? e.message : "Gagal mengunduh." }, { status: e instanceof LedgerError ? 400 : 500 });
  }
}
