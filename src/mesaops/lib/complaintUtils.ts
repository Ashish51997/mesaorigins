/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CAPARecord } from '@mesaops/types';

/**
 * Checks if a CAPA preventive action plan is overdue based on target dates.
 */
export function isCAPAOverdue(dueDate: string, status: string, currentDateStr: string): boolean {
  if (status === 'closed') return false;
  
  const due = new Date(dueDate);
  const current = new Date(currentDateStr);
  
  return due < current;
}

/**
 * Determines SLA resolution timeline in days depending on visual severity levels.
 */
export function getTargetResolutionDays(severity: 'low' | 'medium' | 'high'): number {
  switch (severity) {
    case 'high': return 3;
    case 'medium': return 10;
    case 'low': return 30;
    default: return 14;
  }
}
