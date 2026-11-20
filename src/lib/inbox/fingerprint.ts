import { createHash } from "node:crypto";
import { normalizeText } from "../capture/text";

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 24);

export function fileHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Stable identity of a statement line. With a bank reference it is account + reference + amount; without one it is
 * account + date + amount + type + normalized text + the occurrence number among identical lines in the same file.
 * The occurrence number keeps two genuine identical purchases apart while still letting an overlapping statement
 * recreate the same fingerprints (so re-imports skip them).
 */
export function lineFingerprint(f: { account_id: number; occurred_on: string; amount: number; type: string; description: string; reference?: string | null; occurrence: number }): string {
  if (f.reference) return sha1(`ref|${f.account_id}|${normalizeText(f.reference)}|${f.amount}`);
  return sha1(`row|${f.account_id}|${f.occurred_on}|${f.amount}|${f.type}|${normalizeText(f.description)}|${f.occurrence}`);
}

export const receiptFingerprint = (reference: string, amount: number) => sha1(`rcpt|${normalizeText(reference)}|${amount}`);
