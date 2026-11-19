import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type DataTableColumn<Row> = {
  key: string;
  header: string;
  className?: string;
  render: (row: Row) => ReactNode;
};

export function DataTable<Row extends { id: string }>({
  rows,
  columns,
  empty,
}: {
  rows: Row[];
  columns: DataTableColumn<Row>[];
  empty: ReactNode;
}) {
  if (!rows.length) return <div role="status">{empty}</div>;

  return (
    <div className="border-border overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
          <tr>
            {columns.map((column) => (
              <th
                className={cn("px-3 py-2 font-medium", column.className)}
                key={column.key}
                scope="col"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {rows.map((row) => (
            <tr className="hover:bg-muted/30" key={row.id}>
              {columns.map((column) => (
                <td
                  className={cn("px-3 py-3 align-middle", column.className)}
                  key={column.key}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
