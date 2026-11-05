import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isDemoMode, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import { recordAudit } from '@/shared/lib/auditTrail';
import {
  GOSI_CONFIG,
  GOSI_CONFIG_DEFAULTS,
  PAYROLL_CONFIG,
  PAYROLL_CONFIG_DEFAULTS,
  type GosiConfig,
  type PayrollConfig,
} from '@/features/hr/api/hr.api';

/**
 * Payroll & GOSI settings — supabase `payroll_config` / `gosi_config` (0022,
 * writable with hr.manage since 0067, audited by audit_row_change). The engine
 * (calculatePayslip / employerGosiFor) reads the live PAYROLL_CONFIG/GOSI_CONFIG
 * objects, so a saved value applies to the next payroll run, the payslip and
 * the accounting accrual immediately. Demo mode persists edits locally.
 */

const LS_KEY = 'masea_payroll_settings';

export interface PayrollSettings {
  payroll: PayrollConfig;
  gosi: GosiConfig;
}

function persistDemo(): void {
  try {
    localStorage?.setItem(LS_KEY, JSON.stringify({ payroll: PAYROLL_CONFIG, gosi: GOSI_CONFIG }));
  } catch {
    // storage blocked → keep the in-memory edit
  }
}

// ------------------------------ validation --------------------------------
// Same bounds as the 0067 CHECK constraints, so the UI rejects what the DB would.
const rate = z
  .number({ message: 'أدخل رقمًا' })
  .min(0, { message: 'لا تقل عن 0٪' })
  .max(0.5, { message: 'لا تزيد عن 50٪' });

export const payrollConfigSchema = z.object({
  standardWorkDays: z
    .number({ message: 'أدخل رقمًا' })
    .int({ message: 'عدد صحيح' })
    .min(20, { message: 'بين 20 و31 يومًا' })
    .max(31, { message: 'بين 20 و31 يومًا' }),
  dailyHours: z
    .number({ message: 'أدخل رقمًا' })
    .gt(0, { message: 'أكبر من صفر' })
    .max(12, { message: 'لا تزيد عن 12 ساعة' }),
  overtimeMultiplier: z
    .number({ message: 'أدخل رقمًا' })
    .min(1, { message: 'المعامل 1 على الأقل' })
    .max(3, { message: 'لا يزيد عن 3' }),
  shiftStartHour: z
    .number({ message: 'أدخل رقمًا' })
    .min(0, { message: 'بين 0 و23.5' })
    .lt(24, { message: 'بين 0 و23.5' }),
  lateGraceMinutes: z
    .number({ message: 'أدخل رقمًا' })
    .int({ message: 'عدد صحيح' })
    .min(0, { message: 'بين 0 و120 دقيقة' })
    .max(120, { message: 'بين 0 و120 دقيقة' }),
});

export const gosiConfigSchema = z.object({
  ceiling: z.number({ message: 'أدخل رقمًا' }).positive({ message: 'أكبر من صفر' }),
  saudiOldEmployee: rate,
  saudiOldCompany: rate,
  saudiNewEmployee: rate,
  saudiNewCompany: rate,
  nonSaudiCompany: rate,
});

/** Restore demo edits once at load (the engine defaults stay the seed). */
(function restoreDemo() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<PayrollSettings>;
    const p = payrollConfigSchema.safeParse(saved.payroll);
    const g = gosiConfigSchema.safeParse(saved.gosi);
    if (p.success) Object.assign(PAYROLL_CONFIG, p.data);
    if (g.success) Object.assign(GOSI_CONFIG, g.data);
  } catch {
    // corrupt storage → defaults
  }
})();

// ----------------------------- DB mapping ---------------------------------
const PAYROLL_COLS: Record<keyof PayrollConfig, string> = {
  standardWorkDays: 'standard_work_days',
  dailyHours: 'daily_hours',
  overtimeMultiplier: 'overtime_multiplier',
  shiftStartHour: 'shift_start_hour',
  lateGraceMinutes: 'late_grace_minutes',
};
const GOSI_COLS: Record<keyof GosiConfig, string> = {
  ceiling: 'ceiling',
  saudiOldEmployee: 'saudi_old_employee',
  saudiOldCompany: 'saudi_old_company',
  saudiNewEmployee: 'saudi_new_employee',
  saudiNewCompany: 'saudi_new_company',
  nonSaudiCompany: 'nonsaudi_company',
};

function toRow<T extends object>(obj: T, cols: Record<keyof T, string>): Record<string, number> {
  const row: Record<string, number> = {};
  (Object.keys(cols) as (keyof T)[]).forEach((k) => {
    row[cols[k]] = Number(obj[k]);
  });
  return row;
}

function fromRow<T extends object>(row: Record<string, unknown>, cols: Record<keyof T, string>): T {
  const out = {} as Record<keyof T, number>;
  (Object.keys(cols) as (keyof T)[]).forEach((k) => {
    out[k] = Number(row[cols[k]]);
  });
  return out as T;
}

/** Only the fields that changed, in DB column names (same shape as audit_row_change). */
function diff<T extends object>(
  before: T,
  after: T,
  cols: Record<keyof T, string>,
): { old: Record<string, number>; next: Record<string, number> } {
  const old: Record<string, number> = {};
  const next: Record<string, number> = {};
  (Object.keys(cols) as (keyof T)[]).forEach((k) => {
    if (before[k] !== after[k]) {
      old[cols[k]] = Number(before[k]);
      next[cols[k]] = Number(after[k]);
    }
  });
  return { old, next };
}

// ------------------------------- read/write --------------------------------
export async function getPayrollSettings(): Promise<PayrollSettings> {
  if (!isDemoMode()) {
    try {
      const [p, g] = await Promise.all([
        supabase.from('payroll_config').select('*').eq('id', 1).single(),
        supabase.from('gosi_config').select('*').eq('id', 1).single(),
      ]);
      if (!p.error && p.data) {
        const cfg = payrollConfigSchema.safeParse(
          fromRow<PayrollConfig>(p.data as Record<string, unknown>, PAYROLL_COLS),
        );
        if (cfg.success) Object.assign(PAYROLL_CONFIG, cfg.data); // engine uses live values
      }
      if (!g.error && g.data) {
        const cfg = gosiConfigSchema.safeParse(
          fromRow<GosiConfig>(g.data as Record<string, unknown>, GOSI_COLS),
        );
        if (cfg.success) Object.assign(GOSI_CONFIG, cfg.data);
      }
    } catch {
      /* fall through to the live/demo values */
    }
  }
  return { payroll: { ...PAYROLL_CONFIG }, gosi: { ...GOSI_CONFIG } };
}

async function writeRow(
  table: 'payroll_config' | 'gosi_config',
  row: Record<string, number>,
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
}

export async function updatePayrollConfig(next: PayrollConfig): Promise<void> {
  const parsed = payrollConfigSchema.parse(next);
  const { old, next: changed } = diff(PAYROLL_CONFIG, parsed, PAYROLL_COLS);
  if (Object.keys(changed).length === 0) return;
  if (isDemoMode()) {
    recordAudit({
      action: 'update',
      entity: 'payroll_config',
      record_ref: 'إعدادات الرواتب',
      old_data: old,
      new_data: changed,
      branch: null,
    });
  } else {
    await writeRow('payroll_config', toRow(parsed, PAYROLL_COLS)); // audited by trigger (0067)
  }
  Object.assign(PAYROLL_CONFIG, parsed);
  persistDemo();
}

export async function updateGosiConfig(next: GosiConfig): Promise<void> {
  const parsed = gosiConfigSchema.parse(next);
  const { old, next: changed } = diff(GOSI_CONFIG, parsed, GOSI_COLS);
  if (Object.keys(changed).length === 0) return;
  if (isDemoMode()) {
    recordAudit({
      action: 'update',
      entity: 'gosi_config',
      record_ref: 'إعدادات التأمينات',
      old_data: old,
      new_data: changed,
      branch: null,
    });
  } else {
    await writeRow('gosi_config', toRow(parsed, GOSI_COLS));
  }
  Object.assign(GOSI_CONFIG, parsed);
  persistDemo();
}

export const PAYROLL_DEFAULTS: PayrollSettings = {
  payroll: { ...PAYROLL_CONFIG_DEFAULTS },
  gosi: { ...GOSI_CONFIG_DEFAULTS },
};
