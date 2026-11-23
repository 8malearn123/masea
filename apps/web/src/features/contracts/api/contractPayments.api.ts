/**
 * دفعات العقد (payments — 0003/0089): العرض والتسجيل من صفحة العقد.
 * مع قاعدة البيانات: الإدراج في payments يحدّث المدفوع ويرحّل القيد تلقائياً (0089).
 * الوضع التجريبي: مخزن في الذاكرة يحدّث المدفوع على العقد.
 */
import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode } from '@/shared/lib/demoBackend';
import { demoMutateContract, getContract } from '@/features/contracts/api/contracts.api';

export type PaymentMethod = 'cash' | 'mada' | 'apple_pay' | 'tamara' | 'transfer';
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'نقدي',
  mada: 'مدى',
  apple_pay: 'Apple Pay',
  tamara: 'تمارا',
  transfer: 'تحويل بنكي',
};

export interface ContractPayment {
  id: string;
  contract_id: string;
  amount: number;
  method: PaymentMethod | null;
  reference_no: string | null;
  paid_at: string;
}

const DEMO: Record<string, ContractPayment[]> = {};
export function resetContractPaymentsDemo(): void {
  for (const k of Object.keys(DEMO)) delete DEMO[k];
}
const demo = (id: string) => isDemoMode() || isDemoId(id);

export async function listContractPayments(contractId: string): Promise<ContractPayment[]> {
  if (demo(contractId)) return (DEMO[contractId] ?? []).map((p) => ({ ...p }));
  const { data, error } = await supabase
    .from('payments')
    .select('id, contract_id, amount, method, reference_no, paid_at')
    .eq('contract_id', contractId)
    .order('paid_at');
  if (error) throw new Error(`تعذّر جلب الدفعات: ${error.message}`);
  return ((data ?? []) as ContractPayment[]).map((p) => ({ ...p, amount: Number(p.amount) }));
}

export const paymentInputSchema = z.object({
  amount: z.number().positive({ message: 'المبلغ يجب أن يكون أكبر من صفر' }),
  method: z.enum(['cash', 'mada', 'apple_pay', 'tamara', 'transfer'], {
    message: 'اختر طريقة الدفع',
  }),
  reference_no: z.string().trim().max(60).optional(),
  paid_on: z.string().min(1, { message: 'حدّد تاريخ الدفعة' }),
});
export type PaymentInput = z.infer<typeof paymentInputSchema>;

export async function recordContractPayment(
  contractId: string,
  input: PaymentInput,
): Promise<void> {
  const p = paymentInputSchema.parse(input);
  const c = await getContract(contractId);
  if (!c) throw new Error('العقد غير موجود');
  const remaining = Math.round((c.total_amount - c.amount_paid) * 100) / 100;
  if (p.amount > remaining) throw new Error(`المبلغ يتجاوز المتبقي على العقد (${remaining})`);
  if (p.paid_on > new Date().toISOString().slice(0, 10))
    throw new Error('تاريخ الدفعة لا يكون في المستقبل');
  if (demo(contractId)) {
    const row: ContractPayment = {
      id: `pay-${Date.now()}`,
      contract_id: contractId,
      amount: p.amount,
      method: p.method,
      reference_no: p.reference_no?.trim() || null,
      paid_at: `${p.paid_on}T09:00:00Z`,
    };
    DEMO[contractId] = [...(DEMO[contractId] ?? []), row];
    demoMutateContract(contractId, {
      amount_paid: Math.round((c.amount_paid + p.amount) * 100) / 100,
    });
    return;
  }
  const { error } = await supabase.from('payments').insert({
    contract_id: contractId,
    amount: p.amount,
    method: p.method,
    reference_no: p.reference_no?.trim() || null,
    paid_at: `${p.paid_on}T09:00:00Z`,
  });
  if (error) throw new Error(`تعذّر تسجيل الدفعة: ${error.message}`);
}
