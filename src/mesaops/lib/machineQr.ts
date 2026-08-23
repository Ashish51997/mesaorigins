/**
 * Machine floor QR helpers — encode a deep link phones can open, and render
 * MesaOrigins-branded sticker-ready PNG downloads.
 */
import QRCode from 'qrcode';

/** Gateway mark paths (36×36 viewBox), same as `Logo.tsx` / `public/icons/logo.svg`. */
const LOGO_PATH_ARCH =
  'M23.5771 6.68959C25.4125 7.64277 31.1904 15.4049 31.1904 15.4049L4.00013 15.4049C4.00013 15.4049 9.77807 7.57469 11.6134 6.68959C13.4488 5.80449 21.7418 5.73641 23.5771 6.68959Z';
const LOGO_PATH_RIGHT =
  'M31.1904 15.4049L31.1904 25.1926C31.1904 27.2954 29.4858 29.0001 27.383 29.0001C25.2802 29.0001 23.5755 27.2954 23.5755 25.1926L23.5755 17.5801C23.5755 17.5801 23.6027 16.1526 23.4395 15.9487C23.1675 15.6089 22.6236 15.4049 22.6236 15.4049L31.1904 15.4049Z';
const LOGO_PATH_LEFT =
  'M4 15.4049L4 25.1926C4 27.2954 5.70466 29.0001 7.80747 29.0001C9.91028 29.0001 11.6149 27.2954 11.6149 25.1926L11.6149 17.5801C11.6149 17.5801 11.5877 16.1526 11.7509 15.9487C12.0229 15.6089 12.5668 15.4049 12.5668 15.4049L4 15.4049Z';

export function machineQrUrl(code: string, origin = typeof window !== 'undefined' ? window.location.origin : ''): string {
  const c = code.trim().toUpperCase();
  const base = origin || '';
  return `${base}/?machine=${encodeURIComponent(c)}`;
}

/** Square QR PNG with MesaOrigins mark centered (H error correction). */
export async function renderMachineQrPng(code: string, size = 512): Promise<string> {
  const url = machineQrUrl(code);
  const qrDataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: size,
    color: { dark: '#0F172A', light: '#FFFFFF' },
  });

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return qrDataUrl;

  const img = await loadImage(qrDataUrl);
  ctx.drawImage(img, 0, 0, size, size);

  const markSize = Math.round(size * 0.22);
  const markX = Math.round((size - markSize) / 2);
  const markY = Math.round((size - markSize) / 2);
  // Quiet pad so modules don't crowd the mark
  const pad = Math.round(markSize * 0.12);
  roundRect(ctx, markX - pad, markY - pad, markSize + pad * 2, markSize + pad * 2, Math.round(pad * 0.6));
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  drawMesaOriginsMark(ctx, markX, markY, markSize);

  return canvas.toDataURL('image/png');
}

/**
 * Sticker PNG: MesaOrigins brand header + branded QR + machine code caption.
 */
export async function renderMachineQrSticker(code: string, size = 512): Promise<string> {
  const c = code.trim().toUpperCase();
  const qrDataUrl = await renderMachineQrPng(c, size);
  const headerH = Math.round(size * 0.2);
  const captionH = Math.round(size * 0.16);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = headerH + size + captionH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return qrDataUrl;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Brand header — icon + wordmark (design-system lockup)
  const iconSize = Math.round(headerH * 0.55);
  const iconY = Math.round((headerH - iconSize) / 2);
  const brandGap = Math.round(size * 0.02);
  const word = 'MesaOrigins';
  ctx.font = `800 ${Math.round(size * 0.055)}px Roboto, system-ui, -apple-system, sans-serif`;
  const wordW = ctx.measureText(word).width;
  const brandW = iconSize + brandGap + wordW;
  const brandX = Math.round((size - brandW) / 2);
  drawMesaOriginsMark(ctx, brandX, iconY, iconSize);
  ctx.fillStyle = '#0F172A';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(word, brandX + iconSize + brandGap, headerH / 2);

  const img = await loadImage(qrDataUrl);
  ctx.drawImage(img, 0, headerH, size, size);

  ctx.fillStyle = '#0F172A';
  ctx.font = `700 ${Math.round(size * 0.09)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(c, size / 2, headerH + size + captionH / 2);

  return canvas.toDataURL('image/png');
}

function drawMesaOriginsMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const scale = size / 36;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  roundRect(ctx, 0, 0, 36, 36, 6);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.stroke();

  const gA = ctx.createLinearGradient(31.1904, 10.7024, 4.00013, 10.7024);
  gA.addColorStop(0, '#1F74FF');
  gA.addColorStop(1, '#0044FF');
  ctx.fillStyle = gA;
  ctx.fill(new Path2D(LOGO_PATH_ARCH));

  const gB = ctx.createLinearGradient(27.383, 29.0001, 27.383, 15.4049);
  gB.addColorStop(0, '#287CFF');
  gB.addColorStop(1, '#0538BD');
  ctx.fillStyle = gB;
  ctx.fill(new Path2D(LOGO_PATH_RIGHT));

  const gC = ctx.createLinearGradient(7.80747, 29.0001, 7.80747, 15.4049);
  gC.addColorStop(0, '#287CFF');
  gC.addColorStop(1, '#0538BD');
  ctx.fillStyle = gC;
  ctx.fill(new Path2D(LOGO_PATH_LEFT));

  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
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
