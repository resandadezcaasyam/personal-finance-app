import { test, expect, wibToday, shift, dd, mm, one, q, run, capture, addEntry, balanceOf, pick } from "./helpers";

test.describe.configure({ mode: "serial" });
const today = wibToday();

test.describe("recurring automation, budgets, actions and goals", () => {
  test("a recurring rule derives overdue occurrences WITHOUT posting anything, then confirm posts exactly one", async ({ page }) => {
    await page.goto("/automation");
    await page.getByRole("button", { name: "Tambah aturan" }).click();
    await page.fill("#rl-name", "Gaji kantor");
    await page.selectOption("#rl-type", "income");
    await page.fill("#rl-amt", "9jt");
    await pick(page.locator("#rl-acc"), /^BCA/);
    await pick(page.locator("#rl-cat"), /Gaji/);
    await page.fill("#rl-day", dd(shift(today, -5)));
    await page.fill("#rl-start", "2026-01-01");
    await page.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByRole("cell", { name: /Gaji kantor/ }).first()).toBeVisible();
    run("UPDATE recurring_rules SET created_at = ?", `${shift(today, -40)}T00:00:00.000Z`); // as if created 40 days ago
    const ledger = one("SELECT COUNT(*) FROM transactions WHERE source='recurring'");
    await page.goto("/automation");
    await expect(page.locator("main")).toContainText("Terlambat");
    expect(one("SELECT COUNT(*) FROM transactions WHERE source='recurring'")).toBe(ledger); // planned is not money
    await page.getByRole("button", { name: "Konfirmasi", exact: true }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Catat transaksi" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(one("SELECT COUNT(*) FROM transactions WHERE source='recurring' AND status='posted'")).toBe(1);
    expect(one("SELECT source_ref FROM transactions WHERE source='recurring'")).toMatch(/^rule:\d+:\d{4}-\d{2}-\d{2}$/);
  });

  test("an existing transaction is offered for LINKING, so nothing is posted twice", async ({ page }) => {
    const d = shift(today, -2);
    await addEntry(page, "income", { amount: "1jt", account: "BCA", category: /Freelance/, description: "proyek freelance", date: d });
    await page.goto("/automation");
    await page.getByRole("button", { name: "Tambah aturan" }).click();
    await page.fill("#rl-name", "Freelance rutin");
    await page.selectOption("#rl-type", "income");
    await page.fill("#rl-amt", "1jt");
    await pick(page.locator("#rl-acc"), /^BCA/);
    await page.fill("#rl-day", dd(d));
    await page.fill("#rl-start", "2026-01-01");
    await page.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByRole("cell", { name: /Freelance rutin/ }).first()).toBeVisible(); // wait until it is saved
    run("UPDATE recurring_rules SET created_at = ? WHERE name = 'Freelance rutin'", `${shift(today, -5)}T00:00:00.000Z`);
    await page.goto("/automation");
    await expect(page.locator("main")).toContainText("Cocok dengan transaksi");
    const before = one("SELECT COUNT(*) FROM transactions WHERE status='posted'");
    const balance = await balanceOf(page, "BCA");
    await page.goto("/automation");
    await page.locator("tr", { hasText: "Freelance rutin" }).getByRole("button", { name: "Tautkan" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Tautkan" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(one("SELECT COUNT(*) FROM transactions WHERE status='posted'")).toBe(before);
    expect(await balanceOf(page, "BCA")).toBe(balance);
  });

  test("a steady monthly pattern in the history is suggested, and only created after approval", async ({ page }) => {
    const lines: string[] = [];
    for (let k = 5; k >= 1; k--) { const d = new Date(Date.parse(`${today}T00:00:00Z`)); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k); lines.push(`netflix 54rb bca 5/${d.getUTCMonth() + 1}`); }
    await capture(page, lines.join("\n"), 5);
    await page.goto("/automation");
    await expect(page.getByRole("heading", { name: "Pola berulang terdeteksi" })).toBeVisible();
    await expect(page.locator("main")).toContainText("Netflix");
    const rules = one("SELECT COUNT(*) FROM recurring_rules");
    await page.getByRole("button", { name: "Buat aturan" }).first().click();
    await expect.poll(() => one("SELECT COUNT(*) FROM recurring_rules")).toBe(rules + 1);
    await page.goto("/automation");
    await expect(page.getByRole("heading", { name: "Pola berulang terdeteksi" })).toHaveCount(0);
  });

  test("budgets: warning at 90%, over beyond 100%, copy to next month, clear", async ({ page }) => {
    const spent = () => one("SELECT COALESCE(SUM(t.amount),0) FROM transactions t JOIN categories c ON c.id=t.category_id LEFT JOIN categories p ON p.id=c.parent_id WHERE t.type='expense' AND t.status='posted' AND substr(t.occurred_on,1,7)=? AND (c.name='Makanan & Minuman' OR p.name='Makanan & Minuman')", today.slice(0, 7));
    const budget = spent() + 1_000_000;
    await page.goto("/expenses");
    const input = page.getByLabel("Anggaran Makanan & Minuman");
    await input.fill(String(budget));
    await input.blur();
    await expect.poll(() => one("SELECT amount FROM budgets LIMIT 1")).toBe(budget);
    await capture(page, "makan 920rb bca", 1);
    await page.goto("/expenses");
    await expect(page.locator("tr", { hasText: "Makanan & Minuman" }).first()).toContainText("Hampir habis");
    await capture(page, "makan 100rb bca", 1);
    await page.goto("/expenses");
    await expect(page.locator("tr", { hasText: "Makanan & Minuman" }).first()).toContainText("Terlampaui");
    const next = new Date(Date.parse(`${today.slice(0, 7)}-01T00:00:00Z`)); next.setUTCMonth(next.getUTCMonth() + 1);
    const nm = next.toISOString().slice(0, 7);
    await page.goto(`/expenses?bm=${nm}`);
    await page.getByRole("button", { name: /Salin anggaran/ }).click();
    await expect.poll(() => one("SELECT COUNT(*) FROM budgets")).toBe(2);
    await page.reload();
    const cleared = page.getByLabel("Anggaran Makanan & Minuman");
    await cleared.fill("");
    await cleared.blur();
    await expect.poll(() => one("SELECT COUNT(*) FROM budgets")).toBe(1);
  });

  test("next actions are ranked from real data and every one explains why; daily review remembers the date", async ({ page }) => {
    // a debt whose first installment is 12 days overdue
    await page.goto("/debts");
    await page.getByRole("button", { name: "Tambah utang" }).click();
    await page.fill("#d-provider", "Akulaku");
    await page.fill("#d-principal", "600rb");
    await page.fill("#d-count", "3");
    await page.fill("#d-first", shift(today, -12));
    await pick(page.locator("#d-acc"), /^BCA/);
    await page.getByRole("button", { name: "Simpan utang" }).click();
    await page.waitForURL(/\/debts\/\d+/);
    await page.goto("/next-actions");
    const items = page.locator("ol[aria-label^='Langkah'] > li");
    await expect(items.first()).toContainText("Akulaku"); // an overdue installment outranks the budget overrun and all bookkeeping
    await expect(items.first()).toContainText("12 hari");
    const n = await items.count();
    expect(n).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < n; i++) await expect(items.nth(i)).toContainText("Mengapa:");
    await expect(page.locator("main")).toContainText(/Anggaran Makanan & Minuman terlampaui/);
    await page.goto("/next-actions?view=review");
    await expect(page.locator("main")).toContainText("belum pernah");
    await page.getByRole("button", { name: "Tandai sudah ditinjau" }).click();
    await expect(page.locator("main")).toContainText("(hari ini)", { timeout: 15_000 });
    expect(one("SELECT value FROM settings WHERE key='last_review_on'")).toBe(today);
  });

  test("savings goals are earmarks: progress, refusal to overdraw, automatic achievement, no effect on balances", async ({ page }) => {
    const bca = await balanceOf(page, "BCA");
    const tx = one("SELECT COUNT(*) FROM transactions");
    await page.goto("/goals");
    await page.getByRole("button", { name: "Target baru" }).click();
    await page.fill("#g-name", "Dana darurat");
    await page.selectOption("#g-kind", "emergency");
    await expect(page.getByText("Patokan umum dana darurat")).toBeVisible();
    await page.fill("#g-target", "6jt");
    await page.fill("#g-date", shift(today, 200));
    await page.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByRole("heading", { name: "Dana darurat" })).toBeVisible();
    await page.getByRole("button", { name: "Catat dana" }).click();
    await page.fill("#c-amt", "1jt");
    await page.getByRole("dialog").getByRole("button", { name: "Catat", exact: true }).click();
    await expect(page.locator("main")).toContainText("17%");
    await page.getByRole("button", { name: "Catat dana" }).click();
    await page.selectOption("#c-dir", "withdraw");
    await page.fill("#c-amt", "5jt");
    await page.getByRole("dialog").getByRole("button", { name: "Catat", exact: true }).click();
    await expect(page.getByRole("dialog").getByText("Penarikan melebihi")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Catat dana" }).click();
    await page.fill("#c-amt", "5jt");
    await page.getByRole("dialog").getByRole("button", { name: "Catat", exact: true }).click();
    await expect(page.locator("main")).toContainText("Tercapai");
    expect(await balanceOf(page, "BCA")).toBe(bca);
    expect(one("SELECT COUNT(*) FROM transactions")).toBe(tx);
    expect(q("SELECT status, saved_amount FROM goals")).toEqual([{ status: "achieved", saved_amount: 6_000_000 }]);
  });
});
void mm;
