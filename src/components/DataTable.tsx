/**
 * Shared data table used across ERP list screens (sales, planning, QA, etc.).
 * Desktop: sticky-header table. Mobile (< md): stacked cards.
 */
import type { ReactNode } from 'react';
import { useIsNarrow } from '../hooks/useIsNarrow';

export type DataTableAlign = 'left' | 'right' | 'center';

export type DataTableMobileRole = 'title' | 'subtitle' | 'badge' | 'meta' | 'action' | 'hide';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: DataTableAlign;
  /** Optional width hint, e.g. "w-28" or "min-w-[8rem]" */
  className?: string;
  headerClassName?: string;
  cell: (row: T) => ReactNode;
  /** How this column appears in the mobile card layout */
  mobile?: DataTableMobileRole;
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

function resolveMobileRole<T>(col: DataTableColumn<T>, index: number, columns: DataTableColumn<T>[]): DataTableMobileRole {
  if (col.mobile) return col.mobile;
  if (index === 0) return 'title';
  if (index === 1) return 'subtitle';
  // Heuristic: last column often holds actions
  if (index === columns.length - 1 && columns.length > 2) return 'action';
  return 'meta';
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

function SkeletonCards() {
  return (
    <div className="p-3 space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2 animate-pulse">
          <div className="h-4 w-2/3 rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-3 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-3 w-full rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}

function MobileCardList<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}) {
  const clickable = Boolean(onRowClick);
  const roles = columns.map((col, i) => resolveMobileRole(col, i, columns));

  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {rows.map((row) => {
        const titleCols = columns.filter((_, i) => roles[i] === 'title');
        const subtitleCols = columns.filter((_, i) => roles[i] === 'subtitle');
        const badgeCols = columns.filter((_, i) => roles[i] === 'badge');
        const metaCols = columns.filter((_, i) => roles[i] === 'meta');
        const actionCols = columns.filter((_, i) => roles[i] === 'action');

        return (
          <div
            key={rowKey(row)}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => onRowClick?.(row) : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onRowClick?.(row);
                    }
                  }
                : undefined
            }
            className={[
              'px-4 py-3.5 text-left transition-colors',
              clickable ? 'cursor-pointer active:bg-blue-50/80 dark:active:bg-slate-800' : '',
            ].join(' ')}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                {titleCols.map((col) => (
                  <div key={col.key} className="text-[15px] font-semibold text-slate-900 dark:text-white truncate">
                    {col.cell(row)}
                  </div>
                ))}
                {subtitleCols.map((col) => (
                  <div key={col.key} className="text-[13px] text-slate-500 dark:text-slate-400 truncate">
                    {col.cell(row)}
                  </div>
                ))}
              </div>
              {badgeCols.length > 0 && (
                <div className="flex flex-wrap gap-1.5 shrink-0 justify-end">
                  {badgeCols.map((col) => (
                    <div key={col.key}>{col.cell(row)}</div>
                  ))}
                </div>
              )}
            </div>

            {metaCols.length > 0 && (
              <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {metaCols.map((col) => (
                  <div key={col.key} className="min-w-0">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 truncate">
                      {col.header}
                    </dt>
                    <dd className="text-[13px] text-slate-700 dark:text-slate-200 truncate">{col.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            )}

            {actionCols.length > 0 && (
              <div
                className="mt-3 flex flex-wrap gap-2"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {actionCols.map((col) => (
                  <div key={col.key}>{col.cell(row)}</div>
                ))}
              </div>
            )}
          </div>
        );
      })}
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
  const isNarrow = useIsNarrow();


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
                <span className="h-4 w-1 rounded-sm bg-[#1E40AF] shrink-0" aria-hidden />
                <h3 className="text-[13px] font-semibold text-slate-800 truncate normal-case tracking-normal">
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
        isNarrow ? <SkeletonCards /> : <SkeletonRows cols={Math.min(columns.length, 5)} dense={dense} />
      ) : rows.length === 0 ? (
        <div className="px-4 py-8">{empty ?? (
          <div className="py-4 text-center text-sm text-slate-400">No rows.</div>
        )}</div>
      ) : isNarrow ? (
        <MobileCardList columns={columns} rows={rows} rowKey={rowKey} onRowClick={onRowClick} />
      ) : (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px] border-collapse">
              <thead className="sticky top-0 z-[1]">
                <tr className="border-b border-slate-200">
                  {columns.map((col, ci) => (
                    <th
                      key={col.key}
                      scope="col"
                      className={[
                        pad,
                        'md-th text-[12px] font-semibold',
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
                      'group border-b border-slate-200 last:border-b-0',
                      ri % 2 === 1 ? 'md-tr-odd' : 'md-tr-even',
                      clickable ? 'cursor-pointer md-tr-hover' : 'md-tr-hover',
                    ].join(' ')}
                  >
                    {columns.map((col, ci) => (
                      <td
                        key={col.key}
                        className={[
                          pad,
                          'align-middle relative text-[13px] text-slate-700',
                          alignCls[col.align ?? 'left'],
                          col.className ?? '',
                          ci === 0 ? 'pl-4 sm:pl-5 font-medium text-slate-800' : '',
                          ci === columns.length - 1 ? 'pr-4 sm:pr-5' : '',
                          col.align === 'right' ? 'tabular-nums font-mono text-[12px]' : '',
                        ].join(' ')}
                      >
                        {clickable && ci === 0 && (
                          <span
                            className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-[#1E40AF] opacity-0 group-hover:opacity-100 transition-opacity"
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
