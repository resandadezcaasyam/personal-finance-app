import { describe, it, expect, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { memDb, twoAccounts, TODAY } from "./helpers";
import { isLocalUrl, loadAiSettings, saveAiSettings, parseWithOllama, ollamaHealth, AiError, DEFAULT_AI_URL, type AiContext, type AiSettings } from "@/lib/capture/ollama";
import { parseCaptureSmart } from "@/lib/capture/smart";
import { findCategoryId } from "@/lib/ledger/categories";
import { LedgerError } from "@/lib/ledger/errors";

/** A fake Ollama on a random local port. Records what it was sent. */
function fake(handler: (body: string, res: http.ServerResponse, req: http.IncomingMessage) => void) {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { seen.push(`${req.method} ${req.url} ${body}`); handler(body, res, req); });
  });
  return new Promise<{ url: string; seen: string[]; close: () => Promise<void> }>((resolve) => server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as AddressInfo).port;
    resolve({ url: `http://127.0.0.1:${port}`, seen, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) });
  }));
}
const reply = (res: http.ServerResponse, content: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify({ message: { content: typeof content === "string" ? content : JSON.stringify(content) } })); };
const ctx: AiContext = {
  today: TODAY, accounts: [{ id: 1, name: "BCA" }, { id: 2, name: "GoPay" }],
  categories: [{ id: 10, name: "Kopi", kind: "expense" }, { id: 11, name: "Makan", kind: "expense" }, { id: 20, name: "Gaji", kind: "income" }],
};
const on = (url: string): AiSettings => ({ enabled: true, url, model: "llama3.2" });
const servers: { close: () => Promise<void> }[] = [];
afterAll(async () => { for (const s of servers) await s.close(); });
const up = async (h: Parameters<typeof fake>[0]) => { const f = await fake(h); servers.push(f); return f; };

describe("local-only address", () => {
  it.each(["http://127.0.0.1:11434", "http://localhost:11434", "http://localhost", "http://[::1]:11434", "http://127.0.0.1:8080/"])("accepts %s", (u) => expect(isLocalUrl(u)).toBe(true));
  it.each(["https://127.0.0.1", "http://192.168.1.10:11434", "http://10.0.0.5", "http://evil.com", "http://127.0.0.1.evil.com", "http://localhost.evil.com", "http://user:pw@127.0.0.1", "ftp://127.0.0.1", "javascript:alert(1)", "", "not a url", "http://0.0.0.0:11434", "http://169.254.169.254"])("rejects %j", (u) => expect(isLocalUrl(u)).toBe(false));
});

describe("settings", () => {
  it("is OFF by default and cannot be switched on for a non-local address", () => {
    const db = memDb();
    expect(loadAiSettings(db)).toEqual({ enabled: false, url: DEFAULT_AI_URL, model: "llama3.2" });
    expect(() => saveAiSettings(db, { enabled: true, url: "http://evil.com", model: "llama3.2" })).toThrow(/komputer ini/);
    expect(() => saveAiSettings(db, { enabled: true, url: "http://127.0.0.1:11434", model: "bad model!" })).toThrow(LedgerError);
    saveAiSettings(db, { enabled: true, url: "http://localhost:11434/", model: "qwen2.5:3b" });
    expect(loadAiSettings(db)).toEqual({ enabled: true, url: "http://localhost:11434", model: "qwen2.5:3b" });
    saveAiSettings(db, { enabled: false, url: "http://localhost:11434", model: "qwen2.5:3b" });
    expect(loadAiSettings(db).enabled).toBe(false);
  });
  it("a tampered non-local URL in the database disables the feature", () => {
    const db = memDb();
    saveAiSettings(db, { enabled: true, url: "http://127.0.0.1:11434", model: "m" });
    db.prepare("UPDATE settings SET value='http://evil.com' WHERE key='ai_url'").run();
    expect(loadAiSettings(db).enabled).toBe(false);
  });
});

describe("reading with the local model", () => {
  it("maps a valid answer onto real accounts and categories by name and sends only the text and names", async () => {
    const f = await up((_b, res) => reply(res, { transactions: [
      { type: "expense", amount: 25000, date: null, description: "Kopi", merchant: "Fore Coffee", account: "gopay", category: "Kopi" },
      { type: "income", amount: 9500000, date: "2026-11-19", description: "Gaji", account: "BCA", category: "Gaji" },
      { type: "transfer", amount: 500000, account: "BCA", to_account: "GoPay" },
    ] }));
    const d = await parseWithOllama("kopi 25rb gopay, gaji masuk 9,5jt bca, tf 500rb", ctx, on(f.url));
    expect(d.map((x) => [x.type, x.amount, x.account_id, x.to_account_id, x.category_id, x.occurred_on])).toEqual([
      ["expense", 25_000, 2, null, 10, TODAY], ["income", 9_500_000, 1, null, 20, "2026-11-19"], ["transfer", 500_000, 1, 2, null, TODAY]]);
    expect(d.every((x) => x.issues.includes("Dibaca dengan AI lokal, periksa hasilnya.") && x.confidence <= 0.7)).toBe(true);
    const sent = f.seen[0];
    expect(sent).toContain("POST /api/chat");
    expect(sent).toContain("kopi 25rb gopay");
    expect(sent).toContain("BCA, GoPay");
    expect(sent).toContain('"temperature":0');
    expect(sent.toLowerCase()).not.toContain("balance"); // account balances are never part of what is sent
    const body = JSON.parse(sent.slice(sent.indexOf("{")));
    expect(Object.keys(body).sort()).toEqual(["format", "messages", "model", "options", "stream"]);
    expect(body.messages).toHaveLength(2); // the instructions (names only) and the user's sentence
  });
  it("unknown accounts or categories become warnings, never invented ids; future dates are replaced", async () => {
    const f = await up((_b, res) => reply(res, { transactions: [{ type: "expense", amount: 12000, date: "2026-12-25", description: "x", account: "Bank Fiktif", category: "Hobi" }] }));
    const [d] = await parseWithOllama("x 12rb", ctx, on(f.url));
    expect(d).toMatchObject({ account_id: null, category_id: null, occurred_on: TODAY });
    expect(d.issues.join(" ")).toMatch(/Bank Fiktif.*tidak dikenal/);
    expect(d.issues.join(" ")).toMatch(/Hobi.*tidak dikenal/);
    expect(d.issues.join(" ")).toMatch(/masa depan/);
  });
  it("fills a missing category with the same rules the built-in parser uses", async () => {
    const f = await up((_b, res) => reply(res, { transactions: [{ type: "expense", amount: 30000, account: "BCA", description: "makan siang" }] }));
    const [d] = await parseWithOllama("makan siang 30rb bca", { ...ctx, matchRule: (t) => (/makan/.test(t) ? { category_id: 11, merchant: null } : null) }, on(f.url));
    expect(d).toMatchObject({ category_id: 11, category_source: "rule" });
  });
  it("rejects unusable output: not JSON, wrong shape, non-integer or negative amounts, empty list", async () => {
    for (const bad of ["maaf saya tidak mengerti", { transactions: [] }, { transactions: [{ type: "expense", amount: "25rb" }] }, { transactions: [{ type: "expense", amount: 1.5 }] }, { transactions: [{ type: "expense", amount: -5 }] }, { transactions: [{ type: "gift", amount: 5 }] }, { hasil: 1 }]) {
      const f = await up((_b, res) => reply(res, bad));
      await expect(parseWithOllama("x", ctx, on(f.url))).rejects.toBeInstanceOf(AiError);
    }
  });
  it("caps the number of items", async () => {
    const f = await up((_b, res) => reply(res, { transactions: Array.from({ length: 50 }, () => ({ type: "expense", amount: 1000, account: "BCA" })) }));
    expect(await parseWithOllama("x", ctx, on(f.url))).toHaveLength(20);
  });
  it("errors from the server, timeouts, redirects and a closed port all raise AiError", async () => {
    const s500 = await up((_b, res) => { res.writeHead(500); res.end("boom"); });
    await expect(parseWithOllama("x", ctx, on(s500.url))).rejects.toThrow(/500/);
    const slow = await up(() => { /* never answers */ });
    await expect(parseWithOllama("x", ctx, on(slow.url), { timeoutMs: 150 })).rejects.toThrow(/tepat waktu/);
    const redir = await up((_b, res) => { res.writeHead(302, { Location: "http://example.com/" }); res.end(); });
    await expect(parseWithOllama("x", ctx, on(redir.url))).rejects.toBeInstanceOf(AiError);
    const gone = await fake((_b, res) => res.end()); const dead = gone.url; await gone.close();
    await expect(parseWithOllama("x", ctx, on(dead))).rejects.toThrow(/tidak dapat dihubungi/);
  });
  it("refuses when disabled or when the address is not local, without making any request", async () => {
    let called = 0;
    const spy = (async () => { called++; return new Response("{}"); }) as unknown as typeof fetch;
    await expect(parseWithOllama("x", ctx, { enabled: false, url: DEFAULT_AI_URL, model: "m" }, { fetchImpl: spy })).rejects.toThrow(/tidak aktif/);
    await expect(parseWithOllama("x", ctx, { enabled: true, url: "http://evil.com", model: "m" }, { fetchImpl: spy })).rejects.toThrow(/bukan komputer ini/);
    expect(called).toBe(0);
  });
});

describe("health check", () => {
  it("lists installed models, and reports failures without throwing", async () => {
    const f = await up((_b, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ models: [{ name: "llama3.2:latest" }, { name: "qwen2.5:3b" }] })); });
    expect(await ollamaHealth(f.url)).toEqual({ ok: true, models: ["llama3.2:latest", "qwen2.5:3b"] });
    const bad = await up((_b, res) => { res.writeHead(503); res.end(); });
    expect(await ollamaHealth(bad.url)).toMatchObject({ ok: false, error: expect.stringContaining("503") });
    expect(await ollamaHealth("http://evil.com")).toMatchObject({ ok: false });
  });
});

describe("the app works without AI", () => {
  function world() { const db = memDb(); twoAccounts(db, 1_000_000, 0); return db; }
  it("with AI off the built-in parser is used and nothing is requested", async () => {
    const db = world();
    let called = 0;
    const spy = (async () => { called++; return new Response("{}"); }) as unknown as typeof fetch;
    const r = await parseCaptureSmart(db, "kopi 25rb gopay", { useAi: true, today: TODAY, fetchImpl: spy });
    expect(called).toBe(0);
    expect(r).toMatchObject({ source: "builtin", notice: expect.stringContaining("tidak aktif") });
    expect(r.drafts[0]).toMatchObject({ amount: 25_000, account_id: 2, category_id: findCategoryId(db, "Kopi", "expense") });
  });
  it("with AI on but unreachable, it falls back to the built-in parser with a notice", async () => {
    const db = world();
    const gone = await fake((_b, res) => res.end()); const dead = gone.url; await gone.close();
    saveAiSettings(db, { enabled: true, url: dead, model: "llama3.2" });
    const r = await parseCaptureSmart(db, "makan 30k bca", { useAi: true, today: TODAY });
    expect(r.source).toBe("builtin");
    expect(r.notice).toContain("Memakai pembaca bawaan");
    expect(r.drafts[0]).toMatchObject({ amount: 30_000, account_id: 1 });
  });
  it("with AI on and working, the model's drafts are used (and still go through the preview)", async () => {
    const db = world();
    const f = await up((_b, res) => reply(res, { transactions: [{ type: "expense", amount: 77000, account: "BCA", category: "Kopi", description: "ngopi" }] }));
    saveAiSettings(db, { enabled: true, url: f.url, model: "llama3.2" });
    const r = await parseCaptureSmart(db, "tadi ngopi tujuh puluh tujuh ribu", { useAi: true, today: TODAY });
    expect(r.source).toBe("ai");
    expect(r.drafts[0]).toMatchObject({ amount: 77_000, account_id: 1 });
    expect(r.notice).toBeNull();
  });
  it("without useAi the model is never contacted even when enabled", async () => {
    const db = world();
    const f = await up((_b, res) => reply(res, { transactions: [{ type: "expense", amount: 1 }] }));
    saveAiSettings(db, { enabled: true, url: f.url, model: "m" });
    const before = f.seen.length;
    const r = await parseCaptureSmart(db, "kopi 25rb bca", { useAi: false, today: TODAY });
    expect(r.source).toBe("builtin");
    expect(f.seen.length).toBe(before);
  });
});
