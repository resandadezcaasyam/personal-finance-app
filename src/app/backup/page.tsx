import { PageHeader } from "@/components/page-header";
import { BackupManager } from "@/components/backup/backup-manager";
import { getActiveProfile, getDb, getStartupHealth } from "@/lib/db/client";
import { backupDir } from "@/lib/db/paths";
import { listBackups } from "@/lib/backup/backup";

export const dynamic = "force-dynamic";

export default function BackupPage() {
  getDb(); // opens the database (and runs the startup self-check) before we read its result
  const personal = getActiveProfile() === "personal";
  return (
    <>
      <PageHeader title="Cadangan & Kesehatan Data" description="Buat, periksa, unduh, dan pulihkan cadangan data Anda, serta pastikan angka di buku besar masih konsisten." />
      <BackupManager backups={listBackups(backupDir())} personal={personal} startupProblem={getStartupHealth()} />
    </>
  );
}
