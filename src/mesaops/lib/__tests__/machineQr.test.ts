import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { machineQrUrl, readMachineCodeFromLocation, clearMachineQueryFromUrl, renderMachineQrPng } from '../machineQr';

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(async () => 'data:image/png;base64,qr'),
  },
}));

import QRCode from 'qrcode';

describe('machineQr helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.mocked(QRCode.toDataURL).mockClear();
  });

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
  });

  it('requests high error correction so the MesaOrigins mark can sit in the QR', async () => {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    const createLinearGradient = vi.fn(() => ({ addColorStop: vi.fn() }));
    const ctx = {
      drawImage: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      arcTo: vi.fn(),
      closePath: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      createLinearGradient,
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      toDataURL: vi.fn(() => 'data:image/png;base64,branded'),
    };
    const realCreateElement = document.createElement.bind(document);

    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('Path2D', class Path2D {});
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
      if (tag === 'canvas') return canvas as unknown as HTMLCanvasElement;
      return realCreateElement(tag, options);
    }) as typeof document.createElement);

    const out = await renderMachineQrPng('M08', 256);
    expect(out).toBe('data:image/png;base64,branded');
    expect(QRCode.toDataURL).toHaveBeenCalledWith(
      expect.stringContaining('machine=M08'),
      expect.objectContaining({ errorCorrectionLevel: 'H' }),
    );
    expect(createLinearGradient).toHaveBeenCalled();
  });
});
