import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-field";
import { CategoryOptions } from "./category-options";
import type { LedgerFilters } from "@/lib/ledger/transactions";
import type { AccountWithBalance, CategoryRow, LedgerKind } from "@/lib/ledger/types";
import { currentMonthWIB, monthRange, previousMonth } from "@/lib/format";

export function FilterBar({ basePath, filters, fixedType, accounts, categories }: {
  basePath: string; filters: LedgerFilters; fixedType?: LedgerKind; accounts: AccountWithBalance[]; categories: CategoryRow[];
}) {
  const now = currentMonthWIB();
  const cur = monthRange(now);
  const prev = monthRange(previousMonth(now));
  const preset = (from?: string, to?: string) => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (!fixedType && filters.type) p.set("type", filters.type);
    return `${basePath}${p.size ? `?${p}` : ""}`;
  };
  return (
    <form method="get" action={basePath} className="mb-4 rounded-card border border-line bg-surface p-4" role="search" aria-label="Filter transaksi">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="relative col-span-2">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" aria-hidden />
          <Input name="q" defaultValue={filters.q} placeholder="Cari deskripsi, merchant, tag, kategori" aria-label="Cari" className="pl-9" />
        </div>
        {!fixedType && (
          <Select name="type" defaultValue={filters.type ?? ""} aria-label="Jenis">
            <option value="">Semua jenis</option><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option><option value="transfer">Transfer</option><option value="adjustment">Penyesuaian</option>
          </Select>
        )}
        <Select name="account" defaultValue={filters.accountId ?? ""} aria-label="Akun">
          <option value="">Semua akun</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.is_archived ? " (arsip)" : ""}</option>)}
        </Select>
        <Select name="category" defaultValue={filters.categoryId ?? ""} aria-label="Kategori">
          {fixedType === "income" ? (
            <CategoryOptions categories={categories} kind="income" emptyLabel="Semua kategori" />
          ) : fixedType === "expense" ? (
            <CategoryOptions categories={categories} kind="expense" emptyLabel="Semua kategori" />
          ) : (
            <>
              <CategoryOptions categories={categories} kind="expense" emptyLabel="Semua kategori" prefix="Pengeluaran: " />
              <CategoryOptions categories={categories} kind="income" emptyLabel={null} prefix="Pemasukan: " />
            </>
          )}
        </Select>
        <label className="space-y-1 text-xs text-muted">Dari<Input type="date" name="from" defaultValue={filters.from} className="text-ink" /></label>
        <label className="space-y-1 text-xs text-muted">Sampai<Input type="date" name="to" defaultValue={filters.to} className="text-ink" /></label>
        <Select name="sort" defaultValue={filters.sort} aria-label="Urutkan">
          <option value="date_desc">Terbaru</option><option value="date_asc">Terlama</option><option value="amount_desc">Nominal terbesar</option><option value="amount_asc">Nominal terkecil</option>
        </Select>
        <label className="col-span-2 flex items-center gap-2 text-sm lg:col-span-4"><input type="checkbox" name="voided" value="1" defaultChecked={filters.includeVoided} className="h-4 w-4" />Tampilkan yang dibatalkan</label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm">Terapkan</Button>
        <Link href={fixedType ? basePath : preset()} className="inline-flex h-8 items-center rounded-md px-3 text-sm hover:bg-sunken">Atur ulang</Link>
        <span className="mx-1 hidden h-4 w-px bg-line sm:block" aria-hidden />
        <Link href={preset(cur.from, cur.to)} className="inline-flex h-8 items-center rounded-md border border-line px-3 text-sm hover:bg-sunken">Bulan ini</Link>
        <Link href={preset(prev.from, prev.to)} className="inline-flex h-8 items-center rounded-md border border-line px-3 text-sm hover:bg-sunken">Bulan lalu</Link>
      </div>
    </form>
  );
}
