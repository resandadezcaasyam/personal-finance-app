import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: T) => React.ReactNode;
}

export function DataTable<T>({ columns, rows, rowKey, empty }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string | number; empty: React.ReactNode }) {
  if (rows.length === 0) return <div className="px-5 py-4">{empty}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("px-5 py-2.5 font-medium", c.align === "right" && "text-right")}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-line last:border-0">
              {columns.map((c) => (
                <td key={c.key} className={cn("px-5 py-3", c.align === "right" && "num whitespace-nowrap text-right")}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
