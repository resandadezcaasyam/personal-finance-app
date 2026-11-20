"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-field";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/toast";
import { formatIDR, formatMonthID } from "@/lib/format";
import type { BudgetLine } from "@/lib/budgets/budgets";
import { copyBudgetsAction, setBudgetAction } from "@/app/actions/phase7";

const STATUS: Record<BudgetLine["status"], ["neutral" | "brand" | "warn" | "loss", string]> = { none: ["neutral", "Tanpa anggaran"], ok: ["brand", "Aman"], warning: ["warn", "Hampir habis"], over: ["loss", "Terlampaui"] };

function Row({ line, month }: { line: BudgetLine; month: string }) {
  const [value, setValue] = React.useState(line.budget === null ? "" : String(line.budget));
  const [pending, start] = React.useTransition();
  const toast = useToast();
  React.useEffect(() => setValue(line.budget === null ? "" : String(line.budget)), [line.budget, month]);
  const save = () => {
    const was = line.budget === null ? "" : String(line.budget);
    if (value.trim() === was) return;
    start(async () => { const r = await setBudgetAction(line.category_id, month, value); toast(r.ok ? (value.trim() === "" ? "Anggaran dihapus" : "Anggaran disimpan") : r.message ?? "Gagal", r.ok ? "ok" : "error"); if (!r.ok) setValue(was); });
  };
  const [tone, label] = STATUS[line.status];
  const pct = line.pct === null ? 0 : Math.min(100, Math.round(line.pct * 100));
  return (
    <tr className="border-b border-line align-middle last:border-0">
      <td className="px-4 py-3 font-medium">{line.name}</td>
      <td className="px-4 py-3"><label className="sr-only" htmlFor={`bud-${line.category_id}`}>Anggaran {line.name}</label>
        <Input id={`bud-${line.category_id}`} value={value} inputMode="numeric" placeholder="Tanpa anggaran" disabled={pending} onChange={(e) => setValue(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className="h-9 w-36 text-right text-sm" /></td>
      <td className="num whitespace-nowrap px-4 py-3 text-right">{formatIDR(line.actual)}</td>
      <td className={`num whitespace-nowrap px-4 py-3 text-right ${line.remaining !== null && line.remaining < 0 ? "text-loss" : ""}`}>{line.remaining === null ? "—" : formatIDR(line.remaining)}</td>
      <td className="min-w-32 px-4 py-3">
        {line.budget !== null && <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Pemakaian ${line.name}`} className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"><div className={`h-full rounded-full ${line.status === "over" ? "bg-loss" : line.status === "warning" ? "bg-warn" : "bg-brand"}`} style={{ width: `${pct}%` }} /></div>}
        <p className="mt-1 text-xs text-muted">{line.pct === null ? "—" : Number.isFinite(line.pct) ? `${Math.round(line.pct * 100)}%` : "tanpa batas"}</p></td>
      <td className="px-4 py-3"><Badge tone={tone}>{label}</Badge></td>
    </tr>
  );
}

export function BudgetTable({ month, prevMonth, nextMonth, lines, totals, uncategorized, basePath }: {
  month: string; prevMonth: string; nextMonth: string | null; lines: BudgetLine[]; totals: { budget: number; actualBudgeted: number; actual: number }; uncategorized: number; basePath: string;
}) {
  const [pending, start] = React.useTransition();
  const toast = useToast();
  const btn = "inline-flex h-9 w-9 items-center justify-center rounded-md border border-line hover:bg-sunken";
  const copy = () => start(async () => {
    const r = await copyBudgetsAction(prevMonth, month, false);
    toast(r.ok ? `${r.copied} anggaran disalin${r.skipped ? `, ${r.skipped} dilewati (sudah ada)` : ""}` : r.message ?? "Gagal", r.ok ? "ok" : "error");
  });
  const hasBudgets = totals.budget > 0 || lines.some((l) => l.budget !== null);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Link href={`${basePath}?bm=${prevMonth}`} className={btn} aria-label="Bulan sebelumnya"><ChevronLeft className="h-4 w-4" aria-hidden /></Link>
          <h3 className="min-w-40 text-center font-display text-lg font-semibold">{formatMonthID(month)}</h3>
          {nextMonth ? <Link href={`${basePath}?bm=${nextMonth}`} className={btn} aria-label="Bulan berikutnya"><ChevronRight className="h-4 w-4" aria-hidden /></Link> : <span className={`${btn} opacity-30`} aria-hidden><ChevronRight className="h-4 w-4" /></span>}
        </div>
        <Button size="sm" variant="secondary" disabled={pending} onClick={copy}><Copy className="h-4 w-4" aria-hidden />Salin anggaran {formatMonthID(prevMonth)}</Button>
      </div>
      <p className="mb-3 max-w-prose text-sm text-muted">Isi anggaran per kategori utama (subkategori ikut terhitung). Kosongkan kolom untuk menghapus. Realisasi dihitung dari pengeluaran yang tercatat; transfer tidak dihitung.</p>
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-4 py-2.5 font-medium">Kategori</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Anggaran</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Terpakai</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Sisa</th><th scope="col" className="px-4 py-2.5 font-medium">Pemakaian</th><th scope="col" className="px-4 py-2.5 font-medium">Status</th></tr></thead>
          <tbody>{lines.map((l) => <Row key={l.category_id} line={l} month={month} />)}</tbody>
          <tfoot>
            <tr className="border-t border-line font-medium"><td className="px-4 py-3">Total beranggaran</td><td className="num px-4 py-3 text-right">{formatIDR(totals.budget)}</td><td className="num px-4 py-3 text-right">{formatIDR(totals.actualBudgeted)}</td><td className={`num px-4 py-3 text-right ${totals.budget - totals.actualBudgeted < 0 ? "text-loss" : ""}`}>{formatIDR(totals.budget - totals.actualBudgeted)}</td><td colSpan={2} /></tr>
            <tr className="text-muted"><td className="px-4 py-2">Semua pengeluaran bulan ini</td><td /><td className="num px-4 py-2 text-right">{formatIDR(totals.actual)}</td><td colSpan={3} className="px-4 py-2 text-xs">{uncategorized > 0 ? `termasuk ${formatIDR(uncategorized)} tanpa kategori` : ""}</td></tr>
          </tfoot>
        </table>
      </div>
      {!hasBudgets && <p className="mt-2 text-sm text-muted">Belum ada anggaran bulan ini. Isi kolom Anggaran, atau salin dari bulan lalu.</p>}
    </div>
  );
}
