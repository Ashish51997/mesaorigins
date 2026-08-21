/**
 * High-contrast status / priority chips for tables and lists.
 * Uses `.md-status-*` tokens (dark text on tinted backgrounds).
 */
import type { ReactNode } from 'react';

export type StatusTone = 'info' | 'warn' | 'success' | 'neutral' | 'error';

export function StatusBadge({
  tone,
  children,
  title,
  className = '',
}: {
  tone: StatusTone;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span className={`md-status md-status-${tone}${className ? ` ${className}` : ''}`} title={title}>
      {children}
    </span>
  );
}

/** Map common workflow statuses onto a tone. */
export function toneForStatus(status: string): StatusTone {
  const s = status.toLowerCase();
  if (
    s === 'passed' || s === 'submitted' || s === 'completed' || s === 'closed'
    || s === 'converted' || s === 'active' || s === 'running' || s === 'inspected'
    || s === 'ordered' || s === 'dispatched' || s === 'packed'
  ) return 'success';
  if (
    s === 'failed' || s === 'rejected' || s === 'overdue' || s === 'stopped'
    || s === 'down' || s === 'open' || s === 'high' || s === 'cancelled'
  ) return 'error';
  if (
    s === 'draft' || s === 'pending' || s === 'pending_quote' || s === 'approved'
    || s === 'in_progress' || s === 'in_production' || s === 'attention'
    || s === 'hold' || s === 'medium' || s === 'scheduled' || s === 'ready'
  ) return 'warn';
  if (
    s === 'quotation' || s === 'planned' || s === 'awaiting' || s === 'info'
  ) return 'info';
  return 'neutral';
}
