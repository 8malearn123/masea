import { afterEach, describe, expect, it } from 'vitest';
import {
  getPayrollSettings,
  PAYROLL_DEFAULTS,
  updateGosiConfig,
  updatePayrollConfig,
} from '@/features/hr/api/payrollSettings.api';
import { calculatePayslip, employerGosiFor, monthlyCost } from '@/features/hr/api/hr.api';
import { listDemoAudit } from '@/shared/lib/auditTrail';
import type { Employee } from '@/features/hr/types';

const emp: Employee = {
  id: 'e-set',
  full_name: 'هند القحطاني',
  job_title: 'محاسبة',
  department: 'المالية',
  branch: 'جازان',
  nationality: 'السعودية',
  base_salary: 12000,
  allowances: 2000,
  status: 'active',
  role: 'accountant',
  join_date: '2024-01-01',
  phone: '0500000000',
  email: 'h@masiat.sa',
  absence_days: 0,
  late_count: 2,
  overtime_hours: 10,
};

afterEach(async () => {
  await updatePayrollConfig({ ...PAYROLL_DEFAULTS.payroll });
  await updateGosiConfig({ ...PAYROLL_DEFAULTS.gosi });
});

describe('managed payroll & GOSI settings (no hardcoded values)', () => {
  it('starts from the DB defaults (0022)', async () => {
    const s = await getPayrollSettings();
    expect(s.payroll).toEqual(PAYROLL_DEFAULTS.payroll);
    expect(s.gosi.saudiNewEmployee).toBe(0.1);
  });

  it('a saved overtime multiplier changes the next payslip immediately', async () => {
    // hourly = 12000 / (30 × 8) = 50
    expect(calculatePayslip(emp, '2026-11', []).overtime_amount).toBe(750); // 10 × 50 × 1.5
    await updatePayrollConfig({ ...PAYROLL_DEFAULTS.payroll, overtimeMultiplier: 2 });
    expect(calculatePayslip(emp, '2026-11', []).overtime_amount).toBe(1000); // 10 × 50 × 2
  });

  it('work days and daily hours drive the daily/hourly wage', async () => {
    await updatePayrollConfig({
      ...PAYROLL_DEFAULTS.payroll,
      standardWorkDays: 26,
      dailyHours: 6,
    });
    const s = calculatePayslip({ ...emp, absence_days: 1, overtime_hours: 0 }, '2026-11', []);
    expect(s.absence_deduction).toBe(461.54); // 12000 / 26
    expect(s.present_days).toBe(25);
  });

  it('a longer grace period reduces the late deduction', async () => {
    const before = calculatePayslip(emp, '2026-11', []).late_deduction; // 2 × 30 min
    await updatePayrollConfig({ ...PAYROLL_DEFAULTS.payroll, lateGraceMinutes: 45 });
    const after = calculatePayslip(emp, '2026-11', []);
    expect(before).toBe(50); // 60 min × 50/h
    expect(after.late_minutes).toBe(0);
    expect(after.late_deduction).toBe(0);
  });

  it('GOSI rates and ceiling flow into the payslip, employer share and cost', async () => {
    await updateGosiConfig({
      ...PAYROLL_DEFAULTS.gosi,
      saudiNewEmployee: 0.105,
      saudiNewCompany: 0.125,
      ceiling: 13000,
    });
    expect(calculatePayslip(emp, '2026-11', []).gosi_employee).toBe(1365); // 13000 × 10.5٪
    expect(employerGosiFor(12000, 2000, true, 'new')).toBe(1625); // 13000 × 12.5٪
    expect(monthlyCost(emp)).toBe(14000 + 1625);
  });

  it('rejects out-of-range values with the same bounds as the DB', async () => {
    const p = PAYROLL_DEFAULTS.payroll;
    await expect(updatePayrollConfig({ ...p, standardWorkDays: 40 })).rejects.toThrow();
    await expect(updatePayrollConfig({ ...p, overtimeMultiplier: 0.5 })).rejects.toThrow();
    await expect(updatePayrollConfig({ ...p, lateGraceMinutes: -5 })).rejects.toThrow();
    await expect(
      updateGosiConfig({ ...PAYROLL_DEFAULTS.gosi, saudiNewCompany: 0.9 }),
    ).rejects.toThrow();
    await expect(updateGosiConfig({ ...PAYROLL_DEFAULTS.gosi, ceiling: 0 })).rejects.toThrow();
  });

  it('audits only the fields that changed, and skips no-op saves', async () => {
    const before = listDemoAudit().length;
    await updatePayrollConfig({ ...PAYROLL_DEFAULTS.payroll }); // no change
    expect(listDemoAudit().length).toBe(before);
    await updatePayrollConfig({ ...PAYROLL_DEFAULTS.payroll, lateGraceMinutes: 10 });
    const last = listDemoAudit().find((e) => e.entity === 'payroll_config');
    expect(last?.old_data).toEqual({ late_grace_minutes: 15 });
    expect(last?.new_data).toEqual({ late_grace_minutes: 10 });
  });
});
