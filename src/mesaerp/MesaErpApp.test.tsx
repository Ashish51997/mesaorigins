import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MesaErpApp from './MesaErpApp';

describe('MesaErpApp', () => {
  it('presents independent manufacturing workflows and the full service navigation', () => {
    render(<MesaErpApp />);

    expect(screen.getByText('MesaERP')).toBeTruthy();
    expect(screen.getByText(/MesaERP operates independently/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vendors & purchasing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Purchase matching' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Inventory & MRP' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manufacturing vouchers' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Voucher desk' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tax & statutory' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Handoff inbox' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Roles & access' })).toBeTruthy();
  });

  it('creates a standalone purchase requisition and emits an API-ready mutation', () => {
    const onMutation = vi.fn();
    render(<MesaErpApp onMutation={onMutation} />);

    fireEvent.click(screen.getByRole('button', { name: 'Vendors & purchasing' }));
    fireEvent.click(screen.getByRole('button', { name: 'New requisition' }));
    const dialog = screen.getByRole('dialog', { name: 'New purchase requisition' });
    fireEvent.change(within(dialog).getByLabelText('Requirement'), { target: { value: 'Demo machine lubricant' } });
    fireEvent.change(within(dialog).getByLabelText('Quantity'), { target: { value: '12' } });
    fireEvent.change(within(dialog).getByLabelText('Unit'), { target: { value: 'litre' } });
    fireEvent.change(within(dialog).getByLabelText('Expected rate'), { target: { value: '450' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create requisition' }));

    expect(screen.getByText('Demo machine lubricant')).toBeTruthy();
    expect(screen.getByText(/created as an independent requisition/i)).toBeTruthy();
    expect(onMutation).toHaveBeenCalledWith(expect.objectContaining({ type: 'purchase.created' }));
  });

  it('saves only a balanced finance voucher draft', () => {
    const onMutation = vi.fn();
    render(<MesaErpApp initialView="voucher-desk" onMutation={onMutation} />);

    const saveButton = screen.getByRole('button', { name: 'Save balanced draft' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Party / counterparty'), { target: { value: 'Demo Internal Allocation' } });
    fireEvent.change(screen.getByLabelText('Debit 1'), { target: { value: '12500' } });
    fireEvent.change(screen.getByLabelText('Credit 2'), { target: { value: '12500' } });
    expect(screen.getByText('Balanced')).toBeTruthy();
    expect(saveButton.disabled).toBe(false);
    fireEvent.click(saveButton);

    expect(screen.getByText(/saved as a balanced draft/i)).toBeTruthy();
    expect(screen.getByText('Demo Internal Allocation')).toBeTruthy();
    expect(onMutation).toHaveBeenCalledWith(expect.objectContaining({ type: 'finance-voucher.saved' }));
  });

  it('contains dense workbenches and gives the mobile voucher action a stable accessible name', () => {
    render(<MesaErpApp initialView="voucher-desk" />);

    expect(screen.getByText('Enter debit and credit')).toBeTruthy();
    expect(screen.queryByText('Difference INR 0')).toBeNull();
    expect(screen.getByRole('button', { name: 'New voucher' }).getAttribute('aria-label')).toBe('New voucher');
    expect(screen.getByTestId('voucher-desk-layout').className).toContain('min-w-0');
    expect(screen.getByTestId('voucher-ledger-scroll').className).toContain('overflow-x-auto');
    fireEvent.change(screen.getByLabelText('Debit 1'), { target: { value: '100' } });
    expect(screen.getByText('Difference INR 100')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Vendors & purchasing' }));
    expect(screen.getByTestId('source-to-pay-layout').className).toContain('minmax(0,1fr)');
    expect(screen.getByTestId('purchase-register-column').className).toContain('min-w-0');
  });

  it('searches active posting ledgers instead of exposing a raw account selector', () => {
    render(<MesaErpApp initialView="voucher-desk" accounts={[
      { id: 'account-wip', code: '1300', name: 'Work in progress', allowPosting: true },
      { id: 'account-payable', code: '2100', name: 'Trade payables', allowPosting: true },
      { id: 'account-heading', code: '2000', name: 'Liabilities', allowPosting: false },
    ]} />);

    const ledger = screen.getByRole('combobox', { name: 'Ledger account 1' });
    fireEvent.change(ledger, { target: { value: 'trade pay' } });
    expect(screen.queryByRole('option', { name: /Liabilities/i })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /2100.*Trade payables/i }));
    expect((ledger as HTMLInputElement).value).toBe('2100 · Trade payables');
  });

  it('validates bulk-pasted rows and saves them with the keyboard shortcut', () => {
    const onMutation = vi.fn();
    render(<MesaErpApp initialView="voucher-desk" onMutation={onMutation} accounts={[
      { id: 'account-wip', code: '1300', name: 'Work in progress', allowPosting: true },
      { id: 'account-payable', code: '2100', name: 'Trade payables', allowPosting: true },
    ]} />);

    fireEvent.change(screen.getByLabelText('Party / counterparty'), { target: { value: 'Internal allocation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Paste ledger rows' }));
    fireEvent.change(screen.getByLabelText('Bulk ledger rows'), { target: { value: '1300\t1250.50\t0\n2100\t0\t1250.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply pasted rows' }));

    expect((screen.getByLabelText('Debit 1') as HTMLInputElement).value).toBe('1250.50');
    expect((screen.getByLabelText('Credit 2') as HTMLInputElement).value).toBe('1250.50');
    fireEvent.keyDown(document.getElementById('finance-voucher-form')!, { key: 'Enter', metaKey: true });
    expect(onMutation).toHaveBeenCalledWith(expect.objectContaining({
      type: 'finance-voucher.saved',
      voucher: expect.objectContaining({ lines: [
        { account: 'account-wip', debit: '1250.50', credit: '0' },
        { account: 'account-payable', debit: '0', credit: '1250.50' },
      ] }),
    }));
  });

  it('starts roles at default deny and records an explicit grant', () => {
    const onMutation = vi.fn();
    render(<MesaErpApp initialView="roles-access" onMutation={onMutation} />);

    expect(screen.getAllByText(/Default deny/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Store operator/i }));
    const postSwitch = screen.getByRole('switch', { name: 'Voucher Post for Store operator' });
    expect(postSwitch.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(postSwitch);
    expect(postSwitch.getAttribute('aria-checked')).toBe('true');
    expect(onMutation).toHaveBeenCalledWith({ type: 'role.permission-changed', roleId: 'ROLE-STORE', permission: 'mesaerp.voucher.post', granted: true });
  });
});
