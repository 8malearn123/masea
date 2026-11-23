/**
 * دفعات العقد وجدول استحقاقاته (payments — 0003/0089/0096).
 * مع قاعدة البيانات: record_contract_payment يتحقق ويُدرج الدفعة، فيُحدَّث المدفوع
 * ويُرحَّل القيد على الحساب المستلم المختار؛ الارتداد قيد عكسي (لا حذف).
 * الوضع التجريبي: مخزن في الذاكرة يطبّق القواعد نفسها ويحدّث المدفوع على العقد.
 */
import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode } from '@/shared/lib/demoBackend';
import { demoMutateContract, getContract } from '@/features/contracts/api/contracts.api';
import { listBankAccounts } from '@/features/accounting/api/accounting.api';

export type PaymentMethod = 'cash' | 'mada' | 'apple_pay' | 'tamara' | 'transfer';
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'نقدي',
  mada: 'مدى / شبكة',
  apple_pay: 'Apple Pay',
  tamara: 'تمارا',
  transfer: 'تحويل بنكي',
};

export type PaymentStatus = 'received' | 'pending_clearance' | 'bounced';
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  received: 'مستلمة',
  pending_clearance: 'بانتظار التحصيل',
  bounced: 'مرتجعة',
};

export interface ContractPayment {
  id: string;
  contract_id: string;
  amount: number;
  method: PaymentMethod | null;
  reference_no: string | null;
  paid_at: string;
  status: PaymentStatus;
  transaction_no: string | null;
  bank_account_id: string | null;
  bank_account_name: string | null;
}

/** حساب استلام (bank_account_options — الآيبان مقنّع لغير المحاسبة). */
export interface ReceivingAccount {
  id: string;
  name: string;
  bank: string | null;
  holder_name: string | null;
  iban_masked: string | null;
  currency: string;
  is_cash: boolean;
}

const DEMO: Record<string, ContractPayment[]> = {};
const DEMO_INST: Record<string, { seq: number; due_date: string; amount: number }[]> = {};
export function resetContractPaymentsDemo(): void {
  for (const k of Object.keys(DEMO)) delete DEMO[k];
  for (const k of Object.keys(DEMO_INST)) delete DEMO_INST[k];
}
const demo = (id: string) => isDemoMode() || isDemoId(id);
const r2 = (n: number) => Math.round(n * 100) / 100;

const maskIban = (iban: string | null) => (iban ? `SA••${iban.slice(-4)}` : null);

export async function listReceivingAccounts(): Promise<ReceivingAccount[]> {
  if (isDemoMode()) {
    return (await listBankAccounts())
      .filter((b) => b.is_active)
      .map((b) => ({
        id: b.id,
        name: b.name,
        bank: b.bank || null,
        holder_name: b.holder_name ?? null,
        iban_masked: maskIban(b.iban),
        currency: b.currency ?? 'SAR',
        is_cash: !b.iban,
      }));
  }
  const { data, error } = await supabase.rpc('bank_account_options');
  if (error) throw new Error(`تعذّر جلب حسابات الاستلام: ${error.message}`);
  return (data ?? []) as ReceivingAccount[];
}

export async function listContractPayments(contractId: string): Promise<ContractPayment[]> {
  if (demo(contractId)) return (DEMO[contractId] ?? []).map((p) => ({ ...p }));
  const { data, error } = await supabase
    .from('payments')
    .select(
      'id, contract_id, amount, method, reference_no, paid_at, status, transaction_no, bank_account_id, bank_accounts(name)',
    )
    .eq('contract_id', contractId)
    .order('paid_at');
  if (error) throw new Error(`تعذّر جلب الدفعات: ${error.message}`);
  return (
    (data ?? []) as unknown as (Omit<ContractPayment, 'bank_account_name'> & {
      bank_accounts: { name: string } | null;
    })[]
  ).map(({ bank_accounts, ...p }) => ({
    ...p,
    amount: Number(p.amount),
    status: p.status ?? 'received',
    bank_account_name: bank_accounts?.name ?? null,
  }));
}

export const paymentInputSchema = z
  .object({
    amount: z.number().positive({ message: 'المبلغ يجب أن يكون أكبر من صفر' }),
    method: z.enum(['cash', 'mada', 'apple_pay', 'tamara', 'transfer'], {
      message: 'اختر طريقة الدفع',
    }),
    reference_no: z.string().trim().max(60).optional(),
    paid_on: z.string().min(1, { message: 'حدّد تاريخ الدفعة' }),
    bank_account_id: z.string().nullable().optional(),
    transaction_no: z.string().trim().max(60).optional(),
    status: z.enum(['received', 'pending_clearance']).default('received'),
  })
  .refine((v) => v.method !== 'transfer' || Boolean(v.bank_account_id), {
    message: 'اختر الحساب البنكي المستلم للتحويل',
    path: ['bank_account_id'],
  })
  .refine((v) => v.method !== 'transfer' || (v.transaction_no ?? '').trim().length >= 3, {
    message: 'رقم عملية التحويل مطلوب',
    path: ['transaction_no'],
  });
export type PaymentInput = z.input<typeof paymentInputSchema>;

/** المتبقي القابل للتحصيل = الإجمالي − المستلم − ما ينتظر التحصيل. */
export function collectibleRemaining(total: number, paid: number, rows: ContractPayment[]): number {
  const pending = rows
    .filter((p) => p.status === 'pending_clearance')
    .reduce((s, p) => s + p.amount, 0);
  return r2(total - paid - pending);
}

export async function recordContractPayment(
  contractId: string,
  input: PaymentInput,
): Promise<void> {
  const p = paymentInputSchema.parse(input);
  const c = await getContract(contractId);
  if (!c) throw new Error('العقد غير موجود');
  if (p.paid_on > new Date().toISOString().slice(0, 10))
    throw new Error('تاريخ الدفعة لا يكون في المستقبل');
  if (demo(contractId)) {
    const rows = DEMO[contractId] ?? [];
    const remaining = collectibleRemaining(c.total_amount, c.amount_paid, rows);
    if (p.amount > remaining) throw new Error(`المبلغ يتجاوز المتبقي على العقد (${remaining})`);
    const accounts = p.bank_account_id ? await listReceivingAccounts() : [];
    const acc = accounts.find((a) => a.id === p.bank_account_id) ?? null;
    if (p.bank_account_id && !acc) throw new Error('الحساب المستلم غير متاح');
    const row: ContractPayment = {
      id: `pay-${Date.now()}-${rows.length}`,
      contract_id: contractId,
      amount: p.amount,
      method: p.method,
      reference_no: p.reference_no?.trim() || null,
      paid_at: `${p.paid_on}T09:00:00Z`,
      status: p.status,
      transaction_no: p.transaction_no?.trim() || null,
      bank_account_id: acc?.id ?? null,
      bank_account_name: acc?.name ?? null,
    };
    DEMO[contractId] = [...rows, row];
    if (p.status === 'received')
      demoMutateContract(contractId, { amount_paid: r2(c.amount_paid + p.amount) });
    return;
  }
  const { error } = await supabase.rpc('record_contract_payment', {
    p_contract: contractId,
    p_amount: p.amount,
    p_method: p.method,
    p_paid_on: p.paid_on,
    p_bank_account: p.bank_account_id ?? null,
    p_transaction_no: p.transaction_no?.trim() || null,
    p_reference: p.reference_no?.trim() || null,
    p_status: p.status,
  });
  if (error) throw new Error(`تعذّر تسجيل الدفعة: ${error.message}`);
}

/** تأكيد تحصيل دفعة معلّقة أو ارتداد دفعة (قيد عكسي — لا حذف). */
export async function setPaymentStatus(
  payment: ContractPayment,
  status: 'received' | 'bounced',
  note?: string,
): Promise<void> {
  const allowed =
    (payment.status === 'pending_clearance' && (status === 'received' || status === 'bounced')) ||
    (payment.status === 'received' && status === 'bounced');
  if (!allowed) throw new Error('لا يمكن تغيير حالة هذه الدفعة');
  if (status === 'bounced' && (note ?? '').trim().length < 3) throw new Error('سبب الارتداد مطلوب');
  if (demo(payment.contract_id)) {
    const rows = DEMO[payment.contract_id] ?? [];
    const row = rows.find((x) => x.id === payment.id);
    if (!row) throw new Error('الدفعة غير موجودة');
    const c = await getContract(payment.contract_id);
    if (!c) throw new Error('العقد غير موجود');
    const delta =
      (status === 'received' ? 1 : 0) * row.amount - (row.status === 'received' ? row.amount : 0);
    row.status = status;
    demoMutateContract(payment.contract_id, { amount_paid: r2(c.amount_paid + delta) });
    return;
  }
  const { error } = await supabase.rpc('set_payment_status', {
    p_payment: payment.id,
    p_status: status,
    p_note: note?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------ الاستحقاقات ------------------------------ */

export type InstallmentStatus = 'paid' | 'partial' | 'overdue' | 'due';
export const INSTALLMENT_STATUS_LABEL: Record<InstallmentStatus, string> = {
  paid: 'مدفوع',
  partial: 'مدفوع جزئياً',
  overdue: 'متأخر',
  due: 'مستحق',
};

export interface Installment {
  seq: number;
  due_date: string;
  amount: number;
  paid_amount: number;
  remaining: number;
  status: InstallmentStatus;
}

/** توزيع المدفوع على الاستحقاقات بالأقدم أولاً (مطابق لـ contract_installments_allocate). */
export function allocateInstallments(
  items: { seq: number; due_date: string; amount: number }[],
  paid: number,
  today = new Date().toISOString().slice(0, 10),
): Installment[] {
  let left = paid;
  return [...items]
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.seq - b.seq)
    .map((i) => {
      const paidAmount = r2(Math.min(i.amount, Math.max(left, 0)));
      left -= i.amount;
      const status: InstallmentStatus =
        paidAmount >= i.amount
          ? 'paid'
          : i.due_date < today
            ? 'overdue'
            : paidAmount > 0
              ? 'partial'
              : 'due';
      return { ...i, paid_amount: paidAmount, remaining: r2(i.amount - paidAmount), status };
    });
}

/** جدول استحقاقات مقترح: دفعة واحدة، أو أقساط متساوية شهرية (الفرق في الأخير). */
export function buildSchedule(
  total: number,
  start: string,
  count: number,
): { due_date: string; amount: number }[] {
  const n = Math.max(1, Math.floor(count));
  const each = Math.floor((total / n) * 100) / 100;
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    return {
      due_date: d.toISOString().slice(0, 10),
      amount: i === n - 1 ? r2(total - each * (n - 1)) : each,
    };
  });
}

export async function listInstallments(contractId: string): Promise<Installment[]> {
  if (demo(contractId)) {
    const c = await getContract(contractId);
    return allocateInstallments(DEMO_INST[contractId] ?? [], c?.amount_paid ?? 0);
  }
  const { data, error } = await supabase
    .from('contract_installments_v')
    .select('seq, due_date, amount, paid_amount, remaining, status')
    .eq('contract_id', contractId)
    .order('due_date');
  if (error) throw new Error(`تعذّر جلب الاستحقاقات: ${error.message}`);
  return ((data ?? []) as Installment[]).map((i) => ({
    ...i,
    amount: Number(i.amount),
    paid_amount: Number(i.paid_amount),
    remaining: Number(i.remaining),
  }));
}

export const installmentsSchema = z
  .array(
    z.object({
      due_date: z.string().min(1, { message: 'حدّد تاريخ كل استحقاق' }),
      amount: z.number().positive({ message: 'مبلغ كل استحقاق أكبر من صفر' }),
    }),
  )
  .min(1, { message: 'أضف استحقاقاً واحداً على الأقل' });

export async function setInstallments(
  contractId: string,
  items: { due_date: string; amount: number }[],
): Promise<void> {
  const rows = installmentsSchema.parse(items);
  const c = await getContract(contractId);
  if (!c) throw new Error('العقد غير موجود');
  if (['cancelled', 'completed'].includes(c.status)) throw new Error('العقد مغلق');
  const sum = r2(rows.reduce((s, i) => s + i.amount, 0));
  if (Math.abs(sum - c.total_amount) > 0.01)
    throw new Error(`مجموع الاستحقاقات (${sum}) لا يساوي إجمالي العقد (${c.total_amount})`);
  if (demo(contractId)) {
    DEMO_INST[contractId] = rows.map((r, i) => ({ seq: i + 1, ...r }));
    return;
  }
  const { error } = await supabase.rpc('set_contract_installments', {
    p_contract: contractId,
    p_items: rows,
  });
  if (error) throw new Error(error.message);
}
