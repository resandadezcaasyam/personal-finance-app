"use client";
import * as React from "react";
import { X } from "lucide-react";
import { Button } from "./button";

/** Native <dialog>: focus trap, Esc to close and inert background come from the browser. */
export function Dialog({ open, onClose, title, description, children, wide }: { wide?: boolean; open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="dlg-title"
      className={`max-h-[90vh] ${wide ? "w-[min(94vw,34rem)]" : "w-[min(92vw,28rem)]"} overflow-y-auto rounded-3xl border border-line bg-surface/90 p-0 text-ink shadow-pop ring-1 ring-white/20 backdrop-blur-2xl backdrop:backdrop-blur-[3px]`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h2 id="dlg-title" className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Tutup"><X className="h-4 w-4" /></Button>
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}

/** Confirmation for destructive or data-affecting operations. */
export function ConfirmDialog({ open, onCancel, onConfirm, title, description, confirmLabel, danger, pending, error }: {
  error?: string; open: boolean; onCancel: () => void; onConfirm: () => void; title: string; description: string; confirmLabel: string; danger?: boolean; pending?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onCancel} title={title} description={description}>
      {error && <p role="alert" className="mb-3 rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Batal</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={pending}>{pending ? "Memproses…" : confirmLabel}</Button>
      </div>
    </Dialog>
  );
}
