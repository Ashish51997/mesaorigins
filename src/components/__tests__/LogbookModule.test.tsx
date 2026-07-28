import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The operator LogbookModule talks to the API (templates, scheduled-plan gate,
// open/save/submit). Mock the client so tests drive it without a server.
vi.mock('../../lib/apiClient', () => ({
  ApiError: class ApiError extends Error { status = 0; code = ''; },
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));
import { api } from '../../lib/apiClient';
import LogbookModule from '../LogbookModule';
import { initialLogbookTemplates } from '../../mockData';

const get = api.get as ReturnType<typeof vi.fn>;
const post = api.post as ReturnType<typeof vi.fn>;
const patch = api.patch as ReturnType<typeof vi.fn>;

const template = initialLogbookTemplates[0];
const PLAN_ID = 'plan-1';
const apiPlan = {
  id: PLAN_ID, salesOrderId: 'so-1', machineId: 'mc1', shift: 'D', operatorName: 'Nandlal',
  scheduledStartDate: '2026-07-25T08:00:00', scheduledEndDate: '2026-07-25T20:00:00', status: 'scheduled',
  machine: { code: 'M08', logbookFormat: template.docNo }, salesOrder: { soNumber: 'SO-2026-150', product: 'RPVC 20mm' }, logbook: null,
};

function blankLogbook() {
  return {
    id: 'lb-1', productionPlanId: PLAN_ID, templateId: template.id, status: 'draft',
    rolls: [], scrapKg: '', operatorSignature: '', supervisorSignature: '',
    machineId: 'M08', date: '2026-07-25', shift: template.shifts[0] ?? 'A', supervisor: '',
    drawingNo: '', tag: '', formulaNo: '',
    dieZoneTemps: Object.fromEntries(template.dieZones.map((z) => [z, ''])),
    barrelZoneTemps: Object.fromEntries(template.barrelZones.map((z) => [z, ''])),
    motorSpeed: '', ampere: '', takeupSpeed: '', vacuum: '', extruderStartTime: '', productSetTime: '',
    shoreHardness: '', productionPerHour: '', moldNo: '', productName: template.productName,
    coilWeights: Array.from({ length: template.coil.count }, () => ''),
    hourlyInspections: template.inspectionTimeSlots.map((slot) => ({ timeSlot: slot, topDim: '', bottomDim: '', thickness: Array.from({ length: template.dimensionSpecs.thickness.count }, () => ''), finish: '', perMeter: '', colour: '', tearing: '', inspectionBy: '' })),
    traceabilityRows: Array.from({ length: template.traceability.tableCount * template.traceability.rowsPerTable }, () => ({ lotNumber: '', colour: '', code: '', winderPackedBy: '' })),
    totalRollsProduced: '', totalRollKgs: '', processWasteKg: '', lumpsWasteKg: '', rejectionKg: '', totalConsumedKg: '',
    rejectionCounts: {}, meterCheckedBy: '', meterCheckTime: '', meter: '', meterCountSet: '',
  };
}

function setupApi(plans: unknown[] = [apiPlan]) {
  get.mockImplementation((path: string) => {
    if (path === '/logbook/templates') return Promise.resolve([template]);
    if (path === '/logbook/plans') return Promise.resolve(plans);
    return Promise.resolve([]);
  });
  post.mockImplementation((path: string) => {
    if (path === '/logbooks') return Promise.resolve(blankLogbook());
    if (path.endsWith('/submit')) return Promise.resolve({ ...blankLogbook(), status: 'submitted' });
    return Promise.resolve({});
  });
  patch.mockResolvedValue(blankLogbook());
}

function renderModule(initialTab: 'operator' | 'admin' = 'operator') {
  const setMachineLogbooks = vi.fn();
  const setTemplates = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactElement = (
    <QueryClientProvider client={qc}>
      <LogbookModule
        templates={initialLogbookTemplates} setTemplates={setTemplates as never}
        machineLogbooks={[]} setMachineLogbooks={setMachineLogbooks as never}
        productionPlans={[] as never} salesOrders={[] as never} initialTab={initialTab}
      />
    </QueryClientProvider>
  );
  return { ...render(ui), setMachineLogbooks, setTemplates };
}

function panelInput(label: string): HTMLInputElement {
  const nodes = screen.getAllByText(label);
  for (const node of nodes) {
    const input = node.closest('label')?.querySelector('input');
    if (input) return input as HTMLInputElement;
  }
  throw new Error(`no input for panel label "${label}"`);
}

beforeEach(() => { get.mockReset(); post.mockReset(); patch.mockReset(); });

describe('LogbookModule (operator)', () => {
  it('is gated on a scheduled extruder — no schedule, no logbook', async () => {
    setupApi([]);
    renderModule('operator');
    expect(await screen.findByText(/No extruder scheduled/i)).toBeTruthy();
  });

  it('opens the logbook for the scheduled plan and renders the sheet + fill panel', async () => {
    setupApi();
    const { container } = renderModule('operator');
    expect(await screen.findByText(/Fill panel/i)).toBeTruthy();
    expect(container.querySelector('.sheet-wrap')).toBeTruthy();
    await waitFor(() => expect(post).toHaveBeenCalledWith('/logbooks', { productionPlanId: PLAN_ID }));
  });

  it('typing in the fill panel reflects live on the sheet (two-way sync)', async () => {
    setupApi();
    const { container } = renderModule('operator');
    await screen.findByText(/Fill panel/i);
    fireEvent.change(panelInput('Machine No'), { target: { value: 'M77' } });
    const withValue = Array.from(container.querySelectorAll('input')).filter((el) => (el as HTMLInputElement).value === 'M77');
    expect(withValue.length).toBeGreaterThanOrEqual(2);
  });

  it('submitting saves then submits via the API', async () => {
    setupApi();
    renderModule('operator');
    await screen.findByText(/Fill panel/i);
    await waitFor(() => expect(panelInput('Machine No').value).toBe('M08')); // wait for the logbook to load
    fireEvent.change(panelInput('Operator (signature)'), { target: { value: 'Nandlal' } });
    fireEvent.click(screen.getByText('Submit & lock'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/logbooks/lb-1/submit'));
    expect(patch).toHaveBeenCalled();
  });

  it('blocks submit without operator signature', async () => {
    setupApi();
    renderModule('operator');
    await screen.findByText(/Fill panel/i);
    await waitFor(() => expect(panelInput('Machine No').value).toBe('M08'));
    post.mockClear();
    fireEvent.click(screen.getByText('Submit & lock'));
    expect(await screen.findByText(/Fix these before submitting/i)).toBeTruthy();
    expect(screen.getAllByText(/operator must sign/i).length).toBeGreaterThan(0);
    expect(post).not.toHaveBeenCalledWith('/logbooks/lb-1/submit');
  });

  it('blocks submit when a value is outside the permissible range', async () => {
    setupApi();
    renderModule('operator');
    await screen.findByText(/Fill panel/i);
    await waitFor(() => expect(panelInput('Machine No').value).toBe('M08'));
    fireEvent.change(panelInput('Operator (signature)'), { target: { value: 'Nandlal' } });
    const zoneLabel = template.dieZones[0];
    const zoneSpan = screen.getAllByText(new RegExp(`^${zoneLabel}`)).find((el) => el.closest('label'));
    const zoneInput = zoneSpan?.closest('label')?.querySelector('input') as HTMLInputElement;
    expect(zoneInput).toBeTruthy();
    fireEvent.change(zoneInput, { target: { value: '1' } });
    post.mockClear();
    fireEvent.click(screen.getByText('Submit & lock'));
    expect(await screen.findByText(/Fix these before submitting/i)).toBeTruthy();
    expect(screen.getAllByText(/must be between/i).length).toBeGreaterThan(0);
    expect(post).not.toHaveBeenCalledWith('/logbooks/lb-1/submit');
  });

  it('uses a date picker for the Date field and strips letters from numeric fields', async () => {
    setupApi();
    renderModule('operator');
    await screen.findByText(/Fill panel/i);
    await waitFor(() => expect(panelInput('Machine No').value).toBe('M08'));
    const dateInput = panelInput('Date');
    expect(dateInput.type).toBe('date');
    fireEvent.change(dateInput, { target: { value: '2026-07-28' } });
    expect(dateInput.value).toBe('2026-07-28');
    fireEvent.change(panelInput('Main Motor Speed'), { target: { value: '12ab.3x' } });
    expect(panelInput('Main Motor Speed').value).toBe('12.3');
    const start = panelInput('Extruder start time');
    expect(start.type).toBe('time');
  });

  it('guided mode shows the one-field-at-a-time wizard covering every section', async () => {
    setupApi();
    renderModule('operator');
    await screen.findByText(/Fill panel/i);
    fireEvent.click(screen.getByText('Guided'));
    expect(screen.getByText(/Guided entry/i)).toBeTruthy();
    expect(screen.getByText(/Step 1 \//i)).toBeTruthy();
    const jump = screen.getByTitle('Jump to step') as HTMLSelectElement;
    const steps = Array.from(jump.options).map((o) => o.textContent ?? '');
    for (const s of ['Coil weights', 'Hourly inspection', 'Finished rolls', 'Traceability', 'Production report', 'Sign-off']) {
      expect(steps.some((t) => t.includes(s))).toBe(true);
    }
  });

  it('focusing a sheet cell highlights the matching panel input', async () => {
    setupApi();
    const { container } = renderModule('operator');
    await screen.findByText(/Fill panel/i);
    await waitFor(() => expect(panelInput('Machine No').value).toBe('M08')); // logbook loaded
    fireEvent.focus(container.querySelectorAll('.idrow input')[0] as HTMLInputElement);
    expect(screen.getByText('Machine No').closest('label')?.className).toContain('ring-2');
  });
});

describe('LogbookModule (admin)', () => {
  it('editing a template field and saving persists via setTemplates', async () => {
    setupApi([]);
    const { setTemplates } = renderModule('admin');
    const docNo = panelInput('Doc No');
    fireEvent.change(docNo, { target: { value: 'QR/MFG/013-B' } });
    fireEvent.click(screen.getByText('Save template'));
    expect(setTemplates).toHaveBeenCalledTimes(1);
  });

  it('shows a live preview and can create a new template', async () => {
    setupApi([]);
    const { setTemplates } = renderModule('admin');
    expect(screen.getByText(/Live preview/i)).toBeTruthy();
    fireEvent.click(screen.getByText('New template'));
    expect(setTemplates).toHaveBeenCalled();
  });
});
