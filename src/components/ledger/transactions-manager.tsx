"use client";
import * as React from "react";
import { useFormState } from "react-dom";
import { Pencil, Ban, Plus, ArrowLeftRight, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FormField, Input, Select } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/toast";
import { CategoryOptions } from "./category-options";
import { formatIDR, formatDateID } from "@/lib/format";
import type { AccountWithBalance, CategoryRow, LedgerEntry } from "@/lib/ledger/types";
import { saveTransactionAction, saveTransferAction, voidTransactionAction, voidTransferAction, type ActionState } from "@/app/actions/ledger";

export type EntryType = "expense" | "income" | "transfer";
const INIT: ActionState = { ok: false };
const TYPE_LABEL: Record<EntryType, string> = { expense: "Pengeluaran", income: "Pemasukan", transfer: "Transfer" };

function TxForm({ entry, accounts, categories, today, allowedTypes, onDone }: {
  entry?: LedgerEntry; accounts: AccountWithBalance[]; categories: CategoryRow[]; today: string; allowedTypes: EntryType[]; onDone: () => void;
}) {
  const editing = !!entry;
  const [type, setType] = React.useState<EntryType>((entry?.kind as EntryType) ?? allowedTypes[0]);
  const [txState, txAction] = useFormState(saveTransactionAction, INIT);
  const [trState, trAction] = useFormState(saveTransferAction, INIT);
  const toast = useToast();
  React.useEffect(() => {
    if (txState.ok || trState.ok) { toast(editing ? "Transaksi diperbarui" : type === "transfer" ? "Transfer dicatat" : "Transaksi dicatat"); onDone(); }
  }, [txState, trState]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = type === "transfer" ? trState : txState;
  const e = state.errors ?? {};
  const usable = accounts.filter((a) => !a.is_archived || a.id === entry?.account_id);
  const noAccounts = usable.length === 0;

  if (noAccounts) return <p className="text-sm">Tambahkan minimal satu akun di halaman <strong>Akun &amp; Saldo</strong> sebelum mencatat transaksi.</p>;

  return (
    <form action={type === "transfer" ? trAction : txAction} className="space-y-4">
      {editing && <input type="hidden" name="id" value={entry.id} />}
      {type !== "transfer" && <input type="hidden" name="type" value={type} />}

      {!editing && allowedTypes.length > 1 && (
        <div role="group" aria-label="Jenis transaksi" className="grid grid-cols-3 gap-1 rounded-md bg-sunken p-1">
          {allowedTypes.map((t) => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}
              className={`h-9 rounded text-sm font-medium ${type === t ? "bg-surface shadow-sm" : "text-muted hover:text-ink"}`}>{TYPE_LABEL[t]}</button>
          ))}
        </div>
      )}

      {type === "transfer" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="tx-from" label="Dari akun" error={e.from_account_id}>
            <Select id="tx-from" name="from_account_id" defaultValue={usable[0].id} aria-invalid={!!e.from_account_id}>{usable.map((a) => <option key={a.id} value={a.id}>{a.name} · {formatIDR(a.balance)}</option>)}</Select>
          </FormField>
          <FormField id="tx-to" label="Ke akun" error={e.to_account_id}>
            <Select id="tx-to" name="to_account_id" defaultValue={usable[1]?.id ?? usable[0].id} aria-invalid={!!e.to_account_id}>{usable.map((a) => <option key={a.id} value={a.id}>{a.name} · {formatIDR(a.balance)}</option>)}</Select>
          </FormField>
        </div>
      ) : (
        <FormField id="tx-acc" label={type === "income" ? "Masuk ke akun" : "Dibayar dari akun"} error={e.account_id}>
          <Select id="tx-acc" name="account_id" defaultValue={entry?.account_id ?? usable[0].id} aria-invalid={!!e.account_id}>{usable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </FormField>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="tx-amount" label="Nominal" error={e.amount} hint="Contoh: 25rb, 9,5jt, 1.250.000">
          <Input id="tx-amount" name="amount" inputMode="numeric" defaultValue={entry ? String(entry.amount) : ""} required autoFocus aria-invalid={!!e.amount} />
        </FormField>
        <FormField id="tx-date" label="Tanggal" error={e.occurred_on}>
          <Input id="tx-date" name="occurred_on" type="date" defaultValue={entry?.occurred_on ?? today} max={today} required aria-invalid={!!e.occurred_on} />
        </FormField>
      </div>

      {type === "transfer" ? (
        <FormField id="tx-fee" label="Biaya admin (opsional)" error={e.fee} hint="Dipotong dari akun asal dan dicatat sebagai pengeluaran terpisah.">
          <Input id="tx-fee" name="fee" inputMode="numeric" placeholder="0" aria-invalid={!!e.fee} />
        </FormField>
      ) : (
        <FormField id="tx-cat" label="Kategori" error={e.category_id}>
          <Select key={type} id="tx-cat" name="category_id" defaultValue={entry?.category_id ?? ""}><CategoryOptions categories={categories} kind={type} selectedId={entry?.category_id} /></Select>
        </FormField>
      )}

      <FormField id="tx-desc" label={type === "transfer" ? "Catatan (opsional)" : "Deskripsi"} error={e.description}>
        <Input id="tx-desc" name="description" defaultValue={entry?.description ?? ""} maxLength={200} placeholder={type === "expense" ? "Contoh: kopi pagi" : type === "income" ? "Contoh: gaji November" : "Contoh: isi saldo GoPay"} aria-invalid={!!e.description} />
      </FormField>

      {type !== "transfer" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="tx-merchant" label="Merchant (opsional)" error={e.merchant}><Input id="tx-merchant" name="merchant" defaultValue={entry?.merchant ?? ""} maxLength={100} /></FormField>
          <FormField id="tx-tags" label="Tag (opsional)" error={e.tags} hint="Pisahkan dengan koma"><Input id="tx-tags" name="tags" defaultValue={entry?.tags ?? ""} maxLength={100} placeholder="harian, kantor" /></FormField>
        </div>
      )}

      <FormError message={!state.errors ? state.message : undefined} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Batal</Button><SubmitButton>Simpan</SubmitButton></div>
    </form>
  );
}

function amountCell(r: LedgerEntry) {
  const cls = r.kind === "income" || (r.kind === "adjustment" && r.adj_direction === "in") ? "text-gain" : r.kind === "expense" || r.kind === "adjustment" ? "text-loss" : "";
  const sign = r.kind === "income" || (r.kind === "adjustment" && r.adj_direction === "in") ? "+" : r.kind === "transfer" ? "" : "−";
  return <span className={`${cls} ${r.status === "voided" ? "line-through opacity-60" : ""}`}>{sign}{formatIDR(r.amount)}</span>;
}

export function TransactionsManager({ rows, accounts, categories, today, allowedTypes, emptyTitle, emptyText }: {
  rows: LedgerEntry[]; accounts: AccountWithBalance[]; categories: CategoryRow[]; today: string; allowedTypes: EntryType[]; emptyTitle: string; emptyText: string;
}) {
  const [dlg, setDlg] = React.useState<{ kind: "create" } | { kind: "edit"; entry: LedgerEntry } | null>(null);
  const [voiding, setVoiding] = React.useState<LedgerEntry | null>(null);
  const [err, setErr] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  const toast = useToast();
  const closeVoid = () => { setVoiding(null); setErr(undefined); };

  const cols: Column<LedgerEntry>[] = [
    { key: "date", header: "Tanggal", render: (r) => <span className="whitespace-nowrap">{formatDateID(r.occurred_on)}</span> },
    {
      key: "desc", header: "Keterangan",
      render: (r) => (
        <div className={`min-w-[12rem] ${r.status === "voided" ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`font-medium ${r.status === "voided" ? "line-through" : ""}`}>{r.kind === "transfer" ? "Transfer" : r.description || r.merchant || r.category_name || "(tanpa keterangan)"}</span>
            {r.status === "voided" && <Badge tone="loss">Dibatalkan</Badge>}
            {r.kind === "adjustment" && <Badge tone="warn">Penyesuaian</Badge>}
            {r.source === "transfer_fee" && <Badge>Otomatis dari transfer</Badge>}
            {r.source === "debt_payment" && <Badge tone="brand">Cicilan · kelola di Utang</Badge>}
            {r.source === "bill_payment" && <Badge tone="brand">Tagihan · kelola di Tagihan</Badge>}
          </div>
          {r.kind === "transfer" && <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">{r.account_name}<ArrowRight className="h-3 w-3" aria-hidden />{r.to_account_name}{r.description ? ` · ${r.description}` : ""}</p>}
          {r.kind !== "transfer" && (r.merchant || r.tags) && <p className="mt-0.5 text-xs text-muted">{[r.merchant && r.description ? r.merchant : null, r.tags ? r.tags.split(",").map((t) => `#${t}`).join(" ") : null].filter(Boolean).join(" · ")}</p>}
        </div>
      ),
    },
    { key: "cat", header: "Kategori & akun", render: (r) => <div className="text-sm">{r.kind === "transfer" || r.kind === "adjustment" ? <span className="text-muted">—</span> : <span>{r.parent_category_name ? `${r.parent_category_name} › ` : ""}{r.category_name ?? "Tanpa kategori"}</span>}{r.kind !== "transfer" && <p className="text-xs text-muted">{r.account_name}</p>}</div> },
    { key: "amt", header: "Nominal", align: "right", render: amountCell },
    {
      key: "act", header: "Aksi", align: "right",
      render: (r) => {
        if (r.status === "voided") return null;
        const system = r.source === "transfer_fee" || r.source === "debt_payment" || r.source === "bill_payment";
        const editable = r.src === "tx" && (r.kind === "income" || r.kind === "expense") && !system;
        const voidable = !system;
        return (
          <div className="flex justify-end gap-1">
            {editable && <Button size="sm" variant="ghost" aria-label="Ubah transaksi" onClick={() => setDlg({ kind: "edit", entry: r })}><Pencil className="h-4 w-4" aria-hidden /></Button>}
            {voidable && <Button size="sm" variant="ghost" aria-label="Batalkan transaksi" onClick={() => setVoiding(r)}><Ban className="h-4 w-4" aria-hidden /></Button>}
          </div>
        );
      },
    },
  ];

  const close = () => setDlg(null);
  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => setDlg({ kind: "create" })}><Plus className="h-4 w-4" aria-hidden />{allowedTypes.length === 1 ? `Catat ${TYPE_LABEL[allowedTypes[0]].toLowerCase()}` : "Catat transaksi"}</Button></div>
      <div className="rounded-card border border-line bg-surface">
        <DataTable columns={cols} rows={rows} rowKey={(r) => `${r.src}-${r.id}`}
          empty={<EmptyState icon={ArrowLeftRight} title={emptyTitle} description={emptyText} />} />
      </div>

      <Dialog wide open={!!dlg} onClose={close} title={dlg?.kind === "edit" ? "Ubah transaksi" : "Catat transaksi"}>
        {dlg && <TxForm entry={dlg.kind === "edit" ? dlg.entry : undefined} accounts={accounts} categories={categories} today={today} allowedTypes={allowedTypes} onDone={close} />}
      </Dialog>

      <ConfirmDialog
        open={!!voiding} onCancel={closeVoid} danger confirmLabel="Batalkan transaksi" pending={pending} error={err}
        title="Batalkan transaksi ini?"
        description={voiding ? `${voiding.kind === "transfer" ? "Transfer" : voiding.description || "Transaksi"} senilai ${formatIDR(voiding.amount)} akan dikeluarkan dari saldo dan laporan. Catatannya tetap tersimpan sebagai "Dibatalkan".${voiding.kind === "transfer" ? " Biaya transfer ikut dibatalkan." : ""}` : ""}
        onConfirm={() => voiding && startTransition(async () => {
          const r = voiding.src === "tr" ? await voidTransferAction(voiding.id) : await voidTransactionAction(voiding.id);
          if (r.ok) { toast("Transaksi dibatalkan"); closeVoid(); } else setErr(r.message);
        })}
      />
    </>
  );
}
