import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, PackageSearch, Search } from 'lucide-react';
import { BRAND } from '@masiat/shared';
import { dateAr } from '@/shared/lib/format';
import { FALLBACK_SERVICES } from '@/lib/funnel';
import { TRACKING_STAGES } from '@/lib/orderTypes';
import { useServiceRequest } from '@/hooks/useServiceRequest';
import type { ServiceCode } from '@/lib/funnel';

const STATUS_LABEL: Record<string, string> = {
  new: 'تم الاستلام',
  paid: 'مدفوع — قيد المعالجة',
  processing: 'قيد التنفيذ',
  completed: 'مكتمل',
  cancelled: 'ملغى',
};

function stageIndex(stages: string[], status: string): number {
  const map: Record<string, number> = {
    new: 0,
    paid: 1,
    processing: 2,
    completed: stages.length - 1,
    cancelled: 0,
  };
  return Math.min(map[status] ?? 0, Math.max(stages.length - 1, 0));
}

export default function OrderTracking() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const { data, isLoading, isFetched } = useServiceRequest(query, query !== '');

  const service = data?.service_code as ServiceCode | undefined;
  const stages = service ? TRACKING_STAGES[service] : [];
  const current = data ? stageIndex(stages, data.status) : 0;
  const serviceName = service ? FALLBACK_SERVICES.find((s) => s.code === service)?.name_ar ?? service : '';

  return (
    <div dir="rtl" className="min-h-screen bg-brand-50/60 text-brand-dark">
      <header className="border-b border-brand-100 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3.5">
          <Link to="/" className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-brand text-lg font-bold text-white">م</div>
            <span className="text-sm font-bold">{BRAND.client.nameAr}</span>
          </Link>
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-brand-dark/60 hover:text-brand">
            <ArrowRight size={16} /> الرئيسية
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand text-white">
            <PackageSearch size={24} strokeWidth={1.6} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-brand">تتبّع طلبك</h1>
            <p className="text-sm text-brand-dark/60">أدخل رقم الطلب لمتابعة حالته ومراحله.</p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(input);
          }}
          className="rounded-2xl bg-white p-5 shadow-card"
        >
          <label className="mb-1 block text-sm font-medium text-brand-dark">رقم الطلب</label>
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="REQ-XXXXXXXX"
              className="num w-full rounded-xl border border-brand-100 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
            <button type="submit" className="btn-brand gap-2 rounded-xl px-5">
              <Search size={16} /> تتبّع
            </button>
          </div>
        </form>

        {/* states */}
        {isLoading && (
          <div className="mt-6 rounded-2xl bg-white p-8 text-center text-sm text-brand-dark/60 shadow-card">
            جارٍ البحث…
          </div>
        )}

        {isFetched && !data && (
          <div className="mt-6 rounded-2xl border border-dashed border-brand-100 bg-white p-10 text-center shadow-sm">
            <PackageSearch size={32} className="mx-auto text-brand-dark/40" />
            <p className="mt-3 font-bold text-brand">لم نعثر على هذا الطلب</p>
            <p className="mt-1 text-sm text-brand-dark/60">تأكّد من رقم الطلب وحاول مرة أخرى.</p>
          </div>
        )}

        {data && (
          <div className="mt-6 rounded-2xl bg-white p-6 shadow-card">
            <div className="flex items-center justify-between border-b border-brand-100 pb-4">
              <div>
                <p className="text-xs text-brand-dark/60">رقم الطلب</p>
                <p className="num text-lg font-bold text-brand-accent">{data.request_no}</p>
              </div>
              <span className="rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand">
                {STATUS_LABEL[data.status] ?? data.status}
              </span>
            </div>

            <div className="flex items-center justify-between py-3 text-sm">
              <span className="text-brand-dark/60">الخدمة</span>
              <span className="font-medium">{serviceName}</span>
            </div>
            <div className="flex items-center justify-between border-b border-brand-100 pb-3 text-sm">
              <span className="text-brand-dark/60">تاريخ الطلب</span>
              <span className="num">{dateAr(data.created_at)}</span>
            </div>

            <p className="mb-4 mt-5 text-sm font-semibold text-brand-dark">مراحل الطلب</p>
            <ol className="space-y-4">
              {stages.map((s, i) => {
                const done = i < current;
                const active = i === current;
                return (
                  <li key={s} className="flex items-center gap-3">
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                        done || active ? 'bg-brand text-white' : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {done ? <CheckCircle2 size={16} /> : <span className="num text-xs">{i + 1}</span>}
                    </span>
                    <span className={`text-sm ${active ? 'font-bold text-brand' : 'text-brand-dark/70'}`}>{s}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </main>
    </div>
  );
}
