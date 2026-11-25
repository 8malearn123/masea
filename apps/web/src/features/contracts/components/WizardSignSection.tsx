import { Signature } from 'lucide-react';
import { Card } from '@/shared/ui';
import {
  ContractSignForm,
  type SignCapture,
} from '@/features/contracts/components/ContractSignForm';

/**
 * «التوقيع الإلكتروني» في نهاية المعاينة (الخطوة الأخيرة من «عقد جديد») — نفس نموذج التوقيع.
 * التوقيع اختياري هنا: يُحفظ مع العقد إن اكتمل، وإلا يُستكمل لاحقاً من صفحة العقد.
 */
export function WizardSignSection({
  available,
  canSignCompany,
  musaned,
  onChange,
}: {
  /** يمكن التوقيع عند الحفظ (عقد تجربة/مساند، أو لمن يملك اعتماد العقود الداخلية) */
  available: boolean;
  canSignCompany: boolean;
  musaned: boolean;
  onChange: (c: SignCapture | null, error: string | null) => void;
}) {
  return (
    <Card className="mt-4 border border-navy-100" data-testid="wizard-sign">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
        <Signature size={16} /> التوقيع الإلكتروني
      </h2>
      {available ? (
        <div className="max-w-xl">
          <ContractSignForm
            customerState="pending"
            companyState={canSignCompany ? 'pending' : 'not_allowed'}
            onChange={onChange}
            note={
              musaned
                ? 'عقد مساند: يُسجَّل التوقيع على نسخة المكتب، ولا يغني عن توقيع العقد على منصة مساند.'
                : 'التوقيع اختياري الآن — إن لم يكتمل يُستكمل من صفحة العقد. لا يُعد العقد موقّعاً إلا بتوقيع الطرفين.'
            }
          />
        </div>
      ) : (
        <p className="rounded-xl bg-navy-50 p-3 text-sm text-navy-900">
          يُوقَّع العقد بعد اعتماده من صاحب صلاحية الاعتماد — احفظه وأرسله للاعتماد، ثم يُستكمل
          التوقيع من صفحة العقد بنفس هذه النافذة.
        </p>
      )}
    </Card>
  );
}
