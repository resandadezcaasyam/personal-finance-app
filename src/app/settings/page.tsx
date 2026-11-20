import Link from "next/link";
import { Palette, Database, ShieldCheck, Sparkles, Tags, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { getDbStatus } from "@/lib/db/status";
import { getDb } from "@/lib/db/client";
import { listCategories } from "@/lib/ledger/categories";
import { CategoryManager } from "@/components/ledger/category-manager";
import { ResetDemoButton } from "@/components/reset-demo-button";
import { AiSettings } from "@/components/ai-settings";
import { SecuritySettings } from "@/components/security-settings";
import { isAuthEnabled } from "@/lib/auth/store";
import { loadAiSettings } from "@/lib/capture/ollama";
import { DEFAULT_SETTINGS } from "@/lib/db/defaults";
import { switchProfile } from "./actions";

export const dynamic = "force-dynamic";

const SECTIONS = [["tampilan", "Tampilan & regional"], ["data", "Data & mode demo"], ["keamanan", "Keamanan"], ["ai", "AI lokal"], ["kategori", "Kategori"]] as const;

export default function SettingsPage() {
  const s = getDbStatus();
  const demo = s.profile === "demo";
  const categories = listCategories(getDb(), { includeArchived: true });
  const ai = loadAiSettings(getDb());
  const pin = isAuthEnabled();
  return (
    <>
      <PageHeader title="Pengaturan" description="Tampilan, data, keamanan, AI lokal, dan kategori. Semuanya tersimpan di komputer ini." />
      <div className="grid gap-6 xl:grid-cols-[12.5rem_minmax(0,1fr)]">
        <nav aria-label="Bagian pengaturan" className="min-w-0 xl:sticky xl:top-20 xl:self-start">
          <ul className="flex gap-1 overflow-x-auto pb-1 xl:flex-col xl:overflow-visible xl:pb-0">
            {SECTIONS.map(([id, label]) => <li key={id} className="shrink-0"><a href={`#${id}`} className="block whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:bg-sunken hover:text-ink">{label}</a></li>)}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          <SettingsSection id="tampilan" icon={Palette} title="Tampilan & regional" description="Tema aplikasi dan format yang dipakai di seluruh halaman.">
            <div className="flex items-center justify-between gap-4 rounded-xl bg-sunken/60 px-4 py-3">
              <div><p className="text-sm font-medium">Tema</p><p className="text-[13px] text-muted">Mode terang atau gelap. Pilihan disimpan di browser ini.</p></div>
              <ThemeToggle />
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-xl border border-line px-4 py-3"><dt className="text-xs text-muted">Mata uang</dt><dd className="mt-0.5 font-medium">Rupiah Indonesia ({DEFAULT_SETTINGS.currency})</dd></div>
              <div className="rounded-xl border border-line px-4 py-3"><dt className="text-xs text-muted">Zona waktu</dt><dd className="mt-0.5 font-medium">{DEFAULT_SETTINGS.timezone} (WIB)</dd></div>
              <div className="rounded-xl border border-line px-4 py-3"><dt className="text-xs text-muted">Bahasa</dt><dd className="mt-0.5 font-medium">Indonesia</dd></div>
            </dl>
          </SettingsSection>

          <SettingsSection id="data" icon={Database} title="Data & mode demo" description="Di mana data Anda disimpan, dan cara mencoba aplikasi dengan data fiktif." badge={<Badge tone={demo ? "warn" : "neutral"}>{demo ? "Mode demo aktif" : "Data pribadi"}</Badge>}>
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Mode demo</h3>
                <p className="text-[13px] leading-5 text-muted">Mode demo memakai berkas basis data terpisah (<code>demo.db</code>) berisi data fiktif. Data pribadi di <code>finance.db</code> tidak dibaca maupun diubah selama mode ini aktif.</p>
                <form action={switchProfile}>
                  <input type="hidden" name="profile" value={demo ? "personal" : "demo"} />
                  <Button type="submit" variant={demo ? "primary" : "secondary"}>{demo ? "Kembali ke data pribadi" : "Aktifkan mode demo"}</Button>
                </form>
                <ResetDemoButton />
              </div>
              <div className="space-y-3 border-line lg:border-l lg:pl-5">
                <h3 className="text-sm font-semibold">Penyimpanan data</h3>
                <dl className="space-y-1.5 text-[13px]">
                  <div className="flex gap-2"><dt className="shrink-0 text-muted">Berkas aktif</dt><dd className="min-w-0 break-all">{s.file}</dd></div>
                  <div className="flex gap-2"><dt className="shrink-0 text-muted">Versi skema</dt><dd className="num">{s.schemaVersion}</dd></div>
                </dl>
                <p className="text-[13px] leading-5 text-muted">Semua data tersimpan di komputer ini. Cadangan otomatis dibuat di <code>data/backups</code> sebelum migrasi skema.</p>
                <Link href="/backup" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-text hover:underline">Cadangan &amp; Kesehatan Data<ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
              </div>
            </div>
          </SettingsSection>

          <SettingsSection id="keamanan" icon={ShieldCheck} title="Keamanan (PIN)" description="Kunci aplikasi dengan PIN. Ini bukan enkripsi basis data." badge={<Badge tone={pin ? "brand" : "neutral"}>{pin ? "PIN aktif" : "PIN nonaktif"}</Badge>}>
            <SecuritySettings enabled={pin} />
          </SettingsSection>

          <SettingsSection id="ai" icon={Sparkles} title="AI lokal (opsional)" description="Membaca kalimat bebas di Catat Cepat. Nonaktif secara default dan tidak pernah dipakai untuk perhitungan." badge={<Badge tone={ai.enabled ? "brand" : "neutral"}>{ai.enabled ? "Aktif" : "Nonaktif"}</Badge>}>
            <AiSettings enabled={ai.enabled} url={ai.url} model={ai.model} />
          </SettingsSection>

          <SettingsSection id="kategori" icon={Tags} title="Kategori" description="Kategori dan subkategori untuk pemasukan dan pengeluaran. Kategori diarsipkan, bukan dihapus, agar riwayat tetap utuh.">
            <CategoryManager categories={categories} />
          </SettingsSection>
        </div>
      </div>
    </>
  );
}
