import { Archive, Clock, HardDrive } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { BackupManager } from "@/components/backup/backup-manager";
import { getActiveProfile, getDb, getStartupHealth } from "@/lib/db/client";
import { backupDir } from "@/lib/db/paths";
import { listBackups } from "@/lib/backup/backup";
import { formatDateTimeID } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function BackupPage() {
  getDb(); // opens the database (and runs the startup self-check) before we read its result
  const personal = getActiveProfile() === "personal";
  const backups = listBackups(backupDir());
  const total = backups.reduce((t, b) => t + b.sizeBytes, 0);
  const last = backups.find((b) => b.kind === "manual" || b.kind === "pre-restore");
  const size = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  return (
    <>
      <PageHeader title="Cadangan & Kesehatan Data" description="Buat, periksa, unduh, dan pulihkan cadangan data Anda, serta pastikan angka di buku besar masih konsisten." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard emphasis label="Cadangan tersimpan" icon={Archive} value={String(backups.length)} caption="Di folder data/backups" />
        <KpiCard label="Cadangan manual terakhir" icon={Clock} value={last ? formatDateTimeID(last.createdAt).split(" ").slice(0, 3).join(" ") : "Belum ada"} empty={!last} caption={last ? `Pukul ${formatDateTimeID(last.createdAt).split(" ")[3]}` : "Buat cadangan pertama Anda"} />
        <KpiCard label="Ruang yang dipakai" icon={HardDrive} value={backups.length ? size(total) : "—"} empty={backups.length === 0} caption="Seluruh berkas cadangan" />
      </div>
      <BackupManager backups={backups} personal={personal} startupProblem={getStartupHealth()} />
    </>
  );
}
