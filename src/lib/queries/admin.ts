import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';

export interface ApiEmployee {
  id: string; employeeCode: string; department: string; role: string; roleId: string | null;
  shift: string; status: string; user: { name: string; email: string };
}
export interface ApiRole {
  id: string; name: string; screens: string[]; isAdmin: boolean; isSystem: boolean;
  _count?: { memberships: number };
}
export interface ApiGrant { id: string; screen: string; state: 'on' | 'off' }
export interface ApiMesaOpsRoleAssignment {
  id: string;
  organizationId: string;
  membershipId: string;
  roleId: string;
  serviceId: 'mesaops';
  legalEntityId: null;
  plantCode: string | null;
  warehouseId: null;
  validFrom: string | null;
  validTo: string | null;
  status: 'active' | 'revoked';
  revokedAt: string | null;
  revocationReason: string | null;
  rowVersion: number;
  membership: { user: { name: string; email: string } };
  role: { id: string; name: string; isSystem: boolean };
}

const keys = {
  employees: ['employees'] as const,
  roles: ['roles'] as const,
  screens: ['screen-catalog'] as const,
  grants: (id: string) => ['grants', id] as const,
  mesaOpsAssignments: ['mesaops-role-assignments'] as const,
};

export interface ApiDirectoryEntry { id: string; name: string; email: string; role: string; employeeCode: string; department: string }

// The signed-in caller's effective access — drives the client menu. Keyed on the
// dev identity so it refetches when you switch employee.
export function useMyPermissions(identity: string) {
  return useQuery({
    queryKey: ['my-perms', identity],
    queryFn: () => api.get<{ isAdmin: boolean; screens: string[] }>('/me/permissions'),
  });
}
// Roster for the login picker / role switcher.
export function useDirectory(enabled = true) {
  return useQuery({ queryKey: ['directory'], queryFn: () => api.get<ApiDirectoryEntry[]>('/directory'), enabled });
}

export function useEmployees() {
  return useQuery({ queryKey: keys.employees, queryFn: () => api.get<ApiEmployee[]>('/employees') });
}
export function useRoles() {
  return useQuery({ queryKey: keys.roles, queryFn: () => api.get<ApiRole[]>('/roles') });
}
export function useScreenCatalog() {
  return useQuery({ queryKey: keys.screens, queryFn: () => api.get<{ screens: string[] }>('/screens').then((r) => r.screens) });
}
export function useEmployeeGrants(membershipId: string | null) {
  return useQuery({
    queryKey: keys.grants(membershipId ?? ''),
    queryFn: () => api.get<ApiGrant[]>(`/employees/${membershipId}/grants`),
    enabled: !!membershipId,
  });
}
export function useMesaOpsRoleAssignments() {
  return useQuery({
    queryKey: keys.mesaOpsAssignments,
    queryFn: () => api.get<ApiMesaOpsRoleAssignment[]>('/mesaops/role-assignments'),
  });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; email: string; roleId: string; department?: string; shift?: string; status?: string }) =>
      api.post<ApiEmployee>('/employees', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.employees }),
  });
}
export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<{ roleId: string; status: string; department: string; shift: string }> }) =>
      api.patch<ApiEmployee>(`/employees/${id}`, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.employees }); qc.invalidateQueries({ queryKey: keys.roles }); },
  });
}
export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; screens: string[] }) => api.post<ApiRole>('/roles', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.roles }),
  });
}
export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<{ name: string; screens: string[] }> }) =>
      api.patch<ApiRole>(`/roles/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.roles }),
  });
}
export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/roles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.roles }),
  });
}
export function useSetGrants() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, grants }: { id: string; grants: { screen: string; state: 'on' | 'off' }[] }) =>
      api.put<ApiGrant[]>(`/employees/${id}/grants`, { grants }),
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: keys.grants(v.id) }); qc.invalidateQueries({ queryKey: keys.employees }); },
  });
}
export function useCreateMesaOpsRoleAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, requestKey }: {
      input: { membershipId: string; roleId: string; plantCode?: string | null; validFrom?: string | null; validTo?: string | null };
      requestKey: string;
    }) => api.postIdempotent<ApiMesaOpsRoleAssignment>('/mesaops/role-assignments', input, requestKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.mesaOpsAssignments }),
  });
}
export function useRevokeMesaOpsRoleAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, expectedVersion, reason, requestKey }: {
      assignmentId: string; expectedVersion: number; reason: string; requestKey: string;
    }) => api.postIdempotent<ApiMesaOpsRoleAssignment>(
      `/mesaops/role-assignments/${assignmentId}/revoke`,
      { expectedVersion, reason },
      requestKey,
    ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.mesaOpsAssignments }),
  });
}
