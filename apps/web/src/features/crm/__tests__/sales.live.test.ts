/**
 * وحدة المبيعات مع قاعدة بيانات فعلية (Supabase مُحاكى): لا بيانات تجريبية عند
 * الفراغ، وأخطاء الكتابة تظهر للمستخدم بدل أن تُحفظ في الذاكرة وتُعرض نجاحًا.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  writes: [] as { table: string; op: string; payload: unknown }[],
  rpcs: [] as { fn: string; params: unknown }[],
  rows: {} as Record<string, unknown[]>,
  fail: {} as Record<string, string>,
  rpcData: {} as Record<string, unknown>,
}));

vi.mock('@/shared/lib/demoBackend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/demoBackend')>()),
  isDemoMode: () => false,
}));

vi.mock('@/shared/lib/supabase', () => {
  function builder(table: string) {
    let op = 'select';
    const result = () => {
      if (db.fail[table]) return { data: null, error: { message: db.fail[table] } };
      if (op === 'insert')
        return { data: { id: 'new-1', ...(db.writes.at(-1)?.payload as object) }, error: null };
      if (op === 'update')
        return { data: db.rows[`${table}:update`] ?? [{ id: 'x' }], error: null };
      return { data: db.rows[table] ?? [], error: null };
    };
    const b: Record<string, unknown> = {};
    const chain = () => b;
    ['select', 'eq', 'order', 'limit', 'not', 'ilike'].forEach((m) => (b[m] = chain));
    for (const m of ['insert', 'update', 'upsert']) {
      b[m] = (p: unknown) => {
        op = m;
        db.writes.push({ table, op: m, payload: p });
        return b;
      };
    }
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
        if (db.fail[fn]) return Promise.resolve({ data: null, error: { message: db.fail[fn] } });
        return Promise.resolve({ data: db.rpcData[fn] ?? null, error: null });
      },
    },
  };
});

import { createLead, listLeads, listActivities, updateLead } from '@/features/crm/api/crm.api';
import { listQuotes } from '@/features/pricing/api/quotes.api';
import { listPromotions } from '@/features/pricing/api/promotions.api';
import {
  getPricingConfig,
  listAllPricingRules,
  updatePricingConfig,
} from '@/features/pricing/api/pricing.api';
import { searchCustomers } from '@/features/contracts/api/customers.api';
import { getTemplates } from '@/features/contracts/api/contracts.api';
import { listExternalOffices } from '@/features/contracts/api/recruitment.api';
import { DEFAULT_PRICING_CONFIG } from '@/shared/lib/pricing';

beforeEach(() => {
  db.writes = [];
  db.rpcs = [];
  db.rows = {};
  db.fail = {};
  db.rpcData = {};
});

describe('مع خادم حقيقي', () => {
  it('قاعدة فارغة = قوائم فارغة لا بيانات تجريبية', async () => {
    expect(await listLeads()).toEqual([]);
    expect(await listActivities()).toEqual([]);
    expect(await listQuotes()).toEqual([]);
    expect(await listPromotions()).toEqual([]);
    expect(await listAllPricingRules()).toEqual([]);
    expect(await searchCustomers('محمد')).toEqual([]);
    expect(await getTemplates()).toEqual([]);
    expect(await listExternalOffices()).toEqual([]);
  });

  it('خطأ القراءة يظهر بدل الإعدادات الافتراضية أو العملاء التجريبيين', async () => {
    db.fail.pricing_config = 'permission denied for table pricing_config';
    await expect(getPricingConfig()).rejects.toThrow('تعذّر تحميل إعدادات التسعير');
    db.fail.leads = 'network error';
    await expect(listLeads()).rejects.toThrow('تعذّر تحميل العملاء المحتملين');
  });

  it('إضافة عميل محتمل: التحقق قبل الإرسال، وخطأ الخادم يظهر ولا يُحفظ محليًا', async () => {
    const input = {
      full_name: 'فيصل آل منصور',
      phone: '+966551239876',
      source_code: 'website' as const,
      service_code: 'recruitment' as const,
      stage_code: 'new' as const,
      est_value: 16000,
      notes: null,
    };
    await expect(createLead({ ...input, phone: '12345' })).rejects.toThrow('05xxxxxxxx');
    expect(db.writes).toHaveLength(0);
    const ok = await createLead(input);
    expect(db.writes[0]).toMatchObject({
      table: 'leads',
      op: 'insert',
      payload: { phone: '0551239876' },
    });
    expect(ok.full_name).toBe('فيصل آل منصور');
    db.fail.leads = 'Failed to fetch';
    await expect(createLead(input)).rejects.toThrow('Failed to fetch');
  });

  it('تعديل يرفضه RLS بصمت (0 صفوف) يظهر كرسالة صلاحية', async () => {
    db.rows['leads:update'] = [];
    await expect(updateLead('l1', { est_value: 5 })).rejects.toThrow('لا تملك صلاحية');
    db.rows['pricing_config:update'] = [];
    await expect(updatePricingConfig({ ...DEFAULT_PRICING_CONFIG })).rejects.toThrow(
      'لا تملك صلاحية',
    );
  });
});
