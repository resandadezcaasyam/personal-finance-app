"use client";
import * as React from "react";
import { useFormState } from "react-dom";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { useToast } from "@/components/toast";
import type { CategoryRow } from "@/lib/ledger/types";
import { createCategoryAction, setCategoryArchivedAction, type ActionState } from "@/app/actions/ledger";

const INIT: ActionState = { ok: false };

export function CategoryManager({ categories }: { categories: CategoryRow[] }) {
  const [state, action] = useFormState(createCategoryAction, INIT);
  const [kind, setKind] = React.useState<"expense" | "income">("expense");
  const [pending, startTransition] = React.useTransition();
  const formRef = React.useRef<HTMLFormElement>(null);
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast("Kategori ditambahkan"); formRef.current?.reset(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = state.errors ?? {};
  const parents = categories.filter((c) => c.kind === kind && c.parent_id === null && !c.is_archived);

  const group = (k: "expense" | "income", title: string) => (
    <div>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      <ul className="space-y-1 text-sm">
        {categories.filter((c) => c.kind === k && c.parent_id === null).map((p) => (
          <li key={p.id}>
            <div className="flex items-center justify-between gap-2">
              <span className={p.is_archived ? "text-muted line-through" : "font-medium"}>{p.name}</span>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => { const r = await setCategoryArchivedAction(p.id, !p.is_archived); toast(r.ok ? (p.is_archived ? "Kategori dipulihkan" : "Kategori diarsipkan") : r.message ?? "Gagal", r.ok ? "ok" : "error"); })}>{p.is_archived ? "Pulihkan" : "Arsipkan"}</Button>
            </div>
            <ul className="ml-4 border-l border-line pl-3 text-muted">
              {categories.filter((c) => c.parent_id === p.id).map((c) => <li key={c.id} className={c.is_archived ? "line-through" : ""}>{c.name}</li>)}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="space-y-5">
      <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-[1fr_9rem_1fr_auto] sm:items-end">
        <FormField id="cat-name" label="Nama kategori" error={e.name}><Input id="cat-name" name="name" required maxLength={50} /></FormField>
        <FormField id="cat-kind" label="Jenis"><Select id="cat-kind" name="kind" value={kind} onChange={(ev) => setKind(ev.target.value as "expense" | "income")}><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option></Select></FormField>
        <FormField id="cat-parent" label="Induk (opsional)" error={e.parent_id}>
          <Select id="cat-parent" name="parent_id" key={kind}><option value="">Kategori utama</option>{parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        </FormField>
        <SubmitButton pendingLabel="Menambah…">Tambah</SubmitButton>
      </form>
      <FormError message={!state.errors ? state.message : undefined} />
      <div className="grid gap-6 sm:grid-cols-2">{group("expense", "Pengeluaran")}{group("income", "Pemasukan")}</div>
    </div>
  );
}
