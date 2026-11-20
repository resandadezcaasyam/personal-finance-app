import path from "node:path";
import { test, expect, capture, one, q } from "./helpers";

test.describe.configure({ mode: "serial" });
const fixture = (n: string) => path.join(process.cwd(), "tests", "fixtures", n);

test.describe("smart capture and import", () => {
  test("quick capture turns free text into a preview and then ledger entries; AI is off by default", async ({ page }) => {
    const before = one("SELECT COUNT(*) FROM transactions WHERE status='posted'");
    await capture(page, "kopi 25rb gopay\nmakan siang 40rb bca", 2);
    expect(one("SELECT COUNT(*) FROM transactions WHERE status='posted'")).toBe(before + 2);
    expect(q("SELECT amount, description FROM transactions WHERE description LIKE '%makan siang%' OR description LIKE '%kopi%' ORDER BY id DESC LIMIT 2").length).toBe(2);
    await page.goto("/quick-capture");
    await expect(page.getByRole("button", { name: "Baca dengan AI lokal" })).toHaveCount(0);
  });

  test("a bank-statement CSV goes to the inbox, nothing touches the ledger until approval", async ({ page }) => {
    const ledgerBefore = one("SELECT COUNT(*) FROM transactions WHERE status='posted'");
    await page.goto("/import");
    await page.locator('input[type="file"][accept*=".csv"]').setInputFiles(fixture("mutasi.csv"));
    await expect(page.getByText("transaksi terbaca")).toBeVisible();
    await page.getByLabel("Akun yang dimiliki mutasi ini").selectOption({ label: "BCA" });
    await page.getByRole("button", { name: "Impor ke kotak masuk" }).click();
    await expect.poll(() => one("SELECT COUNT(*) FROM inbox_items WHERE source_kind='csv'"), { timeout: 20_000 }).toBe(3);
    expect(one("SELECT COUNT(*) FROM transactions WHERE status='posted'")).toBe(ledgerBefore);
    expect(one("SELECT COUNT(*) FROM import_batches")).toBe(1);
  });

  test("approving an inbox item posts exactly one ledger entry", async ({ page }) => {
    const before = one("SELECT COUNT(*) FROM transactions WHERE status='posted'");
    await page.goto("/inbox?status=all");
    await page.getByRole("button", { name: /^Setujui GAJI/ }).click();
    await expect.poll(() => one("SELECT COUNT(*) FROM transactions WHERE status='posted'"), { timeout: 15_000 }).toBe(before + 1);
    expect(one("SELECT COUNT(*) FROM inbox_items WHERE source_kind='csv' AND status='approved'")).toBe(1);
    expect(q("SELECT type, amount FROM transactions WHERE source='import' ORDER BY id DESC LIMIT 1")).toEqual([{ type: "income", amount: 9_500_000 }]);
  });

  test("importing the same file again is refused, creating no duplicates", async ({ page }) => {
    await page.goto("/import");
    await page.locator('input[type="file"][accept*=".csv"]').setInputFiles(fixture("mutasi.csv"));
    await expect(page.getByText("transaksi terbaca")).toBeVisible();
    await page.getByLabel("Akun yang dimiliki mutasi ini").selectOption({ label: "BCA" });
    await page.getByRole("button", { name: "Impor ke kotak masuk" }).click();
    await page.waitForTimeout(1500);
    expect(one("SELECT COUNT(*) FROM inbox_items WHERE source_kind='csv'")).toBe(3);
    expect(one("SELECT COUNT(*) FROM import_batches")).toBe(1);
  });

  test("a receipt screenshot is read OFFLINE (OCR) into the inbox for review", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/import");
    await page.locator("#ocr-file").setInputFiles(fixture("struk_gopay.png"));
    await expect.poll(() => one("SELECT COUNT(*) FROM inbox_items WHERE source_kind='ocr'"), { timeout: 200_000, intervals: [2_000] }).toBeGreaterThanOrEqual(1);
    const row = q<{ amount: number | null; status: string }>("SELECT amount, status FROM inbox_items WHERE source_kind='ocr' ORDER BY id DESC LIMIT 1")[0];
    expect(row.amount).toBeGreaterThan(0);
    expect(row.status).not.toBe("approved"); // OCR results always wait for a human
  });
});
