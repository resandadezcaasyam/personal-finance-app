export type AccountType = "cash" | "bank" | "ewallet" | "other";
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = { cash: "Tunai", bank: "Bank", ewallet: "E-wallet", other: "Lainnya" };

export interface AccountRow {
  id: number;
  name: string;
  type: AccountType;
  initial_balance: number;
  is_archived: number;
  sort_order: number;
  created_at: string;
}
export interface AccountWithBalance extends AccountRow {
  balance: number;
}

export interface CategoryRow {
  id: number;
  parent_id: number | null;
  name: string;
  kind: "income" | "expense";
  is_archived: number;
}

export type LedgerKind = "income" | "expense" | "adjustment" | "transfer";

/** One line of history: a transaction or a transfer. */
export interface LedgerEntry {
  src: "tx" | "tr";
  id: number;
  occurred_on: string;
  kind: LedgerKind;
  amount: number;
  account_id: number;
  to_account_id: number | null;
  category_id: number | null;
  description: string;
  merchant: string | null;
  tags: string | null;
  status: "posted" | "voided";
  adj_direction: "in" | "out" | null;
  source: string;
  account_name: string;
  to_account_name: string | null;
  category_name: string | null;
  parent_category_name: string | null;
}
