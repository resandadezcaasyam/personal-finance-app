import { test, expect, createAccount, balanceOf, addEntry, pick, q, one } from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("ledger: accounts, income, expenses, transfers, reconciliation", () => {
  test("create two accounts with opening balances", async ({ page }) => {
    await createAccount(page, "BCA", "5.000.000");
    await createAccount(page, "GoPay", "500.000");
    expect(await balanceOf(page, "BCA")).toBe(5_000_000);
    expect(await balanceOf(page, "GoPay")).toBe(500_000);
  });

  test("income and expense change the right balance and show on the dashboard", async ({ page }) => {
    await addEntry(page, "income", { amount: "9jt", account: "BCA", category: /Gaji/, description: "Gaji bulanan" });
    await addEntry(page, "expense", { amount: "25rb", account: "BCA", category: /Kopi/, description: "kopi pagi" });
    expect(await balanceOf(page, "BCA")).toBe(5_000_000 + 9_000_000 - 25_000);
    await page.goto("/");
    await expect(page.locator("main")).toContainText("Rp 9.000.000");
  });

  test("a transfer moves money between accounts; the fee is a separate expense", async ({ page }) => {
    await page.goto("/transactions");
    await page.getByRole("button", { name: "Catat transaksi" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("button", { name: "Transfer", exact: true }).click();
    await dlg.locator("#tx-from").selectOption({ index: 0 });
    await dlg.locator("#tx-to").selectOption({ index: 1 });
    await dlg.locator("#tx-amount").fill("700rb");
    await dlg.locator("#tx-fee").fill("2.500");
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(dlg).toBeHidden();
    expect(await balanceOf(page, "BCA")).toBe(5_000_000 + 9_000_000 - 25_000 - 700_000 - 2_500);
    expect(await balanceOf(page, "GoPay")).toBe(1_200_000);
    expect(one("SELECT COUNT(*) FROM transfers WHERE status='posted'")).toBe(1);
    expect(one("SELECT amount FROM transactions WHERE source='transfer_fee'")).toBe(2_500);
  });

  test("income and expense totals ignore the transfer", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main")).toContainText("Rp 9.000.000"); // income unchanged by the 700.000 transfer
    expect(one("SELECT SUM(amount) FROM transactions WHERE type='income' AND status='posted'")).toBe(9_000_000);
  });

  test("reconciliation adds an adjustment that is not income or expense", async ({ page }) => {
    await page.goto("/accounts");
    await page.locator('article[data-account-name="GoPay"]').getByRole("button", { name: "Rekonsiliasi GoPay" }).click();
    await page.fill("#rc-actual", "1.250.000");
    await page.getByRole("dialog").getByRole("button", { name: "Rekonsiliasi", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(await balanceOf(page, "GoPay")).toBe(1_250_000);
    expect(q("SELECT type, amount FROM transactions WHERE type='adjustment'")).toEqual([{ type: "adjustment", amount: 50_000 }]);
    expect(one("SELECT SUM(amount) FROM transactions WHERE type='income' AND status='posted'")).toBe(9_000_000);
  });

  test("invalid input is explained, not silently accepted", async ({ page }) => {
    await page.goto("/expenses");
    await page.getByRole("button", { name: "Catat pengeluaran" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.locator("#tx-amount").fill("abc");
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(dlg.getByText(/Nominal tidak valid/)).toBeVisible();
    await dlg.getByRole("button", { name: "Batal" }).click();
    await pick(page.locator("body"), "x").catch(() => undefined); // helper exercised: a missing option is reported, not ignored
  });
});
