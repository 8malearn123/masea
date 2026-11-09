import { forwardRef, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, MessageCircle } from 'lucide-react';
import { useSubmitWebLead } from '@/features/site/hooks/useSite';
import { webLeadErrors, whatsappLink, type WebLeadErrors } from '@/features/site/lib/webLead';
import { normalizeSaudiPhone } from '@/features/crm/lib/leadInput';
import type { PublicSiteInfo, WebLeadInput } from '@/features/site/types';

const EMPTY: WebLeadInput = {
  full_name: '',
  phone: '',
  service_code: '',
  city: '',
  notes: '',
  website: '',
};

const fieldCls = (bad: boolean) =>
  `w-full rounded-none border-0 border-b bg-transparent px-0 py-3 text-base text-navy-900 outline-none transition placeholder:text-purple/60 focus:border-navy ${
    bad ? 'border-red-500' : 'border-navy-200'
  }`;

/**
 * نموذج طلب الخدمة — يُرسل فعليًا إلى خط المبيعات (submit_web_lead) ويعرض حالة
 * الإرسال والنجاح برقم مرجعي والفشل برسالة الخادم. البيانات الضرورية فقط.
 */
export const RequestForm = forwardRef<
  HTMLInputElement,
  { info: PublicSiteInfo; presetService: string | null; presetKey: number }
>(function RequestForm({ info, presetService, presetKey }, nameRef) {
  const submit = useSubmitWebLead();
  const [v, setV] = useState<WebLeadInput>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState<{ ref: string | null; duplicate: boolean } | null>(null);

  useEffect(() => {
    if (presetService) setV((x) => ({ ...x, service_code: presetService }));
  }, [presetService, presetKey]);
  // فرع واحد = يُختار تلقائيًا
  useEffect(() => {
    if (info.branches.length === 1) setV((x) => ({ ...x, city: info.branches[0]! }));
  }, [info.branches]);

  const errors: WebLeadErrors = touched ? webLeadErrors(v) : {};
  const set = (k: keyof WebLeadInput) => (e: { target: { value: string } }) =>
    setV((x) => ({ ...x, [k]: e.target.value }));
  const err = (k: keyof WebLeadInput) =>
    errors[k] ? (
      <p id={`req-${k}-err`} className="mt-1.5 text-xs text-red-600">
        {errors[k]}
      </p>
    ) : null;
  const aria = (k: keyof WebLeadInput) =>
    errors[k] ? { 'aria-invalid': true, 'aria-describedby': `req-${k}-err` } : {};

  if (done) {
    const svc = info.services.find((s) => s.code === v.service_code)?.name;
    return (
      <div role="status" aria-live="polite" className="py-4">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-teal-100 text-teal">
          <CheckCircle2 size={28} />
        </span>
        <h3 className="mt-5 text-2xl font-bold text-navy-900">
          وصلنا طلبك، {v.full_name.split(' ')[0]}
        </h3>
        <p className="mt-2 leading-relaxed text-purple">
          {done.duplicate
            ? 'طلبك السابق لنفس الخدمة مسجّل لدينا، وسيتواصل معك فريق الفرع على الرقم نفسه.'
            : `سيتواصل معك فريق فرع ${v.city} على ${normalizeSaudiPhone(v.phone) ?? v.phone} بخصوص ${svc ?? 'طلبك'}.`}
        </p>
        {done.ref && (
          <p className="mt-4 inline-flex items-center gap-2 border border-navy-100 px-3 py-2 text-sm text-navy">
            الرقم المرجعي: <span className="num font-semiboldr">{done.ref}</span>
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          {info.company.whatsapp && (
            <a
              href={whatsappLink(
                info.company.whatsapp,
                `السلام عليكم، أرسلت طلب ${svc ?? 'خدمة'} من الموقع${done.ref ? ` برقم ${done.ref}` : ''}.`,
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-[#1f8f4e] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#187540]"
            >
              <MessageCircle size={17} /> تابع عبر واتساب
            </a>
          )}
          <Link
            to="/order/workers"
            className="inline-flex items-center gap-2 border border-navy px-5 py-3 text-sm font-semibold text-navy transition hover:bg-navy hover:text-white"
          >
            تصفّح العاملات المتاحات <ArrowLeft size={16} />
          </Link>
        </div>
        <button
          type="button"
          onClick={() => {
            setDone(null);
            setTouched(false);
            setV({ ...EMPTY, city: info.branches.length === 1 ? info.branches[0]! : '' });
          }}
          className="site-link-line mt-6 text-sm text-purple"
        >
          إرسال طلب آخر
        </button>
      </div>
    );
  }

  return (
    <form
      noValidate
      aria-label="نموذج طلب خدمة"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (Object.keys(webLeadErrors(v)).length) return;
        submit.mutate(v, { onSuccess: (r) => setDone(r) });
      }}
      className="space-y-5"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="req-name" className="text-xs font-semibold text-purple">
            الاسم
          </label>
          <input
            id="req-name"
            ref={nameRef}
            autoComplete="name"
            value={v.full_name}
            onChange={set('full_name')}
            placeholder="الاسم الكامل"
            className={fieldCls(Boolean(errors.full_name))}
            {...aria('full_name')}
          />
          {err('full_name')}
        </div>
        <div>
          <label htmlFor="req-phone" className="text-xs font-semibold text-purple">
            رقم الجوال
          </label>
          <input
            id="req-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            value={v.phone}
            onChange={set('phone')}
            placeholder="05xxxxxxxx"
            className={`${fieldCls(Boolean(errors.phone))} num text-right`}
            {...aria('phone')}
          />
          {err('phone')}
        </div>
        <div>
          <label htmlFor="req-service" className="text-xs font-semibold text-purple">
            الخدمة
          </label>
          <select
            id="req-service"
            value={v.service_code}
            onChange={set('service_code')}
            className={fieldCls(Boolean(errors.service_code))}
            {...aria('service_code')}
          >
            <option value="">اختر الخدمة</option>
            {info.services.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          {err('service_code')}
        </div>
        <div>
          <label htmlFor="req-city" className="text-xs font-semibold text-purple">
            أقرب فرع
          </label>
          <select
            id="req-city"
            value={v.city}
            onChange={set('city')}
            className={fieldCls(Boolean(errors.city))}
            {...aria('city')}
          >
            <option value="">اختر الفرع</option>
            {info.branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          {err('city')}
        </div>
      </div>
      <div>
        <label htmlFor="req-notes" className="text-xs font-semibold text-purple">
          ملاحظات <span className="font-normal">(اختياري)</span>
        </label>
        <textarea
          id="req-notes"
          rows={2}
          value={v.notes}
          onChange={set('notes')}
          placeholder="مثال: نحتاج عاملة لرعاية طفلين، أو موعدًا مناسبًا للاتصال"
          className={`${fieldCls(Boolean(errors.notes))} resize-none`}
          {...aria('notes')}
        />
        {err('notes')}
      </div>
      {/* حقل فخّ للروبوتات — مخفي عن الإنسان وقارئ الشاشة */}
      <div aria-hidden className="sr-only">
        <label htmlFor="req-website">الموقع</label>
        <input
          id="req-website"
          tabIndex={-1}
          autoComplete="off"
          value={v.website}
          onChange={set('website')}
        />
      </div>

      {submit.isError && (
        <p
          role="alert"
          className="flex items-start gap-2 border-r-2 border-red-500 bg-red-50 px-3 py-2.5 text-sm text-red-700"
        >
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <span>
            {submit.error.message || 'تعذّر إرسال الطلب'} — حاول مرة أخرى
            {info.company.phone ? ' أو اتصل بنا مباشرة.' : '.'}
          </span>
        </p>
      )}

      <div className="flex flex-col-reverse items-stretch gap-4 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-purple">
          نستخدم بياناتك للتواصل معك بخصوص طلبك فقط.
        </p>
        <button
          type="submit"
          disabled={submit.isPending}
          className="group inline-flex items-center justify-center gap-3 bg-navy px-7 py-4 text-sm font-semibold text-white transition hover:bg-navy-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 disabled:opacity-70"
        >
          {submit.isPending ? (
            <>
              <Loader2 size={17} className="animate-spin" /> جارٍ الإرسال…
            </>
          ) : (
            <>
              أرسل الطلب
              <ArrowLeft size={17} className="transition group-hover:-translate-x-1" />
            </>
          )}
        </button>
      </div>
    </form>
  );
});
