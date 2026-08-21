import { useState } from 'react';
import { ArrowRight, Factory, Link2, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  useAcceptErpHandoff,
  useAcceptErpOpsReturn,
  useErpHandoffInbox,
  useErpOpsReturnInbox,
  useReceiveErpOpsReturn,
  useRejectErpOpsReturn,
  useRetryErpOpsReturn,
  type ErpOpsCostRate,
  type ErpOpsReturnInboxEvent,
  type ErpToOpsHandoff,
} from '@mesaerp/lib/queries/mesaerpHandoffs';
import { LiveFeedback, LiveNotice, LivePanel, LivePill, humanize, liveInput, livePrimary, liveSecondary, useLiveMutationRunner } from './liveUi';

export function LiveHandoffInbox({ entityId }: { entityId: string }) {
  return <div className="space-y-5">
    <LiveNotice><div className="flex items-start gap-3"><Link2 className="mt-1 h-4 w-4 shrink-0 text-blue-700" /><div><strong>Snapshot, then own the destination.</strong> Each direction loads and fails independently. A disabled MesaOps destination never hides the ERP-owned return queue or changes local ERP records.</div></div></LiveNotice>
    <OutboundDemandInbox entityId={entityId} />
    <OpsReturnInbox entityId={entityId} />
    <LiveNotice tone="amber"><strong>Destination control:</strong> ERP → Ops acceptance requires MesaOps <code>action:operational_order.create</code>. The outbound destination panel is not a general ERP task queue, and an unavailable MesaOps service never changes ERP demand status.</LiveNotice>
  </div>;
}

function OutboundDemandInbox({ entityId }: { entityId: string }) {
  const query = useErpHandoffInbox(entityId);
  const accept = useAcceptErpHandoff(entityId);
  const runner = useLiveMutationRunner();
  if (query.isLoading) return <LivePanel title="Handoff inbox" eyebrow="MesaOps-owned destination"><p className="p-6 text-sm text-slate-500">Loading verified MesaERP demand events visible to MesaOps…</p></LivePanel>;
  if (query.isError) return <LivePanel title="MesaOps handoff inbox unavailable" eyebrow="Independent service boundary"><div className="space-y-3 p-5"><LiveNotice tone="amber">{query.error instanceof Error ? query.error.message : 'The MesaOps inbox could not be loaded.'}</LiveNotice><p className="text-xs leading-5 text-slate-500">Viewing this destination inbox requires the MesaOps <code>screen:orders_to_plan</code> permission. MesaERP demand records and all local ERP flows remain valid when MesaOps is absent or unavailable.</p><button type="button" className={liveSecondary} onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" />Retry MesaOps inbox</button></div></LivePanel>;
  const rows = (query.data ?? []).filter((row) => row.snapshot.legalEntityId === entityId);
  const acceptRow = (row: ErpToOpsHandoff) => runner.run(`erp-ops-handoff:${row.eventId}`, () => accept.mutateAsync({ eventId: row.eventId, expectedSourceSnapshotHash: row.sourceSnapshotHash, requestKey: runner.keyFor(`erp-ops-handoff:${row.eventId}`) }), `${row.snapshot.orderNumber} accepted into an independently owned MesaOps operational order.`);
  return <div className="space-y-3">
    <LiveFeedback message={runner.message} error={runner.error} />
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Awaiting MesaOps" value={rows.filter((row) => row.state === 'unlinked').length} /><Metric label="Linked" value={rows.filter((row) => row.state === 'linked').length} /><Metric label="Conflict review" value={rows.filter((row) => row.state === 'conflict').length} /></div>
    <LivePanel title="MesaERP → MesaOps demand inbox" eyebrow="Verified outbox snapshots"><div className="divide-y divide-slate-100">{rows.map((row) => <article key={row.eventId} className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[1fr_auto] xl:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Factory className="h-4 w-4" /></span><div><p className="font-mono text-xs font-bold text-blue-700">{row.snapshot.orderNumber}</p><p className="mt-0.5 text-sm font-extrabold text-slate-900">{row.snapshot.productCode} · {row.snapshot.productName}</p></div><LivePill state={row.state} /></div><div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2 lg:grid-cols-4"><p>Plant <strong className="text-slate-700">{row.snapshot.plantCode}</strong></p><p>Quantity <strong className="font-mono text-slate-700">{row.snapshot.quantity} {row.snapshot.uom}</strong></p><p>Due <strong className="text-slate-700">{row.snapshot.dueDate || 'not specified'}</strong></p><p>Priority <strong className="text-slate-700">{humanize(row.snapshot.priority)}</strong></p></div><p className="mt-3 text-xs leading-5 text-slate-500">{row.reason || 'No reconciliation note.'}</p><p className="mt-1 font-mono text-[10px] text-slate-400">Snapshot {row.sourceSnapshotHash.slice(0, 16)}… · {new Date(row.occurredAt).toLocaleString()}</p></div><div className="xl:text-right">{row.state === 'unlinked' ? <button type="button" className={livePrimary} onClick={() => void acceptRow(row)}><ShieldCheck className="h-4 w-4" />Accept in MesaOps<ArrowRight className="h-4 w-4" /></button> : <p className="text-xs font-bold text-slate-500">{row.state === 'linked' ? 'MesaOps owns the resulting order.' : 'A person must resolve the source conflict.'}</p>}</div></article>)}{!rows.length && <div className="p-10 text-center"><Factory className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-bold text-slate-700">No MesaERP demand snapshots are waiting for this company.</p><p className="mt-1 text-xs text-slate-500">This is a healthy empty state; MesaERP and MesaOps can each start independently.</p></div>}</div></LivePanel>
  </div>;
}

function eventLabel(eventType: string) {
  if (eventType.includes('production-actuals')) return 'Production actuals';
  if (eventType.includes('qa-disposition')) return 'QA disposition';
  return 'Physical dispatch';
}

function parseCostRates(value: string): { rates: ErpOpsCostRate[] } | { error: string } {
  const allowed = new Set<ErpOpsCostRate['kind']>(['material_return', 'labor', 'machine', 'overhead', 'subcontract', 'recovery']);
  const rows = value.split(/\r?\n/).filter((row) => row.trim());
  const rates: ErpOpsCostRate[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const [kind, reference, rate, ...extra] = rows[index].split('\t').map((part) => part.trim());
    if (extra.length || !allowed.has(kind as ErpOpsCostRate['kind']) || !reference || !/^\d+(?:\.\d+)?$/.test(rate || '')) {
      return { error: `Cost-rate row ${index + 1} must be kind, reference and non-negative Decimal rate separated by tabs.` };
    }
    rates.push({ kind: kind as ErpOpsCostRate['kind'], reference, rate });
  }
  return { rates };
}

function OpsReturnInbox({ entityId }: { entityId: string }) {
  const query = useErpOpsReturnInbox(entityId);
  const receive = useReceiveErpOpsReturn(entityId);
  const accept = useAcceptErpOpsReturn(entityId);
  const reject = useRejectErpOpsReturn(entityId);
  const retry = useRetryErpOpsReturn(entityId);
  const runner = useLiveMutationRunner();
  const [acceptingId, setAcceptingId] = useState('');
  const [costRateText, setCostRateText] = useState('');
  const [notes, setNotes] = useState('');
  const [decision, setDecision] = useState<{ id: string; action: 'retry' | 'reject' } | null>(null);
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState('');
  if (query.isLoading) return <LivePanel title="MesaOps → MesaERP execution / QA / dispatch inbox" eyebrow="ERP-owned destination"><p className="p-6 text-sm text-slate-500">Loading durable MesaOps return events…</p></LivePanel>;
  if (query.isError) return <LivePanel title="MesaOps return inbox unavailable" eyebrow="Independent service boundary"><div className="space-y-3 p-5"><LiveNotice tone="amber">{query.error instanceof Error ? query.error.message : 'The ERP return inbox could not be loaded.'}</LiveNotice><p className="text-xs leading-5 text-slate-500">This queue requires <code>mesaerp.handoff.manage</code>. Inventory, costing, tax and finance remain independently available according to their own grants.</p><button type="button" className={liveSecondary} onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" />Retry ERP inbox</button></div></LivePanel>;
  const workspace = query.data ?? { available: [], inbox: [] };
  const receiveEvent = (event: (typeof workspace.available)[number]) => runner.run(`ops-erp-receive:${event.eventId}`, () => receive.mutateAsync({ event, requestKey: runner.keyFor(`ops-erp-receive:${event.eventId}`) }), `${eventLabel(event.eventType)} evidence received into the ERP-owned queue.`);
  const acceptEvent = (event: ErpOpsReturnInboxEvent) => {
    const parsed = parseCostRates(costRateText);
    if ('error' in parsed) { setLocalError(parsed.error); return; }
    setLocalError('');
    void runner.run(`ops-erp-accept:${event.id}:${event.rowVersion}`, () => accept.mutateAsync({ inboxId: event.id, expectedRowVersion: event.rowVersion, costRates: parsed.rates, notes: notes.trim(), requestKey: runner.keyFor(`ops-erp-accept:${event.id}:${event.rowVersion}`) }), 'Acceptance evaluated and the persisted ERP handoff state reloaded.').then((ok) => { if (ok) { setAcceptingId(''); setCostRateText(''); setNotes(''); } });
  };
  const decide = (event: ErpOpsReturnInboxEvent) => {
    if (!decision || decision.id !== event.id || reason.trim().length < 3) return;
    const action = decision.action;
    const mutation = action === 'retry' ? retry : reject;
    void runner.run(`ops-erp-${action}:${event.id}:${event.rowVersion}`, () => mutation.mutateAsync({ inboxId: event.id, expectedRowVersion: event.rowVersion, reason: reason.trim(), requestKey: runner.keyFor(`ops-erp-${action}:${event.id}:${event.rowVersion}`) }), `${eventLabel(event.eventType)} ${action === 'retry' ? 'returned to received state for another acceptance attempt' : 'rejected with an auditable reason'}.`).then((ok) => { if (ok) { setDecision(null); setReason(''); } });
  };
  return <LivePanel title="MesaOps → MesaERP execution / QA / dispatch inbox" eyebrow="ERP-owned destination · mesaerp.handoff.manage">
    <div className="space-y-5 p-4 sm:p-5">
      <LiveNotice><strong>Direction matters.</strong> These are immutable MesaOps execution, QA and dispatch snapshots entering ERP controls. Receiving does not alter MesaOps; accepting creates only the mapped ERP evidence and posting drafts owned here.</LiveNotice>
      <LiveFeedback message={runner.message} error={localError || runner.error} />
      <section><div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-sm font-extrabold text-slate-900">Available from MesaOps</h3><span className="text-xs font-bold text-slate-500">{workspace.available.length} waiting</span></div><div className="divide-y divide-slate-100 rounded-xl border border-slate-200">{workspace.available.map((event) => <div key={event.eventId} className="flex flex-wrap items-center justify-between gap-3 p-3"><div><p className="text-sm font-extrabold text-slate-900">{eventLabel(event.eventType)}</p><p className="mt-1 text-xs text-slate-500">{event.aggregateType} · source evidence {event.payloadHash.slice(0, 12)}… · {new Date(event.occurredAt).toLocaleString()}</p></div><button type="button" className={liveSecondary} onClick={() => void receiveEvent(event)}>Receive verified event</button></div>)}{!workspace.available.length && <p className="p-5 text-center text-sm text-slate-500">No unreceived MesaOps return events are available for this company.</p>}</div></section>
      <section><div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-sm font-extrabold text-slate-900">Received and resolved events</h3><span className="text-xs font-bold text-slate-500">{workspace.inbox.length} persisted</span></div><div className="divide-y divide-slate-100 rounded-xl border border-slate-200">{workspace.inbox.map((event) => <article key={event.id} className="space-y-3 p-3 sm:p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-extrabold text-slate-900">{eventLabel(event.eventType)}</p><LivePill state={event.state} /></div><p className="mt-1 text-xs text-slate-500">{event.aggregateType} · correlation {event.correlationId || 'not supplied'} · attempt {event.attemptCount}</p></div><p className="font-mono text-[10px] text-slate-400">Snapshot {event.sourceSnapshotHash.slice(0, 16)}…</p></div>{event.exceptionCode && <LiveNotice tone="amber"><strong>Mapping / processing exception:</strong> {humanize(event.exceptionCode)}{Object.keys(event.exceptionDetails || {}).length ? <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[10px] leading-4">{JSON.stringify(event.exceptionDetails, null, 2)}</pre> : null}</LiveNotice>}{acceptingId === event.id && <div className="grid gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3"><label><span className="mb-1 block text-xs font-bold text-blue-900">Cost rates for production actuals</span><textarea aria-label={`Cost rates for ${event.id}`} className={`${liveInput} min-h-24 font-mono text-xs`} value={costRateText} onChange={(input) => setCostRateText(input.target.value)} placeholder={'labor\tOPERATOR-GRADE-A\t250.000000\nmachine\tMACHINE-CLASS-1\t900.000000'} /></label><p className="text-xs leading-5 text-blue-800">Optional for QA and dispatch. Production actuals that reference labor, machine, overhead or recovery rates may need tab-separated kind, reference and exact Decimal rate rows.</p><label><span className="mb-1 block text-xs font-bold text-blue-900">Acceptance notes</span><input aria-label={`Acceptance notes for ${event.id}`} className={liveInput} value={notes} onChange={(input) => setNotes(input.target.value)} /></label><div className="flex flex-wrap gap-2"><button type="button" className={livePrimary} onClick={() => acceptEvent(event)}>Evaluate acceptance</button><button type="button" className={liveSecondary} onClick={() => { setAcceptingId(''); setCostRateText(''); setNotes(''); setLocalError(''); }}>Cancel</button></div></div>}{decision?.id === event.id && <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3"><input aria-label={`${humanize(decision.action)} reason for ${event.id}`} className={`${liveInput} min-w-56 flex-1`} value={reason} onChange={(input) => setReason(input.target.value)} placeholder={`Reason to ${decision.action} this evidence`} /><button type="button" disabled={reason.trim().length < 3} className={decision.action === 'reject' ? 'inline-flex min-h-10 items-center justify-center rounded-lg bg-rose-700 px-4 text-sm font-bold text-white disabled:bg-slate-300' : livePrimary} onClick={() => decide(event)}>Confirm {decision.action}</button><button type="button" className={liveSecondary} onClick={() => { setDecision(null); setReason(''); }}>Cancel</button></div>}<div className="flex flex-wrap gap-2">{event.state === 'received' && <button type="button" className={livePrimary} onClick={() => { setAcceptingId(event.id); setDecision(null); setLocalError(''); }}>Accept into ERP controls</button>}{['retry', 'conflict'].includes(event.state) && <button type="button" className={liveSecondary} onClick={() => { setDecision({ id: event.id, action: 'retry' }); setAcceptingId(''); setReason(''); }}>Retry after fixing mappings</button>}{['received', 'retry', 'conflict'].includes(event.state) && <button type="button" className={liveSecondary} onClick={() => { setDecision({ id: event.id, action: 'reject' }); setAcceptingId(''); setReason(''); }}>Reject with reason</button>}</div></article>)}{!workspace.inbox.length && <p className="p-5 text-center text-sm text-slate-500">No MesaOps return evidence has been received into this company.</p>}</div></section>
      <LiveNotice tone="amber"><strong>Mapping gate:</strong> missing item, UOM, warehouse or customer mappings produce a visible retry state. Correct the company master mapping before retry; no source event is silently coerced and no ERP artifact is partially accepted.</LiveNotice>
    </div>
  </LivePanel>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-slate-900">{value}</p></div>; }
