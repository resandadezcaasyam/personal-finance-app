import { NextResponse } from "next/server";
import { getDbStatus } from "@/lib/db/status";
import { hasValidSession } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export function GET() {
  // While locked, reveal nothing about the data.
  if (!hasValidSession()) return NextResponse.json({ ok: true, locked: true });
  try {
    const s = getDbStatus();
    return NextResponse.json({ ok: true, profile: s.profile, schemaVersion: s.schemaVersion });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
