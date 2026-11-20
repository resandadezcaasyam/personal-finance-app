import { test, expect, wibToday, shift, one } from "./helpers";

test.describe.configure({ mode: "serial" });
const COUNTS = "SELECT (SELECT COUNT(*) FROM transactions)||'|'||(SELECT COUNT(*) FROM transfers)||'|'||(SELECT COUNT(*) FROM debt_payments)||'|'||(SELECT SUM(amount_paid) FROM installment_schedules)||'|'||(SELECT COUNT(*) FROM audit_logs)";

test.describe("forecast and early repayment", () => {
  test("the cash-flow forecast shows numbers, a chart, and writes nothing", async ({ page }) => {
    const before = one<string>(COUNTS);
    await page.goto("/forecast");
    await expect(page.locator("main")).toContainText("Rp");
    await expect(page.locator("div[role=img]").first()).toBeVisible();
    await page.goto("/forecast?preset=conservative");
    await expect(page.locator("main")).toContainText("Rp");
    expect(one<string>(COUNTS)).toBe(before);
  });

  test("an early-repayment simulation compares A and B, with fee, and changes no real record", async ({ page }) => {
    const before = one<string>(COUNTS);
    const id = one("SELECT id FROM debts LIMIT 1");
    await page.goto(`/early-repayment?debt=${id}&date=${shift(wibToday(), 14)}&mode=full&fee=20rb`);
    await expect(page.getByRole("heading", { name: /Perbandingan/ })).toBeVisible();
    await expect(page.locator("main")).toContainText("Uang keluar");
    await expect(page.locator("main")).toContainText("Tidak ada penghematan bunga yang diasumsikan");
    const closing = page.getByRole("row").filter({ hasText: "Kas akhir (12 bulan)" }).first();
    await expect(closing).toContainText("−Rp 20.000"); // B - A = -fee when the horizon covers the schedule
    await page.goto(`/early-repayment?debt=${id}&date=${shift(wibToday(), 14)}&mode=partial&amt=100rb`);
    await expect(page.locator("main")).toContainText("dibayar sebagian");
    expect(one<string>(COUNTS)).toBe(before);
  });

  test("a rebate or provider quotation is the only source of a stated saving", async ({ page }) => {
    const id = one("SELECT id FROM debts LIMIT 1");
    await page.goto(`/early-repayment?debt=${id}&date=${shift(wibToday(), 14)}&mode=full&rb=50`);
    await expect(page.locator("main")).toContainText("Rebat bunga 50%");
    await page.goto(`/early-repayment?debt=${id}&date=${shift(wibToday(), 14)}&mode=full&quote=100rb`);
    await expect(page.locator("main")).toContainText("Kuotasi dari penyedia");
  });

  test("bad input is explained and hostile URL parameters are harmless", async ({ page }) => {
    const id = one("SELECT id FROM debts LIMIT 1");
    await page.goto(`/early-repayment?debt=${id}&date=${shift(wibToday(), -3)}&mode=full`);
    await expect(page.locator("main")).toContainText("sebelum hari ini");
    await page.goto("/early-repayment?debt=zzz&date=<script>&mode=x&rb=9e9&fee=-1&extra=%00&p1=a&cmp=9,9,9,9,9&preset=evil");
    await expect(page.getByRole("heading", { name: "Simulasi Pelunasan Dini" })).toBeVisible();
  });

  test("scenarios can be saved, reopened, duplicated and deleted", async ({ page }) => {
    const id = one("SELECT id FROM debts LIMIT 1");
    await page.goto(`/early-repayment?debt=${id}&date=${shift(wibToday(), 14)}&mode=full&fee=20rb`);
    await page.getByLabel("Simpan simulasi ini sebagai").fill("Lunas bulan depan");
    await page.getByRole("button", { name: "Simpan skenario" }).click();
    await expect(page.getByRole("link", { name: "Lunas bulan depan" })).toBeVisible();
    await page.getByRole("button", { name: "Duplikat Lunas bulan depan" }).click();
    await expect(page.getByRole("link", { name: "Lunas bulan depan (salinan)" })).toBeVisible();
    await page.getByRole("button", { name: "Hapus Lunas bulan depan (salinan)" }).click();
    await expect(page.getByRole("link", { name: "Lunas bulan depan (salinan)" })).toHaveCount(0);
    await page.getByRole("link", { name: "Lunas bulan depan", exact: true }).click();
    await expect(page.locator("main")).toContainText("Uang keluar");
  });

  test("strategy comparison: no rebate means the same total, only faster", async ({ page }) => {
    await page.goto("/early-repayment?extra=100rb");
    const rows = page.getByRole("heading", { name: "Strategi pelunasan beberapa utang" }).locator("xpath=following::table[1]//tbody/tr");
    await expect(rows).toHaveCount(4);
    const total = async (i: number) => (await rows.nth(i).locator("td").nth(3).innerText()).replace(/\D/g, "");
    expect(await total(1)).toBe(await total(0));
    expect(await total(2)).toBe(await total(0));
  });
});
