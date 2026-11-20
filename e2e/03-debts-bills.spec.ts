import { test, expect, wibToday, shift, one, q, pick } from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("debts and bills", () => {
  test("an overdue installment debt is created with a schedule", async ({ page }) => {
    await page.goto("/debts");
    await page.getByRole("button", { name: "Tambah utang" }).click();
    await page.fill("#d-provider", "SeaBank");
    await page.fill("#d-principal", "672rb");
    await page.fill("#d-count", "3");
    await page.fill("#d-first", shift(wibToday(), -10));
    await pick(page.locator("#d-acc"), /^BCA/);
    await page.getByRole("button", { name: "Simpan utang" }).click();
    await page.waitForURL(/\/debts\/\d+/);
    expect(one("SELECT COUNT(*) FROM installment_schedules")).toBe(3);
    expect(one("SELECT SUM(amount_due) FROM installment_schedules")).toBe(672_000);
    await expect(page.locator("main")).toContainText("Rp 672.000");
  });

  test("paying an installment records ONE expense, allocates it, and lowers what is owed", async ({ page }) => {
    const id = one("SELECT id FROM debts LIMIT 1");
    await page.goto(`/debts/${id}`);
    await page.getByRole("button", { name: "Catat pembayaran" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.locator("#p-amount").fill("224rb");
    await pick(dlg.locator("#p-acc"), /^BCA/);
    await dlg.getByRole("button", { name: "Catat pembayaran" }).click();
    await expect(dlg).toBeHidden();
    await expect(page.locator("main")).toContainText("Rp 448.000");
    expect(one("SELECT COUNT(*) FROM debt_payments WHERE status='posted'")).toBe(1);
    expect(one("SELECT COUNT(*) FROM transactions WHERE debt_payment_id IS NOT NULL AND status='posted'")).toBe(1);
    expect(one("SELECT SUM(amount_paid) FROM installment_schedules")).toBe(224_000);
  });

  test("a linked payment expense cannot be edited from the ledger (it is owned by the debt)", async ({ page }) => {
    await page.goto("/expenses");
    const row = page.locator("tr", { hasText: /SeaBank|Cicilan/ }).first();
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: /Ubah|Batalkan/ })).toHaveCount(0);
  });

  test("a bill is created and paid once for its due date", async ({ page }) => {
    await page.goto("/bills");
    await page.getByRole("button", { name: "Tambah tagihan" }).click();
    await page.fill("#b-name", "Internet");
    await page.fill("#b-amount", "350rb");
    await page.fill("#b-due", shift(wibToday(), 4));
    await pick(page.locator("#b-acc"), /^BCA/);
    await page.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Internet").first()).toBeVisible();
    await page.getByRole("button", { name: "Bayar", exact: true }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Catat pembayaran" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(q("SELECT status, amount FROM bill_payments")).toEqual([{ status: "paid", amount: 350_000 }]);
    expect(one("SELECT COUNT(*) FROM transactions WHERE bill_id IS NOT NULL AND status='posted'")).toBe(1);
  });
});
