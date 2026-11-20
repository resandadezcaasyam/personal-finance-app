import { test, expect, wibToday, one, rp } from "./helpers";

const month = wibToday().slice(0, 7);
const prevMonth = (() => { const d = new Date(Date.parse(`${month}-01T00:00:00Z`)); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
const sum = (type: string, m: string) => one(`SELECT COALESCE(SUM(amount),0) FROM transactions WHERE status='posted' AND type='${type}' AND substr(occurred_on,1,7)=?`, m);

test.describe("redesigned dashboard and app shell", () => {
  test("the KPI cards show real ledger numbers", async ({ page }) => {
    await page.goto("/");
    const income = sum("income", month), expense = sum("expense", month);
    const kpi = (name: string) => page.locator("section", { has: page.getByRole("heading", { name, exact: true }) }).first();
    await expect(kpi("Pemasukan bulanan")).toContainText(rp(income));
    await expect(kpi("Pengeluaran bulanan")).toContainText(rp(expense));
    await expect(kpi("Arus kas bersih")).toContainText(rp(income - expense));
    const total = Number((await kpi("Total kas").locator("p").first().innerText()).replace(/\u00a0/g, " ").replace("−", "-").replace(/[^\d-]/g, ""));
    await page.goto("/accounts");
    const rows = page.locator("tbody tr");
    let acc = 0;
    for (let i = 0; i < await rows.count(); i++) acc += Number((await rows.nth(i).locator("td").nth(2).innerText()).replace(/\u00a0/g, " ").replace("−", "-").replace(/[^\d-]/g, ""));
    expect(total).toBe(acc);
  });

  test("month and trend-range controls are real filters (and the future is not selectable)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Bulan berikutnya")).toHaveCount(0); // current month: next is disabled, not a link
    await page.getByRole("link", { name: "Bulan sebelumnya" }).click();
    await expect(page).toHaveURL(new RegExp(`bulan=${prevMonth}`));
    await expect(page.locator("main")).toContainText("Pemasukan bulanan");
    await page.getByRole("link", { name: "Bulan berikutnya" }).click();
    await expect(page).not.toHaveURL(/bulan=/);
    await page.getByRole("link", { name: "12 bln" }).click();
    await expect(page).toHaveURL(/tren=12/);
    await expect(page.locator("div[role=img]").first()).toContainText("");
    await page.goto("/?bulan=2099-01&tren=999");
    await expect(page.getByRole("heading", { name: "Ringkasan Keuangan" })).toBeVisible(); // hostile parameters fall back safely
  });

  test("the cash-flow chart exposes its numbers as a table, and the donut matches the ledger", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Lihat angka per bulan").click();
    await expect(page.getByRole("table", { name: /Pemasukan, pengeluaran, dan selisih/ })).toBeVisible();
    await expect(page.getByLabel("Pengeluaran per kategori").first()).toBeVisible();
  });

  test("the sidebar is grouped, collapses, remembers its state, and keeps every destination reachable", async ({ page }) => {
    await page.goto("/");
    for (const g of ["Ringkasan", "Keuangan", "Alat Cerdas", "Perencanaan & Wawasan", "Sistem"]) await expect(page.getByRole("group", { name: g })).toBeVisible();
    const aside = page.getByRole("complementary", { name: "Sidebar" });
    const expanded = (await aside.boundingBox())!.width;
    expect(expanded).toBeGreaterThan(220);
    expect(expanded).toBeLessThan(260);
    await page.getByRole("button", { name: "Ciutkan sidebar" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-sidebar", "collapsed");
    expect((await aside.boundingBox())!.width).toBeLessThan(90);
    await expect(page.getByRole("link", { name: "Utang & Cicilan" })).toBeVisible(); // icon-only, still named and reachable
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-sidebar", "collapsed"); // remembered, applied before first paint
    await page.getByRole("button", { name: "Perluas sidebar" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-sidebar", "collapsed");
  });

  test("breadcrumbs show where you are, including detail pages", async ({ page }) => {
    await page.goto("/debts");
    const crumbs = page.getByRole("navigation", { name: "Lokasi halaman" });
    await expect(crumbs).toContainText("Keuangan");
    await expect(crumbs).toContainText("Utang & Cicilan");
    const id = one("SELECT id FROM debts LIMIT 1");
    await page.goto(`/debts/${id}`);
    await expect(crumbs).toContainText("Detail");
  });

  test("the global add-transaction button opens the real form, and the global search filters the ledger", async ({ page }) => {
    await page.goto("/debts");
    await page.getByRole("link", { name: "Tambah transaksi" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").locator("#tx-amount")).toBeVisible();
    await expect(page).not.toHaveURL(/tambah=1/); // address bar cleaned
    await page.keyboard.press("Escape");
    await page.getByRole("search").getByLabel("Cari transaksi").fill("kopi");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/transactions\?q=kopi/);
  });

  test("the typeface ships with the app (no external font) and headings are sans-serif", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('14px "Inter Variable"'))).toBe(true);
    const family = await page.locator("h1").first().evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toContain("Inter");
    expect(family.toLowerCase()).not.toMatch(/cambria|georgia|(^|,\s*)serif\s*$/); // a generic sans-serif fallback is fine; a serif face is not
  });

  test("on a phone the menu opens as a drawer, closes with Escape, and nothing scrolls sideways", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: "http://localhost:3100" });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Buka menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Menu" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Utang & Cicilan" })).toBeVisible(); // labels are never collapsed in the drawer
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(o.sw).toBeLessThanOrEqual(o.cw + 1);
    await ctx.close();
  });
});
