"use client";
import * as React from "react";
import { CheckCircle2, AlertTriangle, Download, HardDriveDownload, RotateCcw, ShieldCheck, Trash2, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/toast";
import { formatDateID, formatDateTimeID } from "@/lib/format";
import { createBackupAction, deleteBackupAction, restoreBackupAction, runIntegrityAction, validateBackupAction } from "@/app/actions/backup";
import type { BackupCheck } from "@/lib/backup/backup";
import type { IntegrityReport } from "@/lib/db/integrity";

export interface BackupRow { name: string; kind: "manual" | "pre-restore" | "pre-migration" | "other"; sizeBytes: number; createdAt: string }
const KIND: Record<BackupRow["kind"], [string, "brand" | "neutral" | "warn"]> = { manual: ["Manual", "brand"], "pre-restore": ["Sebelum pemulihan", "warn"], "pre-migration": ["Sebelum pembaruan", "neutral"], other: ["Lainnya", "neutral"] };
const size = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function BackupManager({ backups, personal, startupProblem }: { backups: BackupRow[]; personal: boolean; startupProblem: string | null }) {
  const [pending, start] = React.useTransition();
  const [restore, setRestore] = React.useState<BackupRow | null>(null);
  const [del, setDel] = React.useState<BackupRow | null>(null);
  const [err, setErr] = React.useState<string>();
  const [checks, setChecks] = React.useState<Record<string, BackupCheck | string>>({});
  const [report, setReport] = React.useState<IntegrityReport | null>(null);
  const toast = useToast();
  const close = () => { setRestore(null); setDel(null); setErr(undefined); };

  const verify = (b: BackupRow) => start(async () => {
    const r = await validateBackupAction(b.name);
    setChecks((c) => ({ ...c, [b.name]: r.check ?? r.message ?? "Gagal" }));
  });

  return (
    <div className="space-y-10">
      {startupProblem && <p role="alert" className="flex items-start gap-2 rounded-md border border-loss/40 bg-loss/10 px-4 py-3 text-sm text-loss"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span><strong>Pemeriksaan awal menemukan masalah:</strong> {startupProblem}. Jalankan pemeriksaan lengkap di bawah, dan pertimbangkan memulihkan cadangan terakhir yang sehat.</span></p>}

      <section aria-labelledby="h-bk">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="h-bk" className="font-display text-xl font-semibold">Cadangan</h2>
          <div className="flex flex-wrap gap-2">
            <a href="/api/export?kind=all" download className="inline-flex h-10 items-center gap-2 rounded-md border border-line px-4 text-sm font-medium hover:bg-sunken"><HardDriveDownload className="h-4 w-4" aria-hidden />Ekspor semua data (JSON)</a>
            <Button disabled={pending || !personal} onClick={() => start(async () => { const r = await createBackupAction(); toast(r.ok ? "Cadangan dibuat" : r.message ?? "Gagal", r.ok ? "ok" : "error"); })}>{pending ? "Memproses…" : "Buat cadangan sekarang"}</Button>
          </div>
        </div>
        {!personal && <p className="mb-3 rounded-md bg-sunken px-3 py-2 text-sm">Mode demo aktif. Cadangan dan pemulihan hanya untuk data pribadi; kembali ke data pribadi di Pengaturan.</p>}
        <p className="mb-3 max-w-prose text-sm text-muted">Cadangan disimpan di folder <code>data/backups</code> sebagai berkas basis data lengkap yang konsisten. Berkas ini berisi seluruh data keuangan Anda: simpan salinannya di tempat aman (mis. flash disk atau penyimpanan terenkripsi). Pemulihan selalu membuat cadangan &ldquo;sebelum pemulihan&rdquo; terlebih dahulu.</p>
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          {backups.length === 0 ? <p className="p-5 text-sm text-muted">Belum ada cadangan. Tekan &ldquo;Buat cadangan sekarang&rdquo;.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-4 py-2.5 font-medium">Berkas</th><th scope="col" className="px-4 py-2.5 font-medium">Jenis</th><th scope="col" className="px-4 py-2.5 font-medium">Dibuat</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Ukuran</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Aksi</th></tr></thead>
              <tbody>
                {backups.map((b) => {
                  const c = checks[b.name];
                  return (
                    <tr key={b.name} className="border-b border-line align-top last:border-0">
                      <td className="px-4 py-3"><span className="break-all font-mono text-xs">{b.name}</span>
                        {c && (typeof c === "string" ? <p className="mt-1 text-xs text-loss">{c}</p> : c.ok
                          ? <p className="mt-1 flex items-center gap-1 text-xs text-gain"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Sehat · skema {c.schemaVersion} · {c.accounts} akun · {c.transactions} transaksi</p>
                          : <p className="mt-1 flex items-start gap-1 text-xs text-loss"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{c.problems[0]}</p>)}</td>
                      <td className="px-4 py-3"><Badge tone={KIND[b.kind][1]}>{KIND[b.kind][0]}</Badge></td>
                      <td className="whitespace-nowrap px-4 py-3">{formatDateTimeID(b.createdAt)}</td>
                      <td className="num whitespace-nowrap px-4 py-3 text-right">{size(b.sizeBytes)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" disabled={pending} aria-label={`Periksa ${b.name}`} onClick={() => verify(b)}><ShieldCheck className="h-4 w-4" aria-hidden /></Button>
                        <a href={`/api/backup/download?name=${encodeURIComponent(b.name)}`} download aria-label={`Unduh ${b.name}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-sunken"><Download className="h-4 w-4" aria-hidden /></a>
                        <Button size="sm" variant="ghost" disabled={pending || !personal} aria-label={`Pulihkan ${b.name}`} onClick={() => { setRestore(b); setErr(undefined); }}><RotateCcw className="h-4 w-4" aria-hidden /></Button>
                        <Button size="sm" variant="ghost" disabled={pending} aria-label={`Hapus ${b.name}`} onClick={() => { setDel(b); setErr(undefined); }}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section aria-labelledby="h-int">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="h-int" className="font-display text-xl font-semibold">Kesehatan data</h2>
          <Button variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await runIntegrityAction(); if (r.report) setReport(r.report); else toast(r.message ?? "Gagal", "error"); })}><ListChecks className="h-4 w-4" aria-hidden />Periksa integritas</Button>
        </div>
        <p className="mb-3 max-w-prose text-sm text-muted">Memeriksa struktur berkas, keterkaitan antar data, dan kecocokan angka (cicilan, pembayaran, tagihan, target tabungan) dengan buku besar. Pemeriksaan ini hanya membaca dan tidak mengubah apa pun.</p>
        {report && (
          <div className="rounded-card border border-line bg-surface">
            <p className={`flex items-center gap-2 border-b border-line px-5 py-3 text-sm font-medium ${report.ok ? "text-gain" : "text-loss"}`} role="status">{report.ok ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />}{report.ok ? "Semua pemeriksaan lolos" : "Ada pemeriksaan yang gagal"} · {formatDateTimeID(report.ranAt)}</p>
            <ul className="divide-y divide-line text-sm">
              {report.checks.map((c) => <li key={c.id} className="flex items-start gap-3 px-5 py-2.5">{c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gain" aria-label="Lolos" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-loss" aria-label="Gagal" />}<span><span className="font-medium">{c.label}</span><span className="block text-xs text-muted">{c.detail}</span></span></li>)}
            </ul>
          </div>
        )}
      </section>

      <ConfirmDialog open={!!restore} onCancel={close} danger pending={pending} error={err} confirmLabel="Ya, pulihkan" title="Pulihkan cadangan ini?"
        description={restore ? `Data saat ini akan diganti dengan isi cadangan tertanggal ${formatDateTimeID(restore.createdAt)}. Sebelum itu, kondisi sekarang disimpan otomatis sebagai cadangan "sebelum pemulihan", jadi Anda bisa kembali. Cadangan diperiksa dulu; jika rusak atau terlalu baru, pemulihan dibatalkan tanpa mengubah apa pun.` : ""}
        onConfirm={() => restore && start(async () => { const r = await restoreBackupAction(restore.name); if (r.ok) { toast("Data dipulihkan"); close(); window.location.reload(); } else setErr(r.message); })} />
      <ConfirmDialog open={!!del} onCancel={close} danger pending={pending} error={err} confirmLabel="Hapus cadangan" title="Hapus cadangan ini?" description={del ? `${del.name} dihapus permanen dari komputer ini.` : ""}
        onConfirm={() => del && start(async () => { const r = await deleteBackupAction(del.name); if (r.ok) { toast("Cadangan dihapus"); close(); } else setErr(r.message); })} />
      <p className="text-xs text-muted">Terakhir diperbarui {formatDateID(new Date().toISOString().slice(0, 10))}.</p>
    </div>
  );
}
