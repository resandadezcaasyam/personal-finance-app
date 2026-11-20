import type Database from "better-sqlite3";
import { createAccount } from "../ledger/accounts";
import { findCategoryId } from "../ledger/categories";
import { createTransaction } from "../ledger/transactions";
import { createTransfer } from "../ledger/transfers";
import { createDebt, recordDebtPayment } from "../debts/debts";
import { createBill, payBill } from "../bills/bills";
import { shiftDate, todayWIB } from "../format";

/**
 * Fictional records only. Lives in demo.db, never in the personal database.
 * Categories come from migration 0002; dates are relative to today so the demo always looks current.
 */
export function seedDemo(db: Database.Database, today: string = todayWIB()) {
  db.transaction(() => {
    const bank = createAccount(db, { name: "Demo Bank", type: "bank", initial_balance: 5_000_000 });
    const wallet = createAccount(db, { name: "Demo Dompet Digital", type: "ewallet", initial_balance: 350_000 });
    const cash = createAccount(db, { name: "Demo Tunai", type: "cash", initial_balance: 200_000 });
    const exp = (n: string) => findCategoryId(db, n, "expense");
    const rows: [number, "income" | "expense", number | null, number, number, string, string?][] = [
      [-20, "income", findCategoryId(db, "Gaji", "income"), 9_500_000, bank, "Gaji bulanan (fiktif)"],
      [-18, "expense", exp("Listrik"), 450_000, bank, "Token listrik", "PLN"],
      [-15, "expense", exp("Belanja Harian"), 320_000, bank, "Belanja mingguan", "Supermarket Demo"],
      [-12, "expense", exp("Makan"), 45_000, wallet, "Makan siang", "Warung Demo"],
      [-9, "expense", exp("Langganan Digital"), 54_000, bank, "Langganan streaming", "StreamDemo"],
      [-7, "expense", exp("Ojek Online"), 28_000, wallet, "Perjalanan ke kantor"],
      [-5, "expense", exp("Kopi"), 25_000, cash, "Kopi pagi", "Kedai Kopi Demo"],
      [-3, "expense", exp("Makan"), 60_000, cash, "Makan malam"],
      [-2, "income", findCategoryId(db, "Freelance", "income"), 750_000, bank, "Proyek desain kecil (fiktif)"],
    ];
    for (const [off, type, cat, amount, acc, desc, merchant] of rows) {
      createTransaction(db, { type, category_id: cat, amount, account_id: acc, occurred_on: shiftDate(today, off), description: desc, merchant: merchant ?? null }, { today });
    }
    createTransfer(db, { from_account_id: bank, to_account_id: wallet, amount: 500_000, fee: 2_500, occurred_on: shiftDate(today, -10), description: "Isi saldo dompet digital" }, { today });

    // Fictional obligations: one installment loan already being paid, one upcoming loan, and a few bills.
    const spay = createDebt(db, { provider: "ShopeePay", label: "SPayLater (fiktif)", model: "flat", principal: 1_800_000, rate_bps: 200, count: 6, start_date: shiftDate(today, -22), first_due_date: shiftDate(today, -20), payment_account_id: wallet });
    recordDebtPayment(db, { debt_id: spay, account_id: wallet, amount: 336_000, paid_on: shiftDate(today, -20) }, { today });
    createDebt(db, { provider: "SeaBank", label: "Pinjaman (fiktif)", model: "reducing", principal: 3_000_000, rate_bps: 150, count: 12, start_date: shiftDate(today, -1), first_due_date: shiftDate(today, 4), payment_account_id: bank });
    const internet = createBill(db, { name: "Internet (fiktif)", kind: "bill", category_id: exp("Internet"), account_id: bank, amount: 350_000, frequency: "monthly", next_due_date: shiftDate(today, -1), remind_days: 3 });
    payBill(db, { bill_id: internet, account_id: bank, amount: 350_000, paid_on: shiftDate(today, -1) }, { today });
    createBill(db, { name: "Listrik PLN (fiktif)", kind: "bill", category_id: exp("Listrik"), account_id: bank, amount: null, frequency: "monthly", next_due_date: shiftDate(today, 3), remind_days: 5 });
    createBill(db, { name: "StreamDemo (fiktif)", kind: "subscription", category_id: exp("Langganan Digital"), account_id: bank, amount: 54_000, frequency: "monthly", next_due_date: shiftDate(today, 7), remind_days: 3 });
    createBill(db, { name: "Iuran sampah (fiktif)", kind: "bill", category_id: exp("Rumah Tangga") ?? exp("Lainnya"), account_id: cash, amount: 25_000, frequency: "monthly", next_due_date: shiftDate(today, -2), remind_days: 3 });
    db.prepare("INSERT INTO settings (key, value) VALUES ('demo_seeded','1')").run();
  })();
}
