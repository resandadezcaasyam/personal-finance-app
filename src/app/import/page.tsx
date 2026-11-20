import { Camera, FileSpreadsheet, UploadCloud, Inbox, CheckCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ReceiptUploader, StatementImporter, ImportHistory } from "@/components/imports/import-center";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { listBatches } from "@/lib/inbox/inbox";
import { todayWIB } from "@/lib/format";

export const dynamic = "force-dynamic";

const STEPS = [
  { icon: UploadCloud, text: "1. Unggah file atau gambar" },
  { icon: Inbox, text: "2. Hasil masuk ke Kotak Masuk untuk ditinjau" },
  { icon: CheckCheck, text: "3. Setujui: baru memengaruhi saldo" },
];

export default function ImportPage() {
  const db = getDb();
  return (
    <>
      <PageHeader title="Pusat Impor" description="Masukkan banyak transaksi sekaligus dari screenshot, struk, atau mutasi bank. Semua hasil masuk ke kotak masuk untuk ditinjau; hanya yang Anda setujui yang memengaruhi saldo." />
      <ol aria-label="Cara kerja impor" className="mb-6 flex flex-wrap gap-2 text-[13px]">
        {STEPS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 shadow-card"><Icon className="h-4 w-4 text-brand-text" aria-hidden />{text}</li>
        ))}
      </ol>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card aria-labelledby="h-ocr"><CardBody className="space-y-4 p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-brand-text"><Camera className="h-5 w-5" aria-hidden /></span>
            <div><h2 id="h-ocr" className="text-base font-semibold tracking-tight">Screenshot &amp; struk</h2><p className="mt-1 text-[13px] leading-5 text-muted">Dibaca dengan OCR offline. Nominal diambil dari baris total, bukan dari saldo, subtotal, atau angka lain; bila ragu, item ditandai untuk ditinjau.</p></div>
          </div>
          <ReceiptUploader />
        </CardBody></Card>
        <Card aria-labelledby="h-stmt"><CardBody className="space-y-4 p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-brand-text"><FileSpreadsheet className="h-5 w-5" aria-hidden /></span>
            <div><h2 id="h-stmt" className="text-base font-semibold tracking-tight">Mutasi rekening &amp; e-wallet</h2><p className="mt-1 text-[13px] leading-5 text-muted">CSV, XLSX, atau PDF. Pemetaan kolom bisa disimpan sebagai template. File yang sama tidak akan diimpor dua kali, dan baris yang tumpang tindih dengan impor sebelumnya dilewati.</p></div>
          </div>
          <StatementImporter accounts={listAccounts(db)} today={todayWIB()} />
        </CardBody></Card>
      </div>
      <section aria-labelledby="h-hist" className="mt-10">
        <h2 id="h-hist" className="mb-3 text-lg font-semibold tracking-tight">Riwayat impor</h2>
        <ImportHistory batches={listBatches(db)} />
      </section>
    </>
  );
}
