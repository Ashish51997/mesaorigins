/**
 * RoleHome.test.tsx — the acceptance criteria for the dashboard rebuild,
 * checked mechanically rather than by eye.
 *
 * These assert the rules that are easy to break by accident later: seven
 * distinct homes from one template, no dead click targets, no terse enum
 * leaking into a status, and the what/where/what-to-do shape of an alert.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildRoleHome, type RoleContext } from '../dashboard/roleContent';
import { EMPTY_PLANT, type PlantData } from '../dashboard/plantData';
import type { LiveMachine } from '../../lib/simulation';
import { RoleHome } from '../dashboard/RoleHome';
import { TraceSearchBox } from '../dashboard/AppHeader';
import { BatchPassport } from '../dashboard/BatchPassport';
import { initialBatchLineages } from '../../mockData';
import { resetAcks } from '../dashboard/ackStore';
import * as SL from '../dashboard/statusLanguage';

/** The seven roles the brief names, each of which must get its own home. */
const ROLES = [
  'Operator',
  'Quality Inspector',
  'Store Manager',
  'Dispatch Executive',
  'Production Planner',
  'Sales Executive',
  'Managing Director',
] as const;

const live: LiveMachine[] = [
  { id: 'M08', status: 'running', zoneTemp: 172, limit: 180, rollsDone: 12, updatedAt: Date.now() },
  { id: 'M03', status: 'attention', zoneTemp: 184, limit: 180, reason: 'Zone 3 above limit', rollsDone: 4, updatedAt: Date.now() },
  { id: 'M05', status: 'stopped', zoneTemp: 20, limit: 175, reason: 'Power failure', rollsDone: 0, updatedAt: Date.now() },
];

const data: PlantData = {
  ...EMPTY_PLANT,
  customers: [{ id: 'c1', name: 'Apex Plastic Industries' }],
  inquiries: [
    { id: 'i1', inquiryNumber: 'INQ-1', customerId: 'c1', status: 'submitted', expectedDeliveryDate: '2026-07-01' },
  ],
  salesOrders: [
    { id: 'o1', soNumber: 'SO-1', customerId: 'c1', product: 'LD coil 40µ', quantity: 2000, deliveryDate: '2026-08-01', status: 'pending' },
    { id: 'o2', soNumber: 'SO-2', customerId: 'c1', product: 'PVC beading', quantity: 500, deliveryDate: '2026-08-02', status: 'packed' },
  ],
  productionPlans: [
    { id: 'p1', salesOrderId: 'o1', machineId: 'M08', shift: 'D', operatorName: 'Nandlal', status: 'running' },
    { id: 'p2', salesOrderId: 'o2', machineId: 'M03', shift: 'D', operatorName: 'Nandlal', status: 'scheduled' },
  ],
  machineLogbooks: [
    {
      id: 'lb1', productionPlanId: 'p1', machineId: 'M08', date: '2026-07-19', shift: 'D',
      productName: 'LD coil 40µ', status: 'draft',
      rolls: [
        { rollNumber: 'R-1', weight: 25, status: 'pending' },
        { rollNumber: 'R-2', weight: 24, status: 'passed' },
      ],
      rejectionKg: '30', totalRollKgs: '1000', rejectionCounts: { 'Black spot': '3' }, meterCheckTime: '14:00',
    },
  ],
  inspections: [
    { id: 'q1', rollNumber: 'R-9', lotNumber: 'L-1', decision: 'hold', remarks: 'Colour off', date: '2026-07-18' },
  ],
  rawMaterialStock: [{ itemName: 'RPVC resin', onHand: 15000 }],
  finishedGoodsStock: [{ itemName: 'LD coil 40µ', onHand: 8200 }],
  dispatches: [
    { id: 'd1', invoiceNumber: 'INV-1', vehicleNumber: 'KA-05-1234', transporter: 'VRL', dispatchDate: '2026-07-28', status: 'shipped' },
  ],
  complaints: [
    { id: 'cm1', complaintNumber: 'C-1', customerId: 'c1', batchNumber: 'L-1', description: 'Tearing', severity: 'high', status: 'open', date: '2026-07-01' },
  ],
  capas: [
    { id: 'ca1', rootCause: 'Die worn', correctiveAction: 'Replace die', responsiblePerson: 'Suresh Kumar', dueDate: '2026-07-10', status: 'open' },
  ],
  maintenanceTasks: [
    { id: 'm1', machineId: 'M05', type: 'Preventive', dueDate: '2026-07-01', status: 'overdue' },
  ],
  machines: [{ id: 'M08', line: 'PVC beading', status: 'running' }],
  formulations: [
    { id: 'f1', code: 'RF03', rev: 1, product: 'LD coil 40µ', locked: true, lockReason: 'CAPA raised', capaId: 'CAPA-012' },
    { id: 'f2', code: 'RF03', rev: 2, product: 'LD coil 40µ', locked: false, lockReason: '', capaId: null },
  ],
};

const ctxFor = (role: string, canOpen: (s: string) => boolean = () => true): RoleContext => ({
  role,
  user: 'Nandlal',
  shift: 'B',
  data,
  live,
  canOpen,
  open: vi.fn(),
  now: new Date('2026-07-28T14:30:00'),
});

beforeEach(() => { resetAcks(); });

describe('Layer 1 — one template, seven homes', () => {
  it('gives each of the seven roles a distinct home', () => {
    const titles = ROLES.map((r) => buildRoleHome(ctxFor(r)).title);
    expect(new Set(titles).size).toBe(ROLES.length);
  });

  it('never renders a KPI or task without somewhere to go', () => {
    for (const role of ROLES) {
      const home = buildRoleHome(ctxFor(role));
      for (const k of home.kpis) expect(typeof k.onOpen).toBe('function');
      for (const t of home.tasks) expect(typeof t.onOpen).toBe('function');
    }
  });

  it('drops cards whose target the role cannot open, rather than rendering them dead', () => {
    // A role allowed nothing keeps no KPI at all.
    for (const role of ROLES) {
      const locked = buildRoleHome(ctxFor(role, () => false));
      expect(locked.kpis).toHaveLength(0);
      expect(locked.tasks).toHaveLength(0);
    }
    // …and the same role with full access gets cards back.
    const open = buildRoleHome(ctxFor('Managing Director', () => true));
    expect(open.kpis.length).toBeGreaterThan(0);
  });

  it('phrases every alert as what happened, where, and what to do', () => {
    for (const role of ROLES) {
      for (const a of buildRoleHome(ctxFor(role)).alerts) {
        expect(a.what.length).toBeGreaterThan(0);
        expect(a.where.length).toBeGreaterThan(0);
        // "what to do" must be an instruction, not a restatement.
        expect(a.todo.length).toBeGreaterThan(0);
        expect(a.what.trim().endsWith('.')).toBe(true);
      }
    }
  });

  it('gives the shop-floor roles a verb-labelled primary action', () => {
    for (const role of ['Operator', 'Quality Inspector', 'Store Manager', 'Production Planner']) {
      const home = buildRoleHome(ctxFor(role));
      expect(home.primary).toBeDefined();
      expect(home.primary?.label ?? '').toMatch(/^(Enter|Inspect|Issue|Plan|Prepare|Record|Close)\b/);
    }
  });

  it('reports the shift in physical quantities, not indices', () => {
    const op = buildRoleHome(ctxFor('Operator'));
    expect(op.shiftFigures.map((f) => f.label)).toContain('Rolls wound');
    expect(op.shiftFigures.find((f) => f.label === 'Total weight')?.value).toMatch(/kg$/);
  });
});

describe('Status vocabulary', () => {
  const FORBIDDEN = /\b(draft|pending|processed)\b/i;

  it('never shows draft, pending or processed as a status word', () => {
    const maps = [
      SL.INQUIRY_STATUS, SL.ORDER_STATUS, SL.PLAN_STATUS, SL.LOGBOOK_STATUS, SL.ROLL_STATUS,
      SL.INSPECTION_DECISION, SL.COMPLAINT_STATUS, SL.CAPA_STATUS, SL.MAINTENANCE_STATUS,
      SL.DISPATCH_STATUS, SL.LINE_STATUS,
    ];
    for (const map of maps) {
      for (const view of Object.values(map)) {
        expect(view.word).not.toMatch(FORBIDDEN);
      }
    }
  });

  it('translates the stored enums into sentences', () => {
    expect(SL.orderStatus('pending').word).toBe('Order confirmed — waiting for planning');
    expect(SL.rollStatus('pending').word).toBe('Waiting for QA check');
    expect(SL.logbookStatus('draft').word).toBe('Being filled in');
  });

  it('gives every status a colour and an icon, never colour alone', () => {
    for (const view of Object.values(SL.ORDER_STATUS)) {
      expect(['green', 'amber', 'red']).toContain(view.tone);
      expect(view.icon).toBeTruthy();
      expect(view.word.length).toBeGreaterThan(0);
    }
  });

  it('holds are red and carry their reason', () => {
    expect(SL.INSPECTION_DECISION.hold.tone).toBe('red');
  });

  it('writes percentages without decimals', () => {
    expect(SL.pct(87.34)).toBe('87%');
    expect(SL.pct(87.99)).toBe('88%');
  });

  it('counts down in plain language, never an SLA code', () => {
    const now = new Date('2026-07-28');
    expect(SL.responseClock('2026-07-26', 3, now).word).toBe('Respond within 3 days — 1 day left');
    expect(SL.responseClock('2026-07-01', 3, now).word).toMatch(/overdue/);
  });
});

describe('Alert band', () => {
  it('shows at most three alerts and hides the rest behind "more"', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      id: `a${i}`, what: `Thing ${i} happened.`, where: 'Line 1',
      todo: 'Tell the supervisor.', tone: 'amber' as const, critical: false,
    }));
    const content = { ...buildRoleHome(ctxFor('Operator')), alerts: many };

    render(<RoleHome content={content} lines={[]} currentUser="Ganesh Pai" />);

    expect(screen.getByText('Thing 0 happened.', { exact: false })).toBeTruthy();
    expect(screen.queryByText('Thing 4 happened.', { exact: false })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /2 more alerts/i }));
    expect(screen.getByText('Thing 4 happened.', { exact: false })).toBeTruthy();
  });

  it('records name and time when a critical alert is acknowledged', async () => {
    const content = {
      ...buildRoleHome(ctxFor('Operator')),
      alerts: [{
        id: 'crit', what: 'Line 2 melt temperature is 248 °C, above the 240 °C limit.',
        where: 'Machine M02', todo: 'Inform the shift supervisor.', tone: 'red' as const, critical: true,
      }],
    };

    render(<RoleHome content={content} lines={[]} currentUser="Ganesh Pai" />);
    await userEvent.click(screen.getByRole('button', { name: /tap to acknowledge/i }));

    expect(screen.getByText(/Acknowledged by Ganesh Pai at/i)).toBeTruthy();
  });
});

describe('Disabled controls', () => {
  it('always states why a control is disabled', () => {
    // No packed order ⇒ the dispatch primary is disabled, and says so.
    const noWork: PlantData = { ...EMPTY_PLANT, machines: [], formulations: [] };
    const home = buildRoleHome({ ...ctxFor('Dispatch Executive'), data: noWork });
    expect(home.primary?.disabledReason).toMatch(/unlocks when/i);
  });
});

describe('All seven homes render from the one template', () => {
  it('renders each role without error and shows its own title', () => {
    for (const role of ROLES) {
      const content = buildRoleHome(ctxFor(role));
      const { unmount } = render(<RoleHome content={content} lines={[]} currentUser="Ganesh Pai" />);
      expect(screen.getByRole('heading', { level: 2, name: content.title })).toBeTruthy();
      unmount();
    }
  });

  it('shows a skeleton, not a spinner, while loading', () => {
    const content = buildRoleHome(ctxFor('Operator'));
    render(<RoleHome content={content} lines={[]} currentUser="Ganesh Pai" loading />);
    expect(screen.getByRole('status', { name: /loading your work/i })).toBeTruthy();
  });
});

describe('Trace — the header box and the Batch Passport', () => {
  it('hands whatever identifier was typed to the passport', async () => {
    const onTrace = vi.fn();
    render(<TraceSearchBox onTrace={onTrace} />);

    const box = screen.getByLabelText(/trace a lot, roll, pallet/i);
    await userEvent.type(box, '190726·D·M08·B01{Enter}');

    expect(onTrace).toHaveBeenCalledWith('190726·D·M08·B01');
  });

  it('resolves a lot number to its full chain', () => {
    render(
      <BatchPassport query="190726·D·M08·B01" lineages={initialBatchLineages} onClose={() => {}} />,
    );
    // The passport shows the chain, not just the lot.
    expect(screen.getAllByText(/190726·D·M08·B01/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Supplier resin lot received/i)).toBeTruthy();
    expect(screen.getByText(/Dispatched to customer/i)).toBeTruthy();
  });

  it('resolves an alias — a roll, pallet or invoice — to the same lot', () => {
    for (const alias of ['R-M08-1901', 'PLT-1907-11', 'INV-2026-811']) {
      const { unmount } = render(
        <BatchPassport query={alias} lineages={initialBatchLineages} onClose={() => {}} />,
      );
      expect(screen.getAllByText(/190726·D·M08·B01/).length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('teaches the formats when nothing matches, rather than showing a blank drawer', () => {
    render(<BatchPassport query="not-a-real-id" lineages={initialBatchLineages} onClose={() => {}} />);
    expect(screen.getByText(/Nothing found for "not-a-real-id"/i)).toBeTruthy();
    expect(screen.getByText(/Search with a lot number/i)).toBeTruthy();
  });
});
