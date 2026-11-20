import Link from "next/link";

export function Pagination({ basePath, params, page, pageSize, total }: { basePath: string; params: Record<string, string | undefined>; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set("page", String(p));
    return `${basePath}?${q}`;
  };
  const cls = "inline-flex h-8 items-center rounded-md border border-line px-3 text-sm hover:bg-sunken";
  return (
    <nav aria-label="Halaman" className="mt-4 flex items-center justify-between text-sm">
      <span className="text-muted">Halaman {page} dari {pages}</span>
      <div className="flex gap-2">
        {page > 1 ? <Link className={cls} href={href(page - 1)}>Sebelumnya</Link> : <span className={`${cls} opacity-40`} aria-disabled>Sebelumnya</span>}
        {page < pages ? <Link className={cls} href={href(page + 1)}>Berikutnya</Link> : <span className={`${cls} opacity-40`} aria-disabled>Berikutnya</span>}
      </div>
    </nav>
  );
}
