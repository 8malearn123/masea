/**
 * العمليات والميدان — نطاق العرض: مدير الفرع يرى سائقي فرعه فقط، السائق يرى
 * مسحاته فقط، «اليوم» يعني اليوم، والسكن مقيّد بفرع المشرفة وإشغاله محسوب.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import type { AppRole } from '@masiat/shared';
import { listDrivers } from '@/features/orders/api/orders.api';
import { driverAssignError } from '@/features/orders/lib/orderStatus';
import { isToday, listDriverLocations, listRecentScans } from '@/features/gps/api/gps.api';
import {
  listDorms,
  listMyHousingTargets,
  listResidents,
  logHousingScan,
  resolveResidentForViewer,
} from '@/features/housing/api/housing.api';

function signIn(role: AppRole) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!acc) throw new Error(role);
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
  return acc;
}
afterEach(() => {
  clearDemo();
  useAuth.setState({ profile: null });
});

describe('إسناد السائق', () => {
  const driver = { full_name: 'س', status: 'available' as const, branch: 'نجران' };
  it('متاح ومن فرع الطلب فقط', () => {
    expect(driverAssignError({ branch: 'نجران' }, driver)).toBeNull();
    expect(driverAssignError({ branch: 'شرورة' }, driver)).toContain('من فرع آخر');
    expect(driverAssignError({ branch: 'نجران' }, { ...driver, status: 'on_route' })).toContain(
      'غير متاح',
    );
    expect(driverAssignError({ branch: 'نجران' }, { ...driver, status: 'off_duty' })).toContain(
      'غير متاح',
    );
  });
});

describe('نطاق الفرع للسائقين والتتبّع', () => {
  it('مدير فرع جازان يرى سائقي جازان فقط (اللوحة و GPS)', async () => {
    const acc = signIn('branch_manager');
    const drivers = await listDrivers();
    expect(drivers.length).toBeGreaterThan(0);
    expect(drivers.every((d) => d.branch === acc.branch)).toBe(true);
    const locs = await listDriverLocations();
    expect(locs.every((l) => l.branch === acc.branch)).toBe(true);
  });

  it('الإدارة ترى كل الأسطول', async () => {
    signIn('admin');
    const branches = new Set((await listDrivers()).map((d) => d.branch));
    expect(branches.size).toBeGreaterThan(2);
  });

  it('السائق يرى موقعه هو ومسحاته هو فقط', async () => {
    const acc = signIn('driver');
    const locs = await listDriverLocations();
    expect(locs).toHaveLength(1);
    expect(locs[0]!.full_name).toBe(acc.name);
    const scans = await listRecentScans();
    // مسح الأسطول التجريبي (s1..s4) لا يظهر للسائق
    expect(scans.some((s) => /^s\d$/.test(s.id))).toBe(false);
  });

  it('«اليوم» لا يعدّ الأيام السابقة', () => {
    const now = new Date(2026, 10, 9, 15);
    expect(isToday(new Date(2026, 10, 9, 1).toISOString(), now)).toBe(true);
    expect(isToday('2026-06-12T08:00:00Z', now)).toBe(false);
  });
});

describe('السكن', () => {
  it('المشرفة ترى سكن فرعها وعاملاته فقط، والإشغال = عدد المقيمات', async () => {
    const acc = signIn('housing_supervisor');
    const dorms = await listDorms();
    const residents = await listResidents();
    expect(dorms.length).toBeGreaterThan(0);
    expect(dorms.every((d) => d.branch === acc.branch)).toBe(true);
    expect(residents.every((r) => r.branch === acc.branch)).toBe(true);
    for (const d of dorms) {
      expect(d.occupied).toBe(residents.filter((r) => r.dorm === d.name).length);
    }
  });

  it('عاملة من فرع آخر خارج نطاق محطة المسح', async () => {
    signIn('housing_supervisor');
    expect(resolveResidentForViewer('MAS-W-1001')).toEqual({ resident: null, outOfScope: true });
    await expect(logHousingScan('MAS-W-1001', 'in', null)).rejects.toThrow('خارج نطاق');
  });

  it('«مستهدفاتي»: المشرفة ترى مستهدفها هي بالشهر الحالي ومحقَّق محسوب', async () => {
    const acc = signIn('housing_supervisor');
    const mine = await listMyHousingTargets();
    expect(mine.length).toBe(1);
    expect(mine[0]).toMatchObject({ supervisor: acc.name, branch: acc.branch });
    expect(mine[0]!.month).toBe(new Date().getMonth() + 1);
    const dorms = await listDorms();
    const cap = dorms.reduce((a, d) => a + (d.capacity ?? 0), 0);
    const occ = dorms.reduce((a, d) => a + d.occupied, 0);
    expect(mine[0]!.occupancy_actual_pct).toBe(Math.round((occ / cap) * 100));
  });

  it('الإدارة ترى مستهدفات كل المشرفات باسم كل مشرفة', async () => {
    signIn('admin');
    const all = await listMyHousingTargets();
    expect(new Set(all.map((t) => t.supervisor)).size).toBeGreaterThan(1);
  });
});
