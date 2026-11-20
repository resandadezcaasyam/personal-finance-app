export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <div className="h-8 w-56 animate-pulse rounded-md bg-sunken" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-card bg-sunken" />)}
      </div>
      <span className="sr-only">Memuat…</span>
    </div>
  );
}
