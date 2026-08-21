import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/lib/apiClient';
import { mesaOpsPath } from '@mesaops/lib/apiBase';

export type OperationalOrderSourceType =
  | 'local_customer'
  | 'internal'
  | 'forecast'
  | 'replenishment'
  | 'trial'
  | 'rework'
  | 'import'
  | 'mesaerp';

export type OperationalOrderLinkState = 'linked' | 'stale' | 'conflict' | 'unlinked' | 'independent';

/**
 * MesaOps-owned demand. New APIs return the operational-order fields while the
 * optional aliases keep the planner compatible with the previous sales-order
 * response during rolling deployments.
 */
export interface ApiOperationalOrder {
  id: string;
  orderNumber?: string;
  sourceType?: OperationalOrderSourceType | string;
  sourceReference?: string;
  sourceSnapshotHash?: string;
  sourceLinkState?: OperationalOrderLinkState;
  linkState?: OperationalOrderLinkState;
  sourceLink?: { state: OperationalOrderLinkState } | null;
  legacySalesOrderId?: string | null;
  customerName?: string;
  productCode?: string;
  productName?: string;
  quantity: number | string;
  plannedQuantity?: number | string;
  remainingQuantity?: number | string;
  uom?: string;
  dueDate?: string;
  priority: string;
  status: string;
  rowVersion?: number;
  plantCode?: string;
  // Compatibility aliases from the pre-OperationalOrder planner response.
  soNumber?: string;
  product?: string;
  deliveryDate?: string;
  customer?: { name: string };
}

export type ApiPlanOrder = ApiOperationalOrder;

export interface ApiPlanOrderContext extends ApiOperationalOrder {
  orderNumber: string;
  productName: string;
  dueDate: string;
  customerName: string;
}

export interface ApiPlan {
  id: string; operationalOrderId?: string; salesOrderId?: string | null; machineId: string; plannedQuantity?: number | string; shift: string; operatorName: string;
  scheduledStartDate: string; scheduledEndDate: string; status: string;
  supervisor: string; drawingNo: string; formulaNo: string; moldNo: string; productName: string;
  logbookTemplateId?: string | null;
  machine: { code: string; line: string };
  operationalOrder?: ApiPlanOrderContext;
  salesOrder?: { soNumber: string; product: string; deliveryDate: string; customer: { name: string } } | null;
  logbook?: { id: string; status: string } | null;
  version: number;
}
export interface ApiOperator {
  id: string; employeeCode: string; role: string; user: { name: string };
}

export interface OperationalOrderCreateInput {
  orderNumber: string;
  plantCode?: string;
  sourceType: Exclude<OperationalOrderSourceType, 'mesaerp'>;
  sourceReference?: string;
  customerName?: string;
  productCode?: string;
  productName: string;
  quantity: string;
  uom: string;
  dueDate?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  requirements?: Record<string, unknown>;
}

const keys = {
  ordersToPlan: ['planning', 'orders'] as const,
  plans: ['plans'] as const,
  operators: ['planning', 'operators'] as const,
};

export function useOrdersToPlan() {
  return useQuery({ queryKey: keys.ordersToPlan, queryFn: () => api.get<ApiPlanOrder[]>(mesaOpsPath('/planning/orders')) });
}
export function usePlans() {
  return useQuery({ queryKey: keys.plans, queryFn: () => api.get<ApiPlan[]>(mesaOpsPath('/plans')) });
}
export function useOperators() {
  return useQuery({ queryKey: keys.operators, queryFn: () => api.get<ApiOperator[]>(mesaOpsPath('/planning/operators')) });
}

export function useCreateOperationalOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OperationalOrderCreateInput) => api.postIdempotent<ApiOperationalOrder>(
      mesaOpsPath('/operational-orders'),
      body,
      `operational-order:${crypto.randomUUID()}`,
    ),
    onSuccess: () => invalidatePlanning(qc),
  });
}

function invalidatePlanning(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: keys.plans });
  qc.invalidateQueries({ queryKey: keys.ordersToPlan });
  qc.invalidateQueries({ queryKey: ['orders'] });
  qc.invalidateQueries({ queryKey: ['logbook', 'tasks'] });
  qc.invalidateQueries({ queryKey: ['logbook', 'plans'] });
  qc.invalidateQueries({ queryKey: ['dashboard'] });
  qc.invalidateQueries({ queryKey: ['summary'] });
}

export function useSchedulePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.postIdempotent<ApiPlan>(mesaOpsPath('/plans'), body, `production-plan:${crypto.randomUUID()}`),
    onSuccess: () => invalidatePlanning(qc),
  });
}
export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patchIdempotent<ApiPlan>(mesaOpsPath(`/plans/${id}`), body, `production-plan-update:${crypto.randomUUID()}`),
    onSuccess: () => invalidatePlanning(qc),
  });
}
export function useReleasePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: string; expectedVersion: number }) => api.postIdempotent<{ ok: boolean; releasedPlanId: string }>(
      mesaOpsPath(`/plans/${id}/release`),
      { expectedVersion },
      `production-plan-release:${crypto.randomUUID()}`,
    ),
    onSuccess: () => invalidatePlanning(qc),
  });
}

/** True while a scheduled plan may still be edited (before start, draft logbook). */
export function planIsEditable(pl: ApiPlan, now = Date.now()): boolean {
  if (pl.status !== 'scheduled') return false;
  if (pl.logbook?.status === 'submitted') return false;
  const start = Date.parse(pl.scheduledStartDate);
  return Number.isFinite(start) ? now < start : true;
}
