import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ReceiptText, ShieldCheck, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BRAND } from '@masiat/shared';
import { useAuth } from '@/store/auth';
import { DEMO_ACCOUNTS, type DemoAccount } from '@/lib/demo';
import { ROLE_META } from '@/lib/permissions';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';

const BRAND_POINTS: { icon: LucideIcon; text: string }[] = [
  { icon: Zap, text: 'إدارة لحظية للعمليات والعقود' },
  { icon: ReceiptText, text: 'فوترة وضريبة ومدفوعات آلية' },
  { icon: ShieldCheck, text: 'صلاحيات دقيقة لكل دور وظيفي' },
];

const loginSchema = z.object({
  email: z.string().email('بريد إلكتروني غير صحيح'),
  password: z.string().min(6, 'كلمة المرور ٦ أحرف على الأقل'),
});
type LoginForm = z.infer<typeof loginSchema>;

export default function Login() {
  const { signIn } = useAuth();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const [error, setError] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setError(null);
    const res = await signIn(email, password);
    if (res.error) setError('بيانات الدخول غير صحيحة');
  });

  async function onDemo(acc: DemoAccount) {
    setDemoBusy(acc.email);
    setError(null);
    setValue('email', acc.email);
    setValue('password', acc.password);
    const res = await signIn(acc.email, acc.password);
    if (res.error) setError('تعذّر الدخول التجريبي');
    setDemoBusy(null);
  }

  return (
    <div dir="rtl" className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-navy text-white lg:block">
        <div className="absolute inset-0 bg-arabesque opacity-25" />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(50% 50% at 80% 15%, rgba(200,151,10,0.35) 0%, transparent 60%), radial-gradient(45% 45% at 10% 85%, rgba(88,179,179,0.30) 0%, transparent 60%)',
          }}
        />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gold text-2xl font-bold">
              م
            </div>
            <div>
              <p className="font-bold">{BRAND.client.nameAr}</p>
              <p className="text-xs text-navy-100">نظام إدارة الموارد</p>
            </div>
          </div>

          <div>
            <h2 className="max-w-sm text-3xl font-extrabold leading-snug">
              منظومة الاستقدام الذكية في لوحة واحدة
            </h2>
            <ul className="mt-8 space-y-4">
              {BRAND_POINTS.map((p) => (
                <li key={p.text} className="flex items-center gap-3 text-sm text-navy-100">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-gold-100 ring-1 ring-white/15">
                    <p.icon size={17} strokeWidth={1.8} />
                  </span>
                  {p.text}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-[11px] text-navy-100/70">
            من تطوير {BRAND.vendor.nameAr} · عقد {BRAND.contract}
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-navy-50 p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center lg:hidden">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-navy text-2xl font-bold text-white">
              م
            </div>
            <h1 className="text-lg font-bold text-navy">{BRAND.client.nameAr}</h1>
          </div>

          <div className="card">
            <h1 className="text-xl font-bold text-navy">تسجيل الدخول</h1>
            <p className="mt-1 text-sm text-purple">أدخل بياناتك للوصول إلى لوحة التحكم.</p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
              <Input
                label="البريد الإلكتروني"
                type="email"
                placeholder="name@company.com"
                autoComplete="email"
                error={errors.email?.message}
                {...register('email')}
              />
              <Input
                label="كلمة المرور"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                error={errors.password?.message}
                {...register('password')}
              />
              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" loading={isSubmitting} className="w-full">
                تسجيل الدخول
              </Button>
            </form>
          </div>

          {/* Demo accounts */}
          <div className="mt-5">
            <div className="mb-3 flex items-center gap-3">
              <span className="h-px flex-1 bg-navy-100" />
              <span className="text-xs font-semibold text-purple">حسابات تجريبية — جرّب بنقرة</span>
              <span className="h-px flex-1 bg-navy-100" />
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => void onDemo(acc)}
                  disabled={demoBusy !== null}
                  className="group flex items-center gap-3 rounded-xl border border-navy-100 bg-white p-3 text-right transition hover:border-navy hover:shadow-card disabled:opacity-60"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-navy text-sm font-bold text-white">
                    {acc.name.charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-navy">{acc.name}</span>
                    <span className="block truncate text-[11px] text-purple">
                      {ROLE_META[acc.role].label} · {acc.branch}
                    </span>
                  </span>
                  <span className="text-xs text-purple opacity-0 transition group-hover:opacity-100">
                    {demoBusy === acc.email ? '…' : 'دخول ←'}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-[11px] text-purple">
              كلمة المرور للجميع: <span className="num font-semibold">demo1234</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
