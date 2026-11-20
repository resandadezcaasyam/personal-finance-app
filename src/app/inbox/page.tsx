import Link from "next/link";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-field";
import { InboxManager } from "@/components/inbox/inbox-manager";
import { RulesManager } from "@/components/inbox/rules-manager";
import { Pagination } from "@/components/ledger/pagination";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { listCategories } from "@/lib/ledger/categories";
import { inboxCounts, listInbox, type InboxStatus } from "@/lib/inbox/inbox";
import { listRules } from "@/lib/capture/rules";
import { todayWIB } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TABS: [string, string][] = [["pending", "Perlu tindakan"], ["needs_review", "Perlu ditinjau"], ["potential_duplicate", "Potensi duplikat"], ["new", "Baru"], ["approved", "Disetujui"], ["rejected", "Ditolak"], ["all", "Semua"]];
const EMPTY: Record<string, string> = {
  pending: "Tidak ada yang menunggu. Impor mutasi atau struk di Pusat Impor, atau kirim dari Catat Cepat, dan hasilnya muncul di sini.",
  needs_review: "Tidak ada item yang perlu ditinjau.", potential_duplicate: "Tidak ada item yang mirip dengan transaksi yang sudah ada.", new: "Tidak ada item baru.",
  approved: "Belum ada item yang disetujui.", rejected: "Belum ada item yang ditolak.", all: "Kotak masuk masih kosong.",
};

export default function InboxPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const db = getDb();
  const rulesTab = searchParams.tab === "rules";
  const status = TABS.some(([v]) => v === searchParams.status) ? (searchParams.status as string) : "pending";
  const batch = /^\d+$/.test(searchParams.batch ?? "") ? Number(searchParams.batch) : undefined;
  const page = /^\d+$/.test(searchParams.page ?? "") ? Math.max(1, Number(searchParams.page)) : 1;
  const counts = inboxCounts(db);
  const categories = listCategories(db, { includeArchived: true });
  const countOf = (k: string) => (k === "all" ? null : counts[k as InboxStatus | "pending"]);

  const body = rulesTab ? <RulesManager rules={listRules(db)} categories={categories} /> : (() => {
    const list = listInbox(db, { status: status === "all" ? undefined : (status as InboxStatus | "pending"), batchId: batch, q: searchParams.q, page });
    return (
      <>
        <form method="get" action="/inbox" role="search" className="mb-4 flex flex-wrap items-center gap-2">
          <input type="hidden" name="status" value={status} />{batch && <input type="hidden" name="batch" value={batch} />}
          <div className="relative w-full max-w-sm"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" aria-hidden /><Input name="q" defaultValue={searchParams.q} placeholder="Cari keterangan atau merchant" aria-label="Cari" className="pl-9" /></div>
          <Button type="submit" size="sm">Cari</Button>
          {batch && <Link href={`/inbox?status=${status}`} className="text-sm underline">Hapus filter impor #{batch}</Link>}
        </form>
        <InboxManager rows={list.rows} accounts={listAccounts(db)} categories={categories} today={todayWIB()} emptyText={EMPTY[status] ?? EMPTY.all} />
        <Pagination basePath="/inbox" params={{ status, batch: batch?.toString(), q: searchParams.q }} page={list.page} pageSize={list.pageSize} total={list.total} />
      </>
    );
  })();

  return (
    <>
      <PageHeader title="Kotak Masuk Pintar" description="Semua transaksi dari impor, OCR, dan Catat Cepat berhenti di sini dulu. Periksa, ubah, lalu setujui. Hanya item yang disetujui yang masuk ke buku besar dan memengaruhi saldo." />
      <nav aria-label="Status" className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map(([v, l]) => (
          <Link key={v} href={`/inbox?status=${v}${batch ? `&batch=${batch}` : ""}`} aria-current={!rulesTab && status === v ? "page" : undefined}
            className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium", !rulesTab && status === v ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink")}>
            {l}{countOf(v) ? <Badge tone={v === "potential_duplicate" ? "loss" : v === "needs_review" ? "warn" : "neutral"}>{countOf(v)}</Badge> : null}
          </Link>
        ))}
        <Link href="/inbox?tab=rules" aria-current={rulesTab ? "page" : undefined} className={cn("-mb-px ml-auto border-b-2 px-3 py-2 text-sm font-medium", rulesTab ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink")}>Aturan merchant</Link>
      </nav>
      {body}
    </>
  );
}
