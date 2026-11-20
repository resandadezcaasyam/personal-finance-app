import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { getDbStatus } from "@/lib/db/status";
import { getDb } from "@/lib/db/client";
import { listCategories } from "@/lib/ledger/categories";
import { CategoryManager } from "@/components/ledger/category-manager";
import { ResetDemoButton } from "@/components/reset-demo-button";
import { AiSettings } from "@/components/ai-settings";
import { loadAiSettings } from "@/lib/capture/ollama";
import { DEFAULT_SETTINGS } from "@/lib/db/defaults";
import { switchProfile } from "./actions";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const s = getDbStatus();
  const demo = s.profile === "demo";
  const categories = listCategories(getDb(), { includeArchived: true });
  const ai = loadAiSettings(getDb());
  return (
    <>
      <PageHeader title="Pengaturan" description="Tampilan, mode demo, dan informasi penyimpanan lokal." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Tampilan</CardTitle></CardHeader>
          <CardBody className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted">Mode terang atau gelap. Pilihan disimpan di browser ini.</p>
            <ThemeToggle />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mode demo</CardTitle>
            <Badge tone={demo ? "warn" : "neutral"}>{demo ? "Aktif" : "Nonaktif"}</Badge>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-muted">
              Mode demo memakai berkas basis data terpisah (<code>demo.db</code>) berisi data fiktif. Data pribadi di <code>finance.db</code> tidak dibaca maupun diubah selama mode ini aktif.
            </p>
            <form action={switchProfile}>
              <input type="hidden" name="profile" value={demo ? "personal" : "demo"} />
              <Button type="submit" variant={demo ? "primary" : "secondary"}>{demo ? "Kembali ke data pribadi" : "Aktifkan mode demo"}</Button>
            </form>
            <ResetDemoButton />
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Regional</CardTitle></CardHeader>
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Mata uang</dt><dd>Rupiah Indonesia ({DEFAULT_SETTINGS.currency})</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Zona waktu</dt><dd>{DEFAULT_SETTINGS.timezone} (WIB)</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Bahasa</dt><dd>Indonesia</dd></div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Penyimpanan data</CardTitle></CardHeader>
          <CardBody className="space-y-2 text-sm">
            <p className="break-all"><span className="text-muted">Berkas aktif: </span>{s.file}</p>
            <p><span className="text-muted">Versi skema: </span>{s.schemaVersion}</p>
            <p className="text-muted">Semua data tersimpan di komputer ini. Cadangan otomatis dibuat di <code>data/backups</code> sebelum migrasi skema.</p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>AI lokal (opsional)</CardTitle><Badge tone={ai.enabled ? "brand" : "neutral"}>{ai.enabled ? "Aktif" : "Nonaktif"}</Badge></CardHeader>
          <CardBody><AiSettings enabled={ai.enabled} url={ai.url} model={ai.model} /></CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Kategori</CardTitle></CardHeader>
          <CardBody><CategoryManager categories={categories} /></CardBody>
        </Card>
      </div>
    </>
  );
}
