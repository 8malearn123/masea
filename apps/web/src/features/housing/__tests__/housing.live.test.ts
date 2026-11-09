/**
 * السكن مع قاعدة بيانات فعلية (Supabase مُحاكى) — المرحلتان 1 و2: القراءة من دوال
 * الخادم (list_housing_dorms / list_housing_residents / find_worker_by_code)، الكتابة
 * على الجداول، والأخطاء تظهر للمستخدم بدل بيانات تجريبية.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  rpcs: [] as { fn: string; params: unknown }[],
  writes: [] as { table: string; op: string; payload: unknown }[],
  rpcData: {} as Record<string, unknown>,
  rpcError: {} as Record<string, string>,
  updateRows: [{ id: 'd1' }] as unknown[],
}));

vi.mock('@/shared/lib/demoBackend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/demoBackend')>()),
  isDemoMode: () => false,
}));

vi.mock('@/shared/lib/supabase', () => {
  function builder(table: string) {
    let op = 'select';
    const result = () => {
      if (table === 'branches') return { data: { id: 'b-jzn' }, error: null };
      if (op === 'update' || op === 'insert') return { data: db.updateRows, error: null };
      if (table === 'housing_scans')
        return {
          data: [
            {
              id: 's1',
              worker_id: 'w1',
              direction: 'in',
              note: null,
              scanned_at: '2026-11-09T05:00:00Z',
              workers: { full_name: 'ميرا سوسانتي' },
              housing_dorms: { name: 'سكن جازان' },
            },
          ],
          error: null,
        };
      return { data: [], error: null };
    };
    const b: Record<string, unknown> = {};
    const chain = () => b;
    ['select', 'eq', 'order', 'limit', 'not'].forEach((m) => (b[m] = chain));
    for (const m of ['insert', 'update', 'upsert']) {
      b[m] = (p: unknown) => {
        op = m;
        db.writes.push({ table, op: m, payload: p });
        return b;
      };
    }
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
        if (db.rpcError[fn])
          return Promise.resolve({ data: null, error: { message: db.rpcError[fn] } });
        return Promise.resolve({ data: db.rpcData[fn] ?? [], error: null });
      },
    },
  };
});

import {
  findWorkerByCode,
  listDorms,
  listHousingScans,
  listResidents,
  logHousingScan,
  markAttendance,
  saveDorm,
} from '@/features/housing/api/housing.api';

const RESIDENT = {
  id: 'w1',
  full_name: 'ميرا سوسانتي',
  nationality: 'إندونيسيا',
  dorm: 'سكن جازان',
  branch: 'جازان',
  status: 'absent',
  check_in: '2026-10-01',
  barcode: 'MAS-W-2037',
  iqama_no: '2433990001',
};

beforeEach(() => {
  db.rpcs = [];
  db.writes = [];
  db.rpcError = {};
  db.updateRows = [{ id: 'd1' }];
  db.rpcData = {
    list_housing_dorms: [
      {
        id: 'd1',
        name: 'سكن جازان',
        branch: 'جازان',
        capacity: 18,
        occupied: 2,
        supervisor_id: 'u1',
        supervisor: 'منى الغامدي',
        is_active: true,
        notes: null,
      },
    ],
    list_housing_supervisors: [{ id: 'u1', full_name: 'منى الغامدي', branch: 'جازان' }],
    list_housing_residents: [RESIDENT],
    find_worker_by_code: [{ ...RESIDENT }],
    log_housing_scan: { id: 'w1', full_name: 'ميرا سوسانتي', barcode: 'MAS-W-2037' },
  };
});

describe('السكن مع خادم حقيقي', () => {
  it('المساكن والمقيمات من دوال الخادم — قاعدة فارغة = قائمة فارغة لا بيانات تجريبية', async () => {
    expect((await listDorms())[0]).toMatchObject({ name: 'سكن جازان', occupied: 2 });
    expect((await listResidents())[0]).toMatchObject({
      full_name: 'ميرا سوسانتي',
      dorm: 'سكن جازان',
    });
    db.rpcData.list_housing_residents = [];
    expect(await listResidents()).toEqual([]);
  });

  it('خطأ الخادم يظهر للمستخدم', async () => {
    db.rpcError.list_housing_dorms = 'permission denied';
    await expect(listDorms()).rejects.toThrow('تعذّر تحميل المساكن');
  });

  it('حفظ السكن يكتب الفرع كمعرّف، ورفض RLS الصامت يظهر كرسالة صلاحية', async () => {
    await saveDorm({
      id: 'd1',
      name: 'سكن جازان',
      branch: 'جازان',
      capacity: 20,
      supervisor_id: 'u1',
      notes: null,
      is_active: true,
    });
    expect(db.writes[0]).toMatchObject({
      table: 'housing_dorms',
      op: 'update',
      payload: { branch_id: 'b-jzn', capacity: 20, supervisor_id: 'u1' },
    });
    db.updateRows = [];
    await expect(
      saveDorm({
        id: 'd1',
        name: 'سكن جازان',
        branch: 'جازان',
        capacity: 21,
        supervisor_id: 'u1',
        notes: null,
        is_active: true,
      }),
    ).rejects.toThrow('لا تملك صلاحية');
  });

  it('البحث بالباركود/الإقامة في الخادم، وخارج النطاق رسالة واضحة', async () => {
    expect((await findWorkerByCode('2433990001')).resident?.full_name).toBe('ميرا سوسانتي');
    expect(db.rpcs.some((r) => r.fn === 'find_worker_by_code')).toBe(true);
    db.rpcData.find_worker_by_code = [];
    expect(await findWorkerByCode('NOPE')).toEqual({ resident: null, outOfScope: false });
    db.rpcError.find_worker_by_code = 'هذه العاملة خارج نطاق فرعك';
    expect(await findWorkerByCode('X')).toEqual({ resident: null, outOfScope: true });
  });

  it('مسح السكن وتحديث الحالة يذهبان للخادم (لا مخزن تجريبي)', async () => {
    const r = await logHousingScan('2433990001', 'in', ' رجعت ');
    expect(r.full_name).toBe('ميرا سوسانتي');
    expect(db.rpcs.find((x) => x.fn === 'log_housing_scan')?.params).toMatchObject({
      p_barcode: '2433990001',
      p_direction: 'in',
    });
    db.rpcError.log_housing_scan = 'لا تملك صلاحية تسجيل مسح السكن';
    await expect(logHousingScan('2433990001', 'in', null)).rejects.toThrow('لا تملك صلاحية');

    await markAttendance('w1', 'medical');
    expect(db.writes.at(-1)).toMatchObject({
      table: 'housing_attendance',
      op: 'upsert',
      payload: { worker_id: 'w1', status: 'medical' },
    });
  });

  it('سجل المسح من جدول housing_scans', async () => {
    expect((await listHousingScans())[0]).toMatchObject({
      worker_name: 'ميرا سوسانتي',
      dorm: 'سكن جازان',
    });
  });
});
