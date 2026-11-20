import { PageHeader } from "@/components/page-header";
import { QuickCapture } from "@/components/capture/quick-capture";
import { TemplatesManager } from "@/components/capture/templates-manager";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { listCategories } from "@/lib/ledger/categories";
import { listTemplates } from "@/lib/capture/templates";
import { todayWIB } from "@/lib/format";
import { loadAiSettings } from "@/lib/capture/ollama";

export const dynamic = "force-dynamic";

export default function QuickCapturePage() {
  const db = getDb();
  const accounts = listAccounts(db);
  const categories = listCategories(db, { includeArchived: true });
  const templates = listTemplates(db);
  return (
    <>
      <PageHeader title="Catat Cepat" description="Ketik transaksi seperti mengirim chat. Aplikasi membaca nominal, akun, tanggal, dan kategori di komputer ini (tanpa internet), lalu Anda memeriksa pratinjaunya sebelum apa pun tercatat." />
      <QuickCapture accounts={accounts} categories={categories} templates={templates} today={todayWIB()} aiEnabled={loadAiSettings(db).enabled} />
      <div className="mt-12"><TemplatesManager templates={templates} accounts={accounts} categories={categories} /></div>
    </>
  );
}
