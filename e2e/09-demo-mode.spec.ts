import { test, expect, one } from "./helpers";

test.describe.configure({ mode: "serial" });
const SNAP = "SELECT (SELECT COUNT(*) FROM accounts)||'|'||(SELECT COUNT(*) FROM transactions)||'|'||(SELECT COUNT(*) FROM debts)||'|'||(SELECT COUNT(*) FROM goals)";

test.describe("demo mode", () => {
  test("demo shows fictional data in every Phase 5–7 area and never touches personal data", async ({ page }) => {
    const before = one<string>(SNAP);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Aktifkan mode demo" }).click();
    await expect(page.getByText("Mode demo · data fiktif")).toBeVisible();
    for (const [path, text] of [["/goals", "(fiktif)"], ["/automation", "Iuran RT"], ["/expenses", "Anggaran bulanan"], ["/next-actions", "Mengapa"], ["/reports", "Pemasukan vs pengeluaran"], ["/debts", "(fiktif)"]] as const) {
      await page.goto(path);
      await expect(page.locator("main"), path).toContainText(text);
    }
    expect(one<string>(SNAP)).toBe(before); // personal database untouched
  });

  test("backups are for personal data only while demo is on", async ({ page }) => {
    await page.goto("/backup");
    await expect(page.locator("main")).toContainText("Mode demo aktif");
    await expect(page.getByRole("button", { name: "Buat cadangan sekarang" })).toBeDisabled();
  });

  test("switching back restores the personal data exactly", async ({ page }) => {
    const before = one<string>(SNAP);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Kembali ke data pribadi" }).click();
    await expect(page.getByText("Mode demo · data fiktif")).toHaveCount(0);
    await page.goto("/accounts");
    await expect(page.getByText("BCA", { exact: true }).first()).toBeVisible();
    expect(one<string>(SNAP)).toBe(before);
  });
});
