/**
 * التأجير اليومي بلا عقد يُوقَّع: موافقة العميل على الشروط في معالج الطلب تُنشئ
 * عقدًا موقّعًا تلقائيًا (مرآة 0060 في الوضع التجريبي) يظهر مع بقية العقود.
 */
import { describe, expect, it } from 'vitest';
import { createMockRequestService } from '@/features/requests/services/mockRequestService';
import type { SubmitRequestInput } from '@/features/requests/services/types';
import { contractTerms } from '@/features/requests/lib/orderTerms';
import { emptyDraft } from '@/lib/orderTypes';
import { addDays, today } from '@/features/requests/lib/period';
import {
  getClauses,
  getContract,
  getHistory,
  getSignatures,
  listContracts,
} from '@/features/contracts/api/contracts.api';
import { listOrders } from '@/features/orders/api/orders.api';
import { updateConfig } from '@/features/settings/api/settings.api';

const START = addDays(today(), 10);
const ALL = { status: 'all', service: 'all', branch: 'all', search: '' } as const;
let seq = 0;
function input(over: Partial<SubmitRequestInput['draft']> = {}): SubmitRequestInput {
  seq += 1;
  return {
    clientToken: `terms-${seq}-${Math.random().toString(36).slice(2)}`,
    serviceName: 'تأجير يومي',
    price: { base: 540, vat: 81, total: 621 },
    draft: {
      ...emptyDraft('daily_rental'),
      customerName: 'فهد العنزي',
      phone: '0533456789',
      nationalId: '',
      city: 'شرورة',
      branch: 'شرورة',
      startDate: START,
      days: 3,
      taskType: 'تنظيف',
      agreeTerms: true,
      ...over,
    },
  };
}
const contractOf = async (requestNo: string) =>
  (await listContracts(ALL)).find((c) => c.source_request_no === requestNo);

describe('daily rental: contract from the accepted terms', () => {
  it('creates a signed contract whose clauses are the accepted terms', async () => {
    const req = input();
    const { requestNo } = await createMockRequestService().submit(req);
    const c = await contractOf(requestNo);
    expect(c).toBeDefined();
    expect(c!.status).toBe('signed');
    expect(c!.service_code).toBe('daily_rental');
    expect(c!.customer_name).toBe('فهد العنزي');
    expect(c!.total_amount).toBe(621);
    expect(c!.start_date).toBe(START);
    expect(c!.terms_accepted_at).toBe(c!.signed_at);

    const terms = contractTerms('daily_rental', req.draft, 'تأجير يومي', 621);
    expect((await getClauses(c!.id)).map((x) => x.body)).toEqual(terms);
    const [sig] = await getSignatures(c!.id);
    expect(sig?.signer_type).toBe('customer');
    expect(sig?.signer_name).toContain('موافقة إلكترونية');
    expect((await getHistory(c!.id)).map((h) => h.to_status)).toEqual(['signed']);
    expect((await getContract(c!.id))?.source_request_no).toBe(requestNo);

    // the order links to its contract
    const order = (await listOrders({ status: 'all', branch: 'all', search: '' })).find(
      (o) => o.request_no === requestNo,
    );
    expect(order?.contract_id).toBe(c!.id);
    expect(order?.contract_no).toBe(c!.contract_no);
  });

  it('no contract without acceptance, for other services, or when switched off', async () => {
    const svc = createMockRequestService();
    const noTerms = await svc.submit(input({ agreeTerms: false }));
    expect(await contractOf(noTerms.requestNo)).toBeUndefined();

    const monthly = await svc.submit({
      ...input(),
      serviceName: 'تأجير شهري',
      draft: {
        ...input().draft,
        ...emptyDraft('monthly_rental'),
        customerName: 'سارة القحطاني',
        phone: '0552345678',
        branch: 'جازان',
        city: 'جازان',
        startDate: START,
        months: 1,
        nationality: 'الفلبين',
        agreeTerms: true,
      },
    });
    expect(await contractOf(monthly.requestNo)).toBeUndefined();

    await updateConfig('contract_auto_terms_daily', 0);
    const off = await svc.submit(input());
    expect(await contractOf(off.requestNo)).toBeUndefined();
    await updateConfig('contract_auto_terms_daily', 1);
  });
});
