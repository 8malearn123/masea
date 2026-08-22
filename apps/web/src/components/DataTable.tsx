interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  isLoading?: boolean;
  empty?: string;
}

export default function DataTable<T extends { id: string }>({
  columns,
  rows,
  isLoading,
  empty = 'لا توجد بيانات',
}: Props<T>) {
  return (
    <div className="card overflow-hidden p-0">
      <table className="w-full text-right text-sm">
        <thead>
          <tr className="border-b border-navy-100 bg-navy-50 text-purple">
            {columns.map((c) => (
              <th key={c.key} className="px-4 py-3 font-semibold">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-purple">
                جارٍ التحميل…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-purple">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-b border-navy-50 last:border-0 hover:bg-navy-50/50">
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-3">
                    {c.render ? c.render(row) : (row as Record<string, unknown>)[c.key] as React.ReactNode}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
