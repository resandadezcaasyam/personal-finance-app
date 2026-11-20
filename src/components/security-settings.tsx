"use client";
import * as React from "react";
import { useFormState } from "react-dom";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { useToast } from "@/components/toast";
import { changePinAction, disablePinAction, enablePinAction, lockNowAction, signOutEverywhereAction } from "@/app/auth-actions";
import type { ActionState } from "@/app/actions/shared";

const INIT: ActionState = { ok: false };

function PinForm({ title, action, fields, button, done }: { title: string; action: (p: ActionState, f: FormData) => Promise<ActionState>; fields: { name: string; label: string; autoComplete: string }[]; button: string; done: string }) {
  const [state, run] = useFormState(action, INIT);
  const slug = title.replace(/\s+/g, "-").toLowerCase();
  const ref = React.useRef<HTMLFormElement>(null);
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast(done); ref.current?.reset(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = state.errors ?? {};
  return (
    <form ref={ref} action={run} className="space-y-3 rounded-md border border-line p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => <FormField key={f.name} id={`sec-${slug}-${f.name}`} label={f.label} error={e[f.name]}><Input id={`sec-${slug}-${f.name}`} name={f.name} type="password" autoComplete={f.autoComplete} required maxLength={128} aria-invalid={!!e[f.name]} /></FormField>)}
      </div>
      <FormError message={!state.errors && !state.ok ? state.message : undefined} />
      <SubmitButton pendingLabel="Memproses…">{button}</SubmitButton>
    </form>
  );
}

export function SecuritySettings({ enabled }: { enabled: boolean }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">PIN mengunci aplikasi (semua halaman, aksi, dan unduhan) di komputer ini, termasuk mode demo. <strong>PIN bukan enkripsi basis data</strong>: berkas <code>data/finance.db</code>, cadangan, dan ekspor tetap berkas biasa yang bisa dibaca siapa pun yang memegang berkasnya. Lupa PIN? Tutup aplikasi lalu hapus berkas <code>data/auth.json</code> (data keuangan tidak ikut terhapus).</p>
      {!enabled ? (
        <PinForm title="Aktifkan PIN" action={enablePinAction} button="Aktifkan PIN" done="PIN diaktifkan" fields={[{ name: "pin", label: "PIN baru (min. 4 karakter)", autoComplete: "new-password" }, { name: "confirm", label: "Ulangi PIN", autoComplete: "new-password" }]} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <form action={lockNowAction}><Button type="submit" variant="secondary">Kunci sekarang</Button></form>
            <form action={signOutEverywhereAction}><Button type="submit" variant="secondary">Keluarkan semua sesi</Button></form>
          </div>
          <PinForm title="Ubah PIN" action={changePinAction} button="Ubah PIN" done="PIN diubah" fields={[{ name: "current", label: "PIN saat ini", autoComplete: "current-password" }, { name: "pin", label: "PIN baru", autoComplete: "new-password" }, { name: "confirm", label: "Ulangi PIN baru", autoComplete: "new-password" }]} />
          <PinForm title="Nonaktifkan PIN" action={disablePinAction} button="Nonaktifkan PIN" done="PIN dinonaktifkan" fields={[{ name: "current", label: "PIN saat ini", autoComplete: "current-password" }]} />
        </>
      )}
    </div>
  );
}
