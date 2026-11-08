/** المرحلة هـ — قواعد الإجازات (مرآة 0070) وأثرها على الحالة والراتب. */
import { describe, expect, it } from 'vitest';
import {
  annualAccrued,
  DEFAULT_LEAVE_TYPES,
  daysInclusive,
  leaveBalance,
  leaveDeductionDays,
  validateLeave,
} from '@/features/hr/lib/leaveEngine';
import {
  addLeaveRequest,
  calculatePayslip,
  listEmployees,
  listLeaveTypes,
  saveLeaveType,
  updateLeaveStatus,
} from '@/features/hr/api/hr.api';
import type { Employee, LeaveRequest } from '@/features/hr/types';

const T = DEFAULT_LEAVE_TYPES;
const hind: Employee = {
  id: 'h1',
  full_name: 'هند القحطاني',
  job_title: 'محاسبة',
  department: 'المالية',
  branch: 'نجران',
  nationality: 'السعودية',
  base_salary: 9000,
  allowances: 0,
  status: 'active',
  role: 'accountant',
  join_date: '2021-01-01',
  phone: '',
  email: '',
  absence_days: 0,
  late_count: 0,
  gender: 'female',
};
const newHire: Employee = {
  ...hind,
  id: 'm1',
  full_name: 'ماجد الحربي',
  join_date: '2026-06-01',
  gender: 'male',
  base_salary: 6000,
};
let n = 0;
const leave = (
  e: Employee,
  type: string,
  from: string,
  to: string,
  status: LeaveRequest['status'] = 'approved',
): LeaveRequest => ({
  id: `t${++n}`,
  employee_id: e.id,
  employee_name: e.full_name,
  type,
  from_date: from,
  to_date: to,
  days: daysInclusive(from, to),
  status,
  reason: '',
});
const rejects = (req: LeaveRequest, e: Employee, all: LeaveRequest[], msg: string) =>
  expect(() => validateLeave(req, e, all, T)).toThrow(msg);

describe('annual balance (same numbers as the SQL test 97)', () => {
  it('accrues 21/yr then 30/yr after 5 years', () => {
    expect(annualAccrued('2021-01-01', '2026-01-01', T)).toBeCloseTo(105, 0);
    expect(annualAccrued('2021-01-01', '2027-01-01', T)).toBeCloseTo(135, 0);
    expect(annualAccrued('', '2027-01-01', T)).toBe(0);
  });
  it('balance = accrued − approved; pending is reported separately', () => {
    const all = [
      leave(hind, 'annual', '2026-03-01', '2026-03-10'),
      leave(hind, 'annual', '2026-12-01', '2026-12-02', 'pending'),
    ];
    const b = leaveBalance(hind, all, T, '2026-11-07');
    expect(b.annual_used).toBe(10);
    expect(b.annual_pending).toBe(2);
    expect(b.annual_remaining).toBeCloseTo(b.annual_accrued - 10, 2);
  });
});

describe('validation (same messages as validate_leave_request)', () => {
  it('rejects beyond balance, overlap, eligibility, caps and the sick limit', () => {
    rejects(
      leave(newHire, 'annual', '2026-12-10', '2026-12-24'),
      newHire,
      [],
      'الرصيد السنوي غير كافٍ',
    );
    const ok = leave(newHire, 'annual', '2026-12-10', '2026-12-14');
    expect(() => validateLeave(ok, newHire, [], T)).not.toThrow();
    rejects(
      leave(newHire, 'emergency', '2026-12-13', '2026-12-15', 'pending'),
      newHire,
      [ok],
      'تتداخل',
    );
    rejects(leave(newHire, 'hajj', '2027-05-20', '2027-05-30'), newHire, [], 'خدمة 24');
    rejects(leave(newHire, 'maternity', '2027-01-01', '2027-02-01'), newHire, [], 'لا تنطبق');
    rejects(leave(hind, 'paternity', '2027-01-01', '2027-01-03'), hind, [], 'لا تنطبق');
    rejects(leave(hind, 'marriage', '2027-03-01', '2027-03-08'), hind, [], 'الحد 5');
    rejects(leave(hind, 'emergency', '2027-04-01', '2027-04-06'), hind, [], 'الحد 5');
    rejects(leave(hind, 'sick', '2027-05-01', '2027-09-02'), hind, [], 'حد الإجازة المرضية');
    rejects(leave(hind, 'annual', '2027-01-10', '2027-01-05'), hind, [], 'قبل تاريخ البداية');
  });
  it('hajj is granted once per service', () => {
    const first = leave(hind, 'hajj', '2025-06-01', '2025-06-12');
    rejects(leave(hind, 'hajj', '2026-05-20', '2026-05-30'), hind, [first], 'مرة واحدة');
  });
  it('rejecting / cancelling is never blocked by the rules', () => {
    const bad = {
      ...leave(newHire, 'annual', '2026-12-10', '2026-12-30'),
      status: 'cancelled' as const,
    };
    expect(() => validateLeave(bad, newHire, [], T)).not.toThrow();
  });
});

describe('payroll effect (unpaid + sick tiers)', () => {
  const all = [
    leave(hind, 'unpaid', '2026-11-03', '2026-11-07'),
    leave(hind, 'sick', '2026-01-01', '2026-01-31'),
    leave(hind, 'sick', '2026-02-01', '2026-02-10'),
  ];
  it('matches calculate_payslip: 5 unpaid days, day 31 at 75%, then 10 days at 75%', () => {
    expect(leaveDeductionDays(hind, '2026-11', all, T)).toEqual({
      unpaid_days: 5,
      sick_deduction_days: 0,
    });
    expect(leaveDeductionDays(hind, '2026-01', all, T).sick_deduction_days).toBe(0.25);
    expect(leaveDeductionDays(hind, '2026-02', all, T).sick_deduction_days).toBe(2.5);
    expect(calculatePayslip(hind, '2026-11', [], all, T).leave_deduction).toBe(1500);
    expect(calculatePayslip(hind, '2026-02', [], all, T).leave_deduction).toBe(750);
  });
});

describe('demo store: status, approval re-check, managed types', () => {
  it('an approved leave covering today makes the employee «في إجازة»', async () => {
    const t = new Date().toISOString().slice(0, 10);
    const [nora] = (await listEmployees()).filter((e) => e.id === 'e3');
    expect(nora?.status).toBe('active');
    const l = addLeaveRequest({ ...leave(nora!, 'unpaid', t, t, 'pending'), id: 'lt-today' });
    await updateLeaveStatus(l.id, 'approved');
    expect((await listEmployees()).find((e) => e.id === 'e3')?.status).toBe('on_leave');
    await updateLeaveStatus(l.id, 'cancelled', 'إلغاء للاختبار');
    expect((await listEmployees()).find((e) => e.id === 'e3')?.status).toBe('active');
  });

  it('a changed rule applies immediately (marriage 5 → 7 days)', async () => {
    const types = await listLeaveTypes();
    const marriage = types.find((x) => x.code === 'marriage')!;
    await saveLeaveType({ ...marriage, entitlement_days: 7 }, false);
    expect((await listLeaveTypes()).find((x) => x.code === 'marriage')?.entitlement_days).toBe(7);
    await saveLeaveType(marriage, false);
    await expect(saveLeaveType({ ...marriage, code: 'Bad Code' }, true)).rejects.toThrow();
  });
});
