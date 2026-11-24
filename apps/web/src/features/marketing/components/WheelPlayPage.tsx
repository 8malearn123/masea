import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Sparkles } from 'lucide-react';
import { Button, Card, ErrorState, Skeleton } from '@/shared/ui';
import { spinByToken, wheelPublicView } from '@/features/marketing/api/wheel.api';

/** صفحة العميل العامة لعجلة الحظ (/w/:token) — تُفتح من الجوال دون تسجيل دخول. */
export default function WheelPlayPage() {
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['wheel-public', token],
    queryFn: () => wheelPublicView(token),
    retry: false,
  });
  const spin = useMutation({
    mutationFn: () => spinByToken(token),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['wheel-public', token] }),
  });
  const v = q.data;
  const result = spin.data ?? v?.result ?? null;
  return (
    <div dir="rtl" className="min-h-screen bg-navy-50 px-4 py-8">
      <div className="mx-auto max-w-md space-y-4">
        <div className="text-center">
          <p className="text-lg font-bold text-navy">ماسية الشرق للاستقدام</p>
          <p className="text-sm text-purple">عجلة الحظ</p>
        </div>
        {q.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : q.isError || !v ? (
          <ErrorState
            title="الرابط غير صالح"
            description={
              (q.error as Error | null)?.message ?? 'تواصل مع الفرع للحصول على رابط جديد.'
            }
          />
        ) : (
          <Card className="space-y-4 p-5">
            <h1 className="flex items-center gap-2 text-base font-bold text-navy">
              <Sparkles size={18} /> أهلاً {v.first_name ?? ''}
            </h1>
            {result ? (
              <div className="rounded-xl bg-gold-100/70 p-4 text-center">
                <Gift size={28} className="mx-auto text-gold-600" />
                <p className="mt-2 text-lg font-bold text-navy">{result.label}</p>
                {result.coupon_code && (
                  <p className="mt-2 text-sm">
                    كود الخصم:{' '}
                    <span className="num font-bold" dir="ltr">
                      {result.coupon_code}
                    </span>
                    <span className="mt-1 block text-[11px] text-purple">
                      يُستخدم مرة واحدة على الخدمات المشمولة وضمن صلاحيته.
                    </span>
                  </p>
                )}
              </div>
            ) : v.expired ? (
              <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
                انتهت صلاحية الرابط — تواصل مع الفرع.
              </p>
            ) : v.used ? (
              <p className="rounded-xl bg-navy-50 p-3 text-sm text-purple">
                استُخدم هذا الرابط مسبقاً.
              </p>
            ) : (
              <Button className="w-full" loading={spin.isPending} onClick={() => spin.mutate()}>
                <Sparkles size={16} /> أدِر العجلة
              </Button>
            )}
            {spin.isError && (
              <p className="text-sm text-red-600">{(spin.error as Error).message}</p>
            )}
            <div>
              <p className="mb-2 text-xs font-semibold text-navy">الجوائز وفرص الفوز</p>
              <ul className="divide-y divide-navy-50 text-sm">
                {v.prizes.map((p) => (
                  <li key={p.label} className="flex justify-between py-1.5">
                    <span>{p.label}</span>
                    <span className="num text-purple">{p.chance}٪</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
