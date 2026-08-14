import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';

export interface ErpToOpsHandoff {
  eventId: string;
  correlationId: string;
  sourceId: string;
  sourceSnapshotHash: string;
  snapshot: {
    orderNumber: string;
    plantCode: string;
    customerName: string;
    productCode: string;
    productName: string;
    quantity: string;
    uom: string;
    dueDate?: string;
    priority: string;
    requirements: Record<string, unknown>;
    legalEntityId: string;
  };
  state: 'unlinked' | 'linked' | 'conflict';
  reason: string;
  occurredAt: string;
}

export interface ErpToOpsHandoffAcceptance {
  status: 'accepted' | 'replayed' | 'conflict';
  reason: string;
  operationalOrder?: {
    id: string;
    orderNumber: string;
    sourceType: string;
    sourceReference: string;
    sourceLinkState: string;
    productCode: string;
    productName: string;
    quantity: string;
    uom: string;
    status: string;
  } | null;
}

export type ErpOpsReturnEventType =
  | 'mesaops.production-actuals.submitted.v1'
  | 'mesaops.qa-disposition.recorded.v1'
  | 'mesaops.physical-dispatch.completed.v1';

export interface ErpOpsReturnAvailableEvent {
  eventId: string;
  eventType: ErpOpsReturnEventType;
  schemaVersion: 1;
  aggregateType: string;
  aggregateId: string;
  payloadHash: string;
  occurredAt: string;
  state: 'available';
}

export interface ErpOpsReturnInboxEvent {
  id: string;
  legalEntityId: string;
  sourceEventId: string;
  sourceService: 'mesaops';
  eventType: ErpOpsReturnEventType;
  schemaVersion: 1;
  aggregateType: string;
  aggregateId: string;
  correlationId: string;
  occurredAt: string;
  sourceSnapshotHash: string;
  payloadHash: string;
  payload: Record<string, unknown>;
  state: 'received' | 'accepted' | 'retry' | 'rejected' | 'conflict';
  exceptionCode: string;
  exceptionDetails: Record<string, unknown>;
  createdArtifacts: Record<string, unknown>;
  attemptCount: number;
  rowVersion: number;
  receivedAt: string;
  resolvedAt?: string;
  updatedAt: string;
}

export interface ErpOpsReturnWorkspace {
  inbox: ErpOpsReturnInboxEvent[];
  available: ErpOpsReturnAvailableEvent[];
}

export interface ErpOpsCostRate {
  kind: 'material_return' | 'labor' | 'machine' | 'overhead' | 'subcontract' | 'recovery';
  reference: string;
  rate: string;
}

const key = (entityId: string) => ['mesaerp', entityId, 'handoff-inbox', 'mesaerp-to-mesaops'] as const;
const opsReturnKey = (entityId: string) => ['mesaerp', entityId, 'handoff-inbox', 'mesaops-to-mesaerp'] as const;

export function useErpHandoffInbox(entityId: string) {
  return useQuery({
    queryKey: key(entityId),
    enabled: Boolean(entityId),
    retry: false,
    queryFn: () => api.get<ErpToOpsHandoff[]>('/operational-orders/handoffs/mesaerp'),
  });
}

export function useAcceptErpHandoff(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, expectedSourceSnapshotHash, requestKey }: { eventId: string; expectedSourceSnapshotHash: string; requestKey: string }) => api.postIdempotent<ErpToOpsHandoffAcceptance>(
      `/operational-orders/handoffs/mesaerp/${eventId}/accept`,
      { expectedSourceSnapshotHash },
      requestKey,
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(entityId) }),
  });
}

export function useErpOpsReturnInbox(entityId: string) {
  return useQuery({
    queryKey: opsReturnKey(entityId),
    enabled: Boolean(entityId),
    retry: false,
    queryFn: () => api.get<ErpOpsReturnWorkspace>(`/mesaerp/v1/entities/${entityId}/handoff-inbox`),
  });
}

function invalidateOpsReturn(queryClient: ReturnType<typeof useQueryClient>, entityId: string) {
  return queryClient.invalidateQueries({ queryKey: opsReturnKey(entityId) });
}

export function useReceiveErpOpsReturn(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ event, requestKey }: { event: ErpOpsReturnAvailableEvent; requestKey: string }) => api.postIdempotent<ErpOpsReturnInboxEvent>(
      `/mesaerp/v1/entities/${entityId}/handoff-inbox/events/${event.eventId}/receive`,
      { expectedPayloadHash: event.payloadHash, expectedEventType: event.eventType, expectedSchemaVersion: event.schemaVersion },
      requestKey,
    ),
    onSuccess: () => invalidateOpsReturn(queryClient, entityId),
  });
}

export function useAcceptErpOpsReturn(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ inboxId, expectedRowVersion, productionDemandId, costRates, notes, requestKey }: { inboxId: string; expectedRowVersion: number; productionDemandId?: string; costRates: ErpOpsCostRate[]; notes: string; requestKey: string }) => api.postIdempotent<ErpOpsReturnInboxEvent>(
      `/mesaerp/v1/entities/${entityId}/handoff-inbox/${inboxId}/accept`,
      { expectedRowVersion, ...(productionDemandId ? { productionDemandId } : {}), costRates, notes },
      requestKey,
    ),
    onSuccess: () => invalidateOpsReturn(queryClient, entityId),
  });
}

export function useRejectErpOpsReturn(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ inboxId, expectedRowVersion, reason, requestKey }: { inboxId: string; expectedRowVersion: number; reason: string; requestKey: string }) => api.postIdempotent<ErpOpsReturnInboxEvent>(
      `/mesaerp/v1/entities/${entityId}/handoff-inbox/${inboxId}/reject`,
      { expectedRowVersion, reason },
      requestKey,
    ),
    onSuccess: () => invalidateOpsReturn(queryClient, entityId),
  });
}

export function useRetryErpOpsReturn(entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ inboxId, expectedRowVersion, reason, requestKey }: { inboxId: string; expectedRowVersion: number; reason: string; requestKey: string }) => api.postIdempotent<ErpOpsReturnInboxEvent>(
      `/mesaerp/v1/entities/${entityId}/handoff-inbox/${inboxId}/retry`,
      { expectedRowVersion, reason },
      requestKey,
    ),
    onSuccess: () => invalidateOpsReturn(queryClient, entityId),
  });
}
