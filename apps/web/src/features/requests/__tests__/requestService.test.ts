/**
 * طبقة خدمة الطلبات: Mock (الافتراضي — عرض تجريبي في الذاكرة) و Supabase
 * (مستقبلي، غير مفعّل). نفس العقد، وتبديلهما من المصنع فقط.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/shared/lib/supabase';
import * as requestsApi from '@/features/requests/api/requests.api';
import { listOrders } from '@/features/orders/api/orders.api';
import {
  customerContactSchema,
  normalizeSaudiMobile,
} from '@/features/requests/schemas/request.schema';
import { createMockRequestService } from '@/features/requests/services/mockRequestService';
import {
  createSupabaseRequestService,
  toSubmitPayload,
} from '@/features/requests/services/supabaseRequestService';
import {
  getRequestService,
  requestServiceFor,
  resolveRequestBackend,
} from '@/features/requests/services';
import { RequestServiceError, type SubmitRequestInput } from '@/features/requests/services/types';
import { emptyDraft } from '@/lib/orderTypes';
import { addDays, today } from '@/features/requests/lib/period';

/** تاريخ بداية مستقبلي دائمًا (التاريخ الماضي مرفوض). */
const START = addDays(today(), 25);

let seq = 0;
function input(
  over: Partial<SubmitRequestInput['draft']> = {},
  token?: string,
): SubmitRequestInput {
  seq += 1;
  return {
    clientToken: token ?? `token-${seq}-${Math.random().toString(36).slice(2)}`,
    serviceName: 'تأجير يومي',
    price: { base: 300, vat: 45, total: 345 },
    draft: {
      ...emptyDraft('daily_rental'),
      customerName: 'هيا آل مفرح',
      phone: '+966 50 123 4567',
      nationalId: '',
      city: 'نجران',
      branch: 'نجران',
      startDate: START,
      days: 2,
      taskType: 'تنظيف',
      ...over,
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('التحقق من بيانات العميل (Zod)', () => {
  it('يقبل صيغ الجوال السعودي الشائعة ويوحّدها', () => {
    for (const raw of [
      '0501234567',
      '501234567',
      '+966501234567',
      '00966 50 123 4567',
      '966-50-123-4567',
    ]) {
      expect(normalizeSaudiMobile(raw)).toBe('0501234567');
    }
    for (const raw of ['0112345678', '05012345', '1234567890', 'abc']) {
      expect(normalizeSaudiMobile(raw)).toBeNull();
    }
  });

  it('الهوية اختيارية، وإن أُدخلت فـ ١٠ أرقام تبدأ بـ ١ أو ٢', () => {
    const base = { customerName: 'سعد آل مريح', phone: '0501234567' };
    expect(customerContactSchema.safeParse({ ...base, nationalId: '' }).success).toBe(true);
    expect(customerContactSchema.safeParse({ ...base, nationalId: '1023456789' }).success).toBe(
      true,
    );
    expect(customerContactSchema.safeParse({ ...base, nationalId: '2456789012' }).success).toBe(
      true,
    );
    const bad = customerContactSchema.safeParse({ ...base, nationalId: '3023456789' });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toContain('١٠ أرقام');
  });
});

describe('MockRequestService (العرض التجريبي)', () => {
  it('ينشئ طلبًا تجريبيًا برقم واضح ويظهر في الملف والتتبّع ولوحة العمليات', async () => {
    const svc = createMockRequestService();
    const res = await svc.submit(input());
    expect(res).toMatchObject({ backend: 'mock', created: true });
    expect(res.requestNo).toMatch(/^REQ-[0-9A-F]{8}$/);

    const file = await svc.getFile(res.requestNo);
    expect(file?.phone).toBe('0501234567'); // موحّد
    expect(file?.period).toMatchObject({ startDate: START, endDate: addDays(START, 1) });
    expect(await svc.track(res.requestNo)).toMatchObject({
      request_no: res.requestNo,
      service_code: 'daily_rental',
      backend: 'mock',
    });
    const orders = await listOrders({ status: 'all', branch: 'all', search: '' });
    expect(orders.some((o) => o.request_no === res.requestNo)).toBe(true);
  });

  it('يرفض بيانات غير صالحة برسالة واضحة دون حفظ أي شيء', async () => {
    const svc = createMockRequestService();
    const before = (await svc.listFiles()).length;
    await expect(svc.submit(input({ phone: '12345' }))).rejects.toMatchObject({
      kind: 'validation',
      message: 'رقم الجوال غير صحيح — مثال: 0501234567',
    });
    await expect(svc.submit(input({ customerName: 'ع' }))).rejects.toThrow('الاسم الكامل');
    await expect(svc.submit(input({ nationalId: '99' }))).rejects.toThrow('الهوية');
    expect((await svc.listFiles()).length).toBe(before);
  });

  it('لا ينشئ طلبًا ثانيًا عند تكرار الإرسال بنفس المعرّف (متتابعًا أو متزامنًا)', async () => {
    const svc = createMockRequestService();
    const before = (await svc.listFiles()).length;
    const one = input({}, 'same-token-123');
    const [a, b] = await Promise.all([svc.submit(one), svc.submit(one)]);
    const c = await svc.submit(one);
    expect(new Set([a.requestNo, b.requestNo, c.requestNo]).size).toBe(1);
    expect([a.created, b.created, c.created].filter(Boolean)).toHaveLength(1);
    expect((await svc.listFiles()).length).toBe(before + 1);
  });

  it('أرقام الطلبات فريدة', async () => {
    const svc = createMockRequestService();
    const nos = new Set<string>();
    for (let i = 0; i < 300; i += 1) nos.add((await svc.submit(input())).requestNo);
    expect(nos.size).toBe(300);
    const all = (await svc.listFiles()).map((f) => f.request_no);
    expect(new Set(all).size).toBe(all.length);
  });

  it('التتبّع لا يختلق طلبات: الرقم غير الموجود = غير موجود', async () => {
    const svc = createMockRequestService();
    expect(await svc.track('REQ-00000000')).toBeNull();
    expect(await svc.track('رقم غير صالح')).toBeNull();
    expect(await svc.track('req-2a7f41c9')).toMatchObject({ request_no: 'REQ-2A7F41C9' }); // طلب العرض
  });

  it('فشل الحفظ يظهر كخطأ ويجوز إعادة المحاولة بنفس المعرّف', async () => {
    const svc = createMockRequestService();
    vi.spyOn(requestsApi, 'listRequestFiles').mockRejectedValueOnce(new Error('تعذّر الحفظ'));
    const one = input({}, 'retry-token-1');
    await expect(svc.submit(one)).rejects.toThrow('تعذّر الحفظ');
    const ok = await svc.submit(one);
    expect(ok.created).toBe(true);
  });

  it('معزول عن Supabase: لا يتصل بها إطلاقًا', async () => {
    const from = vi.spyOn(supabase, 'from');
    const rpc = vi.spyOn(supabase, 'rpc');
    const svc = createMockRequestService();
    const r = await svc.submit(input());
    await svc.track(r.requestNo);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('SupabaseRequestService (مستقبلي — غير مفعّل)', () => {
  const ok = (data: unknown) =>
    Promise.resolve({ data, error: null }) as unknown as ReturnType<typeof supabase.rpc>;
  const fail = (message: string) =>
    Promise.resolve({ data: null, error: { message } }) as unknown as ReturnType<
      typeof supabase.rpc
    >;

  it('يرسل للخادم بيانات العميل فقط (لا مبالغ ولا حالة) ويعيد رقم الخادم', async () => {
    const rpc = vi
      .spyOn(supabase, 'rpc')
      .mockImplementation(() => ok({ request_no: 'REQ-ABCDEF12', created: true }));
    const svc = createSupabaseRequestService();
    const one = input({}, 'server-token-1');
    const res = await svc.submit(one);
    expect(res).toEqual({ requestNo: 'REQ-ABCDEF12', backend: 'supabase', created: true });
    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe('submit_service_request');
    expect(args.p_client_token).toBe('server-token-1');
    const payload = args.p_payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      customer_phone: '0501234567',
      start_date: START,
      duration_unit: 'day',
      duration_count: 2,
    });
    for (const k of ['base_amount', 'vat_amount', 'total_amount', 'status', 'payment_status']) {
      expect(payload).not.toHaveProperty(k);
    }
    expect(toSubmitPayload(one, '0501234567')).toEqual(payload);
  });

  it('فشل قاعدة البيانات يظهر كخطأ — لا رقم محلي ولا كتابة في بيانات العرض', async () => {
    vi.spyOn(supabase, 'rpc').mockImplementation(() => fail('connection refused'));
    const save = vi.spyOn(requestsApi, 'saveRequestFile');
    const svc = createSupabaseRequestService();
    await expect(svc.submit(input())).rejects.toMatchObject({
      kind: 'backend',
      message: 'تعذّر إرسال الطلب: connection refused',
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('رفض الصلاحيات (RLS) برسالة مفهومة', async () => {
    vi.spyOn(supabase, 'rpc').mockImplementation(() =>
      fail('new row violates row-level security policy'),
    );
    await expect(createSupabaseRequestService().submit(input())).rejects.toThrow('لا تملك صلاحية');
  });

  it('الإرسال المكرر يمرّر نفس المعرّف فيعيد الخادم نفس الطلب', async () => {
    const rpc = vi
      .spyOn(supabase, 'rpc')
      .mockImplementationOnce(() => ok({ request_no: 'REQ-11112222', created: true }))
      .mockImplementationOnce(() => ok({ request_no: 'REQ-11112222', created: false }));
    const svc = createSupabaseRequestService();
    const one = input({}, 'dup-token');
    const a = await svc.submit(one);
    const b = await svc.submit(one);
    expect(a.requestNo).toBe(b.requestNo);
    expect(b.created).toBe(false);
    const tokens = rpc.mock.calls.map((c) => (c[1] as { p_client_token: string }).p_client_token);
    expect(tokens).toEqual(['dup-token', 'dup-token']);
  });

  it('يتحقق قبل الاتصال، والتتبّع لا يختلق، وملف الطلب غير متاح بعد', async () => {
    const rpc = vi.spyOn(supabase, 'rpc').mockImplementation(() => ok(null));
    const svc = createSupabaseRequestService();
    await expect(svc.submit(input({ phone: 'x' }))).rejects.toBeInstanceOf(RequestServiceError);
    expect(rpc).not.toHaveBeenCalled();
    expect(await svc.track('REQ-00000000')).toBeNull();
    await expect(svc.getFile('REQ-00000000')).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

describe('مصنع الخدمة', () => {
  it('Mock افتراضيًا حتى لو كانت Supabase مضبوطة', () => {
    expect(
      resolveRequestBackend({ requested: undefined, backendConfigured: true, demoAccount: false }),
    ).toBe('mock');
    expect(
      resolveRequestBackend({ requested: 'mock', backendConfigured: true, demoAccount: false }),
    ).toBe('mock');
  });

  it('Supabase فقط بطلب صريح ومع اتصال مضبوط وبلا حساب تجريبي', () => {
    expect(
      resolveRequestBackend({ requested: 'supabase', backendConfigured: true, demoAccount: false }),
    ).toBe('supabase');
    expect(
      resolveRequestBackend({
        requested: 'supabase',
        backendConfigured: false,
        demoAccount: false,
      }),
    ).toBe('mock');
    expect(
      resolveRequestBackend({ requested: 'supabase', backendConfigured: true, demoAccount: true }),
    ).toBe('mock');
  });

  it('نسخة واحدة لكل مصدر، والخدمة الحالية في الاختبارات هي Mock', () => {
    expect(requestServiceFor('mock')).toBe(requestServiceFor('mock'));
    expect(requestServiceFor('supabase').backend).toBe('supabase');
    expect(getRequestService().backend).toBe('mock');
  });
});
