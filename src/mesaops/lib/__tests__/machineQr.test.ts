import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { machineQrUrl, readMachineCodeFromLocation, clearMachineQueryFromUrl } from '../machineQr';

describe('machineQr helpers', () => {
  it('builds an absolute deep link with uppercase machine code', () => {
    expect(machineQrUrl('m08', 'https://plant.example')).toBe('https://plant.example/?machine=M08');
  });

  it('reads machine code from the query string', () => {
    expect(readMachineCodeFromLocation('?machine=m08&x=1')).toBe('M08');
    expect(readMachineCodeFromLocation('')).toBeNull();
    expect(readMachineCodeFromLocation('?foo=bar')).toBeNull();
  });

  it('clears the machine query without dropping other params', () => {
    const replaceState = vi.fn();
    const href = 'https://plant.example/?machine=M08&tab=1';
    vi.stubGlobal('window', {
      location: { href, pathname: '/', search: '?machine=M08&tab=1', hash: '' },
      history: { replaceState },
    });
    clearMachineQueryFromUrl();
    expect(replaceState).toHaveBeenCalled();
    const next = replaceState.mock.calls[0][2] as string;
    expect(next).toContain('tab=1');
    expect(next).not.toContain('machine=');
    vi.unstubAllGlobals();
  });
});
