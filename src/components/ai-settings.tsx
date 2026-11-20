"use client";
import * as React from "react";
import { useFormState } from "react-dom";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { useToast } from "@/components/toast";
import { saveAiSettingsAction, testAiAction } from "@/app/actions/phase7";
import type { ActionState } from "@/app/actions/shared";

const INIT: ActionState = { ok: false };

export function AiSettings({ enabled, url, model }: { enabled: boolean; url: string; model: string }) {
  const [state, action] = useFormState(saveAiSettingsAction, INIT);
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = React.useTransition();
  const toast = useToast();
  React.useEffect(() => { if (state.ok) toast("Pengaturan AI disimpan"); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-muted">Opsional. Jika Anda memasang <strong>Ollama</strong> di komputer ini, Catat Cepat bisa memakainya untuk membaca kalimat yang lebih bebas. Aplikasi tetap berfungsi penuh tanpa AI, dan perhitungan keuangan tidak pernah memakai AI. Yang dikirim hanya kalimat yang Anda ketik dan nama akun/kategori, dan hanya ke alamat di komputer ini.</p>
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="enabled" defaultChecked={enabled} className="h-4 w-4" />Aktifkan AI lokal untuk Catat Cepat</label>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="ai-url" label="Alamat Ollama" error={e.url} hint="Harus http://127.0.0.1 atau http://localhost."><Input id="ai-url" name="url" defaultValue={url} required aria-invalid={!!e.url} /></FormField>
        <FormField id="ai-model" label="Model" error={e.model} hint="Contoh: llama3.2, qwen2.5:3b"><Input id="ai-model" name="model" defaultValue={model} required aria-invalid={!!e.model} /></FormField>
      </div>
      <FormError message={!state.errors && !state.ok ? state.message : undefined} />
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingLabel="Menyimpan…">Simpan</SubmitButton>
        <Button variant="secondary" disabled={pending} onClick={() => start(async () => setResult(await testAiAction()))}>{pending ? "Menguji…" : "Tes koneksi"}</Button>
        {result && <span role="status" className={`text-sm ${result.ok ? "text-gain" : "text-loss"}`}>{result.message}</span>}
      </div>
    </form>
  );
}
