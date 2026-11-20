import type Database from "better-sqlite3";
import { listAccounts } from "../ledger/accounts";
import { listCategories } from "../ledger/categories";
import { todayWIB } from "../format";
import { parseQuickCapture, type Draft } from "./nl-parser";
import { loadMatcher } from "./rules";
import { AiError, loadAiSettings, parseWithOllama } from "./ollama";

export interface SmartResult { drafts: Draft[]; source: "ai" | "builtin"; notice: string | null }

/**
 * Reads quick-capture text. With the optional local AI enabled it asks the model first; if the AI is off, unreachable,
 * slow or returns something unusable, the deterministic built-in parser is used instead, so the app never depends on AI.
 */
export async function parseCaptureSmart(db: Database.Database, text: string, opts: { useAi: boolean; today?: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<SmartResult> {
  const today = opts.today ?? todayWIB();
  const matcher = loadMatcher(db);
  const accounts = listAccounts(db, { archived: false }).map((a) => ({ id: a.id, name: a.name, type: a.type }));
  const builtin = () => parseQuickCapture(text, { today, accounts, matchRule: matcher });
  if (!opts.useAi) return { drafts: builtin(), source: "builtin", notice: null };
  const settings = loadAiSettings(db);
  try {
    const drafts = await parseWithOllama(text, {
      today, accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
      categories: listCategories(db).map((c) => ({ id: c.id, name: c.name, kind: c.kind })), matchRule: matcher,
    }, settings, { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs });
    return { drafts, source: "ai", notice: null };
  } catch (e) {
    const why = e instanceof AiError ? e.message : "AI lokal gagal.";
    return { drafts: builtin(), source: "builtin", notice: `${why} Memakai pembaca bawaan.` };
  }
}
