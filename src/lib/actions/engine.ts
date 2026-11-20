import { formatIDR, formatDateID } from "../format";

/**
 * Next Financial Actions (PURE). Turns facts read from the user's data into a ranked list. Every action says WHY it is
 * recommended, with the numbers behind it. Payments that can cost money (overdue, upcoming, deficits) outrank bookkeeping (unconfirmed income, reconciliation). Nothing here changes any data and nothing is invented: if the facts are not
 * there, no action is produced.
 */
export type Severity = "critical" | "high" | "medium" | "low";
export type ActionKind = "overdue" | "upcoming" | "cash" | "budget" | "income" | "planned" | "reconcile" | "inbox" | "backup";

export interface Action { id: string; kind: ActionKind; severity: Severity; score: number; title: string; why: string; href: string; cta: string; amount: number | null; date: string | null }

export interface ObligationFact { title: string; subtitle: string; date: string; amount: number; href: string; variable?: boolean }
export interface PlannedFact { rule_id: number; name: string; type: "income" | "expense"; amount: number; due_date: string; state: "overdue" | "due" | "upcoming"; days: number; matched: boolean }
export interface BudgetFact { name: string; budget: number; actual: number; status: "ok" | "warning" | "over" }
export interface AccountFact { id: number; name: string; balance: number; lastReconciledOn: string | null; transactionsSince: number; daysSinceReconcile: number | null }

export interface ActionFacts {
  today: string;
  cash: number;
  overdue: ObligationFact[];
  upcoming: ObligationFact[];
  /** Baseline forecast over the next 30 days. */
  deficit: { firstDate: string; days: number; lowest: number; lowestDate: string } | null;
  payday: { date: string; survives: boolean; lowest: number } | null;
  budgetMonth: string;
  daysLeftInMonth: number;
  budgets: BudgetFact[];
  planned: PlannedFact[];
  accounts: AccountFact[];
  inbox: { newItems: number; needsReview: number; duplicates: number };
  /** Personal data only: days since the last backup (null = never) and how much data there is to lose. */
  backup?: { daysSince: number | null; transactions: number } | null;
}

const BASE: Record<Severity, number> = { critical: 100, high: 80, medium: 50, low: 20 };
const daysAgo = (today: string, d: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);

export function buildActions(f: ActionFacts): Action[] {
  const out: Action[] = [];
  const add = (a: Omit<Action, "score"> & { bonus?: number }) => { const { bonus = 0, ...rest } = a; out.push({ ...rest, score: BASE[a.severity] + bonus }); };

  // 1. Overdue payments
  for (const o of f.overdue) {
    const late = daysAgo(f.today, o.date);
    add({
      id: `overdue:${o.href}:${o.date}:${o.title}`, kind: "overdue", severity: late > 14 ? "critical" : "high", title: `Bayar ${o.title}`, amount: o.amount || null, date: o.date, href: o.href, cta: "Buka",
      why: `${o.subtitle} sudah lewat jatuh tempo ${late} hari (${formatDateID(o.date)})${o.amount ? `, sebesar ${formatIDR(o.amount)}` : ""}. Keterlambatan bisa menimbulkan denda dan memengaruhi riwayat kredit Anda.`,
      bonus: Math.min(late, 30),
    });
  }

  // 2. Upcoming installments / bills
  const soon = f.upcoming.filter((u) => u.amount > 0);
  const soonTotal = soon.reduce((s, u) => s + u.amount, 0);
  for (const u of f.upcoming) {
    const d = -daysAgo(f.today, u.date);
    const short = f.cash < soonTotal;
    add({
      id: `upcoming:${u.href}:${u.date}:${u.title}`, kind: "upcoming", severity: d <= 2 || short ? "high" : "medium", title: `Siapkan ${u.title}`, amount: u.amount || null, date: u.date, href: u.href, cta: "Buka",
      why: `${u.subtitle} jatuh tempo ${d === 0 ? "hari ini" : `${d} hari lagi`} (${formatDateID(u.date)})${u.amount ? `, ${formatIDR(u.amount)}` : u.variable ? ", nominalnya berubah-ubah" : ""}.${short ? ` Total kewajiban 7 hari ke depan ${formatIDR(soonTotal)} melebihi kas Anda ${formatIDR(f.cash)}.` : ""}`,
      bonus: Math.max(0, 7 - d),
    });
  }

  // 3. Insufficient balance
  if (f.deficit) {
    const inDays = -daysAgo(f.today, f.deficit.firstDate);
    add({
      id: "cash:deficit", kind: "cash", severity: inDays <= 7 ? "critical" : "high", title: "Saldo kas diperkirakan negatif", amount: Math.abs(f.deficit.lowest), date: f.deficit.firstDate, href: "/forecast", cta: "Lihat proyeksi",
      why: `Proyeksi baseline menunjukkan saldo negatif mulai ${formatDateID(f.deficit.firstDate)} (${inDays <= 0 ? "hari ini" : `${inDays} hari lagi`}) selama ${f.deficit.days} hari, terendah ${formatIDR(f.deficit.lowest)} pada ${formatDateID(f.deficit.lowestDate)}.${f.payday && !f.payday.survives ? ` Kas juga tidak cukup sampai gajian ${formatDateID(f.payday.date)}.` : ""} Pertimbangkan menunda pengeluaran, memindahkan dana, atau meninjau cicilan.`,
      bonus: Math.max(0, 14 - inDays),
    });
  }

  // 4. Budgets
  for (const b of f.budgets) {
    if (b.status === "ok") continue;
    const over = b.status === "over";
    const left = b.budget - b.actual;
    add({
      id: `budget:${b.name}`, kind: "budget", severity: over ? "high" : "medium", title: over ? `Anggaran ${b.name} terlampaui` : `Anggaran ${b.name} hampir habis`, amount: over ? b.actual - b.budget : left, date: null, href: "/expenses", cta: "Lihat anggaran",
      why: over ? `Pengeluaran ${b.name} bulan ini ${formatIDR(b.actual)} sudah melewati anggaran ${formatIDR(b.budget)} sebesar ${formatIDR(b.actual - b.budget)}, dengan ${f.daysLeftInMonth} hari tersisa.`
        : `Pengeluaran ${b.name} sudah ${Math.round((b.actual / b.budget) * 100)}% dari anggaran ${formatIDR(b.budget)}. Sisa ${formatIDR(left)} untuk ${f.daysLeftInMonth} hari (±${formatIDR(Math.floor(left / Math.max(1, f.daysLeftInMonth)))} per hari).`,
      bonus: over ? Math.min(20, Math.round(((b.actual - b.budget) / b.budget) * 20)) : 0,
    });
  }

  // 5. Planned recurring entries and missing income confirmation
  for (const p of f.planned) {
    if (p.state === "upcoming") continue;
    const late = p.days < 0 ? -p.days : 0;
    if (p.type === "income") {
      add({
        id: `planned:${p.rule_id}:${p.due_date}`, kind: "income", severity: p.matched || late === 0 ? "low" : "medium", title: p.matched ? `Tautkan pemasukan ${p.name}` : `Konfirmasi pemasukan ${p.name}`, amount: p.amount, date: p.due_date, href: "/automation", cta: p.matched ? "Tautkan" : "Konfirmasi",
        why: p.matched ? `${p.name} dijadwalkan ${formatDateID(p.due_date)} dan ada transaksi yang tampak sama di catatan. Tautkan agar tidak dicatat dua kali.`
          : `${p.name} (${formatIDR(p.amount)}) dijadwalkan ${late > 0 ? `${late} hari lalu` : "hari ini"} (${formatDateID(p.due_date)}) tetapi belum ada pemasukan yang tercatat. Konfirmasi jika sudah diterima, atau lewati bila tidak jadi.`,
        bonus: Math.min(late, 20),
      });
    } else {
      add({
        id: `planned:${p.rule_id}:${p.due_date}`, kind: "planned", severity: p.matched || late === 0 ? "low" : "medium", title: p.matched ? `Tautkan pengeluaran ${p.name}` : `Catat pengeluaran rutin ${p.name}`, amount: p.amount, date: p.due_date, href: "/automation", cta: p.matched ? "Tautkan" : "Konfirmasi",
        why: p.matched ? `${p.name} dijadwalkan ${formatDateID(p.due_date)} dan ada transaksi yang tampak sama. Tautkan agar tidak ganda.` : `${p.name} (${formatIDR(p.amount)}) dijadwalkan ${late > 0 ? `${late} hari lalu` : "hari ini"} dan belum tercatat.`,
        bonus: Math.min(late, 20),
      });
    }
  }

  // 6. Account reconciliation / discrepancies
  for (const a of f.accounts) {
    if (a.balance < 0) {
      add({ id: `account:negative:${a.id}`, kind: "reconcile", severity: "high", title: `Saldo ${a.name} negatif`, amount: Math.abs(a.balance), date: null, href: "/accounts", cta: "Periksa akun",
        why: `Saldo ${a.name} tercatat ${formatIDR(a.balance)}. Biasanya ini berarti ada pemasukan atau transfer yang belum dicatat. Bandingkan dengan saldo sebenarnya lalu lakukan rekonsiliasi.` });
    } else if (a.transactionsSince >= 5 && (a.daysSinceReconcile === null || a.daysSinceReconcile >= 30)) {
      add({ id: `account:reconcile:${a.id}`, kind: "reconcile", severity: "low", title: `Rekonsiliasi ${a.name}`, amount: null, date: null, href: "/accounts", cta: "Rekonsiliasi",
        why: a.daysSinceReconcile === null ? `${a.name} belum pernah direkonsiliasi dan sudah punya ${a.transactionsSince} transaksi. Cocokkan saldo dengan aplikasi bank/e-wallet agar angkanya bisa dipercaya.`
          : `${a.name} terakhir direkonsiliasi ${a.daysSinceReconcile} hari lalu dan sejak itu ada ${a.transactionsSince} transaksi baru.` });
    }
  }

  // 7. Imports waiting
  if (f.inbox.duplicates > 0) add({ id: "inbox:duplicates", kind: "inbox", severity: "medium", title: `${f.inbox.duplicates} potensi transaksi ganda`, amount: null, date: null, href: "/inbox?status=potential_duplicate", cta: "Tinjau",
    why: `Ada ${f.inbox.duplicates} item di kotak masuk yang mirip dengan transaksi yang sudah tercatat. Periksa agar saldo tidak terhitung dua kali.` });
  const waiting = f.inbox.newItems + f.inbox.needsReview;
  if (waiting > 0) add({ id: "inbox:waiting", kind: "inbox", severity: waiting >= 20 ? "medium" : "low", title: `${waiting} item menunggu persetujuan`, amount: null, date: null, href: "/inbox", cta: "Tinjau",
    why: `${waiting} transaksi hasil impor atau OCR belum Anda setujui, jadi belum memengaruhi saldo dan proyeksi.` });

  // 8. Backup
  if (f.backup && f.backup.transactions >= 10 && (f.backup.daysSince === null || f.backup.daysSince >= 30)) {
    add({ id: "backup:stale", kind: "backup", severity: "low", title: "Buat cadangan data", amount: null, date: null, href: "/backup", cta: "Buat cadangan",
      why: f.backup.daysSince === null ? `Anda sudah punya ${f.backup.transactions} transaksi tetapi belum pernah membuat cadangan. Jika berkas data rusak atau komputer bermasalah, semuanya bisa hilang.`
        : `Cadangan terakhir ${f.backup.daysSince} hari lalu, sementara data Anda sudah ${f.backup.transactions} transaksi. Buat cadangan baru dan simpan salinannya di tempat lain.` });
  }

  return out.sort((a, b) => b.score - a.score || (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.id.localeCompare(b.id));
}
