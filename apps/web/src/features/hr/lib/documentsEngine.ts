/**
 * Documents engine (0074) — one source of truth for the HR documents rules,
 * shared by the demo store and the screens. The database enforces the same:
 *   · status: hr_doc_status → doc_expiry_status(expiry, doc_alert_days())
 *   · a «current» document = active and not superseded by a renewal
 *   · renewal extends the expiry, cost ≥ 0
 *   · storage path: employee/<id>/<file> · worker/<id>/<file>
 */
import { z } from 'zod';
import type { DocStatus, HrDocument } from '@/features/hr/types';

/** Default when the setting is missing — the row itself lives in app_config. */
export const DOC_ALERT_DAYS_KEY = 'doc_expiry_alert_days';
export const DEFAULT_DOC_ALERT_DAYS = 60;

export const DOC_MAX_BYTES = 10 * 1024 * 1024;
export const DOC_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

const DAY = 86_400_000;

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days from today until the expiry (negative = already expired). */
export function daysLeft(expiry: string | null, today = todayIso()): number | null {
  if (!expiry) return null;
  return Math.round((Date.parse(expiry) - Date.parse(today)) / DAY);
}

/** Same rule as doc_expiry_status: past → expired, within the window → expiring. */
export function docStatus(
  expiry: string | null,
  alertDays = DEFAULT_DOC_ALERT_DAYS,
  today = todayIso(),
): DocStatus {
  const left = daysLeft(expiry, today);
  if (left === null) return 'valid';
  if (left < 0) return 'expired';
  if (left <= alertDays) return 'expiring';
  return 'valid';
}

/** Active and not replaced by a renewal — what lists, alerts and counts use. */
export function isCurrent(d: Pick<HrDocument, 'is_active' | 'superseded_by'>): boolean {
  return d.is_active && !d.superseded_by;
}

export interface DocAlert {
  doc: HrDocument;
  status: 'expiring' | 'expired';
  days: number;
}

/** Current documents that are expired or inside the alert window, most urgent first. */
export function expiryAlerts(
  docs: HrDocument[],
  alertDays = DEFAULT_DOC_ALERT_DAYS,
  today = todayIso(),
): DocAlert[] {
  return docs
    .filter(isCurrent)
    .map((doc) => ({
      doc,
      status: docStatus(doc.expiry_date, alertDays, today),
      days: daysLeft(doc.expiry_date, today),
    }))
    .filter((a): a is DocAlert => a.status !== 'valid' && a.days !== null)
    .sort((a, b) => a.days - b.days);
}

/** Iqama register: each person's current iqama + whether a valid work permit exists. */
export interface IqamaRow {
  doc: HrDocument;
  work_permit: boolean;
  status: DocStatus;
  days: number | null;
}
export function iqamaRegister(
  docs: HrDocument[],
  alertDays = DEFAULT_DOC_ALERT_DAYS,
  today = todayIso(),
): IqamaRow[] {
  const current = docs.filter(isCurrent);
  const ownerKey = (d: HrDocument) => `${d.owner_kind}:${d.owner_id}`;
  const permits = new Set(
    current
      .filter((d) => d.type === 'work_permit' && (!d.expiry_date || d.expiry_date >= today))
      .map(ownerKey),
  );
  return current
    .filter((d) => d.type === 'iqama')
    .map((doc) => ({
      doc,
      work_permit: permits.has(ownerKey(doc)),
      status: docStatus(doc.expiry_date, alertDays, today),
      days: daysLeft(doc.expiry_date, today),
    }))
    .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
}

/* ------------------------------- validation ------------------------------- */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'تاريخ غير صحيح' });

export const documentSchema = z
  .object({
    owner_kind: z.enum(['employee', 'worker']),
    owner_id: z.string().min(1, { message: 'اختر صاحب الوثيقة' }),
    type: z.string().min(1, { message: 'اختر نوع الوثيقة' }),
    number: z
      .string()
      .trim()
      .min(1, { message: 'أدخل رقم الوثيقة' })
      .max(40, { message: 'رقم طويل جدًا' }),
    issue_date: isoDate.or(z.literal('')),
    expiry_date: isoDate.or(z.literal('')),
    renewal_cost: z.number({ message: 'التكلفة رقم' }).min(0, { message: 'التكلفة لا تكون سالبة' }),
    notes: z.string().max(500, { message: 'الملاحظات طويلة جدًا' }),
  })
  .refine((d) => !d.issue_date || !d.expiry_date || d.expiry_date > d.issue_date, {
    message: 'تاريخ الانتهاء يجب أن يكون بعد تاريخ الإصدار',
    path: ['expiry_date'],
  });
export type DocumentInput = z.infer<typeof documentSchema>;

export const renewSchema = z
  .object({
    number: z.string().trim().max(40, { message: 'رقم طويل جدًا' }),
    issue_date: isoDate,
    expiry_date: isoDate,
    renewal_cost: z.number({ message: 'التكلفة رقم' }).min(0, { message: 'التكلفة لا تكون سالبة' }),
    notes: z.string().max(500, { message: 'الملاحظات طويلة جدًا' }),
  })
  .refine((d) => d.expiry_date > d.issue_date, {
    message: 'تاريخ الانتهاء يجب أن يكون بعد تاريخ الإصدار',
    path: ['expiry_date'],
  });
export type RenewInput = z.infer<typeof renewSchema>;

/** Renewal must push the expiry forward (renew_document). */
export function assertRenewable(doc: HrDocument, input: RenewInput): void {
  if (!doc.is_active) throw new Error('الوثيقة معطّلة — أعد تفعيلها أولاً');
  if (doc.superseded_by) throw new Error('الوثيقة جُدِّدت سابقًا');
  if (doc.expiry_date && input.expiry_date <= doc.expiry_date)
    throw new Error(`تاريخ الانتهاء الجديد يجب أن يكون بعد الحالي (${doc.expiry_date})`);
}

/** First Zod message, or null when valid. */
export function firstIssue(r: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string | null {
  return r.success ? null : (r.error?.issues[0]?.message ?? 'بيانات غير صحيحة');
}

/* --------------------------------- files ---------------------------------- */
export function validateDocFile(file: { type: string; size: number }): string | null {
  if (!(DOC_MIME_TYPES as readonly string[]).includes(file.type))
    return 'الملف يجب أن يكون PDF أو صورة (JPG / PNG / WEBP)';
  if (file.size <= 0) return 'الملف فارغ';
  if (file.size > DOC_MAX_BYTES) return 'حجم الملف يتجاوز 10 ميجابايت';
  return null;
}

/** Storage object path under its owner — the DB guard rejects anything else. */
export function docStoragePath(
  owner: { owner_kind: 'employee' | 'worker'; owner_id: string },
  fileName: string,
  stamp = Date.now(),
): string {
  const ext = (fileName.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  return `${owner.owner_kind}/${owner.owner_id}/${stamp}.${ext}`;
}

export function fileSizeLabel(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}
