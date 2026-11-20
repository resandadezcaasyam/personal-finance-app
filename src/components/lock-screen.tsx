"use client";
import { useFormState } from "react-dom";
import { Lock } from "lucide-react";
import { Input } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { loginAction } from "@/app/auth-actions";

export function LockScreen() {
  const [state, action] = useFormState(loginAction, { ok: false });
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-5 px-6" aria-labelledby="lock-title">
      <div className="flex items-center gap-2 font-display text-xl font-semibold"><Lock className="h-5 w-5 text-brand" aria-hidden />Personal Finance OS</div>
      <div>
        <h1 id="lock-title" className="font-display text-2xl font-semibold">Aplikasi terkunci</h1>
        <p className="mt-1 text-sm text-muted">Masukkan PIN untuk membuka data keuangan Anda.</p>
      </div>
      <form action={action} className="space-y-4">
        <label className="block space-y-1.5 text-sm font-medium" htmlFor="lock-pin">PIN
          <Input id="lock-pin" name="pin" type="password" autoComplete="current-password" autoFocus required maxLength={128} className="font-normal" aria-describedby="lock-help" />
        </label>
        <p id="lock-help" className="text-xs text-muted">Setelah beberapa kali salah, aplikasi menunggu beberapa saat sebelum menerima percobaan berikutnya.</p>
        <FormError message={state.message} />
        <SubmitButton pendingLabel="Memeriksa…" className="w-full">Buka</SubmitButton>
      </form>
    </main>
  );
}
