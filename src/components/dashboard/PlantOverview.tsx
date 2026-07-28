/**
 * PlantOverview.tsx — Layer 3. The shared mental model.
 *
 * One colour-coded map of the whole chain, identical for every role, so that
 * "where is this stuck?" has the same answer whoever is asked. It runs the full
 * length of the business, not just the factory floor:
 *
 *   procurement → incoming inspection → store issue → inquiry → order →
 *   planning → extrusion → QA → packing → warehousing → dispatch →
 *   complaints & CAPA → maintenance → calibration & review
 *
 * Each stage shows a real count in physical units and is a door into the screen
 * that owns it. Stages the role cannot open stay visible — the map is a shared
 * model, and hiding a stage would break the shape everyone has learned — but
 * they say plainly that access is needed rather than leading to a locked door.
 */

import type { ReactElement } from 'react';
import {
  Truck, ArrowDownToLine, Boxes, FileSpreadsheet, ClipboardList, CalendarClock,
  Factory, ClipboardCheck, PackageCheck, Warehouse, ShieldAlert, Wrench, Gauge,
  Lock, type LucideIcon,
} from 'lucide-react';
import type { Tone } from './statusLanguage';
import { qty, kg } from './statusLanguage';
import { SectionHeading, toneClass, toneSolid } from './primitives';
import type { PlantData } from './plantData';
import { totalOnHand } from './plantData';
import type { LiveMachine } from '../../lib/simulation';

interface Stage {
  key: string;
  label: string;
  icon: LucideIcon;
  /** The figure under the label — always a real quantity. */
  value: string;
  /** One line saying what this stage is waiting on. */
  note: string;
  tone: Tone;
  /** Screen that owns this stage. */
  target: string;
}

/** The chain, in the order material and paperwork actually move. */
function buildStages(data: PlantData, live: LiveMachine[]): Stage[] {
  const rmGrades = data.rawMaterialStock;
  const openInquiries = data.inquiries.filter((i) => i.status === 'draft' || i.status === 'submitted');
  const unplanned = data.salesOrders.filter((o) => o.status === 'pending');
  const scheduled = data.productionPlans.filter((p) => p.status === 'scheduled');
  const running = live.filter((m) => m.status === 'running');
  const stopped = live.filter((m) => m.status === 'stopped');
  const attention = live.filter((m) => m.status === 'attention');
  const holds = data.inspections.filter((i) => i.decision === 'hold');
  const awaitingQa = data.machineLogbooks.reduce(
    (n, lb) => n + lb.rolls.filter((r) => r.status === 'pending').length, 0);
  const packed = data.salesOrders.filter((o) => o.status === 'packed');
  const fgKg = totalOnHand(data.finishedGoodsStock);
  const openComplaints = data.complaints.filter((c) => c.status !== 'resolved');
  const openCapas = data.capas.filter((c) => c.status !== 'closed');
  const overdueMaint = data.maintenanceTasks.filter((t) => t.status === 'overdue');
  const calibration = data.maintenanceTasks.filter((t) => t.type === 'Calibration');

  return [
    {
      key: 'procurement', label: 'Procurement', icon: Truck,
      value: qty(rmGrades.length), note: 'raw-material grades booked into the store',
      tone: 'green', target: 'receive',
    },
    {
      key: 'incoming', label: 'Incoming inspection', icon: ArrowDownToLine,
      value: qty(rmGrades.length), note: 'grades to check before they enter the store',
      tone: rmGrades.length > 0 ? 'amber' : 'green', target: 'receive',
    },
    {
      key: 'store_issue', label: 'Store issue', icon: Boxes,
      value: qty(scheduled.length), note: 'lots to issue against scheduled plans',
      tone: scheduled.length > 0 ? 'amber' : 'green', target: 'issue_lot',
    },
    {
      key: 'inquiry', label: 'Inquiry', icon: FileSpreadsheet,
      value: qty(openInquiries.length), note: 'open inquiries waiting for a quotation',
      tone: openInquiries.length > 0 ? 'amber' : 'green', target: 'inquiries',
    },
    {
      key: 'order', label: 'Order', icon: ClipboardList,
      value: qty(data.salesOrders.length), note: 'orders on the book',
      tone: 'green', target: 'orders',
    },
    {
      key: 'planning', label: 'Planning', icon: CalendarClock,
      value: qty(unplanned.length), note: 'confirmed orders with no machine yet',
      tone: unplanned.length > 0 ? 'amber' : 'green', target: 'orders_to_plan',
    },
    {
      key: 'extrusion', label: 'Extrusion', icon: Factory,
      value: `${running.length} of ${live.length}`,
      note: stopped.length > 0
        ? `${stopped.length} stopped, ${attention.length} needing attention`
        : 'lines running now',
      tone: stopped.length > 0 ? 'red' : attention.length > 0 ? 'amber' : 'green',
      target: 'plan_board',
    },
    {
      key: 'qa', label: 'Quality check', icon: ClipboardCheck,
      value: qty(awaitingQa), note: holds.length > 0 ? `${holds.length} on hold` : 'rolls waiting for a verdict',
      tone: holds.length > 0 ? 'red' : awaitingQa > 0 ? 'amber' : 'green',
      target: 'roll_queue',
    },
    {
      key: 'packing', label: 'Packing', icon: PackageCheck,
      value: qty(data.packingRecords.length), note: 'rolls palletised and labelled',
      tone: 'green', target: 'roll_queue',
    },
    {
      key: 'warehousing', label: 'Warehousing', icon: Warehouse,
      value: kg(fgKg),
      note: 'finished goods on hand', tone: 'green', target: 'rm_stock',
    },
    {
      key: 'dispatch', label: 'Dispatch', icon: Truck,
      value: qty(packed.length), note: 'orders packed and ready to load',
      tone: packed.length > 0 ? 'amber' : 'green', target: 'ready',
    },
    {
      key: 'complaints', label: 'Complaints & CAPA', icon: ShieldAlert,
      value: qty(openComplaints.length + openCapas.length),
      note: `${openComplaints.length} complaints, ${openCapas.length} CAPAs open`,
      tone: openComplaints.length > 0 || openCapas.length > 0 ? 'red' : 'green',
      target: 'sales_complaints',
    },
    {
      key: 'maintenance', label: 'Maintenance', icon: Wrench,
      value: qty(overdueMaint.length), note: 'jobs past their due date',
      tone: overdueMaint.length > 0 ? 'red' : 'green', target: 'preventive',
    },
    {
      key: 'calibration', label: 'Calibration & review', icon: Gauge,
      value: qty(calibration.length), note: 'instrument checks on the schedule',
      tone: 'green', target: 'preventive',
    },
  ];
}

export function PlantOverview({ data, live, onOpen, canOpen }: {
  data: PlantData;
  live: LiveMachine[];
  onOpen: (screen: string, filter?: string) => void;
  canOpen: (screen: string) => boolean;
}): ReactElement {
  const stages = buildStages(data, live);
  const trouble = stages.filter((s) => s.tone === 'red');

  return (
    <div className="space-y-6 pb-24 lg:pb-6">
      <div>
        <h2 className="font-display text-[24px] leading-tight font-bold text-slate-900">Plant overview</h2>
        <p className="text-[15px] text-slate-600 mt-0.5">
          The whole chain, from the supplier's lorry to the customer's complaint. Same map for everyone.
        </p>
      </div>

      {trouble.length > 0 && (
        <p className={`rounded-xl border px-4 py-3 text-[16px] font-semibold ${toneClass('red')}`}>
          {trouble.length === 1 ? '1 stage needs attention' : `${trouble.length} stages need attention`}:{' '}
          {trouble.map((s) => s.label).join(', ')}.
        </p>
      )}

      <section aria-label="The chain">
        <SectionHeading>Follow the material</SectionHeading>
        <ol className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
          {stages.map((s, i) => {
            const allowed = canOpen(s.target);
            const Icon = s.icon;
            return (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => onOpen(s.target)}
                  disabled={!allowed}
                  title={allowed ? `Open ${s.label}` : 'You do not have access to this screen — ask your administrator.'}
                  className={`w-full h-full text-left min-h-[124px] rounded-xl border bg-white p-4 transition
                    ${allowed
                      ? 'border-slate-200 hover:border-blue-500 hover:shadow-[var(--shadow-custom)] cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2'
                      : 'border-slate-200 cursor-not-allowed'}`}
                >
                  {/* Step number keeps the order readable when the grid wraps. */}
                  <span className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[13px] font-bold ${toneClass(s.tone)}`}>
                      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                      Step {i + 1}
                    </span>
                    <span className={`w-2.5 h-2.5 rounded-full ${toneSolid(s.tone)}`} aria-hidden="true" />
                  </span>

                  <span className="mt-2 block font-display text-[17px] font-bold text-slate-900">{s.label}</span>
                  <span className="mt-1 block font-display text-[26px] leading-none font-bold data-value tabular-nums">
                    {s.value}
                  </span>
                  <span className="mt-1.5 block text-[14px] text-slate-600 leading-snug">{s.note}</span>

                  {!allowed && (
                    <span className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-slate-600">
                      <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      Ask your administrator for access
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
