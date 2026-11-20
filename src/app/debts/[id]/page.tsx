import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DebtDetailActions, PaymentHistory } from "@/components/debts/debt-detail-actions";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { getDebt, listDebtPayments, listSchedule } from "@/lib/debts/debts";
import { formatDateID, formatIDR, todayWIB } from "@/lib/format";

export const dynamic = "force-dynamic";
const MODEL: Record<string, string> = { none: "Tanpa bunga", flat: "Bunga flat", reducing: "Bunga menurun (anuitas)", manual: "Jadwal manual" };

export default function DebtDetailPage({ params }: { params: { id: string } }) {
  const db = getDb();
  const today = todayWIB();
  const id = Number(params.id);
  const debt = Number.isInteger(id) ? getDebt(db, id, today) : undefined;
  if (!debt) notFound();
  const schedule = listSchedule(db, debt.id);
  const payments = listDebtPayments(db, debt.id);
  const accounts = listAccounts(db);
  const openRows = schedule.filter((r) => r.status !== "skipped" && r.amount_paid < r.amount_due).map((r) => ({ id: r.id, sequence_no: r.sequence_no, due_date: r.due_date, remaining: r.amount_due - r.amount_paid }));
  const hasPayments = payments.some((p) => p.status === "posted");
  const title = debt.label ? `${debt.provider} · ${debt.label}` : debt.provider;
  const statusTone = debt.status === "active" ? "brand" : debt.status === "settled" ? "neutral" : "loss";
  const statusLabel = debt.status === "active" ? "Aktif" : debt.status === "settled" ? "Lunas" : "Dibatalkan";
  const stats = [
    ["Sisa kewajiban", formatIDR(debt.outstanding)],
    ["Sisa pokok", formatIDR(debt.remaining_principal)],
    ["Cicilan tersisa", `${debt.remaining_installments} dari ${debt.total_rows}`],
    ["Jatuh tempo berikutnya", debt.status === "active" && debt.next_due_date ? formatDateID(debt.next_due_date) : "—"],
  ];

  return (
    <>
      <Link href="/debts" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden />Utang &amp; Cicilan</Link>
      <PageHeader title={title} description={`${MODEL[debt.interest_model]}${debt.interest_rate_bps ? ` ${(debt.interest_rate_bps / 100).toLocaleString("id-ID")}% per bulan` : ""} · pokok ${formatIDR(debt.original_principal)} · total kewajiban ${formatIDR(debt.total_obligation)}`}
        actions={<Badge tone={statusTone}>{statusLabel}</Badge>} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(([l, v]) => <Card key={l}><CardBody><p className="text-sm text-muted">{l}</p><p className="num mt-2 whitespace-nowrap text-lg font-semibold">{v}</p></CardBody></Card>)}
      </div>
      <div className="mt-4 max-w-md"><Progress value={debt.total_rows ? (debt.paid_rows / debt.total_rows) * 100 : 0} label="Progres pelunasan" /><p className="mt-1 text-xs text-muted">{debt.paid_rows} dari {debt.total_rows} cicilan lunas{debt.opening_paid_count > 0 && ` · ${debt.opening_paid_count} sudah dibayar sebelum dicatat (tidak memengaruhi saldo)`}</p></div>
      {debt.notes && <p className="mt-3 text-sm text-muted">Catatan: {debt.notes}</p>}

      <div className="mt-6"><DebtDetailActions debt={debt} openRows={openRows} accounts={accounts} today={today} hasPayments={hasPayments} /></div>

      <Card className="mt-8">
        <CardHeader><CardTitle>Jadwal cicilan</CardTitle></CardHeader>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-muted">
            <th scope="col" className="px-5 py-2.5 font-medium">#</th><th scope="col" className="px-5 py-2.5 font-medium">Jatuh tempo</th>
            <th scope="col" className="px-5 py-2.5 text-right font-medium">Pokok</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Bunga</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Biaya</th>
            <th scope="col" className="px-5 py-2.5 text-right font-medium">Total</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Terbayar</th><th scope="col" className="px-5 py-2.5 font-medium">Status</th>
          </tr></thead>
          <tbody>
            {schedule.map((r) => {
              const paid = r.amount_paid >= r.amount_due;
              const overdue = !paid && r.due_date < today && debt.status === "active";
              const opening = r.sequence_no <= debt.opening_paid_count;
              return (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-2.5 text-muted">{r.sequence_no}</td>
                  <td className="whitespace-nowrap px-5 py-2.5">{formatDateID(r.due_date)}</td>
                  <td className="num px-5 py-2.5 text-right">{formatIDR(r.principal_due)}</td>
                  <td className="num px-5 py-2.5 text-right">{formatIDR(r.interest_due)}</td>
                  <td className="num px-5 py-2.5 text-right">{formatIDR(r.fee_due)}</td>
                  <td className="num px-5 py-2.5 text-right font-medium">{formatIDR(r.amount_due)}</td>
                  <td className="num px-5 py-2.5 text-right">{formatIDR(r.amount_paid)}</td>
                  <td className="px-5 py-2.5">{paid ? <Badge tone="brand">{opening ? "Lunas (sebelum dicatat)" : "Lunas"}</Badge> : r.amount_paid > 0 ? <Badge tone={overdue ? "loss" : "warn"}>Sebagian{overdue ? " · terlambat" : ""}</Badge> : overdue ? <Badge tone="loss">Terlambat</Badge> : <Badge>Belum</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </Card>

      <h2 className="mb-2 mt-10 font-display text-xl font-semibold">Riwayat pembayaran</h2>
      <div className="rounded-card border border-line bg-surface"><PaymentHistory payments={payments} /></div>
    </>
  );
}
