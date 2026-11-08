/** المرحلة ز — نهاية الخدمة (مرآة 0073): المواد 84/85/87/80/111/77، التسوية، المخصص. */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import {
  approveEosSettlement,
  getEosProvision,
  listEosSettlements,
  payEosSettlement,
  postEosProvision,
  postEosSettlement,
  prepareEosSettlement,
  reactivateDemoEmployee,
  terminateDemoEmployee,
} from '@/features/hr/api/hr.api';
import { eosAward, eosCalculate, serviceYears } from '@/features/hr/lib/eosEngine';
import { DEFAULT_LEAVE_TYPES } from '@/features/hr/lib/leaveEngine';
import { assertBalanced } from '@/features/accounting/data/engine';
import {
  buildEosPaymentEntry,
  buildEosProvisionEntry,
  buildEosSettlementEntry,
} from '@/features/accounting/data/payroll';
import type { Employee } from '@/features/hr/types';

function loginAs(role: string) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role)!;
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('the law (wage 10,000 — same as SQL test 99b)', () => {
  const aw = (y: number, r: Parameters<typeof eosAward>[2]) => eosAward(y, 10000, r).award;
  it('م84 / م85 / م87 / م80', () => {
    expect(aw(8, 'employer_termination')).toBe(55000);
    expect(aw(1.5, 'resignation')).toBe(0);
    expect(aw(3, 'resignation')).toBe(5000);
    expect(aw(7, 'resignation')).toBe(30000);
    expect(aw(12, 'resignation')).toBe(95000);
    expect(aw(3, 'resignation_art87')).toBe(15000);
    expect(aw(8, 'article_80')).toBe(0);
    expect(serviceYears('2021-07-01', '2026-06-30')).toBe(5);
  });

  it('a full calculation: award + unused leave (م111) + م77', () => {
    const e: Employee = {
      id: 'q1',
      full_name: 'عبدالرحمن القحطاني',
      job_title: 'مشرف',
      department: 'العمليات',
      branch: 'نجران',
      nationality: 'السعودية',
      base_salary: 8000,
      allowances: 2000,
      housing_allowance: 2000,
      transport_allowance: 0,
      other_allowance: 0,
      status: 'terminated',
      role: 'sales',
      join_date: '2021-07-01',
      phone: '',
      email: '',
      absence_days: 0,
      late_count: 0,
    };
    const c = eosCalculate(
      e,
      '2026-06-30',
      'employer_termination',
      true,
      'full',
      [],
      DEFAULT_LEAVE_TYPES,
    );
    expect(c.award).toBe(25000);
    expect(c.art77_amount).toBe(25000); // max(15 days × 5 years, 2 months)
    expect(c.leave_days).toBeGreaterThan(104);
    expect(c.leave_amount).toBeCloseTo((10000 / 30) * c.leave_days, 1);
    // the wage basis is a setting: basic only → half of 10,000 ⇒ 20,000
    expect(
      eosCalculate(e, '2026-06-30', 'employer_termination', false, 'basic', [], DEFAULT_LEAVE_TYPES)
        .award,
    ).toBe(20000);
  });
});

describe('settlement lifecycle (demo mirror)', () => {
  it('prepare → four eyes → frozen → post → pay', async () => {
    loginAs('hr');
    await expect(
      prepareEosSettlement({
        employee_id: 'e5',
        art77: false,
        other_additions: 0,
        other_deductions: 0,
        note: '',
      }),
    ).rejects.toThrow('إنهاء خدمة');
    terminateDemoEmployee('e5', { date: '2026-11-30', reason: 'resignation', note: '' }); // بدر — hired 2023-09-05
    await expect(
      prepareEosSettlement({
        employee_id: 'e5',
        art77: true,
        other_additions: 0,
        other_deductions: 0,
        note: '',
      }),
    ).rejects.toThrow('المادة 77');
    await expect(
      prepareEosSettlement({
        employee_id: 'e5',
        art77: false,
        other_additions: 0,
        other_deductions: 500,
        note: '',
      }),
    ).rejects.toThrow('سبب');
    await prepareEosSettlement({
      employee_id: 'e5',
      art77: false,
      other_additions: 0,
      other_deductions: 500,
      note: 'عهدة لم تُسلَّم',
    });
    const s = (await listEosSettlements()).find((x) => x.employee_id === 'e5')!;
    expect(s.award_ratio).toBeCloseTo(1 / 3, 3); // 3.24 years, resignation → a third
    expect(s.net).toBeCloseTo(s.award + s.leave_amount - 500, 2);
    await expect(approveEosSettlement(s.id)).rejects.toThrow('الأربع أعين');

    loginAs('admin');
    await approveEosSettlement(s.id);
    loginAs('hr');
    await expect(
      prepareEosSettlement({
        employee_id: 'e5',
        art77: false,
        other_additions: 0,
        other_deductions: 0,
        note: '',
      }),
    ).rejects.toThrow('معتمدة');

    loginAs('accountant');
    let posted = 0;
    await postEosSettlement(s.id, (x) => {
      const je = buildEosSettlementEntry(x);
      expect(() => assertBalanced(je.lines)).not.toThrow();
      expect(je.lines.find((l) => l.account_code === '2210')?.debit).toBe(x.award);
      expect(je.lines.find((l) => l.account_code === '1160')?.credit).toBe(500);
      posted++;
    });
    await postEosSettlement(s.id, () => posted++); // idempotent
    expect(posted).toBe(1);
    await payEosSettlement(s.id, '2026-12-05', '1112', (x) => {
      expect(() =>
        assertBalanced(buildEosPaymentEntry(x, '2026-12-05', '1112').lines),
      ).not.toThrow();
    });
    expect((await listEosSettlements()).find((x) => x.id === s.id)?.status).toBe('paid');
    reactivateDemoEmployee('e5');
  });

  it('monthly provision trues the balance up to the liability, once per month', async () => {
    loginAs('accountant');
    const before = await getEosProvision('2026-10');
    expect(before.target).toBeGreaterThan(0);
    let entry = 0;
    await postEosProvision('2026-10', (delta) => {
      expect(() => assertBalanced(buildEosProvisionEntry(delta, '2026-10').lines)).not.toThrow();
      entry = delta;
    });
    expect(entry).toBeCloseTo(before.delta, 2);
    const after = await getEosProvision('2026-10');
    expect(after.balance).toBeCloseTo(after.target, 2);
    expect(after.posted).toBe(true);
    await expect(postEosProvision('2026-10', () => {})).rejects.toThrow('بالفعل');
    // a falling liability reverses the direction and stays balanced
    const down = buildEosProvisionEntry(-1234.5, '2026-11');
    expect(down.lines.find((l) => l.account_code === '2210')?.debit).toBe(1234.5);
    expect(() => assertBalanced(down.lines)).not.toThrow();
  });
});
