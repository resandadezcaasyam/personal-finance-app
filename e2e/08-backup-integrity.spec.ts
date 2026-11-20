import { test, expect, createAccount, one } from "./helpers";

test.describe.configure({ mode: "serial" });
let backupName = "";

test.describe("backup, restore and data health", () => {
  test("the integrity check passes on data that went through every workflow", async ({ page }) => {
    await page.goto("/backup");
    await page.getByRole("button", { name: "Periksa integritas" }).click();
    await expect(page.getByRole("status").filter({ hasText: "pemeriksaan" })).toContainText("Semua pemeriksaan lolos");
  });

  test("create a backup, verify it, download it, and refuse path traversal", async ({ page, request }) => {
    await page.goto("/backup");
    await page.getByRole("button", { name: "Buat cadangan sekarang" }).click();
    const row = page.locator("tr", { hasText: "-manual.db" }).first();
    await expect(row).toBeVisible();
    backupName = (await row.locator("span.font-mono").innerText()).trim();
    expect(backupName).toMatch(/^finance-.*-manual\.db$/);
    await page.getByRole("button", { name: `Periksa ${backupName}` }).click();
    await expect(row).toContainText("Sehat");
    const dl = await request.get(`/api/backup/download?name=${encodeURIComponent(backupName)}`);
    expect(dl.status()).toBe(200);
    expect((await dl.body()).subarray(0, 15).toString()).toBe("SQLite format 3");
    for (const bad of ["../finance.db", "..%2Ffinance.db", "/etc/passwd", "nope.db", "finance.db"]) {
      const r = await request.get(`/api/backup/download?name=${bad}`);
      expect([400, 404], bad).toContain(r.status());
      if (bad !== "finance.db") expect(r.status(), bad).toBe(400);
    }
  });

  test("restoring brings back the backed-up data and keeps the current state as a pre-restore backup", async ({ page }) => {
    await createAccount(page, "Dompet Uji", "123.000");
    expect(one("SELECT COUNT(*) FROM accounts WHERE name='Dompet Uji'")).toBe(1);
    const txBefore = one("SELECT COUNT(*) FROM transactions");
    await page.goto("/backup");
    await page.getByRole("button", { name: `Pulihkan ${backupName}` }).click();
    await expect(page.getByRole("dialog")).toContainText("sebelum pemulihan");
    await page.getByRole("dialog").getByRole("button", { name: "Ya, pulihkan" }).click();
    await expect.poll(() => one("SELECT COUNT(*) FROM accounts WHERE name='Dompet Uji'"), { timeout: 20_000 }).toBe(0);
    expect(one("SELECT COUNT(*) FROM transactions")).toBe(txBefore);
    await page.waitForTimeout(1800); // the page reloads itself after a restore; let that finish before navigating
    await page.goto("/backup");
    await expect(page.locator("tr", { hasText: "-pre-restore.db" }).first()).toBeVisible();
  });

  test("the app keeps working after a restore, and the integrity check still passes", async ({ page }) => {
    await page.goto("/accounts");
    await expect(page.getByText("BCA", { exact: true }).first()).toBeVisible();
    await createAccount(page, "Setelah Restore", "1.000");
    await page.goto("/backup");
    await page.getByRole("button", { name: "Periksa integritas" }).click();
    await expect(page.getByRole("status").filter({ hasText: "pemeriksaan" })).toContainText("Semua pemeriksaan lolos");
  });

  test("a backup can be deleted after confirmation", async ({ page }) => {
    await page.goto("/backup");
    await page.getByRole("button", { name: `Hapus ${backupName}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Hapus cadangan" }).click();
    await expect(page.locator("tr", { hasText: backupName })).toHaveCount(0);
  });
});
