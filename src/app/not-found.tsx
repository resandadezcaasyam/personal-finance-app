import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";

export default function NotFound() {
  return (
    <Card>
      <CardBody className="space-y-2">
        <h1 className="text-lg font-semibold">Halaman tidak ditemukan</h1>
        <p className="text-sm text-muted">Fitur ini mungkin belum tersedia pada fase pengembangan saat ini.</p>
        <Link href="/" className="text-sm font-medium text-brand underline">Kembali ke dasbor</Link>
      </CardBody>
    </Card>
  );
}
