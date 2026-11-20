"use client";
import * as React from "react";
import { useFormState } from "react-dom";
import { Check, X, Pencil, Undo2, Link2, AlertTriangle, Inbox as InboxIcon, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { FormField, Input, Select } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/toast";
import { CategoryOptions } from "@/components/ledger/category-options";
import { formatIDR, formatDateID } from "@/lib/format";
import { suggestPattern } from "@/lib/capture/text";
import type { InboxView, InboxStatus } from "@/lib/inbox/inbox";
import type { AccountWithBalance, CategoryRow } from "@/lib/ledger/types";
import { approveItemsAction, rejectItemsAction, restoreItemAction, categorizeItemsAction, dismissMatchAction, updateInboxItemAction } from "@/app/actions/capture";
import type { ApproveResult } from "@/lib/inbox/inbox";
import type { ActionState } from "@/app/actions/shared";

const INIT: ActionState = { ok: false };
const STATUS: Record<InboxStatus, [string, "neutral" | "brand" | "warn" | "loss"]> = {
  new: ["Baru", "brand"], needs_review: ["Perlu ditinjau", "warn"], potential_duplicate: ["Potensi duplikat", "loss"], approved: ["Disetujui", "neutral"], rejected: ["Ditolak", "neutral"],
};
const SOURCE: Record<string, string> = { ocr: "OCR", csv: "CSV", xlsx: "XLSX", pdf: "PDF", quick_capture: "Ketik" };
const pending = (s: InboxStatus) => s === "new" || s === "needs_review" || s === "potential_duplicate";

function EditForm({ item, accounts, categories, today, onDone }: { item: InboxView; accounts: AccountWithBalance[]; categories: CategoryRow[]; today: string; onDone: () => void }) {
  const [state, action] = useFormState(updateInboxItemAction, INIT);
  const [type, setType] = React.useState<"income" | "expense">(item.type === "income" ? "income" : "expense");
  const [desc, setDesc] = React.useState(item.description ?? "");
  const [merchant, setMerchant] = React.useState(item.merchant ?? "");
  const [saveRule, setSaveRule] = React.useState(false);
  const [pattern, setPattern] = React.useState(suggestPattern(item.description ?? "", item.merchant));
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast("Item diperbarui"); onDone(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={item.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="e-type" label="Jenis"><Select id="e-type" name="type" value={type} onChange={(ev) => setType(ev.target.value as "income" | "expense")}><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option></Select></FormField>
        <FormField id="e-amount" label="Nominal" error={e.amount}><Input id="e-amount" name="amount" inputMode="numeric" defaultValue={item.amount ?? ""} aria-invalid={!!e.amount} autoFocus /></FormField>
        <FormField id="e-date" label="Tanggal" error={e.occurred_on}><Input id="e-date" name="occurred_on" type="date" defaultValue={item.occurred_on ?? ""} max={today} aria-invalid={!!e.occurred_on} /></FormField>
        <FormField id="e-acc" label="Akun" error={e.account_id}><Select id="e-acc" name="account_id" defaultValue={item.account_id ?? ""}><option value="">Pilih akun</option>{accounts.filter((a) => !a.is_archived || a.id === item.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></FormField>
      </div>
      <FormField id="e-desc" label="Keterangan" error={e.description}><Input id="e-desc" name="description" value={desc} onChange={(ev) => setDesc(ev.target.value)} maxLength={200} /></FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="e-merchant" label="Merchant" error={e.merchant}><Input id="e-merchant" name="merchant" value={merchant} onChange={(ev) => setMerchant(ev.target.value)} maxLength={100} /></FormField>
        <FormField id="e-cat" label="Kategori" error={e.category_id}><Select id="e-cat" name="category_id" key={type} defaultValue={item.category_id ?? ""}><CategoryOptions categories={categories} kind={type} selectedId={item.category_id} /></Select></FormField>
      </div>
      {item.match && item.match.kind !== "transfer" && (
        <label className="flex items-start gap-2 rounded-md bg-sunken px-3 py-2 text-sm"><input type="checkbox" name="dismiss_match" defaultChecked={!!item.match_dismissed} className="mt-0.5 h-4 w-4" />
          <span>Bukan pembayaran {item.match.kind === "debt" ? "cicilan" : "tagihan"} <strong>{item.match.label}</strong> (catat sebagai pengeluaran biasa)</span></label>
      )}
      <div className="space-y-2 rounded-md border border-line p-3">
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="save_rule" checked={saveRule} onChange={(ev) => setSaveRule(ev.target.checked)} className="h-4 w-4" />Ingat pilihan kategori ini untuk transaksi serupa</label>
        {saveRule && <FormField id="e-pattern" label="Kata kunci yang dicocokkan" error={e.rule_pattern} hint="Transaksi berikutnya yang memuat kata ini akan otomatis memakai kategori di atas."><Input id="e-pattern" name="rule_pattern" value={pattern} onChange={(ev) => setPattern(ev.target.value)} maxLength={60} /></FormField>}
      </div>
      <FormError message={!state.errors ? state.message : undefined} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Batal</Button><SubmitButton>Simpan</SubmitButton></div>
    </form>
  );
}

export function InboxManager({ rows, accounts, categories, today, emptyText }: { rows: InboxView[]; accounts: AccountWithBalance[]; categories: CategoryRow[]; today: string; emptyText: string }) {
  const [sel, setSel] = React.useState<Set<number>>(new Set());
  const [edit, setEdit] = React.useState<InboxView | null>(null);
  const [dupFor, setDupFor] = React.useState<InboxView | null>(null);
  const [results, setResults] = React.useState<{ rows: ApproveResult[]; ok: number } | null>(null);
  const [bulkCat, setBulkCat] = React.useState("");
  const [busy, startTransition] = React.useTransition();
  const toast = useToast();
  const byId = React.useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const pendingRows = rows.filter((r) => pending(r.status));
  const allSelected = pendingRows.length > 0 && pendingRows.every((r) => sel.has(r.id));
  React.useEffect(() => setSel(new Set()), [rows]);

  const toggle = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ids = [...sel];

  const approve = (list: number[], includeDup = false) => startTransition(async () => {
    const r = await approveItemsAction(list, includeDup);
    if (!r.ok) { toast(r.message ?? "Gagal menyetujui", "error"); return; }
    const ok = r.results.filter((x) => x.ok).length;
    const failed = r.results.filter((x) => !x.ok && x.code !== "done");
    toast(`${ok} item disetujui${failed.length ? `, ${failed.length} perlu perhatian` : ""}`, failed.length && !ok ? "error" : "ok");
    if (failed.length) setResults({ rows: failed, ok });
    setDupFor(null);
  });
  const reject = (list: number[]) => startTransition(async () => { const r = await rejectItemsAction(list); toast(r.ok ? `${r.count} item ditolak` : r.message ?? "Gagal", r.ok ? "ok" : "error"); });
  const categorize = () => startTransition(async () => {
    const r = await categorizeItemsAction(ids, Number(bulkCat));
    toast(r.ok ? `${r.updated} item dikategorikan${r.skipped ? `, ${r.skipped} dilewati (jenis tidak cocok)` : ""}` : r.message ?? "Gagal", r.ok ? "ok" : "error");
    setBulkCat("");
  });

  const matchChip = (r: InboxView) => {
    const m = r.match;
    if (!m) return r.match_dismissed ? <span className="text-xs text-muted">Kecocokan diabaikan</span> : null;
    const text = m.kind === "debt" ? `Akan dicatat sebagai pembayaran cicilan ${m.label} #${m.sequence_no}` : m.kind === "bill" ? `Akan dicatat sebagai pembayaran tagihan ${m.label}` : `Pasangan transfer: ${m.pair_label}`;
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Badge tone="brand"><Link2 className="mr-1 h-3 w-3" aria-hidden />{text}</Badge>
        {pending(r.status) && m.kind !== "transfer" && <button type="button" className="text-xs underline" onClick={() => startTransition(async () => { await dismissMatchAction(r.id, true); })}>Abaikan</button>}
        {m.kind !== "transfer" && <span className="sr-only">{m.reason}</span>}
      </span>
    );
  };

  if (rows.length === 0) return <div className="rounded-card border border-line bg-surface p-5"><EmptyState icon={InboxIcon} title="Tidak ada item" description={emptyText} /></div>;

  return (
    <>
      {sel.size > 0 && (
        <div role="region" aria-label="Aksi massal" className="sticky top-14 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-card border border-brand/40 bg-surface p-3 shadow-md">
          <span className="text-sm font-medium">{sel.size} dipilih</span>
          <Button size="sm" onClick={() => approve(ids)} disabled={busy}><Check className="h-4 w-4" aria-hidden />Setujui</Button>
          <Button size="sm" variant="secondary" onClick={() => reject(ids)} disabled={busy}><X className="h-4 w-4" aria-hidden />Tolak</Button>
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
          <label className="sr-only" htmlFor="bulk-cat">Kategori untuk item terpilih</label>
          <Select id="bulk-cat" value={bulkCat} onChange={(e) => setBulkCat(e.target.value)} className="h-8 w-56 text-sm">
            <option value="">Atur kategori…</option>
            <optgroup label="Pengeluaran"><CategoryOptions categories={categories} kind="expense" emptyLabel={null} /></optgroup>
            <optgroup label="Pemasukan"><CategoryOptions categories={categories} kind="income" emptyLabel={null} /></optgroup>
          </Select>
          <Button size="sm" variant="secondary" onClick={categorize} disabled={busy || !bulkCat}><Tags className="h-4 w-4" aria-hidden />Terapkan</Button>
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Batal pilih</Button>
          <p className="basis-full text-xs text-muted">Item &ldquo;Potensi duplikat&rdquo; tidak ikut disetujui massal. Setujui satu per satu setelah memeriksa.</p>
        </div>
      )}

      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-muted">
            <th scope="col" className="w-10 px-4 py-2.5"><input type="checkbox" aria-label="Pilih semua di halaman ini" className="h-4 w-4" checked={allSelected} disabled={pendingRows.length === 0} onChange={() => setSel(allSelected ? new Set() : new Set(pendingRows.map((r) => r.id)))} /></th>
            <th scope="col" className="px-3 py-2.5 font-medium">Tanggal</th><th scope="col" className="px-3 py-2.5 font-medium">Keterangan</th><th scope="col" className="px-3 py-2.5 font-medium">Akun</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Kategori</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Nominal</th><th scope="col" className="px-3 py-2.5 font-medium">Status</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Aksi</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const [label, tone] = STATUS[r.status];
              const canAct = pending(r.status);
              return (
                <tr key={r.id} className={`border-b border-line align-top last:border-0 ${r.status === "rejected" ? "opacity-60" : ""}`}>
                  <td className="px-4 py-3">{canAct && <input type="checkbox" className="h-4 w-4" aria-label={`Pilih ${r.description ?? "item"}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} />}</td>
                  <td className="whitespace-nowrap px-3 py-3">{r.occurred_on ? formatDateID(r.occurred_on) : <Badge tone="warn">Belum ada</Badge>}</td>
                  <td className="min-w-[16rem] px-3 py-3">
                    <p className="font-medium">{r.description || "(tanpa keterangan)"}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <Badge>{SOURCE[r.source_kind] ?? r.source_kind}</Badge>
                      {r.merchant && <span>{r.merchant}</span>}
                      {r.confidence !== null && r.confidence < 0.75 && <Badge tone="warn">Keyakinan {Math.round(r.confidence * 100)}%</Badge>}
                      {r.duplicates.length > 0 && <Badge tone="loss"><AlertTriangle className="mr-1 h-3 w-3" aria-hidden />Mirip {r.duplicates.map((d) => `#${d.split(":")[1]}`).join(", ")}</Badge>}
                    </div>
                    {matchChip(r) && <div className="mt-1.5">{matchChip(r)}</div>}
                    {r.note && canAct && <p className="mt-1 text-xs text-muted">{r.note}</p>}
                    {r.status === "approved" && r.posted_ref && <p className="mt-1 text-xs text-muted">Tercatat sebagai {r.posted_ref.startsWith("transfer") ? "transfer" : r.posted_ref.startsWith("debt") ? "pembayaran cicilan" : r.posted_ref.startsWith("bill") ? "pembayaran tagihan" : "transaksi"}</p>}
                  </td>
                  <td className="px-3 py-3">{r.account_name ?? <span className="text-warn">Belum dipilih</span>}</td>
                  <td className="px-3 py-3">{r.type === "transfer" ? "—" : r.category_name ? <>{r.parent_category_name ? `${r.parent_category_name} › ` : ""}{r.category_name}{r.category_source === "rule" && <span className="ml-1 text-xs text-muted">(aturan)</span>}</> : <span className="text-warn">Belum ada</span>}</td>
                  <td className={`num whitespace-nowrap px-3 py-3 text-right ${r.type === "income" ? "text-gain" : ""}`}>{r.amount ? `${r.type === "income" ? "+" : "−"}${formatIDR(r.amount)}` : <Badge tone="warn">Belum ada</Badge>}</td>
                  <td className="px-3 py-3"><Badge tone={tone}>{label}</Badge></td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    {canAct && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" onClick={() => (r.status === "potential_duplicate" ? setDupFor(r) : approve([r.id]))} disabled={busy} aria-label={`Setujui ${r.description ?? ""}`}><Check className="h-4 w-4" aria-hidden />Setujui</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEdit(r)} aria-label="Ubah item"><Pencil className="h-4 w-4" aria-hidden /></Button>
                        <Button size="sm" variant="ghost" onClick={() => reject([r.id])} disabled={busy} aria-label="Tolak item"><X className="h-4 w-4" aria-hidden /></Button>
                      </div>
                    )}
                    {r.status === "rejected" && <Button size="sm" variant="secondary" onClick={() => startTransition(async () => { const x = await restoreItemAction(r.id); toast(x.ok ? "Item dipulihkan" : x.message ?? "Gagal", x.ok ? "ok" : "error"); })}><Undo2 className="h-4 w-4" aria-hidden />Pulihkan</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog wide open={!!edit} onClose={() => setEdit(null)} title="Ubah item" description="Perubahan hanya berlaku di kotak masuk sampai Anda menyetujuinya.">
        {edit && <EditForm item={edit} accounts={accounts} categories={categories} today={today} onDone={() => setEdit(null)} />}
      </Dialog>

      <ConfirmDialog open={!!dupFor} onCancel={() => setDupFor(null)} pending={busy} confirmLabel="Tetap catat" danger
        title="Mirip dengan transaksi yang sudah ada"
        description={dupFor ? `${dupFor.description ?? "Item ini"} (${formatIDR(dupFor.amount ?? 0)}) punya nominal, akun, dan tanggal yang sama dengan ${dupFor.duplicates.length} catatan di buku besar (${dupFor.duplicates.map((d) => (d.startsWith("transfer") ? `transfer #${d.split(":")[1]}` : `transaksi #${d.split(":")[1]}`)).join(", ")}). Catat hanya jika ini memang transaksi terpisah.` : ""}
        onConfirm={() => dupFor && approve([dupFor.id], true)} />

      <Dialog open={!!results} onClose={() => setResults(null)} title="Beberapa item tidak dapat disetujui" description={results ? `${results.ok} berhasil. Yang lain tetap di kotak masuk dan tidak mengubah saldo.` : undefined}>
        <ul className="space-y-2 text-sm">
          {results?.rows.map((x) => <li key={x.id} className="rounded-md bg-sunken px-3 py-2"><span className="font-medium">{byId.get(x.id)?.description ?? `Item #${x.id}`}</span><br /><span className="text-loss">{x.error}</span></li>)}
        </ul>
        <div className="mt-4 flex justify-end"><Button onClick={() => setResults(null)}>Mengerti</Button></div>
      </Dialog>
    </>
  );
}
