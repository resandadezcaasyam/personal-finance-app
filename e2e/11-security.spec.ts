import fs from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, authFile, readAuth, DATA_DIR, one } from "./helpers";
import type { Browser, BrowserContext, Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
const PIN = "481926", PIN2 = "739205";
const BASE = "http://localhost:3100";

const fresh = async (browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> => {
  const ctx = await browser.newContext({ baseURL: BASE });
  return { ctx, page: await ctx.newPage() };
};
/** Submit the PIN. With `expectOpen` (default) it waits until the dashboard is really showing. */
async function login(page: Page, pin: string, expectOpen = true) {
  await page.goto("/");
  await page.fill("#lock-pin", pin);
  await page.getByRole("button", { name: "Buka", exact: true }).click();
  if (expectOpen) await expect(page.getByRole("heading", { name: "Ringkasan Keuangan" })).toBeVisible();
}
/** Clear the persisted lockout without waiting it out (the test would otherwise need to sleep 30 s). */
function clearLockout() {
  const s = JSON.parse(fs.readFileSync(authFile(), "utf8"));
  fs.writeFileSync(authFile(), JSON.stringify({ ...s, failed: 0, lockedUntil: 0 }));
}
const form = (page: Page, title: string) => page.locator("form", { has: page.getByRole("heading", { name: title }) });

test.describe("PIN protection", () => {
  // Never leave the app locked for later specs, even if a test in this file fails halfway.
  test.afterAll(() => { fs.rmSync(authFile(), { force: true }); });

  test("enabling needs a strong-enough PIN and stores only a hash", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel("PIN baru (min. 4 karakter)").fill("1234");
    await page.getByLabel("Ulangi PIN").fill("1234");
    await page.getByRole("button", { name: "Aktifkan PIN" }).click();
    await expect(page.locator("main")).toContainText("mudah ditebak");
    await page.getByLabel("PIN baru (min. 4 karakter)").fill(PIN);
    await page.getByLabel("Ulangi PIN").fill("000000");
    await page.getByRole("button", { name: "Aktifkan PIN" }).click();
    await expect(page.locator("main")).toContainText("Konfirmasi PIN tidak sama");
    await page.getByLabel("PIN baru (min. 4 karakter)").fill(PIN);
    await page.getByLabel("Ulangi PIN").fill(PIN);
    await page.getByRole("button", { name: "Aktifkan PIN" }).click();
    await expect(page.getByText("PIN aktif", { exact: true })).toBeVisible();
    const raw = readAuth()!;
    expect(raw).not.toContain(PIN);
    expect(JSON.parse(raw).hash).toMatch(/^scrypt\$/);
    await expect(page.getByRole("button", { name: "Kunci aplikasi" })).toBeVisible(); // the person who set it stays signed in
  });

  test("without a session nothing is reachable: pages, downloads, uploads, and health reveal nothing", async ({ browser }) => {
    const { ctx, page } = await fresh(browser);
    for (const path of ["/", "/transactions", "/settings", "/backup", "/reports"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Aplikasi terkunci" }), path).toBeVisible();
      await expect(page.locator("body")).not.toContainText("Rp ");
    }
    for (const url of ["/api/export?kind=all", "/api/export?kind=pdf", "/api/backup/download?name=finance-x-manual.db"]) expect((await ctx.request.get(url)).status(), url).toBe(401);
    expect((await ctx.request.post("/api/import/parse", { multipart: { file: { name: "a.csv", mimeType: "text/csv", buffer: Buffer.from("a;b\n1;2") } } })).status()).toBe(401);
    expect((await ctx.request.post("/api/import/commit", { data: {} })).status()).toBe(401);
    expect((await ctx.request.post("/api/ocr/receipt", { multipart: { file: { name: "a.png", mimeType: "image/png", buffer: Buffer.from("x") } } })).status()).toBe(401);
    const health = await (await ctx.request.get("/api/health")).json();
    expect(health).toEqual({ ok: true, locked: true });
    await ctx.close();
  });

  test("wrong PINs are refused, repeated ones lock the app for a while, even the right PIN is refused during that time", async ({ browser }) => {
    const { ctx, page } = await fresh(browser);
    await login(page, "000999", false);
    await expect(page.locator("p[role=alert]")).toContainText("PIN salah");
    for (let i = 0; i < 4; i++) { await page.fill("#lock-pin", "000999"); await page.getByRole("button", { name: "Buka", exact: true }).click(); await page.waitForTimeout(250); }
    await expect(page.locator("p[role=alert]")).toContainText("Terlalu banyak percobaan");
    await page.fill("#lock-pin", PIN);
    await page.getByRole("button", { name: "Buka", exact: true }).click();
    await expect(page.locator("p[role=alert]")).toContainText("Terlalu banyak percobaan");
    await expect(page.getByRole("heading", { name: "Aplikasi terkunci" })).toBeVisible();
    await ctx.close();
    clearLockout();
  });

  test("the right PIN opens the app; the cookie is HttpOnly and SameSite=Strict; a forged cookie does not work", async ({ browser }) => {
    const { ctx, page } = await fresh(browser);
    await login(page, PIN);
    await expect(page.getByRole("heading", { name: "Ringkasan Keuangan" })).toBeVisible();
    const c = (await ctx.cookies()).find((x) => x.name === "pfos_session")!;
    expect(c).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });
    expect(c.value).not.toContain(PIN);
    expect((await ctx.request.get("/api/export?kind=monthly&preset=6m")).status()).toBe(200);
    await ctx.close();

    const forged = await browser.newContext({ baseURL: BASE });
    await forged.addCookies([{ name: "pfos_session", value: `${Buffer.from('{"iat":1,"exp":99999999999999}').toString("base64url")}.AAAA`, url: BASE }]);
    const fp = await forged.newPage();
    await fp.goto("/");
    await expect(fp.getByRole("heading", { name: "Aplikasi terkunci" })).toBeVisible();
    expect((await forged.request.get("/api/export?kind=all")).status()).toBe(401);
    await forged.close();
  });

  test("a server action replayed WITHOUT a session is refused (the PIN is not just a hidden UI)", async ({ browser }) => {
    const { ctx, page } = await fresh(browser);
    await login(page, PIN);
    await page.goto("/accounts");
    const captured = new Promise<import("@playwright/test").Request>((res) => page.on("request", (r) => { if (r.method() === "POST" && r.headers()["next-action"]) res(r); }));
    await page.getByRole("button", { name: "Tambah akun" }).first().click();
    await page.fill("#acc-name", "Replay Uji");
    await page.fill("#acc-init", "1.000");
    await page.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
    const req = await captured;
    await expect(page.getByText("Replay Uji", { exact: true }).first()).toBeVisible();
    const h = req.headers(), body = req.postDataBuffer()!;
    const send = (c: BrowserContext, name: string) => c.request.post(req.url(), {
      headers: { "next-action": h["next-action"], "content-type": h["content-type"], accept: h["accept"] ?? "text/x-component" },
      data: Buffer.from(body.toString("latin1").replace("Replay Uji", name), "latin1"),
    });
    await send(ctx, "Replay Uj1"); // positive control: with a valid session the replay works, so the test is meaningful
    expect(one("SELECT COUNT(*) FROM accounts WHERE name='Replay Uj1'")).toBe(1);
    const anon = await browser.newContext({ baseURL: BASE });
    await send(anon, "Replay Uj2");
    expect(one("SELECT COUNT(*) FROM accounts WHERE name='Replay Uj2'")).toBe(0);
    const forged = await browser.newContext({ baseURL: BASE });
    await forged.addCookies([{ name: "pfos_session", value: "x.y", url: BASE }]);
    await send(forged, "Replay Uj3");
    expect(one("SELECT COUNT(*) FROM accounts WHERE name='Replay Uj3'")).toBe(0);
    await ctx.close(); await anon.close(); await forged.close();
  });

  test("the lock screen and the PIN settings are accessible", async ({ browser }) => {
    const locked = await fresh(browser);
    await locked.page.goto("/");
    await expect(locked.page.getByRole("heading", { name: "Aplikasi terkunci" })).toBeVisible();
    const a = await new AxeBuilder({ page: locked.page as never }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(a.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    const open = await fresh(browser);
    await login(open.page, PIN);
    await open.page.goto("/settings");
    await expect(open.page.getByRole("heading", { name: "Ubah PIN" })).toBeVisible();
    const b = await new AxeBuilder({ page: open.page as never }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(b.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
    await locked.ctx.close(); await open.ctx.close();
  });

  test("locking from the header returns to the lock screen, and switching to demo is not a way around it", async ({ browser }) => {
    const { ctx, page } = await fresh(browser);
    await login(page, PIN);
    await page.getByRole("button", { name: "Kunci aplikasi" }).click();
    await expect(page.getByRole("heading", { name: "Aplikasi terkunci" })).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Aplikasi terkunci" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Aktifkan mode demo" })).toHaveCount(0);
    await ctx.close();
  });

  test("changing the PIN needs the current one and signs out every other session", async ({ browser }) => {
    const a = await fresh(browser), b = await fresh(browser);
    await login(a.page, PIN); await login(b.page, PIN);
    await expect(a.page.getByRole("heading", { name: "Ringkasan Keuangan" })).toBeVisible();
    await b.page.goto("/settings");
    const f = form(b.page, "Ubah PIN");
    await f.getByLabel("PIN saat ini").fill("wrong1");
    await f.getByLabel("PIN baru", { exact: true }).fill(PIN2);
    await f.getByLabel("Ulangi PIN baru").fill(PIN2);
    await f.getByRole("button", { name: "Ubah PIN" }).click();
    await expect(b.page.locator("main")).toContainText("PIN saat ini salah");
    await f.getByLabel("PIN saat ini").fill(PIN);
    await f.getByRole("button", { name: "Ubah PIN" }).click();
    await expect(b.page.getByRole("status").or(b.page.getByText("PIN diubah")).first()).toBeVisible();
    await a.page.reload();
    await expect(a.page.getByRole("heading", { name: "Aplikasi terkunci" })).toBeVisible(); // old session is gone
    await b.page.reload();
    await expect(b.page.getByRole("heading", { name: "Pengaturan" }).first()).toBeVisible(); // the session that changed it continues
    const c = await fresh(browser);
    await login(c.page, PIN, false);
    await expect(c.page.locator("p[role=alert]")).toContainText("PIN salah");
    await login(c.page, PIN2);
    await expect(c.page.getByRole("heading", { name: "Ringkasan Keuangan" })).toBeVisible();
    await a.ctx.close(); await b.ctx.close(); await c.ctx.close();
    clearLockout();
  });

  test("'sign out everywhere' ends other sessions but keeps the PIN", async ({ browser }) => {
    const a = await fresh(browser), b = await fresh(browser);
    await login(a.page, PIN2); await login(b.page, PIN2);
    await a.page.goto("/settings");
    await a.page.getByRole("button", { name: "Keluarkan semua sesi" }).click();
    await expect(a.page.getByRole("heading", { name: "Aplikasi terkunci" })).toBeVisible();
    await b.page.reload();
    await expect(b.page.getByRole("heading", { name: "Aplikasi terkunci" })).toBeVisible();
    await login(a.page, PIN2);
    await expect(a.page.getByRole("heading", { name: "Ringkasan Keuangan" })).toBeVisible();
    await a.ctx.close(); await b.ctx.close();
  });

  test("disabling needs the current PIN; afterwards the app is open again and data is intact", async ({ browser }) => {
    const { ctx, page } = await fresh(browser);
    await login(page, PIN2);
    await page.goto("/settings");
    const f = form(page, "Nonaktifkan PIN");
    await f.getByLabel("PIN saat ini").fill("nope11");
    await f.getByRole("button", { name: "Nonaktifkan PIN" }).click();
    await expect(page.locator("main")).toContainText("PIN saat ini salah");
    await f.getByLabel("PIN saat ini").fill(PIN2);
    await f.getByRole("button", { name: "Nonaktifkan PIN" }).click();
    await expect(page.getByText("PIN nonaktif", { exact: true })).toBeVisible();
    expect(fs.existsSync(`${DATA_DIR}/auth.json`)).toBe(false);
    const open = await browser.newContext({ baseURL: BASE });
    const p = await open.newPage();
    await p.goto("/accounts");
    await expect(p.getByText("BCA", { exact: true }).first()).toBeVisible();
    expect((await open.request.get("/api/export?kind=monthly&preset=6m")).status()).toBe(200);
    await open.close(); await ctx.close();
  });
});
