import { z } from 'zod';
import { isValidDay } from '@/features/requests/lib/period';

/** Contract state machine — mirrors supabase 0015/0016/0049 (backend is source of truth). */
export const contractStatusSchema = z.enum([
  'draft',
  // Musaned track (recruitment / sponsorship transfer) — contract lives on منصة مساند
  'musaned_created',
  'musaned_signed',
  // Internal track (rental) — full in-system lifecycle
  'pending_approval',
  'approved',
  'awaiting_signature',
  'signed',
  'active',
  'completed',
  'cancelled',
]);
export type ContractStatus = z.infer<typeof contractStatusSchema>;

export const contractServiceCodeSchema = z.enum([
  'recruitment',
  'monthly_rental',
  'daily_rental',
  'sponsorship_transfer',
]);
export type ContractServiceCode = z.infer<typeof contractServiceCodeSchema>;

/**
 * Where a contract is created & signed. `musaned` contracts (استقدام / نقل كفالة)
 * are created and signed on منصة مساند; our system only tracks the process and the
 * Musaned reference number. `internal` contracts (تأجير) run the full in-system flow.
 * Managed per service in `services.contract_origin` (0049).
 */
export const contractOriginSchema = z.enum(['internal', 'musaned']);
export type ContractOrigin = z.infer<typeof contractOriginSchema>;

export const priceBreakdownSchema = z.object({
  base: z.number(),
  vat: z.number(),
  total: z.number(),
});
export type PriceBreakdown = z.infer<typeof priceBreakdownSchema>;

export const contractTemplateSchema = z.object({
  id: z.string().uuid(),
  service_code: contractServiceCodeSchema,
  name: z.string(),
  clauses: z.array(z.string()),
  is_active: z.boolean(),
});
export type ContractTemplate = z.infer<typeof contractTemplateSchema>;

export const contractClauseSchema = z.object({
  id: z.string().uuid(),
  contract_id: z.string().uuid(),
  sort_order: z.number().int(),
  body: z.string(),
});
export type ContractClause = z.infer<typeof contractClauseSchema>;

export const contractSignatureSchema = z.object({
  id: z.string(),
  contract_id: z.string(),
  signer_type: z.enum(['customer', 'company']),
  signer_name: z.string().nullable(),
  national_id: z.string().nullable().default(null),
  ip_address: z.string().nullable().default(null),
  signature_image: z.string().nullable(),
  signed_at: z.string(),
});
export type ContractSignature = z.infer<typeof contractSignatureSchema>;

export const contractStatusHistorySchema = z.object({
  id: z.string().uuid(),
  contract_id: z.string().uuid(),
  from_status: z.string().nullable(),
  to_status: z.string(),
  changed_by: z.string().uuid().nullable(),
  created_at: z.string(),
});
export type ContractStatusHistory = z.infer<typeof contractStatusHistorySchema>;

export const contractSchema = z.object({
  id: z.string().uuid(),
  contract_no: z.string().nullable(),
  service_code: contractServiceCodeSchema.nullable(),
  template_id: z.string().uuid().nullable(),
  customer_id: z.string().uuid(),
  worker_id: z.string().uuid().nullable(),
  branch_id: z.string().uuid().nullable(),
  created_by: z.string().uuid().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  base_amount: z.number(),
  vat_amount: z.number(),
  total_amount: z.number(),
  // Predefined-discount trail (0052): base_amount is the NET after discount.
  gross_amount: z.number().nullable().default(null),
  discount_amount: z.number().default(0),
  promotion_id: z.string().nullable().default(null),
  // Running total collected against the contract (supabase contracts.amount_paid).
  amount_paid: z.number().default(0),
  status: contractStatusSchema,
  version: z.number().int(),
  parent_contract_id: z.string().uuid().nullable(),
  signed_at: z.string().nullable(),
  created_at: z.string(),
  // Musaned reference number (رقم عقد مساند) — set for musaned-origin contracts (0049).
  musaned_contract_no: z.string().nullable().default(null),
  // External-office recruitment workflow (0037) — null until assigned.
  assigned_office_id: z.string().nullable().default(null),
  assigned_at: z.string().nullable().default(null),
  recruitment_stage: z.string().nullable().default(null),
  // Visa / travel data filled by the assigned office (0040).
  visa_number: z.string().nullable().default(null),
  expected_arrival_date: z.string().nullable().default(null),
  flight_no: z.string().nullable().default(null),
});
export type Contract = z.infer<typeof contractSchema>;

/** A stage document attached by the external office (supabase recruitment_documents). */
export const recruitmentDocumentSchema = z.object({
  id: z.string(),
  contract_id: z.string(),
  stage_code: z.string().nullable(),
  doc_type: z.string(),
  file_name: z.string(),
  storage_path: z.string().nullable(),
  uploaded_by: z.string().nullable(),
  created_at: z.string(),
});
export type RecruitmentDocument = z.infer<typeof recruitmentDocumentSchema>;

/** Managed recruitment stage (config — supabase recruitment_stages). */
export const recruitmentStageSchema = z.object({
  id: z.string(),
  code: z.string(),
  name_ar: z.string(),
  sort_order: z.number().int(),
  is_active: z.boolean(),
});
export type RecruitmentStage = z.infer<typeof recruitmentStageSchema>;

/** A follow-up entry logged by the external office (supabase recruitment_followups). */
export const recruitmentFollowupSchema = z.object({
  id: z.string(),
  contract_id: z.string(),
  stage_code: z.string().nullable(),
  note: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: z.string(),
});
export type RecruitmentFollowup = z.infer<typeof recruitmentFollowupSchema>;

/** An external-office account a recruitment contract can be assigned to. */
export interface ExternalOfficeAccount {
  id: string;
  full_name: string;
  branch: string | null;
}

/**
 * مدة العقد كما تُحفظ (contracts.start_date / end_date). تُفحص قبل أي كتابة:
 * تاريخ تقويمي صحيح، ونهاية لا تسبق البداية. end_date = null لعقد بلا مدة
 * (نقل الكفالة).
 */
export const contractTermSchema = z
  .object({
    start_date: z
      .string()
      .min(1, { message: 'حدّد تاريخ البداية' })
      .refine(isValidDay, { message: 'تاريخ البداية غير صالح' }),
    end_date: z.string().refine(isValidDay, { message: 'تاريخ النهاية غير صالح' }).nullable(),
  })
  .refine((t) => t.end_date === null || t.end_date >= t.start_date, {
    message: 'تاريخ النهاية لا يمكن أن يسبق تاريخ البداية',
    path: ['end_date'],
  });
export type ContractTerm = z.infer<typeof contractTermSchema>;

/**
 * Wizard input — validated on the client and re-validated/priced in the backend
 * (create_contract_draft, 0052). `branch` is a branch name or uuid (resolved
 * server-side); the price is never sent — only the predefined `promotion_id`.
 */
export const createContractInputSchema = z
  .object({
    service_code: contractServiceCodeSchema,
    customer_id: z.string().min(1, { message: 'اختر العميل' }),
    customer_name: z.string().nullable().optional(),
    worker_id: z.string().nullable().optional(),
    worker_name: z.string().nullable().optional(),
    branch: z.string().min(1, { message: 'اختر الفرع' }),
    start_date: z.string().min(1, { message: 'حدّد تاريخ البداية' }),
    end_date: z.string().nullable().optional(),
    quantity: z.number().int().positive({ message: 'الكمية يجب أن تكون 1 على الأقل' }).default(1),
    nationality: z.string().optional(),
    profession: z.string().optional(),
    template_id: z.string().nullable().optional(),
    promotion_id: z.string().nullable().optional(),
    clauses: z.array(z.string()).default([]),
    // Optional at creation for musaned contracts — can be filled once issued on مساند.
    musaned_contract_no: z.string().optional(),
  })
  .refine((v) => !v.end_date || v.end_date >= v.start_date, {
    message: 'تاريخ النهاية قبل تاريخ البداية',
    path: ['end_date'],
  });
export type CreateContractInput = z.input<typeof createContractInputSchema>;

/** Editable fields of a DRAFT contract (update_contract_draft, 0052). */
export const updateDraftInputSchema = z
  .object({
    start_date: z.string().min(1, { message: 'حدّد تاريخ البداية' }),
    end_date: z.string().nullable(),
    branch: z.string().min(1, { message: 'اختر الفرع' }),
  })
  .refine((v) => !v.end_date || v.end_date >= v.start_date, {
    message: 'تاريخ النهاية قبل تاريخ البداية',
    path: ['end_date'],
  });
export type UpdateDraftInput = z.infer<typeof updateDraftInputSchema>;
