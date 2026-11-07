/**
 * المرحلة أ — الوضع التجريبي: نطاق الفرع (نفس قاعدة RLS في 0068) وتوحيد العاملات
 * مع الكتالوج (نفس السجل، لا قائمة موازية).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import { FALLBACK_WORKERS } from '@/lib/funnel';
import {
  listAttendance,
  listEmployees,
  listHouseWorkers,
  listLeaveRequests,
  persistHouseWorker,
} from '@/features/hr/api/hr.api';
import { mapEmployee, mapWorker } from '@/features/hr/api/hr.live';

function loginAs(role: string) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role)!;
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
  return acc;
}

afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('branch scope (demo mirror of RLS 0068)', () => {
  it('HR sees every branch', async () => {
    loginAs('hr');
    const branches = new Set((await listEmployees()).map((e) => e.branch));
    expect(branches.size).toBeGreaterThan(1);
  });

  it('a branch manager sees only his branch — employees and their records', async () => {
    const acc = loginAs('branch_manager'); // جازان
    const emps = await listEmployees();
    expect(emps.length).toBeGreaterThan(0);
    expect(emps.every((e) => e.branch === acc.branch)).toBe(true);
    const names = new Set(emps.map((e) => e.full_name));
    expect((await listAttendance()).every((a) => names.has(a.employee_name))).toBe(true);
    expect((await listLeaveRequests()).every((l) => names.has(l.employee_name))).toBe(true);
  });
});

describe('house workers = the catalog worker record', () => {
  it('lists the same workers the customer catalog shows', async () => {
    const hr = await listHouseWorkers();
    expect(hr.map((w) => w.id)).toEqual(FALLBACK_WORKERS.map((w) => w.id));
    expect(hr.find((w) => w.id === 'w1')?.passport_no).toBe('P1234567');
  });

  it('an HR edit is visible in the catalog immediately', async () => {
    const w = (await listHouseWorkers()).find((x) => x.id === 'w3')!;
    await persistHouseWorker({ ...w, monthly_salary: 1850, skills: ['تجيد الطبخ'] }, false);
    expect(FALLBACK_WORKERS.find((x) => x.id === 'w3')?.monthly_salary).toBe(1850);
    expect((await listHouseWorkers()).find((x) => x.id === 'w3')?.skills).toEqual(['تجيد الطبخ']);
    await persistHouseWorker(w, false); // restore
  });
});

describe('live row mappers', () => {
  it('maps employees + employee_details, status and allowance split', () => {
    const row = {
      id: 'u1',
      full_name: 'فهد الشهري',
      role: 'operations_manager',
      job_title: null,
      branch_id: 'b1',
      basic_salary: '18000',
      transport_allowance: '1000',
      is_active: true,
      hire_date: '2023-03-01',
      nationality: 'السعودية',
      branches: { city: 'نجران' },
      employee_details: [
        {
          department: 'العمليات',
          housing_allowance: 2000,
          other_allowance: 500,
          manager_id: 'u0',
          iban: 'SA03',
        },
      ],
    };
    const e = mapEmployee(row, new Set(['u1']), new Map([['u0', 'سلطان المالكي']]));
    expect(e).toMatchObject({
      branch: 'نجران',
      base_salary: 18000,
      allowances: 3500,
      housing_allowance: 2000,
      transport_allowance: 1000,
      status: 'on_leave',
      job_title: 'مدير العمليات',
      manager: 'سلطان المالكي',
      iban: 'SA03',
    });
    expect('passport_no' in e).toBe(false); // absent optional fields stay absent
    const gone = mapEmployee({ ...row, is_active: false, role: 'غير معروف' }, new Set(), new Map());
    expect(gone.status).toBe('terminated');
    expect(gone.role).toBe('sales'); // unknown role never crashes ROLE_META lookups
  });

  it('maps worker_profiles with a safe status', () => {
    const w = mapWorker({
      id: 'x',
      full_name: 'ماريا سانتوس',
      status: 'weird',
      languages: null,
      skills: ['الكي'],
      branches: [{ city: 'جازان' }],
      bio_ar: null,
    });
    expect(w).toMatchObject({
      status: 'available',
      branch: 'جازان',
      languages: [],
      skills: ['الكي'],
      bio: '',
    });
  });
});
