"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImageUp, FileSpreadsheet, ClipboardPaste, Loader2, CheckCircle2, AlertTriangle, XCircle, History, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/form-field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/toast";
import { formatIDR, formatDateID } from "@/lib/format";
import { normalizeRows, EMPTY_MAPPING, type Mapping, type Table } from "@/lib/imports/table";
import type { AccountWithBalance } from "@/lib/ledger/types";
import type { BatchRow } from "@/lib/inbox/inbox";
import { saveImportTemplateAction } from "@/app/actions/capture";

/* ---------------- screenshots & receipts (OCR) ---------------- */

interface OcrJob { id: number; name: string; state: "queue" | "running" | "ok" | "dup" | "error"; text?: string; detail?: { amount: number | null; merchant: string | null; date: string | null; confidence: number; issues: string[] } }

export function ReceiptUploader() {
  const [jobs, setJobs] = React.useState<OcrJob[]>([]);
  const [drag, setDrag] = React.useState(false);
  const running = React.useRef(false);
  const router = useRouter();
  const toast = useToast();
  const seq = React.useRef(0);

  const upd = (id: number, p: Partial<OcrJob>) => setJobs((j) => j.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const run = React.useCallback(async (queue: { id: number; file: File }[]) => {
    if (running.current) return;
    running.current = true;
    for (const { id, file } of queue) {
      upd(id, { state: "running" });
      try {
        const fd = new FormData();
        fd.set("file", file);
        const res = await fetch("/api/ocr/receipt", { method: "POST", body: fd });
        const data = await res.json();
        if (data.ok) upd(id, { state: data.created ? "ok" : "dup", text: data.message ?? undefined, detail: { amount: data.result.amount, merchant: data.result.merchant, date: data.result.date, confidence: data.result.confidence, issues: data.result.issues } });
        else upd(id, { state: data.duplicate ? "dup" : "error", text: data.error });
      } catch { upd(id, { state: "error", text: "Koneksi ke aplikasi terputus." }); }
    }
    running.current = false;
    router.refresh();
  }, [router]);

  const add = (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|bmp|webp)$/i.test(f.name));
    if (imgs.length === 0) { toast("Pilih file gambar (PNG atau JPG).", "error"); return; }
    const batch = imgs.map((file) => ({ id: ++seq.current, file }));
    setJobs((j) => [...j, ...batch.map((b) => ({ id: b.id, name: b.file.name, state: "queue" as const }))]);
    void run(batch);
  };

  const pasteImage = async () => {
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const it of items) { const t = it.types.find((x) => x.startsWith("image/")); if (t) files.push(new File([await it.getType(t)], `clipboard-${Date.now()}.png`, { type: t })); }
      if (files.length === 0) { toast("Tidak ada gambar di clipboard.", "error"); return; }
      add(files);
    } catch { toast("Browser tidak mengizinkan membaca clipboard. Fokuskan kotak ini lalu tekan Ctrl+V.", "error"); }
  };

  const icon = (s: OcrJob["state"]) => s === "running" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : s === "ok" ? <CheckCircle2 className="h-4 w-4 text-gain" aria-hidden /> : s === "dup" ? <AlertTriangle className="h-4 w-4 text-warn" aria-hidden /> : s === "error" ? <XCircle className="h-4 w-4 text-loss" aria-hidden /> : <span className="h-4 w-4 rounded-full border border-line" aria-hidden />;
  const label = { queue: "Antre", running: "Membaca…", ok: "Masuk kotak masuk", dup: "Dilewati", error: "Gagal" } as const;

  return (
    <div>
      <div
        tabIndex={0} role="button" aria-describedby="ocr-hint"
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add([...e.dataTransfer.files]); }}
        onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); add(f); } }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") document.getElementById("ocr-file")?.click(); }}
        onClick={() => document.getElementById("ocr-file")?.click()}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${drag ? "border-brand bg-tint" : "border-line hover:border-brand/50 hover:bg-tint/50"}`}>
        <ImageUp className="h-7 w-7 text-muted" aria-hidden />
        <p className="font-medium">Seret screenshot atau foto struk ke sini</p>
        <p className="text-sm text-muted">atau klik untuk memilih beberapa gambar sekaligus. Dibaca di komputer ini, tanpa internet.</p>
      </div>
      <p id="ocr-hint" className="sr-only">Seret file ke sini, klik, atau tekan Ctrl+V setelah tombol ini fokus untuk menempel gambar.</p>
      <input id="ocr-file" type="file" accept="image/*" multiple tabIndex={-1} aria-label="Pilih gambar struk atau screenshot" className="sr-only" onChange={(e) => { add([...(e.target.files ?? [])]); e.target.value = ""; }} />
      <div className="mt-3"><Button variant="secondary" size="sm" onClick={pasteImage}><ClipboardPaste className="h-4 w-4" aria-hidden />Tempel gambar dari clipboard</Button></div>

      {jobs.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-card border border-line bg-surface text-sm" aria-live="polite">
          {jobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <span className="mt-0.5">{icon(j.state)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{j.name}</p>
                {j.detail && <p className="text-muted">{j.detail.merchant ?? "Merchant tidak terbaca"} · {j.detail.amount ? formatIDR(j.detail.amount) : "nominal tidak terbaca"} · {j.detail.date ? formatDateID(j.detail.date) : "tanggal tidak terbaca"}</p>}
                {j.detail && j.detail.issues.length > 0 && <p className="text-xs text-warn">{j.detail.issues.join(" · ")}</p>}
                {j.text && j.state !== "ok" && <p className={`text-xs ${j.state === "error" ? "text-loss" : "text-muted"}`}>{j.text}</p>}
              </div>
              {j.detail && <Badge tone={j.detail.confidence >= 0.75 ? "brand" : "warn"}>Keyakinan {Math.round(j.detail.confidence * 100)}%</Badge>}
              <Badge tone={j.state === "ok" ? "brand" : j.state === "error" ? "loss" : "neutral"}>{label[j.state]}</Badge>
            </li>
          ))}
        </ul>
      )}
      {jobs.some((j) => j.state === "ok") && <p className="mt-3 text-sm"><Link href="/inbox?status=needs_review" className="font-medium text-brand-text underline">Tinjau hasil di kotak masuk</Link> <span className="text-muted">— belum ada yang tercatat di buku besar sebelum Anda menyetujuinya.</span></p>}
    </div>
  );
}

/* ---------------- statements (CSV / XLSX / PDF) ---------------- */

interface Parsed {
  fileName: string; fileHash: string; kind: "csv" | "xlsx" | "pdf"; scanned: boolean; note: string | null; table: Table; mapping: Mapping; signature: string; usedTemplate: string | null;
  templates: { id: number; name: string; mapping: Mapping }[];
}
interface Commit { batchId: number; imported: number; duplicates: number; errors: { row_no: number; reason: string }[]; skippedRows: number; needsReview: number }

const FIELDS: { key: "date" | "description" | "debit" | "credit" | "amount" | "dc" | "reference" | "balance"; label: string; hint?: string }[] = [
  { key: "date", label: "Tanggal" }, { key: "description", label: "Keterangan" }, { key: "debit", label: "Debet (uang keluar)" }, { key: "credit", label: "Kredit (uang masuk)" },
  { key: "amount", label: "Jumlah (satu kolom)", hint: "Dipakai bila tidak ada kolom debet/kredit terpisah." }, { key: "dc", label: "Kolom D/K atau tipe" },
  { key: "reference", label: "Nomor referensi" }, { key: "balance", label: "Saldo", hint: "Membantu menentukan masuk/keluar jika tidak ada penanda." },
];

export function StatementImporter({ accounts, today }: { accounts: AccountWithBalance[]; today: string }) {
  const [p, setP] = React.useState<Parsed | null>(null);
  const [mapping, setMapping] = React.useState<Mapping>(EMPTY_MAPPING);
  const [accountId, setAccountId] = React.useState("");
  const [busy, setBusy] = React.useState<"parse" | "commit" | null>(null);
  const [err, setErr] = React.useState<string>();
  const [result, setResult] = React.useState<Commit | null>(null);
  const [tplName, setTplName] = React.useState("");
  const router = useRouter();
  const toast = useToast();
  const active = accounts.filter((a) => !a.is_archived);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy("parse"); setErr(undefined); setResult(null); setP(null);
    try {
      const fd = new FormData(); fd.set("file", file);
      const res = await fetch("/api/import/parse", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.ok) { setErr(data.error); return; }
      setP(data); setMapping(data.mapping);
    } catch { setErr("Koneksi ke aplikasi terputus."); } finally { setBusy(null); }
  };

  const norm = React.useMemo(() => (p ? normalizeRows(p.table, mapping, today) : null), [p, mapping, today]);
  const width = p ? Math.max(...p.table.slice(0, 60).map((r) => r.length), 1) : 0;
  const headerRow = p && mapping.header_row >= 0 ? p.table[mapping.header_row] : null;
  const colLabel = (j: number) => `Kolom ${j + 1}${headerRow && headerRow[j] ? `: ${String(headerRow[j]).slice(0, 24)}` : p?.table[mapping.header_row + 1]?.[j] != null ? ` (contoh: ${String(p.table[mapping.header_row + 1][j]).slice(0, 20)})` : ""}`;
  const set = <K extends keyof Mapping>(k: K, v: Mapping[K]) => setMapping((m) => ({ ...m, [k]: v }));
  const colSelect = (k: (typeof FIELDS)[number]["key"]) => (
    <Select value={mapping[k] ?? ""} onChange={(e) => set(k, e.target.value === "" ? null : Number(e.target.value))} className="text-ink">
      <option value="">— tidak dipakai —</option>{Array.from({ length: width }, (_, j) => <option key={j} value={j}>{colLabel(j)}</option>)}
    </Select>
  );
  const needsPositive = mapping.amount !== null && mapping.debit === null && mapping.credit === null && mapping.dc === null && mapping.balance === null;

  const commit = async () => {
    if (!p || !accountId) return;
    setBusy("commit"); setErr(undefined);
    try {
      const res = await fetch("/api/import/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: p.fileName, fileHash: p.fileHash, kind: p.kind, scanned: p.scanned, accountId: Number(accountId), table: p.table, mapping }) });
      const data = await res.json();
      if (!data.ok) { setErr(data.error); return; }
      setResult(data); setP(null); toast(`${data.imported} baris masuk kotak masuk`); router.refresh();
    } catch { setErr("Koneksi ke aplikasi terputus."); } finally { setBusy(null); }
  };

  const saveTemplate = async () => {
    if (!p) return;
    const r = await saveImportTemplateAction(tplName, p.signature, JSON.stringify(mapping));
    toast(r.ok ? "Pemetaan disimpan. File dengan header sama akan memakainya otomatis." : r.message ?? "Gagal", r.ok ? "ok" : "error");
    if (r.ok) setTplName("");
  };

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line p-6 text-center transition-colors hover:border-brand/50 hover:bg-tint/50 focus-within:outline focus-within:outline-2 focus-within:outline-brand">
        {busy === "parse" ? <Loader2 className="h-7 w-7 animate-spin text-muted" aria-hidden /> : <FileSpreadsheet className="h-7 w-7 text-muted" aria-hidden />}
        <span className="font-medium">{busy === "parse" ? "Membaca file…" : "Pilih file mutasi (CSV, XLSX, atau PDF)"}</span>
        <span className="text-sm text-muted">PDF hasil pindai dibaca dengan OCR dan bisa memakan waktu lebih lama.</span>
        <input type="file" accept=".csv,.tsv,.txt,.xlsx,.pdf" className="sr-only" disabled={busy !== null} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
      </label>

      {err && <p role="alert" className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{err}</p>}

      {result && (
        <div role="status" className="space-y-1 rounded-card border border-brand/40 bg-brand/10 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-brand-text"><CheckCircle2 className="h-4 w-4" aria-hidden />{result.imported} baris masuk kotak masuk{result.needsReview > 0 && `, ${result.needsReview} perlu ditinjau`}.</p>
          {result.duplicates > 0 && <p>{result.duplicates} baris dilewati karena sudah pernah diimpor.</p>}
          {result.skippedRows > 0 && <p className="text-muted">{result.skippedRows} baris bukan transaksi (saldo awal, total, dll.) diabaikan.</p>}
          {result.errors.length > 0 && <p className="text-warn">{result.errors.length} baris tidak dapat dibaca. Lihat rinciannya di Riwayat impor.</p>}
          <p><Link href={`/inbox?batch=${result.batchId}`} className="font-medium text-brand-text underline">Tinjau hasil impor</Link> <span className="text-muted">· belum ada yang tercatat di buku besar sebelum disetujui.</span></p>
        </div>
      )}

      {p && norm && (
        <section className="space-y-4 rounded-card border border-line bg-surface p-5" aria-label="Pemetaan kolom">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg font-semibold">{p.fileName}</h3>
            <Badge>{p.kind.toUpperCase()}</Badge>{p.scanned && <Badge tone="warn">Hasil OCR</Badge>}{p.usedTemplate && <Badge tone="brand">Template: {p.usedTemplate}</Badge>}
          </div>
          {p.note && <p className="rounded-md bg-sunken px-3 py-2 text-sm">{p.note}</p>}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">Akun yang dimiliki mutasi ini
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="font-normal"><option value="">Pilih akun</option>{active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></label>
            <label className="space-y-1.5 text-sm font-medium">Baris judul kolom
              <Select value={mapping.header_row} onChange={(e) => set("header_row", Number(e.target.value))} className="font-normal">
                <option value={-1}>Tidak ada judul</option>{p.table.slice(0, 30).map((r, i) => <option key={i} value={i}>Baris {i + 1}: {r.filter((c) => c !== null && c !== "").slice(0, 4).join(" | ").slice(0, 60)}</option>)}
              </Select></label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FIELDS.map((f) => <label key={f.key} className="space-y-1 text-xs text-muted">{f.label}{colSelect(f.key)}{f.hint && <span className="block text-[11px]">{f.hint}</span>}</label>)}
            <label className="space-y-1 text-xs text-muted">Format tanggal<Select value={mapping.date_format} onChange={(e) => set("date_format", e.target.value as Mapping["date_format"])} className="text-ink"><option value="auto">Otomatis (hari/bulan/tahun)</option><option value="dmy">Hari/Bulan/Tahun</option><option value="mdy">Bulan/Hari/Tahun</option></Select></label>
            <label className="space-y-1 text-xs text-muted">Format angka<Select value={mapping.number_format} onChange={(e) => set("number_format", e.target.value as Mapping["number_format"])} className="text-ink"><option value="auto">Otomatis</option><option value="id">1.250.000,50 (Indonesia)</option><option value="en">1,250,000.50 (Inggris)</option></Select></label>
            {needsPositive && <label className="space-y-1 text-xs text-muted">Nominal positif adalah<Select value={mapping.positive_is ?? ""} onChange={(e) => set("positive_is", (e.target.value || null) as Mapping["positive_is"])} className="text-ink"><option value="">Pilih…</option><option value="income">Pemasukan</option><option value="expense">Pengeluaran</option></Select></label>}
          </div>

          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3 text-sm">
            {p.templates.length > 0 && (
              <label className="space-y-1 text-xs text-muted">Pakai pemetaan tersimpan
                <Select value="" onChange={(e) => { const t = p.templates.find((x) => x.id === Number(e.target.value)); if (t) setMapping(t.mapping); }} className="h-8 w-52 text-sm text-ink"><option value="">Pilih template…</option>{p.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></label>
            )}
            <label className="space-y-1 text-xs text-muted">Simpan pemetaan ini sebagai<Input value={tplName} onChange={(e) => setTplName(e.target.value)} maxLength={40} placeholder="Nama template" className="h-8 w-48 text-sm text-ink" /></label>
            <Button size="sm" variant="secondary" onClick={saveTemplate} disabled={!tplName.trim()}>Simpan</Button>
          </div>

          <div>
            <p className="mb-2 text-sm"><strong>{norm.rows.length}</strong> transaksi terbaca{norm.errors.length > 0 && <>, <strong className="text-warn">{norm.errors.length}</strong> baris bermasalah</>}{norm.skipped > 0 && <>, {norm.skipped} baris bukan transaksi diabaikan</>}.</p>
            {norm.rows.length > 0 ? (
              <div className="max-h-64 overflow-auto rounded border border-line">
                <table className="w-full text-xs"><thead className="sticky top-0 bg-sunken text-left text-muted"><tr><th className="px-3 py-1.5">Baris</th><th className="px-3 py-1.5">Tanggal</th><th className="px-3 py-1.5">Keterangan</th><th className="px-3 py-1.5">Jenis</th><th className="px-3 py-1.5 text-right">Nominal</th></tr></thead>
                  <tbody>{norm.rows.slice(0, 15).map((r) => <tr key={r.row_no} className="border-t border-line"><td className="px-3 py-1.5 text-muted">{r.row_no}</td><td className="whitespace-nowrap px-3 py-1.5">{r.occurred_on}</td><td className="px-3 py-1.5">{r.description}</td><td className="px-3 py-1.5">{r.type === "income" ? <Badge tone="brand">Masuk</Badge> : <Badge>Keluar</Badge>}</td><td className="num px-3 py-1.5 text-right">{formatIDR(r.amount)}</td></tr>)}</tbody></table>
              </div>
            ) : <p className="rounded-md bg-sunken px-3 py-2 text-sm text-muted">Belum ada transaksi yang terbaca. Atur kolom di atas sampai pratinjau terisi.</p>}
            {norm.rows.length > 15 && <p className="mt-1 text-xs text-muted">Menampilkan 15 dari {norm.rows.length} baris.</p>}
            {norm.errors.length > 0 && (
              <details className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm"><summary className="cursor-pointer font-medium text-warn">{norm.errors.length} baris tidak dapat dibaca</summary>
                <ul className="mt-2 max-h-40 list-disc overflow-auto pl-5 text-xs">{norm.errors.slice(0, 50).map((e) => <li key={e.row_no}>Baris {e.row_no}: {e.reason}</li>)}</ul></details>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={commit} disabled={busy !== null || !accountId || norm.rows.length === 0}>{busy === "commit" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}Impor ke kotak masuk</Button>
            <Button variant="ghost" onClick={() => setP(null)}>Batal</Button>
            {!accountId && <span className="text-xs text-muted">Pilih akun terlebih dahulu.</span>}
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------------- history ---------------- */

export function ImportHistory({ batches }: { batches: BatchRow[] }) {
  const [view, setView] = React.useState<BatchRow | null>(null);
  const errors: { row_no: number; reason: string }[] = view?.error_report ? JSON.parse(view.error_report) : [];
  if (batches.length === 0) return <div className="rounded-card border border-line bg-surface p-5"><EmptyState icon={History} title="Belum ada riwayat impor" description="Setiap file mutasi dan gambar struk yang diproses akan tercatat di sini, lengkap dengan jumlah baris, duplikat yang dilewati, dan baris yang gagal dibaca." /></div>;
  const kind: Record<string, string> = { csv: "CSV", xlsx: "XLSX", pdf: "PDF", ocr: "Struk (OCR)" };
  return (
    <>
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-4 py-2.5 font-medium">Waktu</th><th scope="col" className="px-4 py-2.5 font-medium">File</th><th scope="col" className="px-4 py-2.5 font-medium">Akun</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Masuk</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Duplikat</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Gagal</th><th scope="col" className="px-4 py-2.5" /></tr></thead>
          <tbody>{batches.map((b) => (
            <tr key={b.id} className="border-b border-line last:border-0">
              <td className="whitespace-nowrap px-4 py-2.5">{b.created_at.slice(0, 16).replace("T", " ")}</td>
              <td className="px-4 py-2.5"><span className="font-medium">{b.file_name ?? "—"}</span> <Badge>{kind[b.source_type] ?? b.source_type}</Badge></td>
              <td className="px-4 py-2.5">{b.account_name ?? "—"}</td>
              <td className="num px-4 py-2.5 text-right">{b.imported_count}</td><td className="num px-4 py-2.5 text-right">{b.duplicate_count}</td>
              <td className={`num px-4 py-2.5 text-right ${b.error_count ? "text-warn" : ""}`}>{b.error_count}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right"><Link href={`/inbox?status=all&batch=${b.id}`} className="text-brand-text underline">Lihat item</Link>{b.error_count > 0 && <Button size="sm" variant="ghost" onClick={() => setView(b)}>Galat</Button>}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <Dialog open={!!view} onClose={() => setView(null)} title="Baris yang tidak dapat dibaca" description={view?.file_name ?? undefined}>
        <ul className="max-h-72 list-disc space-y-1 overflow-auto pl-5 text-sm">{errors.map((e) => <li key={e.row_no}>Baris {e.row_no}: {e.reason}</li>)}</ul>
        <div className="mt-4 flex justify-end"><Button onClick={() => setView(null)}>Tutup</Button></div>
      </Dialog>
    </>
  );
}
