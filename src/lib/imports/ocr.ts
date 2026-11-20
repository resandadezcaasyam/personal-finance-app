import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Worker } from "tesseract.js";

/**
 * Offline OCR. The Indonesian and English language data ship in node_modules (@tesseract.js-data/*), so nothing is
 * downloaded at runtime. One worker is created lazily, reused, and closed after a few idle minutes.
 */
const LANGS = ["ind", "eng"] as const;
const IDLE_MS = 5 * 60_000;
const TIMEOUT_MS = 90_000;

interface State { worker: Promise<Worker> | null; queue: Promise<unknown>; idle: ReturnType<typeof setTimeout> | null }
const g = globalThis as unknown as { __pfosOcr?: State };
const state: State = (g.__pfosOcr ??= { worker: null, queue: Promise.resolve(), idle: null });

/** tesseract.js loads every language from one folder, so gather both into a temp dir (copied once). */
export function languageDir(): string {
  const dir = path.join(os.tmpdir(), "pfos-tessdata");
  fs.mkdirSync(dir, { recursive: true });
  for (const l of LANGS) {
    const src = path.join(process.cwd(), "node_modules", "@tesseract.js-data", l, "4.0.0_best_int", `${l}.traineddata.gz`);
    const dst = path.join(dir, `${l}.traineddata.gz`);
    if (!fs.existsSync(src)) throw new Error(`Data bahasa OCR tidak ditemukan: ${src}. Jalankan "npm install" lagi.`);
    if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
  }
  return dir;
}

async function getWorker(): Promise<Worker> {
  if (!state.worker) {
    state.worker = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker(LANGS.join("+"), 1, { langPath: languageDir(), gzip: true, cacheMethod: "none", logger: () => {} });
    })();
    state.worker.catch(() => { state.worker = null; });
  }
  return state.worker;
}

export async function shutdownOcr() {
  const w = state.worker;
  state.worker = null;
  if (state.idle) clearTimeout(state.idle);
  if (w) await (await w.catch(() => null))?.terminate();
}

export interface OcrResult { text: string; confidence: number }

export function ocrImage(image: Buffer): Promise<OcrResult> {
  const run = async (): Promise<OcrResult> => {
    const worker = await getWorker();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const res = await Promise.race([
        worker.recognize(image),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("OCR terlalu lama (lebih dari 90 detik)")), TIMEOUT_MS); }),
      ]);
      return { text: res.data.text, confidence: res.data.confidence };
    } catch (e) {
      await shutdownOcr(); // a stuck worker is discarded; the next call starts a fresh one
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      if (state.idle) clearTimeout(state.idle);
      state.idle = setTimeout(() => { void shutdownOcr(); }, IDLE_MS);
      state.idle.unref?.();
    }
  };
  const job = state.queue.then(run, run); // strictly one image at a time
  state.queue = job.catch(() => undefined);
  return job;
}
