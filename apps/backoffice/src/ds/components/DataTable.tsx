import './DataTable.css';
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  width?: string | number;
  align?: 'left' | 'right' | 'center';
  render: (row: T, idx: number) => ReactNode;
}

type DataTableProps<T extends object> = {
  columns: Array<Column<T>>;
  rows: T[];
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyState?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
};

export function DataTable<T extends object>({
  columns, rows, onRowClick, loading, emptyState, rowClassName,
}: DataTableProps<T>) {
  return (
    <table>
      <thead>
        <tr>
          {columns.map(col => (
            <th key={col.key} style={{ width: col.width, textAlign: col.align ?? 'left' }}>
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {loading ? (
          [0, 1, 2].map(i => (
            <tr key={i}>
              {columns.map(col => (
                <td key={col.key}><div className="ds-skeleton" /></td>
              ))}
            </tr>
          ))
        ) : rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length}>
              <div className="empty-state">{emptyState ?? 'Nenhum resultado.'}</div>
            </td>
          </tr>
        ) : (
          rows.map((row, idx) => (
            <tr
              key={idx}
              className={rowClassName?.(row)}
              style={{ cursor: onRowClick ? 'pointer' : undefined }}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map(col => (
                <td key={col.key} style={{ textAlign: col.align ?? 'left' }}>
                  {col.render(row, idx)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
