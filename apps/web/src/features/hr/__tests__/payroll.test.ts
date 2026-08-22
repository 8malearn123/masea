import { describe, expect, it } from 'vitest';
import {
  calculatePayslip,
  GOSI_CONFIG,
  PAYROLL_CONFIG,
  runPayroll,
} from '@/features/hr/api/hr.api';
import type { Employee, PayrollAdjustment } from '@/features/hr/types';

const PERIOD = '2026-06';

function emp(over: Partial<Employee>): Employee {
  return {
    id: 'e1',
    full_name: 'موظف تجريبي',
    job_title: 'موظف',
    department: 'العمليات',
    branch: 'نجران',
    nationality: 'السعودية',
    base_salary: 12000,
    allowances: 2000,
    status: 'active',
    role: 'sales',
    join_date: '2024-01-01',
    phone: '0500000000',
    email: 't@masiat.sa',
    absence_days: 0,
    late_count: 0,
    ...over,
  };
}

function adj(over: Partial<PayrollAdjustment>): PayrollAdjustment {
  return {
    id: 'a1',
    employee_id: 'e1',
    employee_name: 'موظف تجريبي',
    type: 'bonus',
    amount: 0,
    reason: '',
    period: PERIOD,
    submitted_by: 'مدير',
    status: 'approved',
    ...over,
  };
}

describe('calculatePayslip', () => {
  it('computes a clean Saudi (new GOSI) payslip with no events', () => {
    const s = calculatePayslip(emp({ gosi_system: 'new' }), PERIOD, []);
    // GOSI base = basic + housing(=allowances) = 14000, rate 10%
    expect(s.gosi_employee).toBe(1400);
    expect(s.gross).toBe(14000);
    expect(s.net).toBe(12600);
    expect(s.present_days).toBe(PAYROLL_CONFIG.standardWorkDays);
  });

  it('applies the 1.5x overtime multiplier from the hourly rate', () => {
    const s = calculatePayslip(emp({ overtime_hours: 10 }), PERIOD, []);
    // hourly = 12000/(30*8)=50 → 10h × 50 × 1.5 = 750
    expect(s.overtime_amount).toBe(750);
    expect(s.gross).toBe(14750);
  });

  it('deducts absence by daily wage and late by the hourly rate', () => {
    const s = calculatePayslip(emp({ absence_days: 2, late_count: 1 }), PERIOD, []);
    // daily wage = 12000/30 = 400 → 2 days = 800
    expect(s.absence_deduction).toBe(800);
    // late = 1 incident × 30 min = 30 min → (30/60)*50 = 25
    expect(s.late_minutes).toBe(PAYROLL_CONFIG.lateMinutesPerIncident);
    expect(s.late_deduction).toBe(25);
    expect(s.absent_days).toBe(2);
    expect(s.present_days).toBe(28);
  });

  it('exempts expats from the employee GOSI share', () => {
    const s = calculatePayslip(emp({ nationality: 'الهند' }), PERIOD, []);
    expect(s.gosi_employee).toBe(0);
  });

  it('uses the old-system rate when the employee is on it', () => {
    const s = calculatePayslip(emp({ gosi_system: 'old' }), PERIOD, []);
    expect(s.gosi_employee).toBe(Math.round(14000 * GOSI_CONFIG.saudiOldEmployee * 100) / 100);
  });

  it('counts only APPROVED adjustments — pending is excluded', () => {
    const adjustments: PayrollAdjustment[] = [
      adj({ id: 'b1', type: 'bonus', amount: 500, status: 'approved' }),
      adj({ id: 'b2', type: 'advance', amount: 1000, status: 'pending' }),
      adj({ id: 'b3', type: 'penalty', amount: 300, status: 'approved' }),
    ];
    const s = calculatePayslip(emp({}), PERIOD, adjustments);
    expect(s.additions).toBe(500); // approved bonus only
    expect(s.manual_deductions).toBe(300); // approved penalty only (pending advance excluded)
  });

  it('ignores adjustments from other periods', () => {
    const adjustments = [adj({ amount: 999, period: '2026-05' })];
    const s = calculatePayslip(emp({}), PERIOD, adjustments);
    expect(s.additions).toBe(0);
  });
});

describe('runPayroll', () => {
  it('skips terminated employees and one slip per active employee', () => {
    const list: Employee[] = [
      emp({ id: 'e1' }),
      emp({ id: 'e2', status: 'terminated' }),
      emp({ id: 'e3', status: 'on_leave' }),
    ];
    const slips = runPayroll(list, PERIOD, []);
    expect(slips).toHaveLength(2);
    expect(slips.map((s) => s.employee_id)).toEqual(['e1', 'e3']);
  });
});
