"use client";
import * as React from "react";
import Link from "next/link";
import { useFormState } from "react-dom";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/toast";
import { deleteScenarioAction, saveScenarioAction } from "@/app/actions/forecast";
import type { ActionState } from "@/app/actions/shared";
import type { SavedScenario } from "@/lib/forecast/data";

const INIT: ActionState = { ok: false };

export function ScenarioSaver({ saved, params, months }: { saved: (SavedScenario & { href: string })[]; params: { ip: number; sp: number; bp: number; dd: number; buf: number }; months: number }) {
  const [state, action] = useFormState(saveScenarioAction, INIT);
  const [pending, startTransition] = React.useTransition();
  const ref = React.useRef<HTMLFormElement>(null);
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast("Skenario disimpan"); ref.current?.reset(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3">
      <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
        {Object.entries(params).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="hidden" name="months" value={months} />
        <label className="space-y-1 text-xs text-muted">Simpan asumsi saat ini sebagai<Input name="name" required maxLength={40} placeholder="Contoh: Gaji telat" className="h-9 w-56 text-sm text-ink" aria-invalid={!!state.errors?.name} /></label>
        <SubmitButton pendingLabel="Menyimpan…">Simpan skenario</SubmitButton>
      </form>
      {state.message && !state.ok && <p role="alert" className="text-sm text-loss">{state.message}</p>}
      {saved.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line text-sm">
          {saved.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span><Link href={s.href} className="font-medium text-brand underline">{s.name}</Link> <span className="text-muted">· pemasukan {s.params.income_pct}%, belanja {s.params.spending_pct}%, tagihan {s.params.bills_pct}%, telat {s.params.income_delay_days} hari</span></span>
              <Button size="sm" variant="ghost" aria-label={`Hapus skenario ${s.name}`} disabled={pending} onClick={() => startTransition(async () => { const r = await deleteScenarioAction(s.id); toast(r.ok ? "Skenario dihapus" : r.message ?? "Gagal", r.ok ? "ok" : "error"); })}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
