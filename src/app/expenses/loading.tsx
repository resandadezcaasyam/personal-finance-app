import { PageSkeleton } from "@/components/page-skeleton";

// Not used on /quick-capture, /inbox or /import: a Suspense fallback there would remount the page after a
// revalidating server action and wipe in-progress client state (preview rows, selection, result dialogs).
export default function Loading() { return <PageSkeleton variant="table" />; }
