import { useState } from 'react';
import { Fingerprint, Info, LogIn, LogOut, MapPin, QrCode } from 'lucide-react';
import { Badge, Button, Card, CodeScanner, Modal, Skeleton } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { useAuth } from '@/store/auth';
import {
  useAttendance,
  useAttendanceCheck,
  useAttendanceConfig,
  useMyEmployee,
} from '@/features/hr/hooks/useHr';
import { methodsFor, nowRiyadh, tokenFromQr } from '@/features/hr/lib/attendanceEngine';
import { MonthCalendar } from '@/features/hr/components/AttendanceBoard';
import { ATT_METHOD_LABEL, ATT_STATUS_LABEL, ATT_STATUS_TONE } from '@/features/hr/types';

/**
 * «حضوري» — every staff member records his own attendance with the methods HR
 * enabled for his role (branch QR / location). The server re-checks everything.
 */
export default function MyAttendance() {
  const role = useAuth((s) => s.profile?.role);
  const { data: me, isLoading } = useMyEmployee();
  const { data: cfg } = useAttendanceConfig();
  const { data: today = [] } = useAttendance();
  const check = useAttendanceCheck();
  const [scanning, setScanning] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { date } = nowRiyadh();
  const rec = me ? today.find((r) => r.employee_id === me.id) : undefined;
  const methods = cfg ? methodsFor(role, cfg) : { qr: false, gps: false, manual: false };
  const done = !!rec?.check_out;
  const next = rec?.check_in ? 'الانصراف' : 'الحضور';

  function byLocation() {
    setError(null);
    if (!navigator.geolocation) return setError('جهازك لا يدعم تحديد الموقع');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        check.mutate(
          { method: 'gps', lat: p.coords.latitude, lng: p.coords.longitude },
          { onError: (e) => setError(e.message) },
        );
      },
      () => {
        setLocating(false);
        setError('تعذّر تحديد موقعك — اسمح للمتصفح بالوصول إلى الموقع');
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <Fingerprint size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">حضوري</h1>
          <p className="text-sm text-purple">سجّل حضورك وانصرافك — {dateAr(date)}</p>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !me ? (
        <Card className="flex items-start gap-2 text-sm text-purple">
          <Info size={18} className="mt-0.5 shrink-0" />
          حسابك غير مرتبط بملف موظف — تربطه الموارد البشرية من ملف الموظف (تبويب «حساب الدخول»).
        </Card>
      ) : (
        <>
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-purple">
                  {me.full_name} · فرع {me.branch}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {rec ? (
                    <Badge tone={ATT_STATUS_TONE[rec.status]}>{ATT_STATUS_LABEL[rec.status]}</Badge>
                  ) : (
                    <Badge tone="neutral">لم تسجّل اليوم</Badge>
                  )}
                  {rec?.check_in && (
                    <span className="text-sm text-navy">
                      حضور <span className="num font-semibold">{rec.check_in}</span>
                      {rec.check_in_method && (
                        <span className="text-xs text-purple">
                          {' '}
                          ({ATT_METHOD_LABEL[rec.check_in_method]})
                        </span>
                      )}
                    </span>
                  )}
                  {rec?.check_out && (
                    <span className="text-sm text-navy">
                      · انصراف <span className="num font-semibold">{rec.check_out}</span>
                    </span>
                  )}
                  {!!rec?.late_minutes && (
                    <span className="text-xs text-gold-600">
                      تأخير <span className="num">{rec.late_minutes}</span> دقيقة
                    </span>
                  )}
                </div>
              </div>
            </div>

            {done ? (
              <p className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-700">
                سجّلت حضورك وانصرافك اليوم.
              </p>
            ) : !methods.qr && !methods.gps ? (
              <p className="rounded-xl bg-navy-50 px-3 py-2 text-sm text-navy">
                لا توجد طريقة تسجيل ذاتي مفعّلة لدورك — يسجّل حضورك المسؤول.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {methods.qr && (
                  <Button
                    size="lg"
                    onClick={() => {
                      setError(null);
                      setScanning(true);
                    }}
                    loading={check.isPending && !locating}
                  >
                    <QrCode size={18} /> {next} بمسح رمز الفرع
                  </Button>
                )}
                {methods.gps && (
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={byLocation}
                    loading={locating || check.isPending}
                  >
                    {rec?.check_in ? <LogOut size={18} /> : <LogIn size={18} />}
                    <MapPin size={16} /> {next} بموقعي
                  </Button>
                )}
              </div>
            )}
            {error && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-bold text-navy">سجلّي هذا الشهر</h2>
            <MonthCalendar employeeId={me.id} period={date.slice(0, 7)} />
          </Card>
        </>
      )}

      {scanning && (
        <Modal open onClose={() => setScanning(false)} title={`${next} — امسح رمز الفرع`}>
          <CodeScanner
            placeholder="أو أدخل رمز الفرع يدويًا"
            notFoundText="رمز غير صالح."
            onCode={(code) => {
              const token = tokenFromQr(code);
              if (!token) return false;
              setScanning(false);
              check.mutate({ method: 'qr', token }, { onError: (e) => setError(e.message) });
              return true;
            }}
          />
        </Modal>
      )}
    </div>
  );
}
