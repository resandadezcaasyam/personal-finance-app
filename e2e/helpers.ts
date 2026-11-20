import { test as base, expect, type Page, type Locator } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export { expect };
export const DATA_DIR = process.env.E2E_DATA_DIR ?? path.join(os.tmpdir(), "pfos-e2e-data");

/** Today's date in WIB, the app's calendar. */
export const wibToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
export const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const dd = (d: string) => String(Number(d.slice(8)));
export const mm = (d: string) => String(Number(d.slice(5, 7)));
export const rp = (n: number) => `${n < 0 ? "-" : ""}Rp ${Math.abs(n).toLocaleString("id-ID")}`;
export const num = (t: string) => Number(t.replace(/\u00a0/g, " ").replace("−", "-").replace(/[^\d-]/g, ""));

/** Direct (read) access to the throw-away test database, to verify what the app actually stored. */
export function q<T = Record<string, unknown>>(sql: string, ...args: unknown[]): T[] {
  const db = new Database(path.join(DATA_DIR, "finance.db"), { readonly: true });
  try { return db.prepare(sql).all(...args) as T[]; } finally { db.close(); }
}
export const one = <T = number>(sql: string, ...args: unknown[]): T => Object.values(q<Record<string, T>>(sql, ...args)[0] ?? { v: undefined as unknown as T })[0];
export function run(sql: string, ...args: unknown[]) {
  const db = new Database(path.join(DATA_DIR, "finance.db"));
  try { db.prepare(sql).run(...args); } finally { db.close(); }
}
export const authFile = () => path.join(DATA_DIR, "auth.json");
export const readAuth = () => (fs.existsSync(authFile()) ? fs.readFileSync(authFile(), "utf8") : null);

/**
 * Every test page watches itself: any request that leaves this computer, and any uncaught page error, fails the test.
 * This is the runtime half of the offline guarantee (the static half is `npm run check:offline`).
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const external: string[] = [];
    const errors: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (!["localhost", "127.0.0.1"].includes(u.hostname) && !["data:", "blob:", "about:"].includes(u.protocol)) external.push(r.url());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await use(page);
    expect(external, "no request may leave this computer").toEqual([]);
    expect(errors, "no uncaught page errors").toEqual([]);
  },
});

export async function createAccount(page: Page, name: string, initial: string) {
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Tambah akun" }).first().click();
  await page.fill("#acc-name", name);
  await page.fill("#acc-init", initial);
  await page.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
}

export async function balanceOf(page: Page, name: string): Promise<number> {
  await page.goto("/accounts");
  return num(await page.locator(`article[data-account-name="${name}"] [data-balance]`).first().innerText());
}

/** Choose the option whose text matches (category lists are indented, so exact labels are brittle). */
export async function pick(select: Locator, text: RegExp | string) {
  const value = await select.evaluate((el, t) => {
    const re = typeof t === "string" ? new RegExp(t) : new RegExp((t as { source: string }).source, (t as { flags: string }).flags);
    const o = [...(el as HTMLSelectElement).options].find((x) => re.test(x.textContent ?? ""));
    return o ? o.value : null;
  }, text instanceof RegExp ? { source: text.source, flags: text.flags } : text);
  if (value === null) throw new Error(`No option matching ${String(text)}`);
  await select.selectOption(value);
}

export async function capture(page: Page, text: string, count: number) {
  await page.goto("/quick-capture");
  await page.fill("#qc-text", text);
  await page.getByRole("button", { name: "Baca", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Pratinjau (${count})` })).toBeVisible();
  await page.getByRole("button", { name: `Catat sekarang (${count})` }).click();
  await expect(page.getByText(/transaksi sudah dicatat/)).toBeVisible();
}

/** Add a transaction through the form on /income or /expenses. */
export async function addEntry(page: Page, kind: "income" | "expense", o: { amount: string; account?: string; category?: RegExp; description?: string; date?: string }) {
  await page.goto(kind === "income" ? "/income" : "/expenses");
  await page.getByRole("button", { name: kind === "income" ? "Catat pemasukan" : "Catat pengeluaran" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.locator("#tx-amount").fill(o.amount);
  if (o.date) await dlg.locator("#tx-date").fill(o.date);
  if (o.account) await dlg.locator("#tx-acc").selectOption({ label: o.account });
  if (o.category) await pick(dlg.locator("#tx-cat"), o.category);
  if (o.description) await dlg.locator("#tx-desc").fill(o.description);
  await dlg.getByRole("button", { name: "Simpan" }).click();
  await expect(dlg).toBeHidden();
}

export const ALL_PAGES = ["/", "/transactions", "/accounts", "/income", "/expenses", "/debts", "/bills", "/quick-capture", "/inbox", "/import", "/forecast", "/early-repayment", "/goals", "/next-actions", "/reports", "/automation", "/backup", "/settings"];
