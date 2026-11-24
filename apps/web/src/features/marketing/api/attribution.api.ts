/**
 * مصدر العميل (0098): مصدر الاكتساب الأصلي على العميل — يُسجَّل مرة ولا يتغيّر
 * بالتواصل اللاحق — ومصدر العقد/الحملة مستقلان على كل عقد. القائمة نفسها
 * lead_sources (تُدار من الإعدادات). الوضع التجريبي: مخزن في الذاكرة بالقواعد نفسها.
 */
import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode } from '@/shared/lib/demoBackend';
import type { RefItem } from '@/features/settings/api/settings.api';

export const UNSPECIFIED_SOURCE = 'غير محدد';

export interface Acquisition {
  source_code: string;
  source_note: string | null;
  campaign_id: string | null;
  first_contact_at: string | null;
}

/** البيانات التسويقية المرسلة مع إنشاء العقد (create_contract_draft → marketing). */
export interface ContractMarketingInput {
  /** يُرسل فقط إن لم يكن للعميل مصدر مسجّل */
  acquisition_source_code?: string | null | undefined;
  acquisition_source_note?: string | null | undefined;
  first_contact_at?: string | null | undefined;
  source_code: string;
  source_note?: string | null | undefined;
  campaign_id?: string | null | undefined;
  lead_id?: string | null | undefined;
}

const DEMO_ACQ: Record<string, Acquisition> = {};
export function resetAttributionDemo(): void {
  for (const k of Object.keys(DEMO_ACQ)) delete DEMO_ACQ[k];
}
const demo = (id: string) => isDemoMode() || isDemoId(id);

/** «أخرى» (أو أي مصدر requires_note) يتطلب توضيحاً. */
export function noteRequired(sources: RefItem[], code: string | null | undefined): boolean {
  return Boolean(code && sources.find((s) => s.code === code)?.requires_note);
}

export function sourceLabelOf(sources: RefItem[], code: string | null | undefined): string {
  if (!code) return UNSPECIFIED_SOURCE;
  return sources.find((s) => s.code === code)?.name_ar ?? code;
}

export function acquisitionSchema(sources: RefItem[]) {
  return z
    .object({
      source_code: z.string().min(1, { message: 'حدّد مصدر العميل' }),
      source_note: z.string().trim().max(120).nullable().optional(),
      campaign_id: z.string().nullable().optional(),
      first_contact_at: z.string().nullable().optional(),
    })
    .refine(
      (v) => !noteRequired(sources, v.source_code) || (v.source_note ?? '').trim().length >= 2,
      {
        message: 'وضّح المصدر عند اختيار «أخرى»',
        path: ['source_note'],
      },
    );
}

export async function getCustomerAcquisition(customerId: string): Promise<Acquisition | null> {
  if (demo(customerId)) return DEMO_ACQ[customerId] ? { ...DEMO_ACQ[customerId] } : null;
  const { data, error } = await supabase
    .from('customers')
    .select(
      'acquisition_source_code, acquisition_source_note, acquisition_campaign_id, first_contact_at',
    )
    .eq('id', customerId)
    .maybeSingle();
  if (error) throw new Error(`تعذّر جلب مصدر العميل: ${error.message}`);
  const r = data as {
    acquisition_source_code: string | null;
    acquisition_source_note: string | null;
    acquisition_campaign_id: string | null;
    first_contact_at: string | null;
  } | null;
  if (!r?.acquisition_source_code) return null;
  return {
    source_code: r.acquisition_source_code,
    source_note: r.acquisition_source_note,
    campaign_id: r.acquisition_campaign_id,
    first_contact_at: r.first_contact_at,
  };
}

/** تسجيل المصدر لعميل بلا مصدر (لا يكتب فوق مصدر مسجّل). */
export async function setCustomerAcquisition(customerId: string, a: Acquisition): Promise<void> {
  if (demo(customerId)) {
    if (DEMO_ACQ[customerId]) throw new Error('مصدر العميل الأصلي مسجّل — استخدم «تصحيح المصدر»');
    DEMO_ACQ[customerId] = {
      ...a,
      source_note: a.source_note?.trim() || null,
      first_contact_at: a.first_contact_at || new Date().toISOString().slice(0, 10),
    };
    return;
  }
  const { error } = await supabase.rpc('set_customer_acquisition', {
    p_customer: customerId,
    p: {
      acquisition_source_code: a.source_code,
      acquisition_source_note: a.source_note,
      acquisition_campaign_id: a.campaign_id,
      first_contact_at: a.first_contact_at,
    },
  });
  if (error) throw new Error(error.message);
}

/** تصحيح مصدر مسجّل — مدير الفرع/العمليات/المدير العام، بسبب، مع سجل. */
export async function changeCustomerAcquisition(
  customerId: string,
  source: string,
  note: string | null,
  reason: string,
  role: string | null,
): Promise<void> {
  if (reason.trim().length < 5) throw new Error('سبب التصحيح مطلوب');
  if (demo(customerId)) {
    if (!['admin', 'branch_manager', 'operations_manager'].includes(role ?? ''))
      throw new Error('تصحيح مصدر العميل الأصلي لمدير الفرع أو العمليات أو المدير العام');
    const cur = DEMO_ACQ[customerId];
    DEMO_ACQ[customerId] = {
      source_code: source,
      source_note: note?.trim() || null,
      campaign_id: cur?.campaign_id ?? null,
      first_contact_at: cur?.first_contact_at ?? null,
    };
    return;
  }
  const { error } = await supabase.rpc('change_customer_acquisition', {
    p_customer: customerId,
    p_source: source,
    p_note: note,
    p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
}

/** للوضع التجريبي: تسجيل المصدر من العميل المحتمل أو العقد إن لم يكن مسجّلاً. */
export function demoRecordAcquisition(customerId: string, a: Acquisition): void {
  if (!DEMO_ACQ[customerId]) DEMO_ACQ[customerId] = { ...a };
}
export function demoAcquisition(customerId: string): Acquisition | null {
  return DEMO_ACQ[customerId] ? { ...DEMO_ACQ[customerId] } : null;
}

/** تعديل مصدر العقد/الحملة بعد إنشائه (اللقطة الأصلية لا تتغيّر). */
export async function setContractMarketing(
  contractId: string,
  m: { source_code: string; source_note?: string | null; campaign_id?: string | null },
): Promise<void> {
  if (demo(contractId)) {
    const { demoMutateContract } = await import('@/features/contracts/api/contracts.api');
    demoMutateContract(contractId, {
      source_code: m.source_code,
      source_note: m.source_note?.trim() || null,
      campaign_id: m.campaign_id ?? null,
    });
    return;
  }
  const { error } = await supabase.rpc('set_contract_marketing', { p_contract: contractId, p: m });
  if (error) throw new Error(error.message);
}
