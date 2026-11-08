/** المرحلة ج — ملف الموظف: قواعد الهوية/الآيبان، البدلات المفصّلة، إنهاء الخدمة وتصحيحه. */
import { describe, expect, it } from 'vitest';
import {
  employeeFormSchema,
  isValidSaudiIban,
  isValidSaudiId,
} from '@/features/hr/lib/employeeValidation';
import {
  calculatePayslip,
  listAccountOptions,
  listEmployees,
  monthlyCost,
  reactivateDemoEmployee,
  terminateDemoEmployee,
} from '@/features/hr/api/hr.api';
import type { Employee } from '@/features/hr/types';

const valid = {
  full_name: 'سلطان القحطاني',
  english_name: '',
  nationality: 'السعودية',
  id_number: '1055238719',
  passport_no: '',
  dob: '',
  marital_status: '',
  phone: '0551234567',
  email: '',
  job_title: 'محاسب',
  department: 'المالية',
  branch: 'نجران',
  join_date: '2025-01-05',
  contract_type: 'full_time' as const,
  manager_id: '',
  base_salary: 9000,
  housing_allowance: 2250,
  transport_allowance: 900,
  other_allowance: 0,
  iban: 'SA03 8000 0000 6080 1016 7519',
  bank_name: 'الراجحي',
  gosi_system: 'new' as const,
  gosi_reg_date: '',
  user_id: '',
};
const issues = (v: object, opts = {}) => {
  const r = employeeFormSchema(opts).safeParse(v);
  return r.success
    ? {}
    : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe('Saudi identity and bank rules', () => {
  it('validates the national ID / iqama check digit', () => {
    expect(isValidSaudiId('1055238719')).toBe(true);
    expect(isValidSaudiId('2443129875')).toBe(true);
    expect(isValidSaudiId('1055238718')).toBe(false); // wrong check digit
    expect(isValidSaudiId('3055238719')).toBe(false); // must start 1 or 2
  });

  it('validates the IBAN with mod-97 (spaces allowed)', () => {
    expect(isValidSaudiIban('SA03 8000 0000 6080 1016 7519')).toBe(true);
    expect(isValidSaudiIban('SA0480000000608010167519')).toBe(false);
    expect(isValidSaudiIban('AE070331234567890123456')).toBe(false);
  });

  it('accepts a complete Saudi employee and reports each wrong field in Arabic', () => {
    expect(issues(valid)).toEqual({});
    const bad = issues({
      ...valid,
      id_number: '2443129875',
      phone: '0123',
      iban: 'SA12',
      join_date: '',
    });
    expect(bad.id_number).toContain('تبدأ بـ 1'); // a Saudi needs a national ID, not an iqama
    expect(bad.phone).toContain('05');
    expect(bad.iban).toContain('22');
    expect(bad.join_date).toContain('التعيين');
  });

  it('an expat needs an iqama; an IBAN needs a bank', () => {
    const bad = issues({ ...valid, nationality: 'الهند', bank_name: '' });
    expect(bad.id_number).toContain('الإقامة');
    expect(bad.bank_name).toBe('اختر البنك');
  });

  it('a legacy number never blocks an unrelated edit (check digit enforced on change only)', () => {
    const legacy = { ...valid, id_number: '1012345678' }; // seeded before validation
    expect(issues(legacy, { initialId: '1012345678' })).toEqual({});
    expect(issues(legacy).id_number).toContain('رقم التحقق');
  });
});

describe('allowance split drives pay and cost', () => {
  const emp: Employee = {
    id: 'x',
    full_name: 'موظف',
    job_title: 'محاسب',
    department: 'المالية',
    branch: 'نجران',
    nationality: 'السعودية',
    base_salary: 10000,
    allowances: 3500,
    housing_allowance: 2500,
    transport_allowance: 1000,
    other_allowance: 0,
    status: 'active',
    role: 'accountant',
    join_date: '2025-01-01',
    phone: '',
    email: '',
    absence_days: 0,
    late_count: 0,
    gosi_system: 'new',
  };
  it('GOSI base = basic + housing only; transport is paid but not insured', () => {
    const s = calculatePayslip(emp, '2026-11', []);
    expect(s.housing_allowance).toBe(2500);
    expect(s.transport_allowance).toBe(1000);
    expect(s.gosi_employee).toBe(1250); // (10000 + 2500) × 10٪
    expect(s.gross).toBe(13500);
    expect(monthlyCost(emp)).toBe(13500 + 12500 * 0.12);
  });
});

describe('end of service + correction path (demo mirror of 0069)', () => {
  it('terminates with date and reason, rejects bad input, and reactivates', async () => {
    expect(() =>
      terminateDemoEmployee('e3', { date: '2023-01-01', reason: 'resignation', note: '' }),
    ).toThrow('قبل تاريخ التعيين');
    const t = terminateDemoEmployee('e3', {
      date: '2026-11-30',
      reason: 'resignation',
      note: 'خطاب استقالة',
    });
    expect(t).toMatchObject({ status: 'terminated', termination_reason: 'resignation' });
    expect(() =>
      terminateDemoEmployee('e3', { date: '2026-12-01', reason: 'other', note: '' }),
    ).toThrow('بالفعل');
    expect((await listEmployees()).find((e) => e.id === 'e3')?.status).toBe('terminated');
    const back = reactivateDemoEmployee('e3');
    expect(back.status).toBe('active');
    expect(back.termination_date).toBeUndefined();
  });

  it('offers login accounts to link', async () => {
    const accounts = await listAccountOptions();
    expect(accounts.length).toBeGreaterThan(5);
    expect(accounts.some((a) => a.role === 'hr')).toBe(true);
  });
});
