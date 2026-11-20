"use client";
import { bannerMessage } from "@/lib/form-state";
import * as React from "react";
import { useFormState } from "react-dom";
import { Pencil, Ban, Plus, ArrowLeftRight, ArrowRight, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { EntryAvatar, CategoryPill, entrySign } from "./entry-visuals";
import { FormField, Input, Select } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/toast";
import { CategoryOptions } from "./category-options";
import { formatIDR, formatDateShortID, formatDateID } from "@/lib/format";
import { cn } from "@/lib/utils";
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
        <div role="group" aria-label="Jenis transaksi" className="grid grid-cols-3 gap-1 rounded-xl bg-sunken p-1">
          {allowedTypes.map((t) => {
            const Icon = t === "expense" ? ArrowUpRight : t === "income" ? ArrowDownLeft : ArrowLeftRight;
            const tone = t === "expense" ? "text-loss" : t === "income" ? "text-gain" : "text-brand-text";
            return (
              <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}
                className={cn("flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition-colors", type === t ? "bg-surface shadow-card" : "text-muted hover:text-ink")}>
                <Icon className={cn("h-3.5 w-3.5", type === t && tone)} aria-hidden />{TYPE_LABEL[t]}
              </button>
            );
          })}
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
          <Input id="tx-amount" name="amount" inputMode="numeric" defaultValue={entry ? String(entry.amount) : ""} required autoFocus aria-invalid={!!e.amount} className="h-11 text-lg font-semibold tracking-tight" />
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

      <FormError message={bannerMessage(state)} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Batal</Button><SubmitButton>Simpan</SubmitButton></div>
    </form>
  );
}

function amountCell(r: LedgerEntry) {
  const { text, sign } = entrySign(r);
  return <span className={cn("font-semibold", text, r.status === "voided" && "line-through opacity-60")}>{sign}{formatIDR(r.amount)}</span>;
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
  // The global "Tambah transaksi" button links here with ?tambah=1: open the form once, then clean the address bar.
  React.useEffect(() => {
    const u = new URL(window.location.href);
    if (u.searchParams.get("tambah") === "1") {
      setDlg({ kind: "create" });
      u.searchParams.delete("tambah");
      window.history.replaceState(null, "", `${u.pathname}${u.search}${u.hash}`);
    }
  }, []);

  const titleOf = (r: LedgerEntry) => (r.kind === "transfer" ? "Transfer" : r.description || r.merchant || r.category_name || "(tanpa keterangan)");
  const categoryOf = (r: LedgerEntry) => (r.kind === "transfer" || r.kind === "adjustment" ? null : `${r.parent_category_name ? `${r.parent_category_name} › ` : ""}${r.category_name ?? ""}`.trim() || null);
  const rowActions = (r: LedgerEntry, align: "start" | "end" = "end") => {
    if (r.status === "voided") return null;
    const system = r.source === "transfer_fee" || r.source === "debt_payment" || r.source === "bill_payment";
    const editable = r.src === "tx" && (r.kind === "income" || r.kind === "expense") && !system;
    const voidable = !system;
    return (
      <div className={cn("flex gap-0.5", align === "end" ? "justify-end" : "-ml-2 justify-start")}>
        {editable && <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Ubah transaksi" onClick={() => setDlg({ kind: "edit", entry: r })}><Pencil className="h-4 w-4" aria-hidden /></Button>}
        {voidable && <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Batalkan transaksi" onClick={() => setVoiding(r)}><Ban className="h-4 w-4" aria-hidden /></Button>}
      </div>
    );
  };

  const close = () => setDlg(null);
  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => setDlg({ kind: "create" })}><Plus className="h-4 w-4" aria-hidden />{allowedTypes.length === 1 ? `Catat ${TYPE_LABEL[allowedTypes[0]].toLowerCase()}` : "Catat transaksi"}</Button></div>
      <div className="rounded-card border border-line bg-surface shadow-card">
        {rows.length === 0 ? <div className="px-5 py-4"><EmptyState icon={ArrowLeftRight} title={emptyTitle} description={emptyText} /></div> : (
          <div className="overflow-x-auto p-2">
            <table className="w-full text-[13px]">
              <caption className="sr-only">Daftar transaksi</caption>
              <thead><tr className="bg-sunken/70 text-left [&>th:first-child]:rounded-l-lg [&>th:last-child]:rounded-r-lg">
                <th scope="col" className="px-3 py-2.5">Keterangan</th><th scope="col" className="hidden px-3 py-2.5 md:table-cell">Kategori &amp; akun</th>
                <th scope="col" className="hidden px-3 py-2.5 sm:table-cell">Tanggal</th><th scope="col" className="px-3 py-2.5 text-right">Nominal</th><th scope="col" className="hidden px-3 py-2.5 text-right sm:table-cell"><span className="sr-only">Aksi</span></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const voided = r.status === "voided";
                  const cat = categoryOf(r);
                  return (
                    <tr key={`${r.src}-${r.id}`} className="border-b border-line/70 last:border-0">
                      <td className="px-3 py-3">
                        <div className={cn("flex items-center gap-3", voided && "opacity-60")}>
                          <EntryAvatar r={r} className="hidden sm:flex" />
                          <div className="min-w-0 max-w-[9.5rem] sm:max-w-[22rem]">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={cn("truncate font-medium", voided && "line-through")}>{titleOf(r)}</span>
                              {voided && <Badge tone="loss">Dibatalkan</Badge>}
                              {r.kind === "adjustment" && <Badge tone="warn">Penyesuaian</Badge>}
                              {r.source === "transfer_fee" && <Badge>Otomatis dari transfer</Badge>}
                              {r.source === "debt_payment" && <Badge tone="brand">Cicilan · kelola di Utang</Badge>}
                              {r.source === "bill_payment" && <Badge tone="brand">Tagihan · kelola di Tagihan</Badge>}
                            </div>
                            {r.kind === "transfer" && <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">{r.account_name}<ArrowRight className="h-3 w-3" aria-hidden />{r.to_account_name}{r.description ? ` · ${r.description}` : ""}</p>}
                            {r.kind !== "transfer" && (r.merchant || r.tags) && <p className="mt-0.5 truncate text-xs text-muted">{[r.merchant && r.description ? r.merchant : null, r.tags ? r.tags.split(",").map((t) => `#${t}`).join(" ") : null].filter(Boolean).join(" · ")}</p>}
                            <p className="mt-0.5 text-xs text-muted sm:hidden">{formatDateShortID(r.occurred_on)}{r.kind !== "transfer" && ` · ${r.account_name}`}</p>
                            <div className="sm:hidden">{rowActions(r, "start")}</div>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-3 py-3 md:table-cell">
                        {cat ? <div className="space-y-1"><CategoryPill>{cat}</CategoryPill><p className="text-xs text-muted">{r.account_name}</p></div> : <span className="text-muted">{r.kind === "transfer" ? "Antar akun" : r.kind === "adjustment" ? r.account_name : "—"}</span>}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-3 text-muted sm:table-cell">{formatDateID(r.occurred_on)}</td>
                      <td className="num whitespace-nowrap px-3 py-3 text-right">{amountCell(r)}</td>
                      <td className="hidden px-3 py-3 sm:table-cell">{rowActions(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
