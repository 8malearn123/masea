import { BadgeCheck, Clock, PenLine, Signature } from 'lucide-react';
import { Badge, Button, Card } from '@/shared/ui';
import { dateTimeAr } from '@/shared/lib/format';
import { SIGNATURE_STAGE_TONE, type SignatureState } from '@/features/contracts/lib/signatureStage';
import type { ContractSignature } from '@/features/contracts/types';

/** حالة التوقيع الإلكتروني في صفحة أي عقد، مع زر استكمال التوقيعات الناقصة حسب الصلاحية. */
export function SignatureStatusCard({
  state,
  canSign,
  onSign,
}: {
  state: SignatureState;
  canSign: boolean;
  onSign: () => void;
}) {
  const missing = !state.customer || !state.company;
  return (
    <Card className="mb-4" data-testid="signature-status">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <Signature size={16} /> التوقيع الإلكتروني
          <Badge tone={SIGNATURE_STAGE_TONE[state.stage]}>{state.label}</Badge>
        </h2>
        {state.signable && missing && canSign && (
          <Button size="sm" onClick={onSign}>
            <PenLine size={14} />{' '}
            {state.customer || state.company ? 'استكمال التوقيع' : 'التوقيع الإلكتروني'}
          </Button>
        )}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <PartyRow title="الطرف الثاني (العميل)" sig={state.customer} />
        <PartyRow title="الطرف الأول (ماسية الشرق)" sig={state.company} />
      </div>
      {state.stage === 'draft' && (
        <p className="mt-2 text-[11px] text-purple">
          {state.musaned
            ? 'التوقيع متاح على المسودة وبعد تسجيل العقد على مساند.'
            : 'يُوقَّع العقد بعد اعتماده — أرسله للاعتماد ثم «إرسال للتوقيع».'}
        </p>
      )}
      {state.musaned && (
        <p className="mt-2 text-[11px] text-purple">
          عقد مساند: التوقيع هنا على نسخة المكتب، والتوقيع الرسمي للعقد على منصة مساند.
        </p>
      )}
    </Card>
  );
}

function PartyRow({ title, sig }: { title: string; sig: ContractSignature | null }) {
  return (
    <div
      className={`flex items-start gap-2 rounded-xl p-2.5 text-xs ${sig ? 'bg-green-50' : 'bg-navy-50'}`}
    >
      {sig ? (
        <BadgeCheck size={15} className="mt-0.5 shrink-0 text-green-600" />
      ) : (
        <Clock size={15} className="mt-0.5 shrink-0 text-purple" />
      )}
      <div className="min-w-0">
        <p className="font-semibold text-navy">{title}</p>
        {sig ? (
          <p className="text-purple">
            {sig.signer_name ?? '—'}
            {sig.signer_capacity ? ` · ${sig.signer_capacity}` : ''} ·{' '}
            <span className="num">{dateTimeAr(sig.signed_at)}</span>
          </p>
        ) : (
          <p className="text-purple">لم يوقّع بعد</p>
        )}
      </div>
    </div>
  );
}
