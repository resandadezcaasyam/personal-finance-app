import { PageHeader } from "@/components/page-header";
import { ReceiptUploader, StatementImporter, ImportHistory } from "@/components/imports/import-center";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { listBatches } from "@/lib/inbox/inbox";
import { todayWIB } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  const db = getDb();
  return (
    <>
      <PageHeader title="Pusat Impor" description="Masukkan banyak transaksi sekaligus dari screenshot, struk, atau mutasi bank. Semua hasil masuk ke kotak masuk untuk ditinjau; hanya yang Anda setujui yang memengaruhi saldo." />
      <section aria-labelledby="h-ocr" className="mb-12">
        <h2 id="h-ocr" className="mb-1 font-display text-xl font-semibold">Screenshot &amp; struk</h2>
        <p className="mb-4 max-w-prose text-sm text-muted">Dibaca dengan OCR offline. Nominal diambil dari baris total, bukan dari saldo, subtotal, atau angka lain; bila ragu, item ditandai untuk ditinjau.</p>
        <ReceiptUploader />
      </section>
      <section aria-labelledby="h-stmt" className="mb-12">
        <h2 id="h-stmt" className="mb-1 font-display text-xl font-semibold">Mutasi rekening &amp; e-wallet</h2>
        <p className="mb-4 max-w-prose text-sm text-muted">CSV, XLSX, atau PDF. Pemetaan kolom bisa disimpan sebagai template. File yang sama tidak akan diimpor dua kali, dan baris yang tumpang tindih dengan impor sebelumnya dilewati.</p>
        <StatementImporter accounts={listAccounts(db)} today={todayWIB()} />
      </section>
      <section aria-labelledby="h-hist">
        <h2 id="h-hist" className="mb-3 font-display text-xl font-semibold">Riwayat impor</h2>
        <ImportHistory batches={listBatches(db)} />
      </section>
    </>
  );
}
