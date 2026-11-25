import { useEffect, useState } from 'react';
import { BadgeCheck, Globe } from 'lucide-react';
import { Button, Input } from '@/shared/ui';
import { dateTimeAr } from '@/shared/lib/format';
import { SignaturePad } from '@/features/contracts/components/SignaturePad';
import { getClientIp } from '@/features/contracts/lib/clientIp';
import type { ContractSignature } from '@/features/contracts/types';

/**
 * نموذج التوقيع الإلكتروني — نفس نافذة التوقيع القائمة (اسم العميل، رقم الهوية، IP، توقيع
 * الطرفين، «حفظ التوقيع وتأكيد العقد») مستخرجة لتُستخدم في كل العقود: من صفحة العقد وفي
 * نهاية معاينة «عقد جديد». التحقق النهائي والحفظ على الخادم (sign_contract_party).
 */
export type PartyState = 'pending' | 'signed' | 'not_allowed';

export interface SignCapture {
  customer: {
    image: string;
    name: string;
    nationalId: string;
    method: 'in_person' | 'agent';
    poaNo: string | null;
  } | null;
  company: { image: string } | null;
  ipAddress: string | null;
}

export function ContractSignForm({
  customerState,
  companyState,
  signed,
  onSubmit,
  onChange,
  busy,
  note,
}: {
  customerState: PartyState;
  companyState: PartyState;
  signed?: { customer?: ContractSignature | null; company?: ContractSignature | null } | undefined;
  /** نافذة العقد: زر الحفظ. بدونها (المعالج) يُبلَّغ بالالتقاط عبر onChange. */
  onSubmit?: ((c: SignCapture) => void) | undefined;
  onChange?: ((c: SignCapture | null, error: string | null) => void) | undefined;
  busy?: boolean | undefined;
  note?: string | null | undefined;
}) {
  const [name, setName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [agent, setAgent] = useState(false);
  const [poaNo, setPoaNo] = useState('');
  const [attested, setAttested] = useState(false);
  const [customer, setCustomer] = useState<string | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [ip, setIp] = useState<string | null>(null);
  const [ipLoading, setIpLoading] = useState(true);

  // عنوان IP للتوقيع (تقديري، غير مانع)
  useEffect(() => {
    let alive = true;
    void getClientIp().then((v) => {
      if (alive) {
        setIp(v);
        setIpLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const custPending = customerState === 'pending';
  const compPending = companyState === 'pending';
  const nameOk = name.trim().length >= 3;
  const idOk = /^[12]\d{9}$/.test(nationalId.trim());
  const poaOk = !agent || poaNo.trim().length >= 3;
  const custError =
    !custPending || !customer
      ? null
      : !nameOk
        ? 'أدخل اسم الموقّع كاملاً'
        : !idOk
          ? 'رقم الهوية/الإقامة 10 أرقام يبدأ بـ 1 أو 2'
          : !poaOk
            ? 'أدخل رقم الوكالة الموثقة'
            : !agent && !attested
              ? 'أكّد أن العميل وقّع بنفسه بحضورك'
              : null;
  const capture: SignCapture | null =
    (custPending && customer) || (compPending && company)
      ? {
          customer:
            custPending && customer
              ? {
                  image: customer,
                  name: name.trim(),
                  nationalId: nationalId.trim(),
                  method: agent ? 'agent' : 'in_person',
                  poaNo: agent ? poaNo.trim() : null,
                }
              : null,
          company: compPending && company ? { image: company } : null,
          ipAddress: ip,
        }
      : null;
  const ready = Boolean(capture) && !custError;

  useEffect(() => {
    onChange?.(custError ? null : capture, custError);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report on the captured values only
  }, [customer, company, name, nationalId, agent, poaNo, attested, ip, custError]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-purple">
        يُدخل العميل اسمه ورقم هويته ثم يوقّع الطرفان لإتمام العقد وتحويله إلى «موقّع». تُوثَّق هوية
        الموقّع وعنوان الـ IP وتاريخ ووقت التوقيع في سجل التوقيعات.
      </p>
      {note && <p className="rounded-xl bg-gold-100/60 p-3 text-xs text-navy-900">{note}</p>}

      {custPending ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={agent ? 'اسم الوكيل' : 'اسم العميل (الطرف الثاني)'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="الاسم كما في الهوية"
              error={name && !nameOk ? 'أدخل الاسم كاملاً' : undefined}
            />
            <Input
              label="رقم الهوية / الإقامة"
              value={nationalId}
              onChange={(e) => setNationalId(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="10 أرقام"
              inputMode="numeric"
              className="num"
              error={
                nationalId && !idOk ? 'رقم هوية غير صحيح (10 أرقام يبدأ بـ 1 أو 2)' : undefined
              }
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-navy">
            <input
              type="checkbox"
              className="h-4 w-4 accent-navy"
              checked={agent}
              onChange={(e) => setAgent(e.target.checked)}
            />
            يوقّع وكيل عن العميل بموجب وكالة موثقة
          </label>
          {agent && (
            <Input
              label="رقم الوكالة الموثقة"
              value={poaNo}
              onChange={(e) => setPoaNo(e.target.value)}
              className="num"
            />
          )}
        </>
      ) : (
        <SignedRow label="توقيع الطرف الثاني (العميل)" sig={signed?.customer ?? null} />
      )}

      <div className="flex items-center gap-2 rounded-xl bg-navy-50 px-3 py-2 text-xs text-purple">
        <Globe size={14} />
        <span>عنوان الـ IP للتوقيع:</span>
        <span className="num font-semibold text-navy">
          {ipLoading ? '…جارٍ التحديد' : (ip ?? 'غير متاح')}
        </span>
      </div>

      {custPending && <SignaturePad label="توقيع الطرف الثاني (العميل)" onChange={setCustomer} />}
      {compPending ? (
        <SignaturePad label="توقيع الطرف الأول (ماسية الشرق)" onChange={setCompany} />
      ) : companyState === 'signed' ? (
        <SignedRow label="توقيع الطرف الأول (ماسية الشرق)" sig={signed?.company ?? null} />
      ) : (
        <p className="rounded-xl border border-dashed border-navy-100 p-3 text-xs text-purple">
          توقيع الطرف الأول (ماسية الشرق) لممثل الشركة المخوّل (صلاحية اعتماد العقود) — يُستكمل من
          صفحة العقد.
        </p>
      )}

      {custPending && customer && !agent && (
        <label className="flex items-start gap-2 text-xs text-navy">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-navy"
            checked={attested}
            onChange={(e) => setAttested(e.target.checked)}
          />
          أقرّ بأن العميل وقّع بنفسه بحضوري بعد اطلاعه على العقد كاملاً.
        </label>
      )}
      {custError && <p className="text-xs text-red-600">{custError}</p>}
      <p className="text-[11px] text-purple">يُسجَّل تاريخ ووقت كل توقيع تلقائياً عند الحفظ.</p>

      {onSubmit && (
        <Button
          onClick={() => capture && ready && onSubmit(capture)}
          loading={Boolean(busy)}
          disabled={!ready}
          className="w-full"
        >
          حفظ التوقيع وتأكيد العقد
        </Button>
      )}
    </div>
  );
}

function SignedRow({ label, sig }: { label: string; sig: ContractSignature | null }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-green-50 p-3 text-xs text-navy">
      <BadgeCheck size={15} className="mt-0.5 shrink-0 text-green-600" />
      <div>
        <p className="font-semibold">{label} — مكتمل</p>
        {sig && (
          <p className="text-purple">
            {sig.signer_name ?? '—'}
            {sig.signer_capacity ? ` · ${sig.signer_capacity}` : ''} ·{' '}
            <span className="num">{dateTimeAr(sig.signed_at)}</span>
          </p>
        )}
      </div>
    </div>
  );
}
