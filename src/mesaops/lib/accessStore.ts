/**
 * accessStore.ts — the live access state (role overrides, per-employee grants, temporary
 * delegations) plus the current signed-in employee context, so can(featureKey) works from
 * anywhere. Persisted to localStorage. Reuses aclUtils.checkPermission for resolution.
 */

import { useSyncExternalStore } from 'react';
import { PermissionRule, ACLRequest, EmployeeGrant } from './accessTypes';
import { checkPermission } from './aclUtils';

export interface EmployeeCtx { employeeId: string; role: string; email: string; }
export type TriState = 'on' | 'off' | 'inherit';

const LS = { rules: 'mp_permissions', grants: 'mp_grants', delegations: 'mp_delegations' };

function load<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function save(key: string, val: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}
const now = (): string => new Date().toISOString();

let roleRules: PermissionRule[] = load<PermissionRule[]>(LS.rules, []);
let grants: EmployeeGrant[] = load<EmployeeGrant[]>(LS.grants, []);
let delegations: ACLRequest[] = load<ACLRequest[]>(LS.delegations, []);
let current: EmployeeCtx | null = null;

const subs = new Set<() => void>();
const emit = (): void => subs.forEach((s) => s());
const subscribe = (cb: () => void): (() => void) => { subs.add(cb); return () => { subs.delete(cb); }; };

const snapRules = (): PermissionRule[] => roleRules;
const snapGrants = (): EmployeeGrant[] => grants;
const snapDelegations = (): ACLRequest[] => delegations;
const snapCurrent = (): EmployeeCtx | null => current;

/* ------------------------------------------------------------- resolution --- */

export function setCurrentEmployee(ctx: EmployeeCtx | null): void { current = ctx; emit(); }

// Effective access for an explicit (role, email, employeeId).
export function checkFor(role: string, email: string, employeeId: string | undefined, featureKey: string): boolean {
  return checkPermission(role, featureKey, email, roleRules, delegations, grants, employeeId);
}

// Effective access for the current signed-in employee. Permissive before context is set.
export function can(featureKey: string): boolean {
  if (!current) return true;
  return checkPermission(current.role, featureKey, current.email, roleRules, delegations, grants, current.employeeId);
}

export function useCan(featureKey: string): boolean {
  return useSyncExternalStore(subscribe, () => can(featureKey), () => can(featureKey));
}

/* ----------------------------------------------------------------- hooks --- */

export function useRoleRules(): PermissionRule[] { return useSyncExternalStore(subscribe, snapRules, snapRules); }
export function useGrants(): EmployeeGrant[] { return useSyncExternalStore(subscribe, snapGrants, snapGrants); }
export function useDelegations(): ACLRequest[] { return useSyncExternalStore(subscribe, snapDelegations, snapDelegations); }
export function useCurrentEmployee(): EmployeeCtx | null { return useSyncExternalStore(subscribe, snapCurrent, snapCurrent); }

/* --------------------------------------------------------------- mutators --- */

export function setRoleRule(role: string, featureKey: string, allowed: boolean, by: string): void {
  const id = `${role}-${featureKey}`;
  const exists = roleRules.some((r) => r.id === id);
  roleRules = exists
    ? roleRules.map((r) => (r.id === id ? { ...r, allowed, updatedBy: by, updatedAt: now() } : r))
    : [...roleRules, { id, role, module: featureKey, allowed, updatedBy: by, updatedAt: now() }];
  save(LS.rules, roleRules);
  emit();
}

export function grantState(employeeId: string, featureKey: string): TriState {
  const g = grants.find((x) => x.employeeId === employeeId && x.featureKey === featureKey);
  return g ? g.state : 'inherit';
}

export function setGrant(employeeId: string, featureKey: string, state: TriState, by: string): void {
  const id = `${employeeId}-${featureKey}`;
  if (state === 'inherit') {
    grants = grants.filter((g) => g.id !== id);
  } else {
    const exists = grants.some((g) => g.id === id);
    grants = exists
      ? grants.map((g) => (g.id === id ? { ...g, state, by, at: now() } : g))
      : [...grants, { id, employeeId, featureKey, state, by, at: now() }];
  }
  save(LS.grants, grants);
  emit();
}

export function clearGrantsFor(employeeId: string): void {
  grants = grants.filter((g) => g.employeeId !== employeeId);
  save(LS.grants, grants);
  emit();
}

export function countGrantsFor(employeeId: string): number {
  return grants.filter((g) => g.employeeId === employeeId).length;
}

export function addDelegation(req: ACLRequest): void {
  delegations = [req, ...delegations];
  save(LS.delegations, delegations);
  emit();
}

export function resolveDelegation(id: string, status: 'approved' | 'rejected', by: string): void {
  delegations = delegations.map((r) => (r.id === id ? { ...r, status, resolvedAt: now(), resolvedBy: by } : r));
  save(LS.delegations, delegations);
  emit();
}

export function resetRoleRules(): void { roleRules = []; save(LS.rules, roleRules); emit(); }

// Snapshot counts for admin home tiles.
export function customRuleCount(): number { return roleRules.length + grants.length; }
export function pendingDelegationCount(): number { return delegations.filter((d) => d.status === 'pending').length; }
