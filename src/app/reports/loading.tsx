import { PageSkeleton } from "@/components/page-skeleton";

// Reports is read-only (period and export are plain links), so a loading fallback never wipes client state.
export default function Loading() { return <PageSkeleton variant="chart" />; }
