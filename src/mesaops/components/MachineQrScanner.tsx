/**
 * Machine QR scanner — camera (BarcodeDetector when available) + manual code entry.
 * Opens as a bottom sheet from the operator dashboard.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Keyboard, QrCode } from 'lucide-react';
import BottomSheet from '@shared/components/ui/BottomSheet';
import { machineQrUrl, readMachineCodeFromLocation } from '@mesaops/lib/machineQr';

function extractMachineCode(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    if (text.includes('machine=')) {
      const fromUrl = readMachineCodeFromLocation(text.includes('?') ? `?${text.split('?')[1]}` : `?${text}`);
      if (fromUrl) return fromUrl;
      const u = new URL(text, typeof window !== 'undefined' ? window.location.origin : 'http://local');
      const q = u.searchParams.get('machine');
      if (q) return q.trim().toUpperCase() || null;
    }
  } catch { /* not a URL */ }
  const code = text.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (/^M\d{1,3}$/i.test(code) || /^MC?\d+/i.test(code)) return code;
  if (code.length >= 2 && code.length <= 12) return code;
  return null;
}

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
};

function getBarcodeDetector(): (new (opts?: { formats: string[] }) => BarcodeDetectorLike) | null {
  const w = window as unknown as { BarcodeDetector?: new (opts?: { formats: string[] }) => BarcodeDetectorLike };
  return w.BarcodeDetector ?? null;
}

export default function MachineQrScanner({
  open,
  onClose,
  onScan,
}: {
  open: boolean;
  onClose: () => void;
  onScan: (machineCode: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [manual, setManual] = useState('');
  const [error, setError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const accept = useCallback((raw: string) => {
    const code = extractMachineCode(raw);
    if (!code) {
      setError('Could not read a machine code from that scan.');
      return;
    }
    stopCamera();
    onScan(code);
  }, [onScan, stopCamera]);

  useEffect(() => {
    if (!open || mode !== 'camera') {
      stopCamera();
      return;
    }

    let cancelled = false;
    setError('');

    (async () => {
      const Detector = getBarcodeDetector();
      if (!Detector) {
        setMode('manual');
        setError('Camera QR scanning is not supported on this browser — enter the machine code below.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setCameraReady(true);

        const detector = new Detector({ formats: ['qr_code'] });
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            if (video.readyState >= 2) {
              const codes = await detector.detect(video);
              const raw = codes[0]?.rawValue;
              if (raw) {
                accept(raw);
                return;
              }
            }
          } catch { /* keep scanning */ }
          rafRef.current = requestAnimationFrame(() => { void tick(); });
        };
        rafRef.current = requestAnimationFrame(() => { void tick(); });
      } catch {
        if (!cancelled) {
          setMode('manual');
          setError('Camera permission denied — enter the machine code instead.');
        }
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, mode, accept, stopCamera]);

  useEffect(() => {
    if (!open) {
      setManual('');
      setError('');
      setMode('camera');
    }
  }, [open]);

  const submitManual = () => {
    const code = extractMachineCode(manual) || manual.trim().toUpperCase();
    if (!code) {
      setError('Enter a machine code (e.g. M08).');
      return;
    }
    stopCamera();
    onScan(code);
  };

  return (
    <BottomSheet open={open} onClose={() => { stopCamera(); onClose(); }} title="Scan machine QR" wide className="max-h-[92vh]">
      <div className="space-y-4 pb-2" data-testid="machine-qr-scanner">
        <p className="text-[13px] text-slate-500">
          Point at the machine sticker, or type the code. Stickers open{' '}
          <span className="font-mono text-[11px] text-slate-600">{machineQrUrl('M08').replace(/M08$/, '…')}</span>
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setError(''); setMode('camera'); }}
            className={`inline-flex flex-1 min-h-10 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold ${
              mode === 'camera' ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-700'
            }`}
          >
            <Camera className="h-4 w-4" /> Camera
          </button>
          <button
            type="button"
            onClick={() => { stopCamera(); setMode('manual'); }}
            className={`inline-flex flex-1 min-h-10 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold ${
              mode === 'manual' ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-700'
            }`}
          >
            <Keyboard className="h-4 w-4" /> Type code
          </button>
        </div>

        {mode === 'camera' && (
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 aspect-[3/4] max-h-[50vh]">
            <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
            {!cameraReady && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
                <QrCode className="h-8 w-8 animate-pulse" />
                <span className="text-sm">Starting camera…</span>
              </div>
            )}
            <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/70" />
          </div>
        )}

        {mode === 'manual' && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-[12px] font-bold text-slate-500">Machine code</span>
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') submitManual(); }}
                placeholder="e.g. M08"
                autoFocus
                className="mt-1 w-full min-h-12 rounded-xl border border-slate-300 px-3 font-mono text-lg font-bold tracking-wide"
              />
            </label>
            <button
              type="button"
              onClick={submitManual}
              className="inline-flex w-full min-h-12 items-center justify-center rounded-xl bg-indigo-600 text-[15px] font-bold text-white"
            >
              Open machine
            </button>
          </div>
        )}

        {error && <p className="text-[13px] font-medium text-amber-700">{error}</p>}
      </div>
    </BottomSheet>
  );
}
