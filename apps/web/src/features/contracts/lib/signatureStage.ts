import type { ContractListItem, ContractSignature } from '@/features/contracts/types';

/**
 * مرحلة التوقيع الإلكتروني للعقد (مرآة sign_contract_party — 0107):
 * مسودة · بانتظار توقيع العميل · بانتظار توقيع الشركة · بانتظار اكتمال التوقيعات · موقّع ومكتمل.
 * الحالة النظامية للعقد (contracts.status) لا تتغيّر — هذه قراءة لها مع سجل التوقيعات.
 */
export type SignatureStage =
  | 'draft'
  | 'awaiting_customer'
  | 'awaiting_company'
  | 'awaiting_both'
  | 'complete'
  | 'closed';

export const SIGNATURE_STAGE_LABEL: Record<SignatureStage, string> = {
  draft: 'مسودة',
  awaiting_customer: 'بانتظار توقيع العميل',
  awaiting_company: 'بانتظار توقيع الشركة',
  awaiting_both: 'بانتظار اكتمال التوقيعات',
  complete: 'موقّع ومكتمل',
  closed: 'ملغى',
};

export const SIGNATURE_STAGE_TONE: Record<
  SignatureStage,
  'neutral' | 'gold' | 'success' | 'danger'
> = {
  draft: 'neutral',
  awaiting_customer: 'gold',
  awaiting_company: 'gold',
  awaiting_both: 'gold',
  complete: 'success',
  closed: 'danger',
};

const DONE = ['signed', 'musaned_signed', 'active', 'completed'];

export interface SignatureState {
  stage: SignatureStage;
  label: string;
  /** يمكن التوقيع الآن (حالة العقد تسمح) */
  signable: boolean;
  customer: ContractSignature | null;
  company: ContractSignature | null;
  /** عقد مساند: التوقيع هنا على نسخة المكتب، والرسمي على المنصة */
  musaned: boolean;
}

/** آخر توقيع لكل طرف (السجلات السابقة تُحتسب كما هي — لا يُفترض توقيع غير مسجّل). */
export function signatureState(
  contract: Pick<ContractListItem, 'status' | 'service_code'>,
  signatures: ContractSignature[],
  musaned: boolean,
): SignatureState {
  const last = (t: 'customer' | 'company') =>
    [...signatures].reverse().find((s) => s.signer_type === t) ?? null;
  const customer = last('customer');
  const company = last('company');
  const status = contract.status as string;
  const trial = contract.service_code === 'transfer_trial';
  const signable =
    status !== 'cancelled' &&
    !DONE.includes(status) &&
    (trial
      ? ['draft', 'awaiting_signature'].includes(status)
      : musaned
        ? ['draft', 'musaned_created'].includes(status)
        : ['approved', 'awaiting_signature'].includes(status));
  let stage: SignatureStage;
  if (status === 'cancelled') stage = 'closed';
  else if ((customer && company) || (!musaned && DONE.includes(status))) stage = 'complete';
  else if (!signable) stage = 'draft';
  else if (customer) stage = 'awaiting_company';
  else if (company) stage = 'awaiting_customer';
  else stage = 'awaiting_both';
  return { stage, label: SIGNATURE_STAGE_LABEL[stage], signable, customer, company, musaned };
}
