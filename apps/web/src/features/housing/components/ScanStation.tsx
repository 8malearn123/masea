import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, LogIn, LogOut, ScanLine, UserRound } from 'lucide-react';
import { Badge, Button, Card, Input } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { resolveWorkerByBarcode } from '@/features/housing/api/housing.api';
import { useHousingScans, useLogHousingScan } from '@/features/housing/hooks/useHousing';
import {
  RESIDENT_STATUS_LABEL,
  RESIDENT_STATUS_TONE,
  SCAN_DIRECTION_LABEL,
  type Resident,
} from '@/features/housing/types';

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

function WorkerCard({ worker }: { worker: Resident }) {
  const { data: scans = [] } = useHousingScans(worker.id);
  const log = useLogHousingScan();
  const [note, setNote] = useState('');

  function record(direction: 'in' | 'out') {
    log.mutate(
      { code: worker.barcode, direction, note: note.trim() ? note.trim() : null },
      { onSuccess: () => setNote('') },
    );
  }

  return (
    <Card>
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-navy-50 text-navy">
          <UserRound size={22} />
        </span>
        <div className="flex-1">
          <p className="font-bold text-navy">{worker.full_name}</p>
          <p className="text-xs text-purple">
            {worker.nationality} · {worker.dorm}
          </p>
          <p className="num text-[11px] text-purple">إقامة: {worker.iqama_no}</p>
        </div>
        <Badge tone={RESIDENT_STATUS_TONE[worker.status]}>
          {RESIDENT_STATUS_LABEL[worker.status]}
        </Badge>
      </div>

      <div className="mt-3 space-y-2 rounded-xl border border-navy-100 p-3">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="ملاحظة (اختياري)"
        />
        <div className="flex gap-2">
          <Button
            variant="primary"
            className="flex-1"
            loading={log.isPending}
            onClick={() => record('in')}
          >
            <LogIn size={16} /> تسجيل دخول السكن
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            loading={log.isPending}
            onClick={() => record('out')}
          >
            <LogOut size={16} /> تسجيل خروج
          </Button>
        </div>
      </div>

      <div className="mt-3">
        <p className="mb-2 text-xs font-bold text-navy">سجل الدخول والخروج</p>
        {scans.length === 0 ? (
          <p className="text-sm text-purple">لا توجد حركات مسجّلة.</p>
        ) : (
          <ol className="space-y-2">
            {scans.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${s.direction === 'in' ? 'bg-green-500' : 'bg-gold-600'}`}
                  />
                  {SCAN_DIRECTION_LABEL[s.direction]}
                  {s.note && <span className="text-purple"> — {s.note}</span>}
                </span>
                <span className="num text-[11px] text-purple">{dateAr(s.scanned_at)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

export function ScanStation() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [worker, setWorker] = useState<Resident | null>(null);
  const [notFound, setNotFound] = useState(false);

  const supportsCamera = Boolean(BarcodeDetectorCtor && navigator.mediaDevices?.getUserMedia);

  function lookup(code: string) {
    const w = resolveWorkerByBarcode(code);
    setWorker(w);
    setNotFound(!w);
    if (w) stopCamera();
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
      setCamError('تعذّر فتح الكاميرا — استخدم الإدخال اليدوي بالأسفل.');
    }
  }

  // detection loop while the camera is on
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
        /* transient — keep trying */
      }
      if (active) window.setTimeout(() => void tick(), 400);
    };
    void tick();
    return () => {
      active = false;
    };
  }, [cameraOn]);

  // stop the stream when leaving the tab
  useEffect(() => () => stopCamera(), []);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
          <ScanLine size={16} /> مسح باركود العاملة
        </h2>

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
        {notFound && (
          <p className="mt-2 text-xs text-red-600">لا توجد عاملة بهذا الباركود أو رقم الإقامة.</p>
        )}
      </Card>

      {worker ? (
        <WorkerCard worker={worker} />
      ) : (
        <Card className="grid place-items-center py-12 text-center text-sm text-purple">
          <ScanLine size={28} className="text-navy-200 mb-2" />
          امسح باركود العاملة أو أدخله يدوياً لعرض ملفها وسجل دخولها للسكن.
        </Card>
      )}
    </div>
  );
}
