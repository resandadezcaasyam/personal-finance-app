import { NextResponse } from "next/server";

/**
 * The app only listens on localhost, but a web page open in the same browser could still try to POST to it.
 * State-changing routes therefore require the request to originate from this same host.
 */
export function assertSameOrigin(req: Request): NextResponse | null {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return NextResponse.json({ ok: false, error: "Permintaan ditolak (asal tidak sesuai)." }, { status: 403 });
    } catch {
      return NextResponse.json({ ok: false, error: "Permintaan ditolak." }, { status: 403 });
    }
  }
  return null;
}

export const fail = (message: string, status = 400) => NextResponse.json({ ok: false, error: message }, { status });
