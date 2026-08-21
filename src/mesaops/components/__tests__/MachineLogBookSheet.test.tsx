import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import MachineLogBookSheet, { LogbookHandlers } from '../MachineLogBookSheet';
import { initialLogbookTemplates, initialMachineLogbooks } from '@mesaops/mockData';
import { MachineLogbook } from '@mesaops/types';

const template = initialLogbookTemplates[0];
const sampleLogbook = initialMachineLogbooks[0];

const noop: LogbookHandlers = {
  scalar: () => {},
  dieZone: () => {},
  barrelZone: () => {},
  coil: () => {},
  hourly: () => {},
  hourlyThickness: () => {},
  trace: () => {},
  rejection: () => {}
};

// Stateful harness that wires the sheet's handlers to local state, so we can
// assert that typing/selecting on the sheet flows through and re-renders.
function Harness({ initial, onSelectSection }: { initial: MachineLogbook; onSelectSection?: (n: number) => void }) {
  const [lb, setLb] = useState<MachineLogbook>(initial);
  const on: LogbookHandlers = {
    scalar: (k, v) => setLb((p) => ({ ...p, [k]: v } as MachineLogbook)),
    dieZone: (z, v) => setLb((p) => ({ ...p, dieZoneTemps: { ...p.dieZoneTemps, [z]: v } })),
    barrelZone: (z, v) => setLb((p) => ({ ...p, barrelZoneTemps: { ...p.barrelZoneTemps, [z]: v } })),
    coil: (i, v) => setLb((p) => { const a = [...p.coilWeights]; a[i] = v; return { ...p, coilWeights: a }; }),
    hourly: (i, f, v) => setLb((p) => ({ ...p, hourlyInspections: p.hourlyInspections.map((r, idx) => (idx === i ? { ...r, [f]: v } : r)) })),
    hourlyThickness: (i, j, v) => setLb((p) => ({
      ...p,
      hourlyInspections: p.hourlyInspections.map((r, idx) => {
        if (idx !== i) return r;
        const th = [...r.thickness]; th[j] = v; return { ...r, thickness: th };
      })
    })),
    trace: (i, f, v) => setLb((p) => ({ ...p, traceabilityRows: p.traceabilityRows.map((r, idx) => (idx === i ? { ...r, [f]: v } : r)) })),
    rejection: (reason, v) => setLb((p) => ({ ...p, rejectionCounts: { ...p.rejectionCounts, [reason]: v } }))
  };
  return <MachineLogBookSheet logbook={lb} template={template} on={on} onSelectSection={onSelectSection} />;
}

describe('MachineLogBookSheet', () => {
  it('renders the QR/MFG/013 sheet faithfully (snapshot)', () => {
    const { container } = render(<MachineLogBookSheet logbook={sampleLogbook} template={template} on={noop} />);
    // sanity: the document header + all four section bands are present
    const bands = Array.from(container.querySelectorAll('.band')).map((b) => b.textContent);
    expect(bands).toHaveLength(4);
    expect(container.querySelector('.title')?.textContent).toBe('MACHINE LOG BOOK');
    // the 44-cell coil weight list is rendered
    expect(container.querySelectorAll('.coil-cell')).toHaveLength(template.coil.count);
    expect(container).toMatchSnapshot();
  });

  it('typing in a sheet cell flows through the handler and re-renders (two-way)', () => {
    const { container } = render(<Harness initial={sampleLogbook} />);
    const machineInput = container.querySelectorAll('.idrow input')[0] as HTMLInputElement;
    expect(machineInput.value).toBe('M09');
    fireEvent.change(machineInput, { target: { value: 'M12' } });
    expect((container.querySelectorAll('.idrow input')[0] as HTMLInputElement).value).toBe('M12');
  });

  it('flags a coil-weight cell amber when the value is outside the permissible range', () => {
    const { container } = render(<Harness initial={sampleLogbook} />);
    const coil0 = container.querySelectorAll('.coil-cell input')[0] as HTMLInputElement;
    // range is 7.945–7.995 → 9.9 is out of range
    fireEvent.change(coil0, { target: { value: '9.9' } });
    expect((container.querySelectorAll('.coil-cell input')[0] as HTMLInputElement).className).toContain('oor');
    // back in range → amber clears
    fireEvent.change(coil0, { target: { value: '7.96' } });
    expect((container.querySelectorAll('.coil-cell input')[0] as HTMLInputElement).className).not.toContain('oor');
  });

  it('opens the shift dropdown and selecting an option updates the value', () => {
    const { container } = render(<Harness initial={sampleLogbook} />);
    const shiftTrigger = container.querySelectorAll('.drop-btn')[0] as HTMLButtonElement;
    expect(shiftTrigger.textContent).toContain('N'); // seeded shift (Night)
    fireEvent.click(shiftTrigger);
    const menu = container.querySelector('.drop-menu');
    expect(menu).toBeTruthy();
    const optionD = Array.from(menu!.querySelectorAll('button')).find((b) => (b.textContent || '').trim().startsWith('D'));
    expect(optionD).toBeTruthy();
    fireEvent.click(optionD!);
    expect((container.querySelectorAll('.drop-btn')[0] as HTMLButtonElement).textContent).toContain('D');
    expect(container.querySelector('.drop-menu')).toBeNull(); // menu closed after select
  });

  it('clicking a section band reports the section number', () => {
    const onSelectSection = vi.fn();
    const { container } = render(<MachineLogBookSheet logbook={sampleLogbook} template={template} on={noop} onSelectSection={onSelectSection} />);
    const bands = container.querySelectorAll('.band');
    fireEvent.click(bands[1]); // section 2 — Inspection Report
    expect(onSelectSection).toHaveBeenCalledWith(2);
    fireEvent.click(bands[3]); // section 4 — Production Report
    expect(onSelectSection).toHaveBeenCalledWith(4);
  });
});
