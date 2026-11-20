import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { listCategories } from "@/lib/ledger/categories";
import { listLedger } from "@/lib/ledger/transactions";
import { parseLedgerFilters } from "@/lib/ledger/filters";
import type { LedgerKind } from "@/lib/ledger/types";
import { formatIDR, formatNumber, todayWIB } from "@/lib/format";
import { FilterBar } from "./filter-bar";
import { Pagination } from "./pagination";
import { TransactionsManager, type EntryType } from "./transactions-manager";

type SP = Record<string, string | string[] | undefined>;

/** Server-rendered ledger list: filters from the URL, rows from SQLite, actions in a client island. */
export function LedgerView({ basePath, sp, fixedType, allowedTypes, emptyTitle, emptyText }: {
  basePath: string; sp: SP; fixedType?: LedgerKind; allowedTypes: EntryType[]; emptyTitle: string; emptyText: string;
}) {
  const db = getDb();
  const filters = parseLedgerFilters(sp, fixedType);
  const page = listLedger(db, filters);
  const accounts = listAccounts(db);
  const categories = listCategories(db, { includeArchived: true });
  const hasFilters = !!(filters.q || filters.accountId || filters.categoryId || filters.from || filters.to || (!fixedType && filters.type) || filters.includeVoided);

  const params: Record<string, string | undefined> = {
    q: filters.q, type: fixedType ? undefined : filters.type, account: filters.accountId?.toString(), category: filters.categoryId?.toString(),
    from: filters.from, to: filters.to, sort: filters.sort === "date_desc" ? undefined : filters.sort, voided: filters.includeVoided ? "1" : undefined,
  };

  return (
    <>
      <FilterBar basePath={basePath} filters={filters} fixedType={fixedType} accounts={accounts} categories={categories} />
      <p className="mb-3 text-sm text-muted" role="status">
        {formatNumber(page.total)} entri
        {(page.incomeTotal > 0 || page.expenseTotal > 0) && <> · Pemasukan <span className="num text-gain">{formatIDR(page.incomeTotal)}</span> · Pengeluaran <span className="num text-loss">{formatIDR(page.expenseTotal)}</span></>}
        {hasFilters && " (sesuai filter)"}
      </p>
      <TransactionsManager
        rows={page.rows} accounts={accounts} categories={categories} today={todayWIB()} allowedTypes={allowedTypes}
        emptyTitle={hasFilters ? "Tidak ada hasil" : emptyTitle} emptyText={hasFilters ? "Tidak ada entri yang cocok dengan filter. Ubah atau atur ulang filter." : emptyText}
      />
      <Pagination basePath={basePath} params={params} page={page.page} pageSize={page.pageSize} total={page.total} />
    </>
  );
}
