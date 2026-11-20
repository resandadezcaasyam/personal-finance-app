import type Database from "better-sqlite3";

/**
 * Read-only health checks: SQLite's own integrity and foreign-key checks, plus the financial invariants the app relies on.
 * A failing check never changes data; it tells the user what to look at (and to restore a backup if needed).
 */
export interface CheckResult { id: string; label: string; ok: boolean; detail: string }
export interface IntegrityReport { ok: boolean; checks: CheckResult[]; ranAt: string }

const count = (db: Database.Database, sql: string) => (db.prepare(sql).get() as { n: number }).n;

export function runIntegrityChecks(db: Database.Database, now: Date = new Date()): IntegrityReport {
  const checks: CheckResult[] = [];
  const add = (id: string, label: string, bad: number, okText: string, badText: (n: number) => string) => checks.push({ id, label, ok: bad === 0, detail: bad === 0 ? okText : badText(bad) });

  const integrity = (db.pragma("integrity_check") as { integrity_check: string }[]).map((r) => r.integrity_check);
  checks.push({ id: "sqlite", label: "Struktur berkas basis data", ok: integrity.length === 1 && integrity[0] === "ok", detail: integrity[0] === "ok" && integrity.length === 1 ? "Tidak ada kerusakan yang ditemukan SQLite." : integrity.slice(0, 3).join("; ") });
  add("fk", "Keterkaitan antar data", (db.pragma("foreign_key_check") as unknown[]).length, "Semua rujukan antar data valid.", (n) => `${n} rujukan menunjuk ke data yang tidak ada.`);

  add("inst-range", "Cicilan: nominal terbayar", count(db, "SELECT COUNT(*) n FROM installment_schedules WHERE amount_paid < 0 OR amount_paid > amount_due"), "Tidak ada cicilan yang terbayar melebihi tagihannya.", (n) => `${n} cicilan terbayar negatif atau melebihi nominal tagihan.`);

  // Paid amount = (installments already paid before the debt was entered) + allocations of posted payments.
  add("inst-alloc", "Cicilan cocok dengan riwayat pembayaran", count(db,
    `SELECT COUNT(*) n FROM installment_schedules s JOIN debts d ON d.id = s.debt_id
     WHERE s.amount_paid <> (CASE WHEN s.sequence_no <= d.opening_paid_count THEN s.amount_due ELSE 0 END)
       + COALESCE((SELECT SUM(a.amount) FROM debt_payment_allocations a JOIN debt_payments p ON p.id = a.payment_id WHERE a.schedule_id = s.id AND p.status = 'posted'), 0)`),
    "Nominal terbayar tiap cicilan sama dengan pembayaran yang tercatat.", (n) => `${n} cicilan nominal terbayarnya tidak sama dengan riwayat pembayaran.`);

  add("pay-alloc", "Pembayaran utang teralokasi penuh", count(db,
    `SELECT COUNT(*) n FROM debt_payments p WHERE p.status = 'posted' AND p.amount <> COALESCE((SELECT SUM(a.amount) FROM debt_payment_allocations a WHERE a.payment_id = p.id), 0)`),
    "Setiap pembayaran utang teralokasi tepat ke cicilan.", (n) => `${n} pembayaran utang tidak cocok dengan alokasinya.`);

  add("pay-ledger", "Pembayaran utang ada di buku besar", count(db,
    `SELECT COUNT(*) n FROM debt_payments p WHERE (p.status = 'posted' AND (SELECT COUNT(*) FROM transactions t WHERE t.debt_payment_id = p.id AND t.status = 'posted' AND t.amount = p.amount + p.penalty + p.fee) <> 1)
        OR (p.status = 'voided' AND EXISTS (SELECT 1 FROM transactions t WHERE t.debt_payment_id = p.id AND t.status = 'posted'))`),
    "Tiap pembayaran utang punya tepat satu pengeluaran yang sesuai.", (n) => `${n} pembayaran utang tidak punya pengeluaran yang sesuai di buku besar (atau ada yang tertinggal setelah dibatalkan).`);

  add("bill-ledger", "Pembayaran tagihan ada di buku besar", count(db,
    `SELECT COUNT(*) n FROM bill_payments b WHERE b.status = 'paid' AND b.amount > 0 AND (b.transaction_id IS NULL OR NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = b.transaction_id AND t.status = 'posted'))`),
    "Tiap tagihan yang dibayar punya pengeluaran yang sesuai.", (n) => `${n} pembayaran tagihan tidak punya pengeluaran yang aktif di buku besar.`);

  add("transfers", "Transfer antar akun", count(db, "SELECT COUNT(*) n FROM transfers WHERE from_account_id = to_account_id OR amount <= 0"), "Semua transfer valid.", (n) => `${n} transfer tidak valid (akun sama atau nominal ≤ 0).`);

  add("goals", "Dana target tabungan", count(db, "SELECT COUNT(*) n FROM goals g WHERE g.saved_amount <> COALESCE((SELECT SUM(c.amount) FROM goal_contributions c WHERE c.goal_id = g.id), 0)"), "Dana tiap target sama dengan catatannya.", (n) => `${n} target tabungan jumlah danya tidak sama dengan catatannya.`);

  add("occurrences", "Jadwal berulang yang dikonfirmasi", count(db, "SELECT COUNT(*) n FROM recurring_occurrences WHERE status = 'confirmed' AND transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = transaction_id)"), "Semua jadwal yang dikonfirmasi menunjuk transaksi yang ada.", (n) => `${n} jadwal dikonfirmasi tetapi transaksinya hilang.`);

  return { ok: checks.every((c) => c.ok), checks, ranAt: now.toISOString() };
}

/** Quick startup check (cheaper than the full integrity check). Returns null when healthy, otherwise a short description. */
export function quickHealth(db: Database.Database): string | null {
  const q = (db.pragma("quick_check") as { quick_check: string }[]).map((r) => r.quick_check);
  if (!(q.length === 1 && q[0] === "ok")) return `SQLite quick_check: ${q.slice(0, 2).join("; ")}`;
  const fk = (db.pragma("foreign_key_check") as unknown[]).length;
  return fk ? `${fk} pelanggaran keterkaitan data` : null;
}
