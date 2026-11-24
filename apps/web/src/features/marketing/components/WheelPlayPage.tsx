import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { Button, Card, ErrorState, Input, Skeleton } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import logo from '@/assets/brand/masiat-logo.jpg';
import { WHEEL_COLORS } from '@/features/loyalty/data/engine';
import { SERVICE_LABEL, type ContractServiceCode } from '@/features/contracts/types';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';
import { riyadhDateTime } from '@/features/marketing/api/analytics.api';
import {
  spinByToken,
  wheelPublicView,
  type WheelPublicPrize,
  type WheelResult,
} from '@/features/marketing/api/wheel.api';

const serviceNames = (codes: string[] | null) =>
  (codes ?? []).map((c) => SERVICE_LABEL[c as ContractServiceCode] ?? c).join('، ');

/** شروط الجائزة كما حدّدتها الإدارة — لا شروط مخترعة. */
function prizeConditions(
  p: Pick<WheelPublicPrize, 'services' | 'max_discount_amount' | 'valid_days' | 'usage_limit'>,
) {
  const parts: string[] = [];
  if (p.services?.length) parts.push(`على: ${serviceNames(p.services)}`);
  if (p.max_discount_amount != null) parts.push(`بحد أعلى ${sar(p.max_discount_amount)}`);
  if (p.valid_days != null) parts.push(`صالحة ${p.valid_days} يوماً من الفوز`);
  if (p.usage_limit > 1) parts.push(`تُستخدم ${p.usage_limit} مرات`);
  return parts.join(' · ');
}

/** صفحة العميل العامة لعجلة الحظ (/w/:token) — تُفتح من الجوال دون تسجيل دخول. */
export default function WheelPlayPage() {
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const { data: config = [] } = useConfig();
  const maxAttempts = configValue(config, 'wheel_verify_max_attempts', 5);
  const q = useQuery({
    queryKey: ['wheel-public', token],
    queryFn: () => wheelPublicView(token, maxAttempts),
    retry: false,
  });
  const [id4, setId4] = useState('');
  const [phone4, setPhone4] = useState('');
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [shown, setShown] = useState<WheelResult | null>(null);

  const v = q.data;
  const prizes = useMemo(() => v?.prizes ?? [], [v]);
  const seg = prizes.length > 0 ? 360 / prizes.length : 360;
  const gradient = useMemo(
    () =>
      prizes.length > 0
        ? `conic-gradient(${prizes
            .map(
              (_, i) =>
                `${WHEEL_COLORS[i % WHEEL_COLORS.length]} ${i * seg}deg ${(i + 1) * seg}deg`,
            )
            .join(', ')})`
        : WHEEL_COLORS[0],
    [prizes, seg],
  );

  const spin = useMutation({
    mutationFn: () => spinByToken(token, id4, phone4, maxAttempts),
    onSuccess: (r) => {
      const idx = Math.max(
        0,
        prizes.findIndex((p) => p.label === r.label),
      );
      setSpinning(true);
      setRotation((x) => x - (x % 360) + 360 * 5 + (360 - (idx * seg + seg / 2)));
      window.setTimeout(() => {
        setSpinning(false);
        setShown(r);
        void qc.invalidateQueries({ queryKey: ['wheel-public', token] });
      }, 3600);
    },
    onError: () => void qc.invalidateQueries({ queryKey: ['wheel-public', token] }),
  });

  const result = shown ?? (spinning ? null : (v?.result ?? null));
  const blocked = !v
    ? null
    : v.expired
      ? 'انتهت صلاحية الرابط — تواصل مع الفرع للحصول على رابط جديد.'
      : !v.campaign_active
        ? 'انتهت حملة العجلة.'
        : v.locked
          ? 'أُوقف الرابط بعد محاولات تحقق خاطئة — تواصل مع الفرع.'
          : v.used
            ? 'استُخدم هذا الرابط مسبقاً.'
            : !v.ready
              ? 'العجلة غير متاحة حالياً — نعمل على تحديث الجوائز.'
              : null;

  return (
    <div dir="rtl" className="min-h-screen bg-navy-50 px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">
        <header className="flex flex-col items-center gap-2 text-center">
          <img
            src={logo}
            alt="ماسية الشرق للاستقدام"
            className="h-16 w-16 rounded-2xl object-cover shadow-card"
          />
          <p className="text-base font-bold text-navy">ماسية الشرق للاستقدام</p>
          {v?.campaign_name && (
            <p className="text-sm font-semibold text-purple">{v.campaign_name}</p>
          )}
        </header>
        {q.isLoading ? (
          <Skeleton className="h-80 w-full" />
        ) : q.isError || !v ? (
          <ErrorState
            title="الرابط غير صالح"
            description={
              (q.error as Error | null)?.message ?? 'تواصل مع الفرع للحصول على رابط جديد.'
            }
          />
        ) : (
          <Card className="space-y-4 p-5">
            <h1 className="flex items-center justify-center gap-2 text-base font-bold text-navy">
              <Sparkles size={18} className="text-gold-600" /> أهلاً {v.first_name ?? ''}
            </h1>

            {prizes.length > 0 && (
              <div className="relative mx-auto h-60 w-60" aria-hidden>
                <div className="absolute left-1/2 top-[-6px] z-10 -translate-x-1/2">
                  <div className="h-0 w-0 border-x-8 border-t-[16px] border-x-transparent border-t-gold-600" />
                </div>
                <div
                  className="h-60 w-60 rounded-full border-4 border-navy shadow-card"
                  style={{
                    background: gradient,
                    transform: `rotate(${rotation}deg)`,
                    transition: spinning
                      ? 'transform 3.5s cubic-bezier(0.17,0.67,0.12,0.99)'
                      : 'none',
                  }}
                />
                <div className="absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-navy bg-white">
                  <Gift size={18} className="text-gold-600" />
                </div>
              </div>
            )}

            {result ? (
              <div className="rounded-xl bg-gold-100/70 p-4 text-center" data-testid="wheel-result">
                <Gift size={26} className="mx-auto text-gold-600" />
                <p className="mt-2 text-lg font-bold text-navy">{result.label}</p>
                {result.reference && (
                  <p className="mt-2 text-sm">
                    {result.coupon_code ? 'كود الخصم' : 'مرجع الجائزة'}:{' '}
                    <span className="num font-bold" dir="ltr">
                      {result.reference}
                    </span>
                  </p>
                )}
                {result.valid_until && (
                  <p className="mt-1 text-xs text-purple">
                    صالحة حتى <span className="num">{riyadhDateTime(result.valid_until)}</span>
                  </p>
                )}
                {result.terms && <p className="mt-2 text-xs text-navy">{result.terms}</p>}
                {result.reference && (
                  <p className="mt-2 text-[11px] text-purple">
                    احتفظ بالمرجع وقدّمه للموظف عند إنشاء العقد أو تجديده — محفوظ في ملفك لدى الفرع.
                  </p>
                )}
              </div>
            ) : blocked ? (
              <p className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                <Lock size={15} /> {blocked}
              </p>
            ) : (
              <div className="space-y-3">
                <p className="flex items-center gap-1.5 text-xs text-purple">
                  <ShieldCheck size={14} /> للتحقق من هويتك أدخل آخر 4 أرقام من هويتك ومن جوالك
                  المسجّل لدينا.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    label="آخر 4 من الهوية"
                    inputMode="numeric"
                    maxLength={4}
                    value={id4}
                    className="num"
                    onChange={(e) => setId4(e.target.value.replace(/\D/g, ''))}
                  />
                  <Input
                    label="آخر 4 من الجوال"
                    inputMode="numeric"
                    maxLength={4}
                    value={phone4}
                    className="num"
                    onChange={(e) => setPhone4(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
                <Button
                  className="w-full"
                  loading={spin.isPending || spinning}
                  disabled={id4.length !== 4 || phone4.length !== 4}
                  onClick={() => spin.mutate()}
                >
                  <Sparkles size={16} /> لف العجلة
                </Button>
              </div>
            )}
            {spin.isError && (
              <p className="text-sm text-red-600">{(spin.error as Error).message}</p>
            )}

            <section>
              <p className="mb-2 text-xs font-semibold text-navy">الجوائز وفرص الفوز</p>
              <ul className="divide-y divide-navy-50 text-sm">
                {prizes.map((p, i) => (
                  <li key={p.label} className="py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ background: WHEEL_COLORS[i % WHEEL_COLORS.length] }}
                        />
                        {p.label}
                      </span>
                      <span className="num text-purple">{p.chance}٪</span>
                    </div>
                    {(prizeConditions(p) || p.terms) && (
                      <p className="mt-0.5 text-[11px] text-purple">
                        {[prizeConditions(p), p.terms].filter(Boolean).join(' — ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-xl bg-navy-50 p-3 text-[11px] text-navy">
              <p className="mb-1 font-semibold">شروط المشاركة</p>
              <p>يُحدَّد الفوز على خادم الشركة وتُحفظ النتيجة في ملفك لدى الفرع.</p>
              {v.campaign_terms && <p className="mt-1 whitespace-pre-line">{v.campaign_terms}</p>}
            </section>
          </Card>
        )}
      </div>
    </div>
  );
}
