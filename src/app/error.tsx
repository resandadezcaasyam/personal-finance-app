"use client";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <AlertTriangle className="h-5 w-5 text-loss" aria-hidden />
        <h1 className="text-lg font-semibold">Halaman tidak dapat dimuat</h1>
        <p className="text-sm text-muted">Data Anda aman di komputer ini. Detail teknis: {error.message}</p>
        <Button onClick={reset}>Coba lagi</Button>
      </CardBody>
    </Card>
  );
}
