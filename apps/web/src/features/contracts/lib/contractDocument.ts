/**
 * محرك مستند العقد الموحّد — نفس النص والمبالغ في: معاينة المعالج، صفحة التفاصيل،
 * الطباعة، وتنزيل PDF.
 * - عقد تأجير صادر على القالب المنظَّم (له template_id): `rentalContractHtml` بالقالب
 *   المثبّت وقت إصداره وبيانات الأطراف المجمّدة (doc_fields) — لا يُستبدل بنسخة أحدث.
 * - غير ذلك (العقود القديمة وغير التأجير): `buildContractHtml` ببنوده المحفوظة كما هي.
 */
import { loadRentalDocument } from '@/features/contracts/api/rentalContract.api';
import { rentalContractHtml } from '@/features/contracts/lib/rentalContract/print';
import { buildContractHtml } from '@/features/contracts/lib/contractHtml';
import type { ContractListItem, ContractSignature } from '@/features/contracts/types';

export interface ContractDocument {
  kind: 'rental_template' | 'stored_clauses';
  html: string;
  templateVersion: number | null;
}

const SIGNED = ['signed', 'musaned_signed', 'active', 'completed'];

export async function contractDocumentHtml(
  contract: ContractListItem,
  opts: { clauses: string[]; signatures: ContractSignature[]; autoPrint?: boolean },
): Promise<ContractDocument> {
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
