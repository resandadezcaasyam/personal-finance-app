"use client";
import * as React from "react";
import Link from "next/link";
import { ClipboardPaste, Sparkles, Trash2, Star, Send, CheckCheck, AlertTriangle, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/form-field";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/toast";
import { CategoryOptions } from "@/components/ledger/category-options";
import { createTemplateAction, parseCaptureAction, postDraftsAction, type DraftView } from "@/app/actions/capture";
import { parseCaptureAiAction } from "@/app/actions/phase7";
import { parseIDR } from "@/lib/format";
import type { AccountWithBalance, CategoryRow } from "@/lib/ledger/types";
import type { TemplateRow } from "@/lib/capture/templates";

interface Row {
  key: string; type: "expense" | "income" | "transfer"; amount_text: string; occurred_on: string; description: string; merchant: string; account_id: number | null;
  to_account_id: number | null; category_id: number | null; category_source: "rule" | "user" | "parser" | null; confidence: number; issues: string[]; duplicate: boolean; match_label: string | null;
}

const EXAMPLES = ["kopi 25rb gopay", "makan 30k cash", "gaji masuk 9.5jt seabank", "bayar listrik 150rb bca", "beli kopi 25rb sama makan siang 35rb", "transfer 500rb dari bca ke gopay"];
let counter = 0;
const toRow = (d: DraftView): Row => ({
  key: `${d.key}-${counter++}`, type: d.type, amount_text: d.amount ? String(d.amount) : "", occurred_on: d.occurred_on, description: d.description, merchant: d.merchant ?? "", account_id: d.account_id,
  to_account_id: d.to_account_id, category_id: d.category_id, category_source: d.category_source, confidence: d.confidence, issues: d.issues, duplicate: d.duplicate, match_label: d.match_label,
});

export function QuickCapture({ accounts, categories, templates, today, aiEnabled = false }: { accounts: AccountWithBalance[]; categories: CategoryRow[]; templates: TemplateRow[]; today: string; aiEnabled?: boolean }) {
  const [text, setText] = React.useState("");
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [msg, setMsg] = React.useState<string>();
  const [notice, setNotice] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  const [tplFor, setTplFor] = React.useState<Row | null>(null);
  const [tplName, setTplName] = React.useState("");
  const [tplErr, setTplErr] = React.useState<string>();
  const [done, setDone] = React.useState<{ posted: number; queued: number } | null>(null);
  const toast = useToast();
  const active = accounts.filter((a) => !a.is_archived);

  const read = (input = text, ai = false) => startTransition(async () => {
    setMsg(undefined); setNotice(undefined); setDone(null);
    const r = ai ? await parseCaptureAiAction(input) : await parseCaptureAction(input);
    if (ai && r.ok) setNotice(r.message ?? "Dibaca dengan AI lokal. Periksa setiap baris sebelum dicatat.");
    if (!r.ok) { setRows(null); setMsg(r.message); return; }
    setRows(r.drafts.map(toRow));
  });

  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) { toast("Clipboard kosong atau bukan teks.", "error"); return; }
      setText(t); read(t);
    } catch { toast("Browser tidak mengizinkan membaca clipboard. Tempel manual dengan Ctrl+V di kolom teks.", "error"); }
  };

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs && rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const addTemplate = (t: TemplateRow) => setRows((rs) => [...(rs ?? []), {
    key: `t${t.id}-${counter++}`, type: t.type, amount_text: t.amount ? String(t.amount) : "", occurred_on: today, description: t.description || t.name, merchant: t.merchant ?? "", account_id: t.account_id ?? (active.length === 1 ? active[0].id : null),
    to_account_id: null, category_id: t.category_id, category_source: t.category_id ? "user" : null, confidence: 1, issues: t.amount ? [] : ["Isi nominal"], duplicate: false, match_label: null,
  }]);

  const problems = (r: Row, mode: "now" | "inbox") => {
    const out: string[] = [];
    const amt = r.amount_text.trim() ? parseIDR(r.amount_text) : null;
    if (r.amount_text.trim() && amt === null) out.push("Nominal tidak valid");
    if (mode === "now") {
      if (!amt) out.push("Nominal wajib");
      if (!r.account_id) out.push(r.type === "transfer" ? "Pilih akun asal" : "Pilih akun");
      if (r.type === "transfer" && (!r.to_account_id || r.to_account_id === r.account_id)) out.push("Pilih akun tujuan yang berbeda");
    }
    if (mode === "inbox" && r.type === "transfer") out.push("Transfer hanya bisa dicatat langsung");
    return out;
  };
  const blockers = (mode: "now" | "inbox") => (rows ?? []).flatMap((r) => problems(r, mode));

  const send = (mode: "now" | "inbox") => startTransition(async () => {
    if (!rows) return;
    const payload = rows.map((r) => ({ type: r.type, amount_text: r.amount_text, occurred_on: r.occurred_on, description: r.description, merchant: r.merchant.trim() || null, account_id: r.account_id, to_account_id: r.type === "transfer" ? r.to_account_id : null, category_id: r.type === "transfer" ? null : r.category_id, category_source: r.category_source, confidence: r.confidence }));
    const res = await postDraftsAction(JSON.stringify(payload), mode);
    if (!res.ok) { setMsg(res.message); return; }
    setDone({ posted: res.posted ?? 0, queued: res.queued ?? 0 });
    toast(mode === "now" ? `${res.posted} transaksi dicatat` : `${res.queued} item masuk kotak masuk`);
    setRows(null); setText(""); setMsg(undefined);
  });

  const saveTemplate = () => startTransition(async () => {
    if (!tplFor) return;
    const fd = new FormData();
    fd.set("name", tplName); fd.set("type", tplFor.type === "income" ? "income" : "expense"); fd.set("amount", tplFor.amount_text); fd.set("account_id", String(tplFor.account_id ?? ""));
    fd.set("category_id", String(tplFor.category_id ?? "")); fd.set("description", tplFor.description); fd.set("merchant", tplFor.merchant);
    const r = await createTemplateAction({ ok: false }, fd);
    if (r.ok) { toast("Template disimpan"); setTplFor(null); setTplName(""); setTplErr(undefined); } else setTplErr(r.message);
  });

  return (
    <div className="space-y-6">
      <section className="rounded-card border border-line bg-surface p-5">
        <label htmlFor="qc-text" className="text-sm font-medium">Ketik transaksi dengan bahasa sehari-hari</label>
        <Textarea id="qc-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} className="mt-2" placeholder={"kopi 25rb gopay\nmakan 30k cash\ngaji masuk 9.5jt seabank"}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") read(); }} />
        <p className="mt-1 text-xs text-muted">Satu baris per transaksi, atau pisahkan dengan &ldquo;sama&rdquo;, &ldquo;dan&rdquo;, atau &ldquo;;&rdquo;. Tanggal opsional: kemarin, 17/11, tgl 3. Ctrl+Enter untuk membaca.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => read()} disabled={pending || !text.trim()}><Sparkles className="h-4 w-4" aria-hidden />{pending ? "Membaca…" : "Baca"}</Button>
          <Button variant="secondary" onClick={paste} disabled={pending}><ClipboardPaste className="h-4 w-4" aria-hidden />Tempel dari clipboard</Button>
          {aiEnabled && <Button variant="secondary" onClick={() => read(text, true)} disabled={pending || !text.trim()} title="Memakai Ollama di komputer ini. Jika tidak tersedia, dipakai pembaca bawaan."><Sparkles className="h-4 w-4" aria-hidden />Baca dengan AI lokal</Button>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">Contoh:</span>
          {EXAMPLES.map((e) => <button key={e} type="button" onClick={() => setText(e)} className="rounded-full border border-line px-2.5 py-1 hover:bg-sunken">{e}</button>)}
        </div>
        {templates.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-4 text-sm">
            <span className="flex items-center gap-1 text-muted"><Star className="h-3.5 w-3.5" aria-hidden />Template favorit:</span>
            {templates.map((t) => <Button key={t.id} size="sm" variant="secondary" onClick={() => addTemplate(t)}>{t.name}{t.amount ? ` · ${(t.amount / 1000).toLocaleString("id-ID")}rb` : ""}</Button>)}
          </div>
        )}
      </section>

      {notice && <p role="status" className="rounded-md border border-line bg-sunken px-3 py-2 text-sm">{notice}</p>}
      {msg && <p role="alert" className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{msg}</p>}
      {done && (
        <p role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand">
          <CheckCheck className="h-4 w-4" aria-hidden />{done.posted > 0 && `${done.posted} transaksi sudah dicatat. `}{done.queued > 0 && `${done.queued} item menunggu di kotak masuk. `}
          <Link href={done.queued ? "/inbox" : "/transactions"} className="font-medium underline">{done.queued ? "Buka kotak masuk" : "Lihat transaksi"}</Link>
        </p>
      )}

      {rows && (
        <section aria-label="Pratinjau" className="space-y-3">
          <h2 className="font-display text-xl font-semibold">Pratinjau ({rows.length})</h2>
          <p className="text-sm text-muted">Periksa dan ubah bila perlu. Belum ada yang tercatat sampai Anda menekan tombol di bawah.</p>
          {rows.map((r, idx) => {
            return (
              <div key={r.key} className="rounded-card border border-line bg-surface p-4">
                <div className="grid gap-3 sm:grid-cols-6">
                  <label className="space-y-1 text-xs text-muted sm:col-span-1">Jenis
                    <Select value={r.type} onChange={(e) => patch(r.key, { type: e.target.value as Row["type"], category_id: null, category_source: null })} className="text-ink">
                      <option value="expense">Pengeluaran</option><option value="income">Pemasukan</option><option value="transfer">Transfer</option>
                    </Select></label>
                  <label className="space-y-1 text-xs text-muted sm:col-span-1">Nominal
                    <Input value={r.amount_text} onChange={(e) => patch(r.key, { amount_text: e.target.value })} inputMode="numeric" aria-invalid={r.amount_text.trim() !== "" && parseIDR(r.amount_text) === null} className="text-ink" /></label>
                  <label className="space-y-1 text-xs text-muted sm:col-span-1">Tanggal
                    <Input type="date" value={r.occurred_on} max={today} onChange={(e) => patch(r.key, { occurred_on: e.target.value })} className="text-ink" /></label>
                  <label className="space-y-1 text-xs text-muted sm:col-span-3">{r.type === "transfer" ? "Catatan" : "Deskripsi"}
                    <Input value={r.description} onChange={(e) => patch(r.key, { description: e.target.value })} maxLength={200} className="text-ink" /></label>
                  <label className="space-y-1 text-xs text-muted sm:col-span-2">{r.type === "transfer" ? "Dari akun" : r.type === "income" ? "Masuk ke akun" : "Dibayar dari akun"}
                    <Select value={r.account_id ?? ""} onChange={(e) => patch(r.key, { account_id: e.target.value ? Number(e.target.value) : null })} className="text-ink"><option value="">Pilih akun</option>{active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></label>
                  {r.type === "transfer" ? (
                    <label className="space-y-1 text-xs text-muted sm:col-span-2">Ke akun
                      <Select value={r.to_account_id ?? ""} onChange={(e) => patch(r.key, { to_account_id: e.target.value ? Number(e.target.value) : null })} className="text-ink"><option value="">Pilih akun</option>{active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></label>
                  ) : (
                    <>
                      <label className="space-y-1 text-xs text-muted sm:col-span-2">Kategori
                        <Select value={r.category_id ?? ""} onChange={(e) => patch(r.key, { category_id: e.target.value ? Number(e.target.value) : null, category_source: e.target.value ? "user" : null })} className="text-ink"><CategoryOptions categories={categories} kind={r.type} selectedId={r.category_id} /></Select></label>
                      <label className="space-y-1 text-xs text-muted sm:col-span-2">Merchant
                        <Input value={r.merchant} onChange={(e) => patch(r.key, { merchant: e.target.value })} maxLength={100} className="text-ink" /></label>
                    </>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {r.category_source === "rule" && r.category_id && <Badge tone="brand">Kategori dari aturan</Badge>}
                  {r.issues.map((i) => <Badge key={i} tone="warn">{i}</Badge>)}
                  {r.duplicate && <Badge tone="loss"><AlertTriangle className="mr-1 h-3 w-3" aria-hidden />Mirip transaksi yang sudah ada</Badge>}
                  {r.match_label && <Badge tone="brand"><Link2 className="mr-1 h-3 w-3" aria-hidden />Akan dicatat sebagai pembayaran {r.match_label}</Badge>}
                  <span className="ml-auto flex gap-1">
                    {r.type !== "transfer" && <Button size="sm" variant="ghost" onClick={() => { setTplFor(r); setTplName(r.description.slice(0, 40)); setTplErr(undefined); }}><Star className="h-3.5 w-3.5" aria-hidden />Jadikan template</Button>}
                    <Button size="sm" variant="ghost" aria-label={`Hapus baris ${idx + 1}`} onClick={() => setRows((rs) => (rs ? rs.filter((x) => x.key !== r.key) : rs))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                  </span>
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => send("now")} disabled={pending || rows.length === 0 || blockers("now").length > 0}><CheckCheck className="h-4 w-4" aria-hidden />Catat sekarang ({rows.length})</Button>
            <Button variant="secondary" onClick={() => send("inbox")} disabled={pending || rows.length === 0 || blockers("inbox").length > 0}><Send className="h-4 w-4" aria-hidden />Kirim ke kotak masuk</Button>
            {blockers("now").length > 0 && <span className="text-xs text-muted">Lengkapi nominal dan akun di setiap baris untuk mencatat sekarang.</span>}
          </div>
        </section>
      )}

      <Dialog open={!!tplFor} onClose={() => setTplFor(null)} title="Simpan sebagai template favorit" description="Template menyimpan jenis, nominal, akun, kategori, dan deskripsi untuk dipakai ulang dengan satu klik.">
        <div className="space-y-3">
          <label className="block space-y-1.5 text-sm font-medium">Nama template<Input value={tplName} onChange={(e) => setTplName(e.target.value)} maxLength={40} autoFocus /></label>
          {tplErr && <p role="alert" className="text-sm text-loss">{tplErr}</p>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setTplFor(null)}>Batal</Button><Button onClick={saveTemplate} disabled={pending || !tplName.trim()}>Simpan</Button></div>
        </div>
      </Dialog>
    </div>
  );
}
