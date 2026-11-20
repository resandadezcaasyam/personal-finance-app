import { Landmark, TrendingUp, TrendingDown, Scale, PieChart, ArrowLeftRight, Database, Wallet } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { getDbStatus } from "@/lib/db/status";
import { formatDateID, todayWIB, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

const METRICS = [
  { label: "Total kas", icon: Wallet },
  { label: "Pemasukan bulan ini", icon: TrendingUp },
  { label: "Pengeluaran bulan ini", icon: TrendingDown },
  { label: "Arus kas bersih", icon: Scale },
];

export default function DashboardPage() {
  const s = getDbStatus();
  return (
    <>
      <PageHeader title="Dasbor" description={`Hari ini, ${formatDateID(todayWIB())} (WIB)`} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {METRICS.map(({ label, icon: Icon }) => (
          <Card key={label}>
            <CardBody>
              <div className="flex items-center justify-between text-sm text-muted">
                {label}
                <Icon className="h-4 w-4" aria-hidden />
              </div>
              <p className="num mt-3 text-2xl font-semibold text-muted" aria-label="Belum ada data">—</p>
              <p className="mt-1 text-xs text-muted">Belum ada data · aktif di Fase 2</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Transaksi terbaru</CardTitle></CardHeader>
          <CardBody>
            <EmptyState
              icon={ArrowLeftRight}
              title="Belum ada transaksi"
              description="Pencatatan akun, pemasukan, dan pengeluaran dibuka di Fase 2. Tidak ada angka yang dikarang di sini; dasbor hanya menampilkan data yang benar-benar tercatat."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Saldo akun</CardTitle></CardHeader>
          <CardBody>
            <EmptyState
              icon={Landmark}
              title="Belum ada akun"
              description="Tambahkan akun seperti BCA, SeaBank, atau tunai setelah modul akun tersedia."
            />
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Rincian pengeluaran</CardTitle></CardHeader>
          <CardBody>
            <EmptyState icon={PieChart} title="Belum ada pengeluaran" description="Grafik kategori muncul setelah ada pengeluaran yang dicatat." />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status basis data</CardTitle>
            <Badge tone={s.profile === "demo" ? "warn" : "brand"}>{s.profile === "demo" ? "Demo" : "Pribadi"}</Badge>
          </CardHeader>
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-muted">Versi skema</dt><dd className="num">{s.schemaVersion}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Akun aktif</dt><dd className="num">{formatNumber(s.accounts)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Transaksi</dt><dd className="num">{formatNumber(s.transactions)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Ukuran</dt><dd className="num">{formatNumber(Math.round(s.sizeBytes / 1024))} KB</dd></div>
            </dl>
            <p className="mt-3 flex items-start gap-2 text-xs text-muted"><Database className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span className="break-all">{s.file}</span></p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
