/**
 * PlannerScreens.tsx — the Production Planner role (PROMPT 02, dark theme).
 * Home · Orders to Plan (+ plan flow) · Production Plan board (list default /
 * Gantt toggle) · Formulations (BOM, before/after normalize confirm + locked
 * revisions) · Machine Capacity · Material Availability. Reuses productionPlans /
 * salesOrders (App state), the planner store (formulas + RM store), simulation,
 * nudges/toasts. Planning an order updates queue + board + material live.
 */

import { useState, useEffect } from 'react';
import type { Dispatch, SetStateAction, ReactNode } from 'react';
import {
  ClipboardList, Lock, AlertTriangle, CheckCircle2, ArrowRight, Boxes, Gauge, List, BarChart3, Beaker, CalendarClock, Plus, Trash2, Pencil
} from 'lucide-react';
import { SalesOrder, ProductionPlan, Customer } from '../../types';
import { useFormulations, useCreateFormulation, useUpdateFormulation, type ApiFormula, type ApiFormulaComponent } from '../../lib/queries/formulation';
import { pushToast, pushNudge } from '../Notify';
import { useCan } from '../../lib/accessStore';
import { EmptyState } from '../EmptyState';
import { TraceLink } from '../TraceLink';
import { DataTable } from '../DataTable';
import ResponsiveOverlay from '../ui/ResponsiveOverlay';
import { ApiError } from '../../lib/apiClient';
import { useMachines } from '../../lib/queries/maintenance';
import { useOrdersToPlan, usePlans, useOperators, useSchedulePlan, useUpdatePlan, useReleasePlan, planIsEditable, type ApiPlanOrder, type ApiPlan } from '../../lib/queries/planning';
import { useLogbookTemplates, useLogbookFormulas } from '../../lib/queries/logbook';
import { useDirectory } from '../../lib/queries/admin';

export interface PlannerData {
  salesOrders: SalesOrder[];
  setSalesOrders: Dispatch<SetStateAction<SalesOrder[]>>;
  productionPlans: ProductionPlan[];
  setProductionPlans: Dispatch<SetStateAction<ProductionPlan[]>>;
  customers: Customer[];
  onOpen: (m: string) => void;
  onTrace: (q: string) => void;
}

const custName = (p: PlannerData, id: string) => p.customers.find((c) => c.id === id)?.name ?? id;


function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

const priorityChip = (pr: string) => {
  const cls = pr === 'high' ? 'bg-rose-100 text-rose-800' : pr === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700';
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${cls}`}>{pr === 'high' ? 'High priority' : pr === 'medium' ? 'Medium' : 'Low'}</span>;
};

// Delivery urgency relative to today.
const daysUntil = (dateStr: string): number => {
  const t = new Date(`${dateStr}T00:00:00`).getTime();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((t - today.getTime()) / 86400000);
};
function DueBadge({ date }: { date: string }) {
  const d = daysUntil(date);
  const m = Number.isNaN(d) ? { cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400', text: date }
    : d < 0 ? { cls: 'bg-rose-100 text-rose-700', text: `${-d}d overdue` }
    : d === 0 ? { cls: 'bg-rose-100 text-rose-700', text: 'due today' }
    : d <= 3 ? { cls: 'bg-amber-100 text-amber-800', text: `due in ${d}d` }
    : { cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', text: `due in ${d}d` };
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${m.cls}`}>{m.text}</span>;
}
const shiftName = (sh: string) => (sh === 'D' ? 'Day' : 'Night');
const shiftHours = (sh: string) => (sh === 'D' ? '08:00–20:00' : '20:00–08:00');

const MS_DAY = 86400000;
const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Which pending orders can't be fitted onto a free line+shift on/before their due date.
// Each order needs one shift-slot; a day has (lines × shifts) slots minus those already
// planned. Earliest-due orders greedily claim the earliest free slot (so a glut of orders
// competing for the same near-term shifts surfaces as a conflict, not just overdue ones).

/* ---------------------------------------------------------------- plan flow */


const orderLabel = (p: PlannerData, soId: string) => p.salesOrders.find((o) => o.id === soId)?.soNumber ?? soId;

/* ---------------------------------------------------------------- Home */




/* ---------------------------------------------------------------- Orders to Plan (API) */

const planLbl = 'block text-[11px] font-bold text-slate-500 mb-1';
const planInp = 'w-full h-11 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-sm bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200';
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong — please try again.');

export function OrdersToPlan(p: PlannerData) {
  const ordersQ = useOrdersToPlan();
  const [planning, setPlanning] = useState<ApiPlanOrder | null>(null);
  const orders = ordersQ.data ?? [];
  return (
    <div className="space-y-3">
      <DataTable
        title="Orders to plan"
        loading={ordersQ.isLoading}
        rows={orders}
        rowKey={(o) => o.id}
        empty={<EmptyState title="Nothing waiting to be planned." hint="Confirmed orders from sales appear here with their required date and priority." />}
        columns={[
          { key: 'so', header: 'SO', cell: (o) => <TraceLink id={o.soNumber} onTrace={p.onTrace} className="font-bold font-mono text-slate-800 dark:text-slate-100" /> },
          { key: 'prio', header: 'Priority', cell: (o) => priorityChip(o.priority) },
          { key: 'due', header: 'Due', cell: (o) => <DueBadge date={o.deliveryDate} /> },
          { key: 'product', header: 'Product', cell: (o) => <span className="font-semibold">{o.product}</span> },
          { key: 'customer', header: 'Customer', cell: (o) => o.customer.name },
          { key: 'qty', header: 'Qty', align: 'right', className: 'font-mono whitespace-nowrap', cell: (o) => o.quantity.toLocaleString('en-IN') },
          { key: 'act', header: '', align: 'right', cell: (o) => (
            <button onClick={() => setPlanning(o)} className="h-9 px-4 rounded-lg bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 inline-flex items-center gap-1">Plan <ArrowRight className="w-3.5 h-3.5" /></button>
          ) },
        ]}
      />
      {planning && <SchedulePlanModal order={planning} onClose={() => setPlanning(null)} />}
    </div>
  );
}

type SchedulePlanModalProps =
  | { order: ApiPlanOrder; plan?: undefined; onClose: () => void }
  | { order?: undefined; plan: ApiPlan; onClose: () => void };

function SchedulePlanModal({ order, plan, onClose }: SchedulePlanModalProps) {
  const isEdit = !!plan;
  const machines = useMachines().data ?? [];
  const operators = useOperators().data ?? [];
  const directory = useDirectory().data ?? [];
  const formulas = useLogbookFormulas().data ?? [];
  const schedule = useSchedulePlan();
  const update = useUpdatePlan();
  const canPlan = useCan('action:order.plan');
  const productDefault = plan?.productName || plan?.salesOrder.product || order?.product || '';

  const [machineId, setMachineId] = useState(plan?.machineId || '');
  const [shift, setShift] = useState<'D' | 'N'>((plan?.shift as 'D' | 'N') || 'D');
  const [operatorName, setOperatorName] = useState(plan?.operatorName || '');
  const [date, setDate] = useState((plan?.scheduledStartDate || order?.deliveryDate || '').slice(0, 10));
  const [supervisor, setSupervisor] = useState(plan?.supervisor || '');
  const [drawingNo, setDrawingNo] = useState(plan?.drawingNo || '');
  const [formulaNo, setFormulaNo] = useState(plan?.formulaNo || '');
  const [moldNo, setMoldNo] = useState(plan?.moldNo || '');
  const [productName, setProductName] = useState(productDefault);
  const templates = useLogbookTemplates().data ?? [];
  const [templateId, setTemplateId] = useState(plan?.logbookTemplateId || '');

  useEffect(() => {
    if (!templateId && templates.length && !isEdit) {
      const guess = /rpvc|pipe|profile|nos/i.test(productDefault) ? 'pipe' : 'coil';
      setTemplateId((templates.find((t) => (t.layout ?? 'coil') === guess) ?? templates[0]).id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates.length]);

  const formulaOptions = formulas.map((f) => `${f.code} · Rev ${f.rev}`);
  const supervisors = Array.from(new Set(directory.map((d) => d.name.trim()).filter(Boolean))).sort();
  const mId = machineId || machines[0]?.id || '';
  const pending = schedule.isPending || update.isPending;
  const valid = !!mId && !!date && !!supervisor.trim() && !!drawingNo.trim() && !!formulaNo.trim() && !!moldNo.trim() && !!productName.trim();

  const body = () => {
    const startT = shift === 'D' ? '08:00:00' : '20:00:00';
    const endT = shift === 'D' ? '20:00:00' : '08:00:00';
    return {
      machineId: mId,
      shift,
      operatorName,
      scheduledStartDate: `${date}T${startT}`,
      scheduledEndDate: `${date}T${endT}`,
      logbookTemplateId: templateId || undefined,
      supervisor: supervisor.trim(),
      drawingNo: drawingNo.trim(),
      formulaNo: formulaNo.trim(),
      moldNo: moldNo.trim(),
      productName: productName.trim(),
    };
  };

  const confirm = () => {
    if (!valid || !canPlan || pending) return;
    if (isEdit && plan) {
      update.mutate({ id: plan.id, body: body() }, {
        onSuccess: (p) => {
          pushToast(`${p.salesOrder.soNumber} schedule updated on ${p.machine.code}.`);
          onClose();
        },
        onError: (e) => pushToast(errMsg(e)),
      });
      return;
    }
    if (!order) return;
    schedule.mutate(
      { salesOrderId: order.id, ...body() },
      {
        onSuccess: (p) => {
          pushToast(`${order.soNumber} planned on ${p.machine.code}, Shift ${shift}.`);
          pushNudge('good', `${order.soNumber} planned on ${p.machine.code} — operators will see it on Machine Tasks.`);
          onClose();
        },
        onError: (e) => pushToast(errMsg(e)),
      },
    );
  };

  const title = isEdit ? `Edit ${plan!.salesOrder.soNumber}` : `Plan ${order!.soNumber}`;
  const dueDate = plan?.salesOrder.deliveryDate || order?.deliveryDate || '';

  return (
    <ResponsiveOverlay open onClose={onClose} title={title}>
      <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-800 dark:text-slate-100">{productDefault}</span>
            {(order || plan) && <>
              <span className="text-slate-300">·</span> {(order?.quantity ?? '—')} units
              <span className="text-slate-300">·</span> {(order?.customer.name || plan?.salesOrder.customer.name)}
              {order && priorityChip(order.priority)} {dueDate && <DueBadge date={dueDate} />}
            </>}
          </div>

          <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 dark:bg-indigo-950/30 dark:border-indigo-900 px-3 py-2 text-[11px] text-indigo-800 dark:text-indigo-200">
            Machine Identification &amp; Shift Header is locked in at planning. Operators fill process readings from Machine Tasks.
          </div>

          <label className="block"><span className={planLbl}>Machine</span>
            <select value={mId} onChange={(e) => setMachineId(e.target.value)} className={planInp}>{machines.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.line}</option>)}</select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className={planLbl}>Shift</span>
              <select value={shift} onChange={(e) => setShift(e.target.value as 'D' | 'N')} className={planInp}><option value="D">Day (08–20)</option><option value="N">Night (20–08)</option></select>
            </label>
            <label className="block"><span className={planLbl}>Run date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={planInp} />
            </label>
          </div>
          <label className="block"><span className={planLbl}>Shift supervisor *</span>
            <select value={supervisor} onChange={(e) => setSupervisor(e.target.value)} className={planInp}>
              <option value="">— select supervisor —</option>
              {supervisors.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="block"><span className={planLbl}>Operator</span>
            <select value={operatorName} onChange={(e) => setOperatorName(e.target.value)} className={planInp}>
              <option value="">— assign at shift start —</option>
              {operators.map((op) => <option key={op.id} value={op.user.name}>{op.user.name} ({op.employeeCode})</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className={planLbl}>Drawing No *</span>
              <input value={drawingNo} onChange={(e) => setDrawingNo(e.target.value)} className={planInp} placeholder="e.g. DRW-042" />
            </label>
            <label className="block"><span className={planLbl}>Mold No *</span>
              <input value={moldNo} onChange={(e) => setMoldNo(e.target.value)} className={planInp} placeholder="e.g. MLD-12" />
            </label>
          </div>
          <label className="block"><span className={planLbl}>Formula No *</span>
            <select value={formulaNo} onChange={(e) => setFormulaNo(e.target.value)} className={planInp}>
              <option value="">— select formulation —</option>
              {formulaOptions.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="block"><span className={planLbl}>Product name *</span>
            <input value={productName} onChange={(e) => setProductName(e.target.value)} className={planInp} />
          </label>
          <label className="block"><span className={planLbl}>Logbook template</span>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={planInp}>
              {templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.docNo} · {(tp.layout ?? 'coil') === 'pipe' ? 'Pipe/Nos' : 'Coil/Roll'} — {tp.productName}</option>)}
            </select>
          </label>
          {dueDate && date > dueDate && <div className="text-[11px] font-bold text-rose-600 dark:text-rose-400 inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Run date {date} is after the required date {dueDate} — this will miss the due date.</div>}
          <button onClick={confirm} disabled={!valid || !canPlan || pending} title={canPlan ? undefined : 'No access — ask your administrator'} className="w-full h-14 rounded-lg bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {!canPlan ? 'No access to plan orders' : isEdit
              ? `Save changes · ${machines.find((m) => m.id === mId)?.code ?? 'machine'}, Shift ${shift}`
              : `Schedule on ${machines.find((m) => m.id === mId)?.code ?? 'machine'}, Shift ${shift}`}
          </button>
      </div>
    </ResponsiveOverlay>
  );
}

/* ---------------------------------------------------------------- Plan board (API) */

export function PlanBoardScreen(p: PlannerData) {
  const plansQ = usePlans();
  const release = useReleasePlan();
  const canPlan = useCan('action:order.plan');
  const [editing, setEditing] = useState<ApiPlan | null>(null);
  const plans = plansQ.data ?? [];
  return (
    <>
    <DataTable
      title={`Production plan — ${plans.length} scheduled`}
      loading={plansQ.isLoading}
      rows={plans}
      rowKey={(pl) => pl.id}
      empty={<EmptyState title="No lines planned yet." hint="Plan a confirmed order and it lands on the board here." />}
      dense
      columns={[
        { key: 'machine', header: 'Machine', className: 'font-bold whitespace-nowrap', cell: (pl) => pl.machine.code },
        { key: 'shift', header: 'Shift', cell: (pl) => (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${pl.shift === 'D' ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'}`}>{pl.shift === 'D' ? 'Day' : 'Night'}</span>
        ) },
        { key: 'so', header: 'SO', cell: (pl) => <TraceLink id={pl.salesOrder.soNumber} onTrace={p.onTrace} className="text-indigo-600 dark:text-indigo-400 font-semibold font-mono" /> },
        { key: 'product', header: 'Product / Customer', cell: (pl) => <span className="truncate block max-w-[280px]">{pl.productName || pl.salesOrder.product} · {pl.salesOrder.customer.name}</span> },
        { key: 'header', header: 'Header', cell: (pl) => (
          <span className="text-[11px] text-slate-500 truncate block max-w-[160px]">{pl.supervisor || '—'} · {pl.formulaNo || '—'}</span>
        ) },
        { key: 'date', header: 'Start', className: 'font-mono whitespace-nowrap text-slate-400', cell: (pl) => pl.scheduledStartDate.split('T')[0] },
        { key: 'act', header: '', align: 'right', cell: (pl) => {
          const editable = planIsEditable(pl);
          return (
            <div className="inline-flex items-center gap-1.5">
              {editable && canPlan ? (
                <button type="button" onClick={() => setEditing(pl)} className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-500 border border-indigo-200 rounded-lg px-2 py-1">
                  <Pencil className="w-3 h-3" /> Edit
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400" title={pl.logbook?.status === 'submitted' ? 'Logbook submitted' : 'Start time reached'}>
                  <Lock className="w-3 h-3" /> Locked
                </span>
              )}
              <button onClick={() => release.mutate(pl.id, { onSuccess: () => pushToast(`${pl.salesOrder.soNumber} released — back to the planning queue.`), onError: (e) => pushToast(errMsg(e)) })} disabled={release.isPending || pl.logbook?.status === 'submitted'} className="text-[11px] font-bold text-slate-400 hover:text-rose-600 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 disabled:opacity-50" title="Release this plan back to the queue">Release</button>
            </div>
          );
        } },
      ]}
    />
    {editing && <SchedulePlanModal plan={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/* ---------------------------------------------------------------- Formulations (BOM) */

export function Formulations(p: PlannerData) {
  const formulasQ = useFormulations();
  const formulas = formulasQ.data ?? [];
  const updateFormula = useUpdateFormulation();
  const canEdit = useCan('action:formula.edit');
  const [selId, setSelId] = useState<string>('');
  const [showAdd, setShowAdd] = useState(false);
  const selected = formulas.find((f) => f.id === selId);
  const [draft, setDraft] = useState<number[]>([]);
  const [preview, setPreview] = useState<number[] | null>(null);

  // Default the selection to the active formula once the list loads.
  useEffect(() => {
    if (!selId && formulas.length) setSelId(formulas.find((f) => f.active)?.id ?? formulas[0].id);
  }, [selId, formulas]);

  // keep draft in sync when selection changes
  const editable = selected && !selected.locked;
  const comps = selected?.components ?? [];
  const cur = draft.length === comps.length ? draft : comps.map((c) => c.pct);
  const sum = cur.reduce((a, b) => a + b, 0);

  const selectFormula = (id: string) => { setSelId(id); const f = formulas.find((x) => x.id === id); setDraft(f ? f.components.map((c) => c.pct) : []); setPreview(null); };

  const normalize = () => {
    if (Math.round(sum) === 100) { pushToast('Already totals 100% — no adjustment needed.'); return; }
    setPreview(cur.map((v) => Math.round((v / sum) * 1000) / 10));
  };
  const confirmNormalize = () => {
    if (!selected || !preview) return;
    updateFormula.mutate(
      { id: selected.id, patch: { components: selected.components.map((c, i) => ({ ...c, pct: preview[i] ?? c.pct })) } },
      {
        onSuccess: () => { setDraft(preview); setPreview(null); pushToast(`${selected.code} Rev ${selected.rev} adjusted to total 100%.`); },
        onError: (e) => pushToast(e instanceof ApiError ? e.message : 'Could not save the formulation.'),
      },
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card title="Formulations" right={canEdit ? (
        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1 h-8 px-3 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold"><Plus className="w-3.5 h-3.5" /> Add formulation</button>
      ) : undefined}>
        {formulasQ.isLoading ? <div className="text-[12px] text-slate-400 py-6 text-center">Loading…</div> : formulas.length === 0 ? (
          <EmptyState icon={<Beaker className="w-8 h-8" />} title="No formulations yet." hint="Add your first BOM to start." />
        ) : (
        <div className="space-y-1.5">
          {formulas.map((f) => (
            <button key={f.id} onClick={() => selectFormula(f.id)} className={`w-full text-left rounded-lg border p-2.5 ${f.id === selId ? 'border-indigo-500 ring-1 ring-indigo-300' : 'border-slate-200 dark:border-slate-800'} ${f.locked ? 'opacity-70' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-[13px]">{f.code} · Rev {f.rev}</span>
                {f.locked ? <Lock className="w-3.5 h-3.5 text-rose-500" /> : f.active ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : null}
              </div>
              <div className="text-[11px] text-slate-500 truncate">{f.product}</div>
              {f.locked && <div className="text-[10px] text-rose-600 mt-0.5">{f.lockReason}</div>}
            </button>
          ))}
        </div>
        )}
      </Card>

      <div className="lg:col-span-2">
        <Card title={selected ? `${selected.code} Rev ${selected.rev} — components` : 'Components'}>
          {!selected ? <EmptyState title="Pick a formulation." /> : selected.locked ? (
            <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-start gap-2">
              <Lock className="w-4 h-4 shrink-0 mt-0.5" />
              <div>This revision is locked and cannot be edited. {selected.lockReason} <button onClick={() => p.onOpen('sales_complaints')} className="underline font-bold">Open {selected.capaId}</button></div>
            </div>
          ) : (
            <>
              <table className="w-full text-[12px]">
                <thead><tr className="text-slate-400 text-[10px] uppercase"><th className="text-left py-1">Component</th><th className="text-left py-1">RM lot</th><th className="text-right py-1">%</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {comps.map((c, i) => (
                    <tr key={i}>
                      <td className="py-2 text-slate-700 dark:text-slate-200">{c.name}</td>
                      <td className="py-2"><TraceLink id={c.lotId} onTrace={p.onTrace} className="font-mono text-[11px] text-slate-500" /></td>
                      <td className="py-2 text-right">
                        <input type="number" value={cur[i]} disabled={!editable}
                          onChange={(e) => { const d = [...cur]; d[i] = Number(e.target.value); setDraft(d); setPreview(null); }}
                          className="w-16 text-right border border-slate-300 rounded px-1 py-0.5 font-mono" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 flex items-center justify-between">
                <span className={`text-[12px] font-bold ${Math.round(sum) === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>Total: {Math.round(sum * 10) / 10}%</span>
                <button onClick={normalize} className="h-11 px-4 rounded-lg bg-slate-800 text-white text-xs font-bold hover:bg-slate-700">Normalize to 100%</button>
              </div>

              {preview && (
                <div className="mt-3 border border-indigo-200 bg-indigo-50/40 rounded-lg p-3">
                  <div className="text-[12px] font-bold text-indigo-800 mb-2">Your entries totalled {Math.round(sum * 10) / 10}%. Adjust proportionally to reach 100%?</div>
                  <table className="w-full text-[12px] mb-2">
                    <thead><tr className="text-slate-400 text-[10px] uppercase"><th className="text-left">Component</th><th className="text-right">Before</th><th className="text-right">After</th></tr></thead>
                    <tbody>
                      {comps.map((c, i) => (
                        <tr key={i}><td className="text-slate-600">{c.name}</td><td className="text-right font-mono">{cur[i]}%</td><td className="text-right font-mono font-bold text-indigo-700">{preview[i]}%</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex gap-2">
                    <button onClick={confirmNormalize} className="h-11 px-4 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700">Confirm adjustment</button>
                    <button onClick={() => setPreview(null)} className="h-11 px-4 rounded-lg border border-slate-300 text-xs font-bold">Keep my numbers</button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {showAdd && <AddFormulationModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}

/* Add a new formulation (BOM). A repeat code creates the next revision server-side. */
function AddFormulationModal({ onClose }: { onClose: () => void }) {
  const create = useCreateFormulation();
  const [code, setCode] = useState('');
  const [product, setProduct] = useState('');
  const [rows, setRows] = useState<{ name: string; pct: string; lotId: string }[]>([{ name: '', pct: '', lotId: '' }]);
  const setRow = (i: number, k: 'name' | 'pct' | 'lotId', v: string) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));
  const addRow = () => setRows((r) => [...r, { name: '', pct: '', lotId: '' }]);
  const removeRow = (i: number) => setRows((r) => (r.length === 1 ? r : r.filter((_, idx) => idx !== i)));

  const comps: ApiFormulaComponent[] = rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), pct: Number(r.pct) || 0, lotId: r.lotId.trim() }));
  const sum = comps.reduce((a, c) => a + c.pct, 0);
  const valid = code.trim() !== '' && comps.length >= 1;

  const submit = () => {
    if (!valid || create.isPending) return;
    create.mutate(
      { code: code.trim(), product: product.trim(), components: comps },
      {
        onSuccess: (f: ApiFormula) => { pushToast(`Formulation ${f.code} Rev ${f.rev} added.`); onClose(); },
        onError: (e) => pushToast(e instanceof ApiError ? e.message : 'Could not add the formulation.'),
      },
    );
  };

  const inCls = 'w-full min-h-[38px] px-2.5 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 placeholder-slate-400';
  return (
    <ResponsiveOverlay open onClose={onClose} title="Add a formulation" wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block"><span className="block text-[11px] font-bold text-slate-500 mb-1">Code</span><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. RF04" className={inCls + ' font-mono uppercase'} /></label>
          <label className="block"><span className="block text-[11px] font-bold text-slate-500 mb-1">Product</span><input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Product this BOM makes" className={inCls} /></label>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold text-slate-500">Components</span>
            <span className={`text-[11px] font-bold ${Math.round(sum) === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>Total: {Math.round(sum * 10) / 10}%</span>
          </div>
          <div className="space-y-1.5">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_64px_92px_28px] gap-1.5 items-center">
                <input value={r.name} onChange={(e) => setRow(i, 'name', e.target.value)} placeholder="Component" className={inCls} />
                <input value={r.pct} onChange={(e) => setRow(i, 'pct', e.target.value)} inputMode="decimal" placeholder="%" className={inCls + ' text-right'} />
                <input value={r.lotId} onChange={(e) => setRow(i, 'lotId', e.target.value)} placeholder="RM lot" className={inCls + ' font-mono text-[11px]'} />
                <button onClick={() => removeRow(i)} disabled={rows.length === 1} className="text-slate-400 hover:text-rose-600 disabled:opacity-30 shrink-0" title="Remove component"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
          <button onClick={addRow} className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold text-indigo-600 hover:text-indigo-500"><Plus className="w-3.5 h-3.5" /> Add component</button>
          <p className="mt-1 text-[10px] text-slate-400">Percentages needn't total 100% here — use “Normalize to 100%” after saving.</p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="min-h-[42px] px-4 rounded-full border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300">Cancel</button>
          <button onClick={submit} disabled={!valid || create.isPending} className="min-h-[42px] px-5 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-bold inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add formulation</button>
        </div>
      </div>
    </ResponsiveOverlay>
  );
}

/* ---------------------------------------------------------------- Machine Capacity */


/* ---------------------------------------------------------------- Material Availability */

