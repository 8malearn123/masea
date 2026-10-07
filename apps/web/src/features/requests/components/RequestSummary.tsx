import { Link, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Baby,
  CalendarClock,
  CreditCard,
  FileText,
  Hash,
  HeartHandshake,
  Home,
  MapPin,
  Phone,
  Sparkles,
  UserRound,
  UsersRound,
  FlaskConical,
} from 'lucide-react';
import { BRAND } from '@masiat/shared';
import { EmptyState, ErrorState, Skeleton, flagFor } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { PAYMENT_METHODS, TRACKING_STAGES } from '@/lib/orderTypes';
import { useRefList } from '@/features/settings/hooks/useSettings';
import { refName } from '@/features/settings/api/settings.api';
import { useRequestBackend, useRequestFile } from '@/features/requests/hooks/useRequestFiles';
import { periodLabel } from '@/features/requests/lib/period';
import { asksForGuests, asksForHouseholdCare, isOccasion } from '@/features/requests/types';
import type { RequestFile } from '@/features/requests/types';

/**
 * ملف الطلب — ملخّص البيانات الأساسية للطلب كما أدخلها العميل: نوع المستفيد
 * وبيانات مكان الخدمة والمدة والعاملة المختارة والمبالغ ومرحلة التتبّع.
 * البيانات من مخزن ملفات الطلبات (Prototype)، والعرض يغطي الحالات الأربع.
 */
export default function RequestSummary() {
  const { requestNo = '' } = useParams();
  const { data, isLoading, isError, refetch } = useRequestFile(requestNo);

  return (
    <div dir="rtl" className="min-h-screen bg-navy-50">
      <header className="sticky top-0 z-10 border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link
            to="/order"
            className="inline-flex items-center gap-1 text-sm text-purple hover:text-navy"
          >
            <ArrowRight size={16} /> الرئيسية
          </Link>
          <span className="text-sm font-bold text-navy">{BRAND.client.nameAr}</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        {isLoading ? (
          <>
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </>
        ) : isError ? (
          <ErrorState description="تعذّر تحميل ملف الطلب." onRetry={() => void refetch()} />
        ) : !data ? (
          <EmptyState
            icon="🔍"
            title="لا يوجد طلب بهذا الرقم"
            description={`لم نجد ملفًا للطلب ${requestNo}. تأكّد من رقم الطلب أو ابدأ طلبًا جديدًا.`}
            action={
              <Link
                to="/order"
                className="rounded-xl bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-700"
              >
                طلب جديد
              </Link>
            }
          />
        ) : (
          <RequestBody file={data} />
        )}
      </main>
    </div>
  );
}

function RequestBody({ file }: { file: RequestFile }) {
  const { backend } = useRequestBackend();
  const beneficiaryTypes = useRefList('beneficiary_types');
  const occasionTypes = useRefList('occasion_types');
  const careNeeds = useRefList('care_needs');
  const { place } = file;
  const paymentLabel =
    PAYMENT_METHODS.find((m) => m.key === file.payment_method)?.label ?? file.payment_method;

  return (
    <>
      {/* رأس الملف */}
      <section className="rounded-2xl border border-navy-100 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs text-purple">
              <Hash size={13} /> رقم الطلب
            </p>
            <p className="num mt-0.5 text-xl font-bold text-navy">{file.request_no}</p>
            <p className="num mt-1 text-[11px] text-purple">أُنشئ في {dateAr(file.created_at)}</p>
          </div>
          <div className="text-left">
            <span className="inline-flex items-center rounded-full bg-teal-100 px-3 py-1 text-xs font-bold text-teal">
              {file.status}
            </span>
            {backend === 'mock' && (
              <span className="mt-1.5 flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                <FlaskConical size={12} /> طلب تجريبي — بيانات عرض
              </span>
            )}
            <p className="num mt-2 text-lg font-bold text-gold-600">
              {sar(file.amounts.total)} <span className="text-xs font-normal">ر.س</span>
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Info icon={FileText} label="الخدمة" value={file.service_name} />
          <Info
            icon={Home}
            label="نوع المستفيد"
            value={refName(beneficiaryTypes.data ?? [], place.beneficiaryType)}
          />
          <Info icon={MapPin} label="الفرع" value={file.branch || '—'} />
        </div>
      </section>

      {/* بيانات العميل */}
      <Section icon={UserRound} title="بيانات مقدّم الطلب">
        <div className="grid gap-3 sm:grid-cols-2">
          <Info icon={UserRound} label="الاسم" value={file.customer_name || '—'} />
          <Info icon={Phone} label="الجوال" value={file.phone || '—'} />
          <Info icon={Hash} label="رقم الهوية" value={file.national_id || '—'} />
          <Info
            icon={MapPin}
            label="العنوان"
            value={[file.city, file.address].filter(Boolean).join(' · ') || '—'}
          />
        </div>
      </Section>

      {/* مكان الخدمة */}
      <Section icon={Home} title="بيانات مكان الخدمة">
        <div className="grid gap-3 sm:grid-cols-3">
          {isOccasion(place.beneficiaryType) && (
            <Info
              icon={Sparkles}
              label="نوع المناسبة"
              value={refName(occasionTypes.data ?? [], place.occasionType)}
            />
          )}
          <Info icon={Home} label="عدد الأدوار" value={String(place.floors)} />
          <Info icon={Home} label="عدد الغرف" value={String(place.rooms)} />
          {asksForHouseholdCare(place.beneficiaryType) && (
            <>
              <Info icon={Baby} label="عدد الأطفال" value={String(place.children)} />
              <Info
                icon={UsersRound}
                label="كبار السن"
                value={
                  place.elderly === 0
                    ? 'لا يوجد'
                    : `${place.elderly}${place.elderlyCareNeeded ? ' · يحتاجون رعاية' : ''}`
                }
              />
            </>
          )}
          {asksForGuests(place.beneficiaryType) && (
            <Info icon={UsersRound} label="عدد الحضور" value={String(place.guests)} />
          )}
        </div>

        <div className="mt-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-navy">
            <HeartHandshake size={14} /> احتياجات الرعاية
          </p>
          {place.careNeeds.length === 0 ? (
            <p className="text-xs text-purple">لم تُحدَّد احتياجات رعاية.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {place.careNeeds.map((code) => (
                <span
                  key={code}
                  className="rounded-lg bg-navy-50 px-2.5 py-1 text-[11px] font-medium text-navy"
                >
                  {refName(careNeeds.data ?? [], code)}
                </span>
              ))}
            </div>
          )}
        </div>

        {place.notes && (
          <p className="mt-3 rounded-xl bg-navy-50 p-3 text-sm leading-relaxed text-navy-900">
            {place.notes}
          </p>
        )}
      </Section>

      {/* المدة */}
      {file.period && (
        <Section icon={CalendarClock} title="مدة الطلب">
          <div className="grid gap-3 sm:grid-cols-3">
            <Info
              icon={CalendarClock}
              label="تاريخ البداية"
              value={dateAr(file.period.startDate)}
            />
            <Info icon={CalendarClock} label="تاريخ النهاية" value={dateAr(file.period.endDate)} />
            <Info icon={CalendarClock} label="المدة" value={periodLabel(file.period)} />
          </div>
        </Section>
      )}

      {/* العاملة */}
      <Section icon={UserRound} title="العاملة المخصّصة">
        {file.worker ? (
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-navy-50 font-bold text-navy">
              {file.worker.full_name.charAt(0)}
            </span>
            <div className="flex-1">
              <p className="text-sm font-bold text-navy">{file.worker.full_name}</p>
              <p className="flex items-center gap-1 text-[11px] text-purple">
                <span className="text-sm leading-none">{flagFor(file.worker.nationality)}</span>
                {file.worker.profession} · {file.worker.nationality}
              </p>
            </div>
            {file.match_score !== null && (
              <span className="num rounded-full bg-teal-100 px-2.5 py-1 text-[11px] font-bold text-teal">
                مطابقة {file.match_score}٪
              </span>
            )}
            <Link
              to={`/order/workers/${file.worker.id}`}
              className="rounded-lg border border-navy-100 px-3 py-1.5 text-xs font-semibold text-navy hover:bg-navy-50"
            >
              ملف العاملة
            </Link>
          </div>
        ) : (
          <p className="text-sm text-purple">
            لم تُحدَّد عاملة بعد — سيرشّح الفريق الأنسب لاحتياجك ويتواصل معك.
          </p>
        )}
      </Section>

      {/* المبالغ والدفع */}
      <Section icon={CreditCard} title="المبالغ والدفع">
        <ul className="divide-y divide-navy-50 text-sm">
          <Amount label="الأساس" value={file.amounts.base} />
          <Amount label="ضريبة القيمة المضافة" value={file.amounts.vat} />
          <Amount label="الإجمالي" value={file.amounts.total} strong />
        </ul>
        <p className="mt-3 text-xs text-purple">وسيلة الدفع: {paymentLabel}</p>
      </Section>

      {/* التتبّع */}
      <Section icon={CalendarClock} title="مراحل تتبّع الطلب">
        <ol className="flex flex-wrap items-center gap-2">
          {TRACKING_STAGES[file.service_code].map((stage, i) => (
            <li key={stage} className="flex items-center gap-2">
              <span
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  i === 0 ? 'bg-navy text-white' : 'bg-navy-50 text-navy'
                }`}
              >
                <span className="num">{i + 1}</span> {stage}
              </span>
              {i < TRACKING_STAGES[file.service_code].length - 1 && (
                <span className="text-navy-200">←</span>
              )}
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Home;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-navy-100 bg-white p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
        <Icon size={16} /> {title}
      </h2>
      {children}
    </section>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof Home; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-navy-50 p-3">
      <p className="flex items-center gap-1.5 text-[11px] text-purple">
        <Icon size={12} /> {label}
      </p>
      <p className="num mt-0.5 text-sm font-semibold text-navy-900">{value}</p>
    </div>
  );
}

function Amount({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <li className="flex items-center justify-between py-2">
      <span className={strong ? 'font-bold text-navy' : 'text-purple'}>{label}</span>
      <span className={`num ${strong ? 'text-base font-bold text-navy' : 'text-navy-900'}`}>
        {sar(value)} <span className="text-[11px] font-normal">ر.س</span>
      </span>
    </li>
  );
}
