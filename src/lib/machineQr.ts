/**
 * Machine floor QR helpers — encode a deep link phones can open, and render
 * sticker-ready PNG downloads.
 */
import QRCode from 'qrcode';

export function machineQrUrl(code: string, origin = typeof window !== 'undefined' ? window.location.origin : ''): string {
  const c = code.trim().toUpperCase();
  const base = origin || '';
  return `${base}/?machine=${encodeURIComponent(c)}`;
}

/** Square QR PNG data URL (no caption). */
export async function renderMachineQrPng(code: string, size = 512): Promise<string> {
  const url = machineQrUrl(code);
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: size,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}

/**
 * Sticker PNG: QR + machine code caption underneath (canvas composite).
 */
export async function renderMachineQrSticker(code: string, size = 512): Promise<string> {
  const c = code.trim().toUpperCase();
  const qrDataUrl = await renderMachineQrPng(c, size);
  const captionH = Math.round(size * 0.18);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size + captionH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return qrDataUrl;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const img = await loadImage(qrDataUrl);
  ctx.drawImage(img, 0, 0, size, size);

  ctx.fillStyle = '#0f172a';
  ctx.font = `bold ${Math.round(size * 0.09)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(c, size / 2, size + captionH / 2);

  return canvas.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load QR image'));
    img.src = src;
  });
}

export async function downloadMachineQr(code: string): Promise<void> {
  const c = code.trim().toUpperCase();
  const dataUrl = await renderMachineQrSticker(c);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `Machine-${c}-QR.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function readMachineCodeFromLocation(search = typeof window !== 'undefined' ? window.location.search : ''): string | null {
  const raw = new URLSearchParams(search).get('machine');
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return code || null;
}

export function clearMachineQueryFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('machine')) return;
  url.searchParams.delete('machine');
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, '', next);
}
