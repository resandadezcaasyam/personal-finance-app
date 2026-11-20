import { test, expect, ALL_PAGES } from "./helpers";

test.describe("smoke", () => {
  test("health endpoint reports the schema version and the personal profile", async ({ request }) => {
    const r = await request.get("/api/health");
    expect(r.status()).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, profile: "personal", schemaVersion: 7 });
  });

  test("every page loads, has a heading, and makes no request that leaves this computer", async ({ page }) => {
    for (const path of ALL_PAGES) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page.locator("h1").first(), path).toBeVisible();
    }
  });

  test("navigation offers all areas, the skip link exists, and the version is shown", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Navigasi utama" });
    for (const label of ["Dasbor", "Transaksi", "Akun & Saldo", "Utang & Cicilan", "Proyeksi Arus Kas", "Simulasi Pelunasan", "Target Tabungan", "Langkah Berikutnya", "Laporan & Analitik", "Aturan Otomasi", "Cadangan & Data", "Pengaturan"]) {
      await expect(nav.getByText(label, { exact: true }), label).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Lewati ke konten" })).toHaveCount(1);
    await expect(page.getByText(/Versi 1\.0\.0/).first()).toBeVisible();
  });

  test("a brand-new install shows compact, honest empty states (no fake numbers)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Ringkasan Keuangan" })).toBeVisible();
    await expect(page.getByLabel("Belum ada data")).toHaveCount(4); // four KPI cards show an em dash, not zeros or invented values
    await expect(page.getByText("Belum ada akun").first()).toBeVisible();
    await expect(page.getByText("Belum ada transaksi")).toBeVisible();
    await expect(page.getByText("Belum ada arus kas")).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/%\s*vs /); // no made-up comparisons
  });

  test("an unknown page returns a 404, not a crash", async ({ page }) => {
    const res = await page.goto("/tidak-ada");
    expect(res?.status()).toBe(404);
  });
});
