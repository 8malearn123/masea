import { describe, expect, it } from 'vitest';
import {
  addLeaveRequest,
  computeEos,
  currentEmployees,
  decideAdjustment,
  employerGosiFor,
  GOSI_CONFIG,
  listAdjustments,
  listEmployees,
  listLeaveRequests,
  monthlyCost,
  payrollPeriods,
  saveEmployee,
  updateLeaveStatus,
  yearsOfService,
} from '@/features/hr/api/hr.api';
import { employerGosi } from '@/features/accounting/data/payroll';
import type { Employee, Payslip } from '@/features/hr/types';

const base: Employee = {
  id: 'e-test',
  full_name: 'سلطان القحطاني',
  job_title: 'محاسب',
  department: 'المالية',
  branch: 'نجران',
  nationality: 'السعودية',
  base_salary: 10000,
  allowances: 2000,
  status: 'active',
  role: 'accountant',
  join_date: '',
  phone: '0500000000',
  email: 's@masiat.sa',
  absence_days: 0,
  late_count: 0,
};

describe('HR fixes', () => {
  it('end of service never yields NaN for a missing/invalid join date', () => {
    expect(yearsOfService('')).toBe(0);
    expect(yearsOfService('not-a-date')).toBe(0);
    expect(computeEos(base).amount).toBe(0);
  });

  it('payroll periods start at the current month and go back 12 months', () => {
    const p = payrollPeriods(new Date(2026, 10, 5));
    expect(p[0]).toBe('2026-11');
    expect(p).toHaveLength(12);
    expect(p[11]).toBe('2025-12');
  });

  it('excludes terminated employees from the current workforce', () => {
    const list = [base, { ...base, id: 'x', status: 'terminated' as const }];
    expect(currentEmployees(list).map((e) => e.id)).toEqual(['e-test']);
  });

  it('monthly cost uses the same employer GOSI as the accounting accrual', () => {
    const employer = employerGosiFor(10000, 2000, true, 'new');
    expect(employer).toBe(12000 * GOSI_CONFIG.saudiNewCompany);
    expect(monthlyCost(base)).toBe(12000 + employer);
    const slip = {
      basic: 10000,
      housing_allowance: 2000,
      nationality: 'السعودية',
      gosi_system: 'new',
    } as Payslip;
    expect(employerGosi(slip)).toBe(employer);
  });

  it('employee add/edit survives a refetch of the demo store', async () => {
    saveEmployee({ ...base });
    saveEmployee({ ...base, job_title: 'محاسب أول' });
    const list = await listEmployees();
    const mine = list.filter((e) => e.id === 'e-test');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.job_title).toBe('محاسب أول');
  });

  it('leave approval and adjustment decisions persist across a refetch', async () => {
    addLeaveRequest({
      id: 'l-test',
      employee_name: 'سلطان القحطاني',
      type: 'annual',
      from_date: '2026-11-10',
      to_date: '2026-11-12',
      days: 3,
      status: 'pending',
      reason: '',
    });
    await updateLeaveStatus('l-test', 'approved');
    expect((await listLeaveRequests()).find((l) => l.id === 'l-test')?.status).toBe('approved');

    await decideAdjustment('adj2', 'approved');
    expect((await listAdjustments()).find((a) => a.id === 'adj2')?.status).toBe('approved');
  });
});
