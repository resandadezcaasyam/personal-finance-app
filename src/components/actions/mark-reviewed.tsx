"use client";
import * as React from "react";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast";
import { markReviewedAction } from "@/app/actions/phase7";

export function MarkReviewed() {
  const [pending, start] = React.useTransition();
  const toast = useToast();
  return <Button disabled={pending} onClick={() => start(async () => { const r = await markReviewedAction(); toast(r.ok ? "Tinjauan hari ini ditandai selesai" : r.message ?? "Gagal", r.ok ? "ok" : "error"); })}><CheckCheck className="h-4 w-4" aria-hidden />Tandai sudah ditinjau</Button>;
}
