import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff } from 'lucide-react';
import { Button, Input } from '@/shared/ui';
import { resolveWorkerByBarcode } from '@/features/housing/api/housing.api';
import type { Resident } from '@/features/housing/types';

/* Minimal typed view of the native BarcodeDetector (no extra dependency). */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
  .BarcodeDetector;

/**
 * Reusable worker barcode scanner: device camera (native BarcodeDetector) with a
 * manual entry fallback. Calls `onResolved` with the matched worker.
 */
export function BarcodeScanner({ onResolved }: { onResolved: (worker: Resident) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [notFound, setNotFound] = useState(false);

  const supportsCamera = Boolean(BarcodeDetectorCtor && navigator.mediaDevices?.getUserMedia);

  function lookup(code: string) {
    const w = resolveWorkerByBarcode(code);
    if (w) {
      stopCamera();
      setNotFound(false);
      onResolved(w);
    } else {
      setNotFound(true);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  async function startCamera() {
    setCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setCamError('تعذّر فتح الكاميرا — استخدم الإدخال اليدوي.');
    }
  }

  useEffect(() => {
    if (!cameraOn || !BarcodeDetectorCtor) return;
    const detector = new BarcodeDetectorCtor({
      formats: ['qr_code', 'code_128', 'ean_13', 'code_39'],
    });
    let active = true;
    const tick = async () => {
      if (!active || !videoRef.current) return;
      try {
        const codes = await detector.detect(videoRef.current);
        const raw = codes[0]?.rawValue;
        if (raw) {
          lookup(raw);
          return;
        }
      } catch {
        /* transient */
      }
      if (active) window.setTimeout(() => void tick(), 400);
    };
    void tick();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

  useEffect(() => () => stopCamera(), []);

  return (
    <div>
      {supportsCamera ? (
        <div className="space-y-3">
          <div className="relative aspect-video overflow-hidden rounded-xl bg-navy-900/90">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
            {!cameraOn && (
              <div className="absolute inset-0 grid place-items-center text-navy-100/70">
                <Camera size={32} />
              </div>
            )}
            {cameraOn && (
              <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-gold-600/80" />
            )}
          </div>
          {cameraOn ? (
            <Button variant="outline" className="w-full" onClick={stopCamera}>
              <CameraOff size={16} /> إيقاف الكاميرا
            </Button>
          ) : (
            <Button variant="primary" className="w-full" onClick={() => void startCamera()}>
              <Camera size={16} /> تشغيل الكاميرا للمسح
            </Button>
          )}
          {camError && <p className="text-xs text-red-600">{camError}</p>}
        </div>
      ) : (
        <p className="rounded-xl bg-gold-100/60 px-3 py-2.5 text-xs text-gold-600">
          متصفحك لا يدعم قراءة الباركود بالكاميرا — استخدم الإدخال اليدوي.
        </p>
      )}

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) lookup(manual);
        }}
      >
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="أدخل الباركود أو رقم الإقامة يدوياً"
        />
        <Button type="submit" variant="outline">
          بحث
        </Button>
      </form>
      {notFound && <p className="mt-2 text-xs text-red-600">لا توجد عاملة بهذا الباركود.</p>}
    </div>
  );
}
