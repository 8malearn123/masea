/**
 * المرحلة أ — مع قاعدة بيانات فعلية (Supabase مُحاكى): القراءة من الجداول القائمة،
 * الراتب لا يُرسل إلا بصلاحية hr.manage، الأخطاء تظهر للمستخدم (لا بيانات وهمية)،
 * والمسير يُحسب بدالة الخادم calculate_payslip.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; payload: unknown }[],
  rpcs: [] as { fn: string; params: unknown }[],
  failOn: null as string | null,
}));

vi.mock('@/shared/lib/demoBackend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/demoBackend')>()),
  isDemoMode: () => false,
}));

vi.mock('@/shared/lib/supabase', () => {
  const EMP_ROW = {
    id: 'e1e1e1e1-0000-4000-8000-000000000001',
    full_name: 'ريم الزهراني',
    role: 'call_center',
    basic_salary: 6500,
    transport_allowance: 500,
    is_active: true,
    hire_date: '2024-04-20',
    nationality: 'السعودية',
    branches: { city: 'حبونا' },
    employee_details: { department: 'مركز الاتصال', housing_allowance: 1000 },
  };
  function builder(table: string) {
    let op = 'select';
    let payload: unknown = null;
    const result = () => {
      if (db.failOn === table) return { data: null, error: { message: 'permission denied' } };
      if (table === 'employees' && op === 'select') return { data: [EMP_ROW], error: null };
      if (table === 'branches') return { data: { id: 'b-hab' }, error: null };
      if (op === 'insert') return { data: { id: 'new-id' }, error: null };
      return { data: [], error: null };
    };
    const b: Record<string, unknown> = {};
    const chain = () => b;
    ['select', 'eq', 'lte', 'gte', 'in', 'order'].forEach((m) => (b[m] = chain));
    b.insert = (p: unknown) => {
      op = 'insert';
      payload = p;
      db.calls.push({ table, op, payload });
      return b;
    };
    b.update = (p: unknown) => {
      op = 'update';
      payload = p;
      db.calls.push({ table, op, payload });
      return b;
    };
    b.upsert = (p: unknown) => {
      op = 'upsert';
      db.calls.push({ table, op, payload: p });
      return b;
    };
    b.single = () => Promise.resolve(result());
    b.maybeSingle = () => Promise.resolve(result());
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(res, rej);
    return b;
  }
  return {
    supabase: {
      from: (t: string) => builder(t),
      rpc: (fn: string, params: unknown) => {
        db.rpcs.push({ fn, params });
        return Promise.resolve({
          data: {
            basic: 6500,
            housing_allowance: 1000,
            gross: 8000,
            total_deductions: 750,
            net: 7250,
            gosi_system: 'new',
          },
          error: null,
        });
      },
    },
  };
});

import { computePayslips, listEmployees, persistEmployee } from '@/features/hr/api/hr.api';

beforeEach(() => {
  db.calls.length = 0;
  db.rpcs.length = 0;
  db.failOn = null;
});

describe('HR on a real backend', () => {
  it('reads employees from the employees + employee_details tables', async () => {
    const [e] = await listEmployees();
    expect(e).toMatchObject({
      full_name: 'ريم الزهراني',
      branch: 'حبونا',
      allowances: 1500,
      department: 'مركز الاتصال',
    });
  });

  it('surfaces a backend error instead of showing demo data', async () => {
    db.failOn = 'employees';
    await expect(listEmployees()).rejects.toThrow('تعذّر تحميل الموظفين');
  });

  it('branch manager (no hr.manage) saves team data but never money fields', async () => {
    const [e] = await listEmployees();
    await persistEmployee(
      {
        ...e!,
        job_title: 'مشرفة مركز الاتصال',
        base_salary: 99999,
        iban: 'SA0380000000608010167519',
      },
      false,
      false,
    );
    const upd = db.calls.find((c) => c.table === 'employees' && c.op === 'update')!
      .payload as Record<string, unknown>;
    expect(upd.job_title).toBe('مشرفة مركز الاتصال');
    expect('basic_salary' in upd).toBe(false);
    const det = db.calls.find((c) => c.table === 'employee_details')!.payload as Record<
      string,
      unknown
    >;
    expect(det.department).toBe('مركز الاتصال'); // non-financial details are saved (0069)
    for (const money of [
      'iban',
      'bank_name',
      'housing_allowance',
      'other_allowance',
      'gosi_system',
      'employment_status',
    ])
      expect(money in det).toBe(false);
  });

  it('HR (hr.manage) writes salary, the allowance split and bank details', async () => {
    const [e] = await listEmployees();
    await persistEmployee(
      {
        ...e!,
        base_salary: 7000,
        housing_allowance: 1750,
        transport_allowance: 700,
        other_allowance: 0,
      },
      false,
      true,
    );
    const upd = db.calls.find((c) => c.table === 'employees' && c.op === 'update')!
      .payload as Record<string, unknown>;
    expect(upd).toMatchObject({ basic_salary: 7000, transport_allowance: 700 });
    const det = db.calls.find((c) => c.table === 'employee_details')!.payload as Record<
      string,
      unknown
    >;
    expect(det).toMatchObject({ housing_allowance: 1750, other_allowance: 0 });
    expect('employment_status' in det).toBe(false); // status belongs to terminate/reactivate
  });

  it('computes payslips with the server engine calculate_payslip()', async () => {
    const emps = await listEmployees();
    const slips = await computePayslips(emps, '2026-11', []);
    expect(db.rpcs).toEqual([
      { fn: 'calculate_payslip', params: { p_employee_id: emps[0]!.id, p_period: '2026-11' } },
    ]);
    expect(slips[0]).toMatchObject({ net: 7250, gross: 8000 });
  });
});
