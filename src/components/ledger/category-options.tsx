import type { CategoryRow } from "@/lib/ledger/types";

/** Grouped <option>s: each parent heads its own group, followed by its subcategories. */
export function CategoryOptions({ categories, kind, selectedId, emptyLabel = "Tanpa kategori", prefix = "" }: {
  categories: CategoryRow[]; kind: "income" | "expense"; selectedId?: number | null; emptyLabel?: string | null; prefix?: string;
}) {
  const ofKind = categories.filter((c) => c.kind === kind && (!c.is_archived || c.id === selectedId));
  const parents = ofKind.filter((c) => c.parent_id === null);
  return (
    <>
      {emptyLabel !== null && <option value="">{emptyLabel}</option>}
      {parents.map((p) => {
        const kids = ofKind.filter((c) => c.parent_id === p.id);
        if (kids.length === 0) return <option key={p.id} value={p.id}>{prefix}{p.name}</option>;
        return (
          <optgroup key={p.id} label={`${prefix}${p.name}`}>
            <option value={p.id}>{prefix}{p.name} (umum)</option>
            {kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </optgroup>
        );
      })}
    </>
  );
}
