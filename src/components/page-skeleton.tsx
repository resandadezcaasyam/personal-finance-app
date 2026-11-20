/**
 * Loading placeholders that mirror the real layout (header, KPI cards, content block) so the page does not jump when data
 * arrives. Only for routes whose client state is disposable (dialogs/forms that close after saving) or that have no client
 * state at all. NOT for /quick-capture, /inbox, /import (a fallback there would wipe in-progress client state).
 */
const bar = "animate-pulse rounded-md bg-sunken";

function Header() {
  return (
    <div className="mb-6 space-y-2">
      <div className={`h-8 w-64 ${bar}`} />
      <div className={`h-4 w-full max-w-md ${bar}`} />
    </div>
  );
}

function KpiRow({ n = 4 }: { n?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="rounded-card border border-line bg-surface p-5 shadow-card">
          <div className="flex items-center gap-3"><div className={`h-10 w-10 rounded-xl ${bar}`} /><div className={`h-3.5 w-28 ${bar}`} /></div>
          <div className={`mt-5 h-8 w-40 ${bar}`} />
          <div className={`mt-3 h-3 w-32 ${bar}`} />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton({ variant = "kpis" }: { variant?: "kpis" | "chart" | "table" }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <Header />
      <KpiRow />
      {variant === "chart" && (
        <div className="mt-5 rounded-card border border-line bg-surface p-5 shadow-card">
          <div className={`mb-5 h-4 w-48 ${bar}`} />
          <div className={`h-64 w-full ${bar}`} />
        </div>
      )}
      {variant === "table" && (
        <div className="mt-5 space-y-3 rounded-card border border-line bg-surface p-5 shadow-card">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className={`h-9 w-full ${bar}`} />)}
        </div>
      )}
      <span className="sr-only">Memuat…</span>
    </div>
  );
}
