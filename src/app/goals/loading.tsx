import { PageSkeleton } from "@/components/page-skeleton";

// Goal dialogs close after saving, so their state is disposable.
export default function Loading() { return <PageSkeleton variant="table" />; }
