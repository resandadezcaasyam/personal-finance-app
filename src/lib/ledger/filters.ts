import type { LedgerFilters } from "./transactions";
import type { LedgerKind } from "./types";
import { isValidIsoDate } from "./validate";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const posInt = (v: string | undefined) => (v && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : undefined);

const KINDS: LedgerKind[] = ["income", "expense", "transfer", "adjustment"];
const SORTS = ["date_desc", "date_asc", "amount_desc", "amount_asc"] as const;

/** Parse URL search params into safe ledger filters. Unknown or malformed values are ignored. */
export function parseLedgerFilters(sp: SP, fixedType?: LedgerKind): LedgerFilters {
  const type = fixedType ?? (KINDS.find((k) => k === one(sp.type)) as LedgerKind | undefined);
  const from = one(sp.from);
  const to = one(sp.to);
  const sort = one(sp.sort);
  return {
    q: one(sp.q)?.slice(0, 100) || undefined,
    type,
    accountId: posInt(one(sp.account)),
    categoryId: posInt(one(sp.category)),
    from: from && isValidIsoDate(from) ? from : undefined,
    to: to && isValidIsoDate(to) ? to : undefined,
    sort: (SORTS as readonly string[]).includes(sort ?? "") ? (sort as LedgerFilters["sort"]) : "date_desc",
    includeVoided: one(sp.voided) === "1",
    page: posInt(one(sp.page)) ?? 1,
  };
}
