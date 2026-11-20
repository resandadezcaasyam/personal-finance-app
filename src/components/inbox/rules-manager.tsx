"use client";
import * as React from "react";
import { useFormState } from "react-dom";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/toast";
import type { CategoryRow } from "@/lib/ledger/types";
import type { RuleRow } from "@/lib/capture/rules";
import { createRuleAction, deleteRuleAction, setRuleActiveAction } from "@/app/actions/capture";
import type { ActionState } from "@/app/actions/shared";

const INIT: ActionState = { ok: false };

export function RulesManager({ rules, categories }: { rules: RuleRow[]; categories: CategoryRow[] }) {
  const [state, action] = useFormState(createRuleAction, INIT);
  const [kind, setKind] = React.useState<"expense" | "income">("expense");
  const [pending, startTransition] = React.useTransition();
  const [filter, setFilter] = React.useState("");
  const formRef = React.useRef<HTMLFormElement>(null);
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast("Aturan disimpan"); formRef.current?.reset(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = state.errors ?? {};
  const cats = categories.filter((c) => c.kind === kind && !c.is_archived);
  const shown = rules.filter((r) => !filter || r.pattern.includes(filter.toLowerCase()) || (r.merchant_name ?? "").toLowerCase().includes(filter.toLowerCase()) || (r.category_name ?? "").toLowerCase().includes(filter.toLowerCase()));
  const user = shown.filter((r) => r.source === "user");
  const defaults = shown.filter((r) => r.source === "default");

  const row = (r: RuleRow) => (
    <tr key={r.id} className="border-b border-line last:border-0">
      <td className={`px-4 py-2 font-medium ${r.is_active ? "" : "text-muted line-through"}`}>{r.pattern}</td>
      <td className="px-4 py-2 text-muted">{r.merchant_name ?? "—"}</td>
      <td className="px-4 py-2">{r.category_name ?? "—"} <span className="text-xs text-muted">({r.kind === "income" ? "pemasukan" : "pengeluaran"})</span></td>
      <td className="px-4 py-2 text-right">
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => { const x = await setRuleActiveAction(r.id, !r.is_active); toast(x.ok ? (r.is_active ? "Aturan dinonaktifkan" : "Aturan diaktifkan") : x.message ?? "Gagal", x.ok ? "ok" : "error"); })}>{r.is_active ? "Nonaktifkan" : "Aktifkan"}</Button>
        {r.source === "user" && <Button size="sm" variant="ghost" aria-label={`Hapus aturan ${r.pattern}`} disabled={pending} onClick={() => startTransition(async () => { const x = await deleteRuleAction(r.id); toast(x.ok ? "Aturan dihapus" : x.message ?? "Gagal", x.ok ? "ok" : "error"); })}><Trash2 className="h-4 w-4" aria-hidden /></Button>}
      </td>
    </tr>
  );
  const table = (list: RuleRow[]) => (
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-4 py-2 font-medium">Pola</th><th scope="col" className="px-4 py-2 font-medium">Merchant</th><th scope="col" className="px-4 py-2 font-medium">Kategori</th><th scope="col" className="px-4 py-2" /></tr></thead><tbody>{list.map(row)}</tbody></table></div>
  );

  return (
    <div className="space-y-6">
      <p className="max-w-prose text-sm text-muted">Aturan mencocokkan kata di keterangan transaksi dengan kategori. Aturan Anda selalu didahulukan dari aturan bawaan, dan kategori yang Anda pilih sendiri tidak pernah ditimpa aturan.</p>
      <form ref={formRef} action={action} className="grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-[1.4fr_1fr_9rem_1.4fr_auto] sm:items-end">
        <FormField id="r-pattern" label="Pola kata" error={e.pattern} hint="Contoh: kopi kenangan"><Input id="r-pattern" name="pattern" required maxLength={60} /></FormField>
        <FormField id="r-merchant" label="Nama merchant" error={e.merchant}><Input id="r-merchant" name="merchant" maxLength={60} placeholder="opsional" /></FormField>
        <FormField id="r-kind" label="Jenis"><Select id="r-kind" name="kind" value={kind} onChange={(ev) => setKind(ev.target.value as "expense" | "income")}><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option></Select></FormField>
        <FormField id="r-cat" label="Kategori" error={e.category_id}><Select id="r-cat" name="category_id" key={kind} defaultValue=""><option value="">Pilih kategori</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.parent_id ? "— " : ""}{c.name}</option>)}</Select></FormField>
        <SubmitButton pendingLabel="Menyimpan…">Simpan aturan</SubmitButton>
      </form>
      <FormError message={!state.errors ? state.message : undefined} />
      <label className="block max-w-xs text-sm"><span className="sr-only">Cari aturan</span><Input placeholder="Cari aturan…" value={filter} onChange={(ev) => setFilter(ev.target.value)} /></label>
      <section className="rounded-card border border-line bg-surface"><h3 className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold">Aturan saya <Badge tone="brand">{user.length}</Badge></h3>{user.length ? table(user) : <p className="px-4 py-4 text-sm text-muted">Belum ada. Aturan dibuat di sini, atau lewat &ldquo;simpan sebagai aturan&rdquo; saat Anda mengoreksi kategori di kotak masuk.</p>}</section>
      <section className="rounded-card border border-line bg-surface"><h3 className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold">Aturan bawaan <Badge>{defaults.length}</Badge></h3>{defaults.length ? table(defaults) : <p className="px-4 py-4 text-sm text-muted">Tidak ada yang cocok.</p>}</section>
    </div>
  );
}
