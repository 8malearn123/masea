import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BRAND } from '@masiat/shared';
import { useServices } from '@/hooks/useServices';
import { useWorkerProfiles } from '@/hooks/useWorkerProfiles';
import { isServiceCode } from '@/lib/wizardConfig';
import { emptyDraft } from '@/lib/orderTypes';
import { useOrderIntent } from '@/store/orderIntent';
import StepWizard from '@/components/order/StepWizard';
import type { ServiceCode } from '@/lib/funnel';

export default function OrderWizard() {
  const [params, setParams] = useSearchParams();
  const { data: services = [] } = useServices();
  const { data: workers = [] } = useWorkerProfiles();

  const serviceParam = params.get('service') ?? '';
  const service: ServiceCode | null = isServiceCode(serviceParam) ? serviceParam : null;
  const workerParam = params.get('worker');
  const { beneficiaryType, beneficiaryLabel, eventType, eventLabel } = useOrderIntent();

  const initialDraft = useMemo(() => {
    if (!service) return null;
    const d = { ...emptyDraft(service), beneficiaryType, beneficiaryLabel, eventType, eventLabel };
    const w = workerParam ? workers.find((x) => x.id === workerParam) : undefined;
    if (w) {
      d.workerProfileId = w.id;
      d.nationality = w.nationality;
      d.profession = w.profession;
    }
    return d;
  }, [service, workerParam, workers, beneficiaryType, beneficiaryLabel, eventType, eventLabel]);

  function chooseService(code: string) {
    const next = new URLSearchParams(params);
    next.set('service', code);
    setParams(next, { replace: true });
  }
  function resetService() {
    const next = new URLSearchParams(params);
    next.delete('service');
    next.delete('worker');
    setParams(next, { replace: true });
  }

  return (
    <div dir="rtl" className="min-h-screen bg-brand-50 text-brand-dark">
      <header className="border-b border-brand-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-lg font-bold text-white">
              م
            </div>
            <span className="text-sm font-bold">{BRAND.client.nameAr}</span>
          </Link>
          <Link to="/" className="text-sm text-brand-dark/60 hover:text-brand">
            ← الرئيسية
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {!service || !initialDraft ? (
          <div className="rounded-2xl bg-white p-6 shadow-card">
            <h1 className="text-xl font-bold text-brand">اختر نوع الخدمة</h1>
            <p className="mt-1 text-sm text-brand-dark/60">حدّد الخدمة التي تريد طلبها للبدء.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {services.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => chooseService(s.code)}
                  className="flex items-start gap-3 rounded-xl border border-brand-100 p-4 text-right transition hover:border-brand hover:bg-brand-50"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-50 text-2xl">
                    {s.icon}
                  </span>
                  <span>
                    <span className="block font-bold text-brand">{s.name_ar}</span>
                    <span className="mt-0.5 block text-xs text-brand-dark/60">{s.tagline_ar}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <StepWizard
            service={service}
            serviceName={services.find((s) => s.code === service)?.name_ar ?? service}
            initialDraft={initialDraft}
            onReset={resetService}
          />
        )}
      </main>
    </div>
  );
}
