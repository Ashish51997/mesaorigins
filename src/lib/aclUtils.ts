/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PermissionRule, ACLRequest, EmployeeGrant } from './accessTypes';
import { roleSeesScreenByDefault } from './accessCatalog';

/**
 * Effective access for (role, employee) on a feature. Resolution order (first wins):
 *   1. approved, current delegation (per employee/email)
 *   2. per-employee grant (on/off)          ← the one new layer
 *   3. role override matrix (PermissionRule)
 *   4. role preset default (screens: role's default set; actions: allow)
 *
 * Backward compatible: a bare module id (e.g. 'orders') is treated as 'screen:orders',
 * and the extra params are optional, so existing 5-arg calls keep working.
 */
export function checkPermission(
  role: string,
  featureKey: string,
  userEmail: string,
  roleRules: PermissionRule[],
  delegations: ACLRequest[],
  grants: EmployeeGrant[] = [],
  employeeId?: string
): boolean {
  const key = featureKey.includes(':') ? featureKey : `screen:${featureKey}`;

  // 1. Approved delegation (temporary bypass)
  const hasBypass = delegations.some(
    (req) => req.userEmail === userEmail && req.requestedModule === key && req.status === 'approved'
  );
  if (hasBypass) return true;

  // 2. Per-employee grant
  if (employeeId) {
    const g = grants.find((x) => x.employeeId === employeeId && x.featureKey === key);
    if (g) return g.state === 'on';
  }

  // 3. Role override matrix
  const rule = roleRules.find((p) => p.id === `${role}-${key}` || (p.role === role && p.module === key));
  if (rule) return rule.allowed;

  // 4. Role preset default
  if (key.startsWith('action:')) return true;              // actions default-allow
  return roleSeesScreenByDefault(role, key.replace(/^screen:/, ''));
}
