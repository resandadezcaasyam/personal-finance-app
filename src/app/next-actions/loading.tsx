import { PageSkeleton } from "@/components/page-skeleton";

// The only client state here is a button, so a loading fallback is safe.
export default function Loading() { return <PageSkeleton variant="table" />; }
