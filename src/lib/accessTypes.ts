/**
 * accessTypes.ts — shared types for Access & Role Management (SPEC_ACCESS_MGMT.md).
 * Kept in lib so both the resolver (aclUtils) and stores can import without reaching
 * into a component. AclManagement re-exports PermissionRule/ACLRequest for continuity.
 */

// Role-level override in the permission matrix. `module` holds a FEATURE KEY
// (screen:<id> or action:<verb>) — kept named `module` to avoid churning the existing
// AclManagement grid, which reads rule.module.
export interface PermissionRule {
  id: string;        // `${role}-${featureKey}`
  role: string;
  module: string;    // feature key
  allowed: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

// Temporary delegation / bypass request (unchanged behaviour).
export interface ACLRequest {
  id: string;
  userEmail: string;
  displayName: string;
  requestedRole: string;
  requestedModule: string;   // feature key
  durationMinutes: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

// Per-employee override — the one new layer. Absence of a grant = "inherit role default".
export interface EmployeeGrant {
  id: string;          // `${employeeId}-${featureKey}`
  employeeId: string;
  featureKey: string;
  state: 'on' | 'off';
  by?: string;
  at?: string;
}

// A catalogued capability.
export interface Feature {
  key: string;                    // screen:<id> | action:<verb>
  label: string;
  area: string;                   // grouping in the admin UI
  kind: 'screen' | 'action';
}
