/**
 * Shared data table used across ERP list screens (sales, planning, QA, etc.).
 * Navy-accent plant board: sticky header, zebra rows, hairline rules, scannable.
 */
import type { ReactNode } from 'react';

export type DataTableAlign = 'left' | 'right' | 'center';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: DataTableAlign;
  /** Optional width hint, e.g. "w-28" or "min-w-[8rem]" */
  className?: string;
  headerClassName?: string;
  cell: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /** Slightly tighter row padding */
  dense?: boolean;
  className?: string;
  /** Optional caption above the table (inside the card chrome) */
  title?: string;
  /** Optional trailing control in the title bar (search, filters, etc. live outside) */
  toolbar?: ReactNode;
}

const alignCls: Record<DataTableAlign, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

/** Format ISO / YYYY-MM-DD dates for table cells (en-IN). */
export function formatTableDate(value?: string | null): string {
  if (!value) return '—';
  const raw = value.includes('T') ? value : `${value}T00:00:00`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function SkeletonRows({ cols, dense }: { cols: number; dense?: boolean }) {
  const h = dense ? 'h-3' : 'h-3.5';
  return (
    <div className="px-4 py-3 space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-3 items-center animate-pulse">
          {Array.from({ length: cols }).map((__, j) => (
            <div
              key={j}
              className={`${h} rounded bg-slate-100 dark:bg-slate-800 ${j === 0 ? 'w-[22%]' : j === cols - 1 ? 'w-[12%] ml-auto' : 'flex-1'}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  onRowClick,
  dense,
  className = '',
  title,
  toolbar,
}: DataTableProps<T>) {
  const pad = dense ? 'py-2 px-3' : 'py-3 px-3.5';
  const clickable = Boolean(onRowClick);

  return (
    <div
      className={[
        'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl',
        'overflow-hidden',
        className,
      ].join(' ')}
    >
      {(title || toolbar) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            {title && (
              <>
                <span className="h-4 w-1 rounded-full bg-blue-600 dark:bg-slate-300 shrink-0" aria-hidden />
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate normal-case tracking-normal">
                  {title}
                </h3>
              </>
            )}
            {!loading && rows.length > 0 && (
              <span className="shrink-0 text-[11px] font-medium tabular-nums text-slate-400">
                {rows.length}
              </span>
            )}
          </div>
          {toolbar}
        </div>
      )}

      {loading ? (
        <SkeletonRows cols={Math.min(columns.length, 5)} dense={dense} />
      ) : rows.length === 0 ? (
        <div className="px-4 py-8">{empty ?? (
          <div className="py-4 text-center text-sm text-slate-400">No rows.</div>
        )}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px] border-collapse">
            <thead className="sticky top-0 z-[1]">
              <tr className="bg-slate-50/95 dark:bg-slate-950/90 backdrop-blur-sm border-b border-slate-200 dark:border-slate-800">
                {columns.map((col, ci) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={[
                      pad,
                      'text-[11px] font-medium text-slate-500 dark:text-slate-400',
                      'whitespace-nowrap select-none normal-case tracking-normal',
                      alignCls[col.align ?? 'left'],
                      col.headerClassName ?? '',
                      col.className ?? '',
                      ci === 0 ? 'pl-4 sm:pl-5' : '',
                      ci === columns.length - 1 ? 'pr-4 sm:pr-5' : '',
                    ].join(' ')}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr
                  key={rowKey(row)}
                  onClick={clickable ? () => onRowClick?.(row) : undefined}
                  className={[
                    'group border-b border-slate-100 dark:border-slate-800/80 last:border-b-0',
                    'transition-colors duration-100',
                    ri % 2 === 1 ? 'bg-slate-50/60 dark:bg-slate-950/40' : 'bg-white dark:bg-slate-900',
                    clickable
                      ? 'cursor-pointer hover:bg-blue-600/[0.04] dark:hover:bg-slate-800'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                  ].join(' ')}
                >
                  {columns.map((col, ci) => (
                    <td
                      key={col.key}
                      className={[
                        pad,
                        'align-middle text-slate-700 dark:text-slate-200 relative',
                        alignCls[col.align ?? 'left'],
                        col.className ?? '',
                        ci === 0 ? 'pl-4 sm:pl-5 font-medium text-slate-800 dark:text-slate-100' : '',
                        ci === columns.length - 1 ? 'pr-4 sm:pr-5' : '',
                        col.align === 'right' ? 'tabular-nums font-mono text-[12px]' : '',
                      ].join(' ')}
                    >
                      {clickable && ci === 0 && (
                        <span
                          className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-blue-600 opacity-0 group-hover:opacity-100 transition-opacity dark:bg-slate-300"
                          aria-hidden
                        />
                      )}
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default DataTable;
