import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  CalendarOff,
  Crosshair,
  Fingerprint,
  MapPin,
  Pencil,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Save,
} from 'lucide-react';
import { Badge, Button, Card, ErrorState, Input, Modal, Skeleton } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { ROLE_META, type RoleCode } from '@/lib/permissions';
import {
  useAttendanceConfig,
  useBranchAttendance,
  useHolidays,
  useSaveAttendanceConfig,
  useSaveHoliday,
  useSetBranchAttendance,
} from '@/features/hr/hooks/useHr';
import { qrPayload } from '@/features/hr/lib/attendanceEngine';
import {
  WEEKDAY_LABEL,
  type AttendanceConfig,
  type BranchAttendance,
  type PublicHoliday,
} from '@/features/hr/types';

const ROLES = Object.keys(ROLE_META) as RoleCode[];

/** «الحضور»: methods + who may use each, branch locations/QR, official holidays (0072). */
export function AttendanceSettings({ editable }: { editable: boolean }) {
  return (
    <div className="space-y-5">
      <MethodsCard editable={editable} />
      <BranchesCard editable={editable} />
      <HolidaysCard editable={editable} />
    </div>
  );
}

/* ------------------------------- methods ---------------------------------- */
function MethodsCard({ editable }: { editable: boolean }) {
  const { data, isLoading, isError, refetch } = useAttendanceConfig();
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || !data)
    return <ErrorState title="تعذّر تحميل إعدادات الحضور" onRetry={() => void refetch()} />;
  return <MethodsForm key={JSON.stringify(data)} initial={data} editable={editable} />;
}

function MethodsForm({ initial, editable }: { initial: AttendanceConfig; editable: boolean }) {
  const save = useSaveAttendanceConfig();
  const [c, setC] = useState<AttendanceConfig>(initial);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(c) !== JSON.stringify(initial);
  const methods = [
    {
      key: 'qr',
      label: 'باركود الفرع (QR)',
      icon: QrCode,
      on: 'qr_enabled',
      roles: 'qr_roles',
      hint: 'يمسح الموظف رمز الفرع المعلّق عند المدخل',
    },
    {
      key: 'gps',
      label: 'تحديد الموقع (GPS)',
      icon: MapPin,
      on: 'gps_enabled',
      roles: 'gps_roles',
      hint: 'يُقبل التسجيل داخل نصف قطر الفرع فقط',
    },
    {
      key: 'manual',
      label: 'تحضير/تصحيح يدوي',
      icon: Fingerprint,
      on: 'manual_enabled',
      roles: 'manual_roles',
      hint: 'بملاحظة إلزامية ويُسجَّل في التدقيق',
    },
  ] as const;

  const toggleRole = (field: 'qr_roles' | 'gps_roles' | 'manual_roles', r: string) =>
    setC((x) => ({
      ...x,
      [field]: x[field].includes(r) ? x[field].filter((y) => y !== r) : [...x[field], r],
    }));

  function submit() {
    if (c.workdays.length === 0) return setError('اختر يوم عمل واحدًا على الأقل');
    if (!(c.gps_radius_m >= 20 && c.gps_radius_m <= 5000))
      return setError('نصف القطر بين 20 و5000 متر');
    setError(null);
    save.mutate(c);
  }

  return (
    <Card>
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-navy">
        <Fingerprint size={16} /> طرق تسجيل الحضور وصلاحياتها
      </h3>
      <p className="mb-4 text-xs leading-relaxed text-purple">
        فعّل كل طريقة وحدّد الأدوار المسموح لها. يتحقق الخادم من الطريقة والدور عند كل تسجيل.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-xs text-purple">
              <th className="pb-2 text-right font-medium">الطريقة</th>
              <th className="pb-2 text-center font-medium">مفعّلة</th>
              {ROLES.map((r) => (
                <th key={r} className="pb-2 text-center text-[11px] font-medium">
                  {ROLE_META[r].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {methods.map((m) => {
              const Icon = m.icon;
              return (
                <tr key={m.key} className="border-t border-navy-50">
                  <td className="py-2.5 pl-2">
                    <p className="flex items-center gap-1.5 font-semibold text-navy">
                      <Icon size={14} /> {m.label}
                    </p>
                    <p className="text-[11px] text-purple">{m.hint}</p>
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      aria-label={`تفعيل ${m.label}`}
                      checked={c[m.on]}
                      disabled={!editable}
                      onChange={(e) => setC((x) => ({ ...x, [m.on]: e.target.checked }))}
                    />
                  </td>
                  {ROLES.map((r) => (
                    <td key={r} className="text-center">
                      <input
                        type="checkbox"
                        aria-label={`${m.label} — ${ROLE_META[r].label}`}
                        checked={c[m.roles].includes(r)}
                        disabled={!editable || !c[m.on]}
                        onChange={() => toggleRole(m.roles, r)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Input
          label="نصف قطر التسجيل بالموقع"
          type="number"
          suffix="متر"
          value={c.gps_radius_m}
          disabled={!editable}
          onChange={(e) => setC((x) => ({ ...x, gps_radius_m: Number(e.target.value) }))}
        />
        <div>
          <p className="mb-1.5 text-sm font-medium text-navy-900">أيام العمل</p>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABEL.map((d, i) => {
              const on = c.workdays.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!editable}
                  onClick={() =>
                    setC((x) => ({
                      ...x,
                      workdays: on ? x.workdays.filter((y) => y !== i) : [...x.workdays, i].sort(),
                    }))
                  }
                  className={`rounded-lg px-2.5 py-1 text-xs transition ${on ? 'bg-navy text-white' : 'bg-navy-50 text-navy'}`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <label className="mt-4 flex items-start gap-2 rounded-xl bg-navy-50 p-3 text-sm text-navy">
        <input
          type="checkbox"
          className="mt-1"
          checked={c.worker_barcode_required}
          disabled={!editable}
          onChange={(e) => setC((x) => ({ ...x, worker_barcode_required: e.target.checked }))}
        />
        <span>
          <b>حضور العاملات بالباركود فقط</b>
          <span className="block text-xs text-purple">
            مشرفة السكن تحضّر العاملة بمسح باركودها عند الدخول؛ لا تُسجَّل «حاضرة» يدويًا. الغياب
            والمرضية وفي الخدمة تبقى يدوية.
          </span>
        </span>
      </label>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {editable && (
        <div className="mt-4 flex gap-2">
          <Button onClick={submit} disabled={!dirty} loading={save.isPending}>
            <Save size={16} /> حفظ
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setC(initial)}>
              تراجع
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/* --------------------------- branches + QR ------------------------------- */
function BranchesCard({ editable }: { editable: boolean }) {
  const { data = [], isLoading, isError, refetch } = useBranchAttendance(editable);
  if (!editable) return null; // tokens are for HR managers only
  return (
    <Card>
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-navy">
        <QrCode size={16} /> مواقع الفروع ورموز الحضور
      </h3>
      <p className="mb-4 text-xs leading-relaxed text-purple">
        اطبع رمز كل فرع وعلّقه عند المدخل. «تجديد الرمز» يُبطل الرمز القديم فورًا (لو تسرّبت صورته).
      </p>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : isError ? (
        <ErrorState title="تعذّر تحميل مواقع الفروع" onRetry={() => void refetch()} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((b) => (
            <BranchRow key={`${b.id}-${b.attendance_token}`} branch={b} />
          ))}
        </div>
      )}
    </Card>
  );
}

function BranchRow({ branch }: { branch: BranchAttendance }) {
  const set = useSetBranchAttendance();
  const [lat, setLat] = useState(branch.latitude?.toString() ?? '');
  const [lng, setLng] = useState(branch.longitude?.toString() ?? '');
  const [qr, setQr] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void QRCode.toDataURL(qrPayload(branch.attendance_token), { width: 220, margin: 1 }).then(
      (u) => {
        if (alive) setQr(u);
      },
    );
    return () => {
      alive = false;
    };
  }, [branch.attendance_token]);

  const n = (v: string) => (v.trim() === '' ? null : Number(v));

  function useMyLocation() {
    setGeoError(null);
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(6));
        setLng(p.coords.longitude.toFixed(6));
      },
      () => setGeoError('تعذّر تحديد موقعك'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function print() {
    if (!qr) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document
      .write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>رمز حضور فرع ${branch.city}</title>
<style>body{font-family:Alexandria,Tahoma,sans-serif;text-align:center;padding-top:40px;color:#14294a}
h1{font-size:28px;margin:0 0 6px}p{color:#65738c}img{width:320px;height:320px;margin:24px auto;display:block}</style></head>
<body><h1>تسجيل الحضور — فرع ${branch.city}</h1><p>افتح «حضوري» في النظام ثم امسح الرمز عند الحضور وعند الانصراف</p>
<img src="${qr}" alt="QR"/><p>ماسية الشرق للاستقدام</p><script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  }

  return (
    <div className="flex gap-3 rounded-xl border border-navy-100 p-3">
      <div className="shrink-0 text-center">
        {qr ? (
          <img src={qr} alt={`رمز حضور ${branch.city}`} className="h-28 w-28 rounded-lg" />
        ) : (
          <Skeleton className="h-28 w-28" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-bold text-navy">فرع {branch.city}</p>
        <div className="grid grid-cols-2 gap-2">
          <Input
            aria-label={`خط العرض ${branch.city}`}
            placeholder="خط العرض"
            dir="ltr"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
          />
          <Input
            aria-label={`خط الطول ${branch.city}`}
            placeholder="خط الطول"
            dir="ltr"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
          />
        </div>
        {geoError && <p className="text-xs text-red-600">{geoError}</p>}
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={useMyLocation}>
            <Crosshair size={13} /> موقعي الحالي
          </Button>
          <Button
            size="sm"
            loading={set.isPending}
            onClick={() => set.mutate({ id: branch.id, lat: n(lat), lng: n(lng), rotate: false })}
          >
            <Save size={13} /> حفظ الموقع
          </Button>
          <Button size="sm" variant="outline" onClick={print} disabled={!qr}>
            <Printer size={13} /> طباعة الرمز
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (window.confirm(`تجديد رمز فرع ${branch.city}؟ سيتوقف الرمز المطبوع الحالي.`))
                set.mutate({ id: branch.id, lat: n(lat), lng: n(lng), rotate: true });
            }}
          >
            <RefreshCw size={13} /> تجديد الرمز
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- holidays --------------------------------- */
function HolidaysCard({ editable }: { editable: boolean }) {
  const { data = [], isLoading, isError, refetch } = useHolidays();
  const save = useSaveHoliday();
  const [editing, setEditing] = useState<{ h: PublicHoliday; isNew: boolean } | null>(null);
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-navy">
          <CalendarOff size={16} /> العطل الرسمية
        </h3>
        {editable && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setEditing({
                isNew: true,
                h: { id: '', name_ar: '', from_date: '', to_date: '', is_active: true },
              })
            }
          >
            <Plus size={14} /> عطلة
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs text-purple">
        لا يُحتسب فيها غياب. تواريخ الأعياد هجرية — راجعها مع الإعلان الرسمي كل عام.
      </p>
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : isError ? (
        <ErrorState title="تعذّر تحميل العطل" onRetry={() => void refetch()} />
      ) : (
        <ul className="divide-y divide-navy-50">
          {data.map((h) => (
            <li
              key={h.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span className="text-navy">
                {h.name_ar}{' '}
                <span className="num text-xs text-purple">
                  {dateAr(h.from_date)}
                  {h.to_date !== h.from_date && ` → ${dateAr(h.to_date)}`}
                </span>
                {!h.is_active && (
                  <span className="mr-1">
                    <Badge tone="neutral">معطّلة</Badge>
                  </span>
                )}
              </span>
              {editable && (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      save.mutate({ holiday: { ...h, is_active: !h.is_active }, isNew: false })
                    }
                    className="rounded-lg bg-navy-50 px-2.5 py-1 text-xs text-navy hover:bg-navy-100"
                  >
                    {h.is_active ? 'تعطيل' : 'تفعيل'}
                  </button>
                  <button
                    type="button"
                    aria-label={`تعديل ${h.name_ar}`}
                    onClick={() => setEditing({ h, isNew: false })}
                    className="inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2.5 py-1 text-xs text-navy hover:bg-navy-100"
                  >
                    <Pencil size={12} /> تعديل
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <HolidayModal {...editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function HolidayModal({
  h,
  isNew,
  onClose,
}: {
  h: PublicHoliday;
  isNew: boolean;
  onClose: () => void;
}) {
  const save = useSaveHoliday();
  const [v, setV] = useState(h);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={isNew ? 'عطلة رسمية جديدة' : 'تعديل العطلة'}>
      <div className="space-y-3">
        <Input
          label="اسم العطلة"
          value={v.name_ar}
          onChange={(e) => setV({ ...v, name_ar: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="من"
            type="date"
            value={v.from_date}
            onChange={(e) =>
              setV({ ...v, from_date: e.target.value, to_date: v.to_date || e.target.value })
            }
          />
          <Input
            label="إلى"
            type="date"
            value={v.to_date}
            onChange={(e) => setV({ ...v, to_date: e.target.value })}
          />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button
          className="w-full"
          loading={save.isPending}
          onClick={() => {
            if (!v.name_ar.trim()) return setError('اسم العطلة مطلوب');
            if (!v.from_date || !v.to_date || v.to_date < v.from_date)
              return setError('تاريخ النهاية قبل البداية');
            save.mutate({ holiday: v, isNew }, { onSuccess: onClose });
          }}
        >
          حفظ
        </Button>
      </div>
    </Modal>
  );
}
