"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/toast";
import { resetDemoAction } from "@/app/actions/ledger";

export function ResetDemoButton() {
  const [open, setOpen] = React.useState(false);
  const [err, setErr] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  const toast = useToast();
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>Reset data demo</Button>
      <ConfirmDialog open={open} onCancel={() => setOpen(false)} danger pending={pending} error={err}
        title="Reset data demo?" description="Data demo dihapus lalu dibuat ulang dengan contoh fiktif terbaru. Data pribadi Anda tidak terpengaruh."
        confirmLabel="Reset data demo"
        onConfirm={() => startTransition(async () => { const r = await resetDemoAction(); if (r.ok) { toast("Data demo dibuat ulang"); setOpen(false); } else setErr(r.message); })} />
    </>
  );
}
