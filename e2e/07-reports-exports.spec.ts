import { test, expect, wibToday, one, q, rp, addEntry } from "./helpers";

test.describe.configure({ mode: "serial" });
const today = wibToday();
const from6m = (() => { const d = new Date(Date.parse(`${today}T00:00:00Z`)); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 5); return d.toISOString().slice(0, 10); })();
const total = (type: string) => one(`SELECT COALESCE(SUM(amount),0) FROM transactions WHERE status='posted' AND type='${type}' AND occurred_on BETWEEN ? AND ?`, from6m, today);

test.describe("reports and exports", () => {
  test("report totals equal the ledger and the page has its charts", async ({ page }) => {
    await page.goto("/reports?preset=6m");
    await expect(page.locator("main")).toContainText(rp(total("income")));
    await expect(page.locator("main")).toContainText(rp(total("expense")));
    await expect(page.locator("div[role=img]")).toHaveCount(2);
    for (const h of ["Pemasukan vs pengeluaran", "Pengeluaran per kategori", "Pengurangan utang", "Anggaran vs aktual", "Kondisi keuangan dari waktu ke waktu"]) await expect(page.locator("main")).toContainText(h);
  });

  test("custom ranges and bad ranges are handled", async ({ page }) => {
    await page.goto(`/reports?preset=custom&from=${today.slice(0, 8)}01&to=${today}`);
    await expect(page.locator("main")).toContainText("Periode:");
    await page.goto(`/reports?preset=custom&from=${today}&to=2020-01-01`);
    await expect(page.locator("p[role=alert]")).toContainText("Tanggal awal tidak boleh setelah tanggal akhir");
  });

  test("PDF, JSON and CSV exports are generated locally and reconcile with the ledger", async ({ request }) => {
    const pdf = await request.get("/api/export?kind=pdf&preset=6m");
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect(pdf.headers()["content-disposition"]).toContain("attachment");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    const json = await (await request.get("/api/export?kind=json&preset=6m")).json();
    expect(json.report.totals.income).toBe(total("income"));
    expect(json.report.totals.expense).toBe(total("expense"));
    expect(json.transactions.length).toBe(one("SELECT (SELECT COUNT(*) FROM transactions WHERE status='posted' AND occurred_on BETWEEN ? AND ?) + (SELECT COUNT(*) FROM transfers WHERE status='posted' AND occurred_on BETWEEN ? AND ?)", from6m, today, from6m, today));

    const csv = await (await request.get("/api/export?kind=transactions&preset=6m")).text();
    expect(csv.startsWith("\uFEFFTanggal,Jenis,Akun")).toBe(true);
    expect(csv.split("\r\n").filter(Boolean).length - 1).toBe(json.transactions.length);
    for (const kind of ["monthly", "categories"]) expect((await request.get(`/api/export?kind=${kind}&preset=6m`)).status()).toBe(200);
  });

  test("a CSV cell that looks like a spreadsheet formula is neutralized", async ({ page, request }) => {
    await addEntry(page, "expense", { amount: "1rb", account: "BCA", description: '=HYPERLINK("http://example.test","x")' });
    const csv = await (await request.get("/api/export?kind=transactions&preset=this_month")).text();
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });

  test("the full data export has every table with matching row counts", async ({ request }) => {
    const all = await (await request.get("/api/export?kind=all")).json();
    expect(all.meta).toMatchObject({ app: "Personal Finance OS", schemaVersion: 7, currency: "IDR" });
    for (const t of ["accounts", "transactions", "debts", "installment_schedules", "goals", "recurring_rules"]) {
      expect(all.tables[t].length, t).toBe(one(`SELECT COUNT(*) FROM ${t}`));
    }
    expect(q("SELECT name FROM accounts ORDER BY name").length).toBe(all.tables.accounts.length);
  });

  test("bad export requests are rejected", async ({ request }) => {
    expect((await request.get("/api/export?kind=evil")).status()).toBe(400);
    expect((await request.get("/api/export?kind=monthly&preset=custom&from=2026-11-15&to=2026-10-01")).status()).toBe(400);
  });
});
