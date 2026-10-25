/**
 * مسار الحفظ مع قاعدة بيانات فعلية (Supabase مُحاكى): تاريخ النهاية يصل إلى دوال
 * الخادم الذرّية (create_contract_draft / update_contract_draft / renew_contract)،
 * وأي فشل يُبلغ للمستخدم دون نجاح وهمي أو مسودة محلية.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/shared/ui';
import {
  createDraft,
  getContract,
  listContracts,
  updateContractTerm,
} from '@/features/contracts/api/contracts.api';
import type { CreateContractInput } from '@/features/contracts/types';
import { useCreateContract, useRenewContract } from '@/features/contracts/hooks/useContracts';
import { renewContract } from '@/features/contracts/api/contracts.api';
import { updateConfig } from '@/features/settings/api/settings.api';

const BRANCH_ID = '11111111-1111-1111-1111-111111111111';
const CUSTOMER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTRACT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RENEWAL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

interface Result {
  data: unknown;
  error: { message: string } | null;
}

const db = vi.hoisted(() => ({
  calls: [] as { table: string; op: 'insert' | 'update'; payload: unknown }[],
  /** جدول/دالة يفشل عندها الطلب، ورسالة الفشل. */
  failOn: null as string | null,
  failMessage: 'permission denied for table contracts',
  /** عدد الصفوف المتأثّرة بالتعديل (٠ = ليس مسودة أو خارج الصلاحية). */
  updatedRows: 1,
  rpcs: [] as { fn: string; params: unknown }[],
}));

vi.mock('@/shared/lib/demoBackend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/demoBackend')>()),
  isDemoMode: () => false,
}));

vi.mock('@/shared/lib/supabase', () => {
  const fail = (): Result => ({ data: null, error: { message: db.failMessage } });

  function respond(
    table: string,
    op: 'select' | 'insert' | 'update',
    payload: unknown,
    one = false,
  ): Result {
    if (db.failOn === table) return fail();
    if (table === 'branches') return { data: [{ id: BRANCH_ID }], error: null };
    if (table === 'contracts' && op === 'insert') {
      return {
        data: { ...(payload as object), id: CONTRACT_ID, created_at: '2026-10-01T09:00:00Z' },
        error: null,
      };
    }
    if (op === 'update') {
      return { data: db.updatedRows ? [{ id: CONTRACT_ID }] : [], error: null };
    }
    // قراءة: لا صفوف حقيقية (maybeSingle → null كما في PostgREST)
    return { data: op === 'select' && !one ? [] : null, error: null };
  }

  function builder(table: string) {
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: unknown = null;
    let one = false;
    const b = {
      select: () => b,
      eq: () => b,
      or: () => b,
      not: () => b,
      order: () => b,
      limit: () => b,
      single: () => b,
      maybeSingle: () => {
        one = true;
        return b;
      },
      insert: (p: unknown) => {
        op = 'insert';
        payload = p;
        db.calls.push({ table, op, payload: p });
        return b;
      },
      update: (p: unknown) => {
        op = 'update';
        payload = p;
        db.calls.push({ table, op, payload: p });
        return b;
      },
      then: (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(respond(table, op, payload, one)).then(resolve, reject),
    };
    return b;
  }

  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: (fn: string, params?: unknown) => {
        db.rpcs.push({ fn, params });
        if (db.failOn === fn) return Promise.resolve(fail());
        if (fn === 'renew_contract') {
          return Promise.resolve({
            data: { id: RENEWAL_ID, contract_no: 'MAS-2026-00077', version: 2, status: 'draft' },
            error: null,
          });
        }
        if (fn === 'create_contract_draft') {
          const { p_input } = params as { p_input: Record<string, unknown> };
          return Promise.resolve({
            data: {
              ...p_input,
              id: CONTRACT_ID,
              contract_no: 'MAS-2026-00042',
              branch_id: BRANCH_ID,
              base_amount: 6000,
              status: 'draft',
              created_at: '2026-10-01T09:00:00Z',
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

function input(over: Partial<CreateContractInput> = {}): CreateContractInput {
  return {
    service_code: 'monthly_rental',
    customer_id: CUSTOMER_ID,
    customer_name: 'سارة القحطاني',
    branch: 'جازان',
    start_date: '2026-10-01',
    end_date: '2026-12-31',
    quantity: 3,
    template_id: 't-month-full',
    clauses: ['بند أول', 'بند ثانٍ'],
    ...over,
  };
}

const ALL = { status: 'all', service: 'all', branch: 'all', search: '' } as const;

beforeEach(() => {
  db.calls.length = 0;
  db.rpcs.length = 0;
  db.failOn = null;
  db.updatedRows = 1;
});

describe('إنشاء العقد مع قاعدة بيانات فعلية', () => {
  it('يرسل تاريخ البداية والنهاية والفرع والبنود إلى دالة الخادم الذرّية', async () => {
    const saved = await createDraft(input());
    const call = db.rpcs.find((r) => r.fn === 'create_contract_draft');
    expect(call?.params).toMatchObject({
      p_input: {
        start_date: '2026-10-01',
        end_date: '2026-12-31',
        branch: 'جازان', // يُحوَّل لمعرّف الفرع في الخادم (resolve_branch_id)
        template_id: null, // قالب تجريبي (ليس uuid) لا يُرسل كمفتاح خارجي
      },
      p_clauses: ['بند أول', 'بند ثانٍ'],
    });
    // السعر لا يُرسل من المتصفح — calc_price في الخادم
    expect(call?.params).not.toHaveProperty('p_input.base_amount');
    expect(db.calls).toEqual([]); // لا insert مباشر — العقد والبنود والسجل في معاملة الخادم
    expect(saved.id).toBe(CONTRACT_ID);
    expect(saved.end_date).toBe('2026-12-31');
    expect(saved.customer_name).toBe('سارة القحطاني');
  });

  it('يُبلغ عن فشل الحفظ ولا يُنشئ مسودة محلية بديلة', async () => {
    db.failOn = 'create_contract_draft';
    await expect(createDraft(input())).rejects.toThrow('تعذّر حفظ العقد');
    // لا عقد وهمي أُضيف: القائمة من قاعدة البيانات وحدها (فارغة هنا) لا من بيانات العرض
    db.failOn = null;
    expect(await listContracts(ALL)).toEqual([]);
  });

  it('يرفض تواريخ غير منطقية قبل الاتصال بالخادم', async () => {
    await expect(createDraft(input({ end_date: '2026-09-01' }))).rejects.toThrow('لا يمكن أن يسبق');
    expect(db.rpcs).toEqual([]);
  });

  it('لا تُعرض رسالة نجاح عندما يفشل الحفظ', async () => {
    db.failOn = 'create_contract_draft';
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateContract(), { wrapper });
    const onSuccess = vi.fn();
    result.current.mutate(input(), { onSuccess });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.error?.message).toContain('تعذّر حفظ العقد');
  });
});

describe('تعديل مدة العقد مع قاعدة بيانات فعلية', () => {
  it('يرسل تاريخ النهاية الجديد إلى دالة تعديل المسودة دون تغيير الفرع', async () => {
    await updateContractTerm(CONTRACT_ID, '2026-11-01', '2027-01-31');
    expect(db.rpcs).toContainEqual({
      fn: 'update_contract_draft',
      params: {
        p_contract_id: CONTRACT_ID,
        p_patch: { start_date: '2026-11-01', end_date: '2027-01-31' },
      },
    });
    expect(db.calls).toEqual([]);
  });

  it('يُبلغ عن رفض الخادم (ليس مسودة أو بلا صلاحية)', async () => {
    db.failOn = 'update_contract_draft';
    db.failMessage = 'لا يُعدَّل إلا العقد في حالة المسودة';
    await expect(updateContractTerm(CONTRACT_ID, '2026-11-01', '2027-01-31')).rejects.toThrow(
      'تعذّر حفظ مدة العقد',
    );
    db.failMessage = 'permission denied for table contracts';
  });

  it('يرفض تواريخ غير منطقية قبل الوصول لقاعدة البيانات', async () => {
    await expect(updateContractTerm(CONTRACT_ID, '2026-11-01', '2026-10-01')).rejects.toThrow(
      'لا يمكن أن يسبق',
    );
    expect(db.rpcs).toHaveLength(0);
  });
});

describe('جلب العقود مع قاعدة بيانات فعلية', () => {
  it('يُبلغ عن فشل جلب القائمة بدل عرض عقود تجريبية', async () => {
    db.failOn = 'contracts';
    await expect(listContracts(ALL)).rejects.toThrow('تعذّر جلب العقود');
  });

  it('يُبلغ عن فشل جلب عقد واحد', async () => {
    db.failOn = 'contracts';
    await expect(getContract(CONTRACT_ID)).rejects.toThrow('تعذّر جلب العقد');
  });

  it('قاعدة بيانات بلا عقود تعني قائمة فارغة — لا بيانات عرض', async () => {
    expect(await listContracts(ALL)).toEqual([]);
  });
});

describe('تجديد العقد مع قاعدة بيانات فعلية', () => {
  it('يستدعي دالة الخادم الذرّية فقط (لا إدخالات من المتصفح)', async () => {
    const r = await renewContract(CONTRACT_ID, '2026-10-01', '2026-12-31');
    expect(db.rpcs).toContainEqual({
      fn: 'renew_contract',
      params: { p_contract_id: CONTRACT_ID, p_start_date: '2026-10-01', p_end_date: '2026-12-31' },
    });
    expect(db.calls).toEqual([]); // لا insert/update مباشر — العقد والبنود والسجل في معاملة الخادم
    expect(r).toMatchObject({ id: RENEWAL_ID, version: 2, status: 'draft' });
  });

  it('يُبلغ عن رفض الخادم (صلاحية/تجديد قائم) ولا ينشئ نسخة محلية', async () => {
    db.failOn = 'renew_contract';
    db.failMessage = 'يوجد تجديد قائم لهذا العقد: MAS-2026-00077';
    await expect(renewContract(CONTRACT_ID, '2026-10-01', '2026-12-31')).rejects.toThrow(
      'يوجد تجديد قائم',
    );
    db.failOn = null;
    expect(await listContracts(ALL)).toEqual([]); // لا عقود تجريبية في المسار الحقيقي
    db.failMessage = 'permission denied for table contracts';
  });

  it('يرفض تواريخ غير منطقية قبل الاتصال بالخادم', async () => {
    await expect(renewContract(CONTRACT_ID, '2026-10-01', '2026-09-01')).rejects.toThrow();
    expect(db.rpcs).toEqual([]);
  });

  it('لا تُستدعى رسالة النجاح عند فشل التجديد', async () => {
    db.failOn = 'renew_contract';
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useRenewContract(CONTRACT_ID), { wrapper });
    const onSuccess = vi.fn();
    result.current.mutate({ start_date: '2026-10-01', end_date: '2026-12-31' }, { onSuccess });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe('تعديل قيم النظام مع قاعدة بيانات فعلية', () => {
  it('يحفظ القيمة عندما يتأثّر الصف', async () => {
    await updateConfig('contract_expiry_alert_days', 21);
    expect(db.calls).toContainEqual({
      table: 'app_config',
      op: 'update',
      payload: expect.objectContaining({ value: 21 }),
    });
  });

  it('يُبلغ بدل نجاح وهمي عندما ترفض RLS التعديل (لا صف متأثّر)', async () => {
    db.updatedRows = 0;
    await expect(updateConfig('contract_expiry_alert_days', 21)).rejects.toThrow('لم تُحفظ القيمة');
  });
});
