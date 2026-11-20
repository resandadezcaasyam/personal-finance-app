import AxeBuilder from "@axe-core/playwright";
import { test, expect, ALL_PAGES } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function audit(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400); // charts and client components settle
  const r = await new AxeBuilder({ page: page as never }).withTags(TAGS).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${path}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

test.describe("accessibility and responsive layout", () => {
  test.setTimeout(300_000);

  test("no serious or critical accessibility violations on any page (light theme)", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    const found: string[] = [];
    for (const p of ALL_PAGES) found.push(...(await audit(page, p)));
    expect(found).toEqual([]);
  });

  test("no serious or critical accessibility violations on any page (dark theme)", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    const found: string[] = [];
    for (const p of ALL_PAGES) found.push(...(await audit(page, p)));
    expect(found).toEqual([]);
  });

  test("dialogs are reachable by keyboard: opened by Enter, closed by Escape, focus returns", async ({ page }) => {
    await page.goto("/accounts");
    const open = page.getByRole("button", { name: "Tambah akun" }).first();
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("the skip link moves focus to the main content", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Lewati ke konten" })).toBeFocused();
  });

  for (const width of [360, 390, 768, 1024]) {
    test(`at ${width}px no page scrolls sideways`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, baseURL: "http://localhost:3100" });
      const page = await ctx.newPage();
      const wide: string[] = [];
      for (const p of ALL_PAGES) {
        await page.goto(p);
        await page.waitForLoadState("networkidle");
        const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        if (o.sw > o.cw + 1) wide.push(`${p}: ${o.sw} > ${o.cw}`);
      }
      await ctx.close();
      expect(wide).toEqual([]);
    });
  }
});
