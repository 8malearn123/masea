/**
 * محرك مستند العقد الموحّد — نفس النص والمبالغ في: معاينة المعالج، صفحة التفاصيل،
 * الطباعة، وتنزيل PDF.
 * - عقد تأجير صادر على القالب المنظَّم (له template_id): `rentalContractHtml` بالقالب
 *   المثبّت وقت إصداره وبيانات الأطراف المجمّدة (doc_fields) — لا يُستبدل بنسخة أحدث.
 * - عقد تجربة (نقل كفالة) على القالب الرسمي «عقد تجربة» (0106): نفس تصميم ملف الشركة ببياناته
 *   المحفوظة مع التجربة وختم القبول الإلكتروني إن وُجد.
 * - غير ذلك (العقود القديمة وغير التأجير): `buildContractHtml` ببنوده المحفوظة كما هي.
 */
import { loadRentalDocument } from '@/features/contracts/api/rentalContract.api';
import { rentalContractHtml } from '@/features/contracts/lib/rentalContract/print';
import { buildContractHtml } from '@/features/contracts/lib/contractHtml';
import type { ContractListItem, ContractSignature } from '@/features/contracts/types';
import {
  getAcceptance,
  getTrialByContract,
  getTrialDocument,
} from '@/features/contracts/api/trials.api';
import { trialDocumentHtml } from '@/features/contracts/lib/trialContract/document';
import { isTrialContractDoc } from '@/features/contracts/lib/trialContract/template';
import { dateTimeAr } from '@/shared/lib/format';

export interface ContractDocument {
  kind: 'rental_template' | 'trial_contract' | 'stored_clauses';
  html: string;
  templateVersion: number | null;
}

const SIGNED = ['signed', 'musaned_signed', 'active', 'completed'];

export async function contractDocumentHtml(
  contract: ContractListItem,
  opts: { clauses: string[]; signatures: ContractSignature[]; autoPrint?: boolean },
): Promise<ContractDocument> {
  if (contract.service_code === 'transfer_trial') {
    const trial = await getTrialByContract(contract.id);
    if (trial && isTrialContractDoc(trial.terms_snapshot)) {
      const [d, acc] = await Promise.all([getTrialDocument(trial.id), getAcceptance(trial.id)]);
      const html = trialDocumentHtml(d, {
        watermark: acc ? null : 'بانتظار قبول العميل',
        autoPrint: opts.autoPrint ?? false,
        acceptance: acc
          ? {
              reference: acc.document_sha256.slice(0, 12).toUpperCase(),
              at: dateTimeAr(acc.accepted_at),
            }
          : null,
      });
      if (html)
        return { kind: 'trial_contract', html, templateVersion: trial.terms_snapshot.version };
    }
  }
  const doc = await loadRentalDocument(contract);
  if (!doc) {
    return {
      kind: 'stored_clauses',
      html: buildContractHtml(contract, opts.clauses, { autoPrint: opts.autoPrint ?? false }),
      templateVersion: null,
    };
  }
  const img = (type: 'customer' | 'company') => {
    const v = opts.signatures.find((x) => x.signer_type === type)?.signature_image ?? null;
    return v && v.startsWith('data:image/') ? v : null;
  };
  return {
    kind: 'rental_template',
    html: await rentalContractHtml(doc.template.doc, doc.source, {
      watermark: SIGNED.includes(contract.status) ? null : 'مسودة — غير موقّعة',
      autoPrint: opts.autoPrint ?? false,
      signatures: { employee: img('company'), customer: img('customer') },
    }),
    templateVersion: doc.template.version,
  };
}
