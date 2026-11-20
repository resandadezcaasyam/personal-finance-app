"use client";
import { bannerMessage } from "@/lib/form-state";
import * as React from "react";
import { useFormState } from "react-dom";
import { Plus, Pencil, SkipForward, Banknote, Power, CalendarClock, Ban, Repeat, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FormField, Input, Select } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/toast";
import { CategoryOptions } from "@/components/ledger/category-options";
import { formatIDR, formatDateID } from "@/lib/format";
import type { BillView, BillPaymentRow } from "@/lib/bills/bills";
import type { AccountWithBalance, CategoryRow } from "@/lib/ledger/types";
import { saveBillAction, payBillAction, skipBillAction, setBillActiveAction, voidBillPaymentAction } from "@/app/actions/obligations";
import type { ActionState } from "@/app/actions/shared";

const INIT: ActionState = { ok: false };
const FREQ: Record<string, string> = { weekly: "Mingguan", monthly: "Bulanan", quarterly: "Per 3 bulan", yearly: "Tahunan", once: "Sekali" };
type Dlg = { k: "create" } | { k: "edit" | "pay" | "skip"; bill: BillView } | null;

function statusBadge(b: BillView) {
  if (b.status === "inactive") return <Badge>{b.next_due_date ? "Nonaktif" : "Selesai"}</Badge>;
  const d = b.days_until ?? 0;
  if (b.status === "overdue") return <Badge tone="loss">Terlambat {Math.abs(d)} hari</Badge>;
  if (b.status === "due_soon") return <Badge tone="warn">{d === 0 ? "Hari ini" : `${d} hari lagi`}</Badge>;
  return <Badge>{d} hari lagi</Badge>;
}

function BillForm({ bill, accounts, categories, today, onDone }: { bill?: BillView; accounts: AccountWithBalance[]; categories: CategoryRow[]; today: string; onDone: () => void }) {
  const [state, action] = useFormState(saveBillAction, INIT);
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast(bill ? "Tagihan diperbarui" : "Tagihan ditambahkan"); onDone(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-4">
      {bill && <input type="hidden" name="id" value={bill.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="b-name" label="Nama" error={e.name}><Input id="b-name" name="name" defaultValue={bill?.name} required maxLength={80} autoFocus placeholder="Listrik PLN, Netflix, Sewa kos" /></FormField>
        <FormField id="b-kind" label="Jenis" error={e.kind}><Select id="b-kind" name="kind" defaultValue={bill?.kind ?? "bill"}><option value="bill">Tagihan</option><option value="subscription">Langganan</option></Select></FormField>
        <FormField id="b-amount" label="Nominal" error={e.amount} hint="Kosongkan jika berubah tiap bulan (mis. listrik): nominal diisi saat membayar.">
          <Input id="b-amount" name="amount" inputMode="numeric" defaultValue={bill?.amount ?? ""} placeholder="150rb" aria-invalid={!!e.amount} />
        </FormField>
        <FormField id="b-remind" label="Ingatkan (hari sebelumnya)" error={e.remind_days}><Input id="b-remind" name="remind_days" type="number" min={0} max={60} defaultValue={bill?.remind_days ?? 3} /></FormField>
        {!bill && (
          <>
            <FormField id="b-freq" label="Frekuensi" error={e.frequency}>
              <Select id="b-freq" name="frequency" defaultValue="monthly">{Object.entries(FREQ).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            </FormField>
            <FormField id="b-due" label="Jatuh tempo berikutnya" error={e.next_due_date}><Input id="b-due" name="next_due_date" type="date" defaultValue={today} required aria-invalid={!!e.next_due_date} /></FormField>
          </>
        )}
        <FormField id="b-cat" label="Kategori" error={e.category_id}><Select id="b-cat" name="category_id" defaultValue={bill?.category_id ?? ""}><CategoryOptions categories={categories} kind="expense" emptyLabel="Tagihan & Utilitas (default)" selectedId={bill?.category_id} /></Select></FormField>
        <FormField id="b-acc" label="Akun pembayaran" error={e.account_id}><Select id="b-acc" name="account_id" defaultValue={bill?.account_id ?? ""}><option value="">Pilih saat membayar</option>{accounts.filter((a) => !a.is_archived || a.id === bill?.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></FormField>
      </div>
      <FormField id="b-notes" label="Catatan (opsional)" error={e.notes}><Input id="b-notes" name="notes" defaultValue={bill?.notes ?? ""} maxLength={300} /></FormField>
      {bill && <p className="text-xs text-muted">Frekuensi dan tanggal jatuh tempo mengikuti pembayaran. Untuk mengubahnya, nonaktifkan tagihan ini lalu buat yang baru.</p>}
      <FormError message={bannerMessage(state)} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Batal</Button><SubmitButton>Simpan</SubmitButton></div>
    </form>
  );
}

function PayForm({ bill, accounts, today, onDone }: { bill: BillView; accounts: AccountWithBalance[]; today: string; onDone: () => void }) {
  const [state, action] = useFormState(payBillAction, INIT);
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast("Pembayaran dicatat"); onDone(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = state.errors ?? {};
  const usable = accounts.filter((a) => !a.is_archived);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="bill_id" value={bill.id} />
      <p className="rounded-md bg-sunken px-3 py-2 text-sm">Jatuh tempo <strong>{bill.next_due_date ? formatDateID(bill.next_due_date) : "—"}</strong>. Setelah dibayar, jatuh tempo berikutnya diatur otomatis.</p>
      <FormField id="bp-amount" label="Nominal dibayar" error={e.amount} hint={bill.is_variable ? "Nominal berubah tiap periode: isi sesuai tagihan." : undefined}>
        <Input id="bp-amount" name="amount" inputMode="numeric" defaultValue={bill.amount ?? ""} required autoFocus aria-invalid={!!e.amount} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="bp-acc" label="Dibayar dari akun" error={e.account_id}><Select id="bp-acc" name="account_id" defaultValue={bill.account_id ?? usable[0]?.id}>{usable.map((a) => <option key={a.id} value={a.id}>{a.name} · {formatIDR(a.balance)}</option>)}</Select></FormField>
        <FormField id="bp-date" label="Tanggal bayar" error={e.paid_on}><Input id="bp-date" name="paid_on" type="date" defaultValue={today} max={today} required /></FormField>
      </div>
      <FormError message={bannerMessage(state)} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Batal</Button><SubmitButton disabled={usable.length === 0}>Catat pembayaran</SubmitButton></div>
    </form>
  );
}

export function BillsManager({ bills, payments, accounts, categories, today }: { bills: BillView[]; payments: BillPaymentRow[]; accounts: AccountWithBalance[]; categories: CategoryRow[]; today: string }) {
  const [dlg, setDlg] = React.useState<Dlg>(null);
  const [voiding, setVoiding] = React.useState<BillPaymentRow | null>(null);
  const [err, setErr] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  const toast = useToast();
  const close = () => { setDlg(null); setVoiding(null); setErr(undefined); };

  const pcols: Column<BillPaymentRow>[] = [
    { key: "n", header: "Tagihan", render: (p) => <span className={p.status === "voided" ? "line-through opacity-60" : ""}>{p.bill_name}</span> },
    { key: "d", header: "Jatuh tempo", render: (p) => formatDateID(p.due_date) },
    { key: "s", header: "Status", render: (p) => <Badge tone={p.status === "paid" ? "brand" : p.status === "skipped" ? "warn" : "loss"}>{p.status === "paid" ? "Dibayar" : p.status === "skipped" ? "Dilewati" : "Dibatalkan"}</Badge> },
    { key: "w", header: "Dibayar pada", render: (p) => (p.status === "skipped" ? "—" : `${formatDateID(p.paid_on)}${p.account_name ? ` · ${p.account_name}` : ""}`) },
    { key: "m", header: "Nominal", align: "right", render: (p) => (p.status === "skipped" ? "—" : formatIDR(p.amount)) },
    { key: "v", header: "", align: "right", render: (p) => (p.status !== "voided" && p.is_latest ? <Button size="sm" variant="ghost" aria-label="Batalkan pembayaran" onClick={() => setVoiding(p)}><Ban className="h-4 w-4" aria-hidden /></Button> : null) },
  ];

  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => setDlg({ k: "create" })}><Plus className="h-4 w-4" aria-hidden />Tambah tagihan</Button></div>
      {bills.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-surface"><EmptyState icon={CalendarClock} title="Belum ada tagihan atau langganan" description="Tambahkan listrik, internet, sewa, asuransi, atau langganan seperti Netflix. Tanggal jatuh tempo akan dipantau dan pembayaran dicatat sebagai pengeluaran." /></div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card" aria-label="Daftar tagihan dan langganan">
          {bills.map((b) => (
            <li key={b.id} className={`flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 ${b.status === "overdue" ? "bg-loss/[0.04]" : ""}`}>
              <div className={`flex min-w-0 flex-1 basis-60 items-center gap-3 ${b.is_active ? "" : "opacity-60"}`}>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${b.status === "overdue" ? "bg-loss/10 text-loss" : "bg-tint text-brand-text"}`}>{b.kind === "subscription" ? <Repeat className="h-[18px] w-[18px]" aria-hidden /> : <Receipt className="h-[18px] w-[18px]" aria-hidden />}</span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold"><span className="truncate">{b.name}</span><Badge>{b.kind === "subscription" ? "Langganan" : "Tagihan"}</Badge></p>
                  <p className="mt-0.5 truncate text-xs text-muted">{FREQ[b.frequency]}{b.account_name ? ` · ${b.account_name}` : ""} · {b.last_paid_on ? `terakhir dibayar ${formatDateID(b.last_paid_on)}` : "belum pernah dibayar"}</p>
                </div>
              </div>
              <div className="basis-40 text-sm">
                <p className="whitespace-nowrap font-medium">{b.next_due_date ? formatDateID(b.next_due_date) : "—"}</p>
                <div className="mt-1">{statusBadge(b)}</div>
              </div>
              <p className="num basis-32 text-right text-[15px] font-semibold">{b.amount !== null ? formatIDR(b.amount) : <span className="text-[13px] font-normal text-muted">Berubah tiap periode</span>}</p>
              <div className="flex items-center justify-end gap-1">
                {b.is_active && <Button size="sm" onClick={() => setDlg({ k: "pay", bill: b })}><Banknote className="h-4 w-4" aria-hidden />Bayar</Button>}
                {b.is_active && <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Lewati ${b.name}`} onClick={() => setDlg({ k: "skip", bill: b })}><SkipForward className="h-4 w-4" aria-hidden /></Button>}
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Ubah ${b.name}`} onClick={() => setDlg({ k: "edit", bill: b })}><Pencil className="h-4 w-4" aria-hidden /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={b.is_active ? `Nonaktifkan ${b.name}` : `Aktifkan ${b.name}`} disabled={pending || (!b.is_active && !b.next_due_date)}
                  onClick={() => startTransition(async () => { const r = await setBillActiveAction(b.id, !b.is_active); toast(r.ok ? (b.is_active ? "Tagihan dinonaktifkan" : "Tagihan diaktifkan") : r.message ?? "Gagal", r.ok ? "ok" : "error"); })}><Power className="h-4 w-4" aria-hidden /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-3 mt-10 text-lg font-semibold tracking-tight">Riwayat pembayaran</h2>
      <div className="rounded-card border border-line bg-surface shadow-card">
        <DataTable columns={pcols} rows={payments} rowKey={(p) => p.id} empty={<EmptyState icon={Banknote} title="Belum ada riwayat" description="Pembayaran dan periode yang dilewati akan tercatat di sini." />} />
      </div>

      <Dialog wide open={dlg?.k === "create"} onClose={close} title="Tambah tagihan atau langganan">{dlg?.k === "create" && <BillForm accounts={accounts} categories={categories} today={today} onDone={close} />}</Dialog>
      <Dialog wide open={dlg?.k === "edit"} onClose={close} title="Ubah tagihan">{dlg?.k === "edit" && <BillForm bill={dlg.bill} accounts={accounts} categories={categories} today={today} onDone={close} />}</Dialog>
      <Dialog open={dlg?.k === "pay"} onClose={close} title={dlg?.k === "pay" ? `Bayar ${dlg.bill.name}` : ""}>{dlg?.k === "pay" && <PayForm bill={dlg.bill} accounts={accounts} today={today} onDone={close} />}</Dialog>
      <ConfirmDialog open={dlg?.k === "skip"} onCancel={close} pending={pending} error={err} confirmLabel="Lewati periode ini" title={dlg?.k === "skip" ? `Lewati ${dlg.bill.name}?` : ""}
        description="Jatuh tempo bergeser ke periode berikutnya tanpa mencatat pengeluaran. Gunakan jika tagihan dibebaskan atau sudah dibayar di luar aplikasi."
        onConfirm={() => dlg?.k === "skip" && startTransition(async () => { const r = await skipBillAction(dlg.bill.id); if (r.ok) { toast("Periode dilewati"); close(); } else setErr(r.message); })} />
      <ConfirmDialog open={!!voiding} onCancel={close} danger pending={pending} error={err} confirmLabel="Batalkan" title="Batalkan pembayaran ini?"
        description={voiding ? `${voiding.bill_name} jatuh tempo ${formatDateID(voiding.due_date)} akan kembali menjadi belum dibayar${voiding.status === "paid" ? " dan pengeluarannya dikeluarkan dari saldo" : ""}.` : ""}
        onConfirm={() => voiding && startTransition(async () => { const r = await voidBillPaymentAction(voiding.id); if (r.ok) { toast("Pembayaran dibatalkan"); close(); } else setErr(r.message); })} />
    </>
  );
}
