/**
 * اتساق سير عمل الطلبات التجريبي: «مُسند» يتطلب سائقًا، وتسلسل مسح الرحلة
 * مفروض في الخدمة المشتركة (لا تخطٍّ ولا تكرار ولا رجوع)، والرفض لا يغيّر
 * الطلب المخزّن ولا يفتح تقييم العاملة.
 */
import { describe, expect, it } from 'vitest';
import { FALLBACK_WORKERS } from '@/lib/funnel';
import { emptyDraft } from '@/lib/orderTypes';
import {
  addLocalOrder,
  advanceTripStage,
  assignDriver,
  DEMO_DRIVER_ID,
  findDemoOrderByRequestNo,
  listOrders,
  OrderTransitionError,
  setOrderStatus,
} from '@/features/orders/api/orders.api';
import { nextOrderStatuses, orderTransitionError } from '@/features/orders/lib/orderStatus';
import type { Order } from '@/features/orders/types';
import { createMockRequestService } from '@/features/requests/services/mockRequestService';
import { getReviewService } from '@/features/rating/services/reviewService';

let seq = 0;
/** طلب تشغيل جديد بحالة «مدفوع» بلا سائق (كما يُنشئه نموذج الطلب). */
function freshOrder(): Order {
  seq += 1;
  const request_no = `REQ-D${String(seq).padStart(7, '0')}`;
  addLocalOrder({
    request_no,
    customer_name: 'مشاعل الغامدي',
    service_code: 'daily_rental',
    branch: 'نجران',
    total_amount: 345,
  });
  return findDemoOrderByRequestNo(request_no)!;
}

const snapshot = (o: Order) => ({ ...o });
const stored = (o: Order) => findDemoOrderByRequestNo(o.request_no)!;

async function rejects(p: Promise<unknown>, message: string) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(OrderTransitionError);
  expect((err as Error).message).toContain(message);
}

const FULL_TRIP = ['warehouse_out', 'customer_arrived', 'service_end', 'warehouse_in'];

/* ------------------------------- «مُسند» = سائق ------------------------------- */
describe('«مُسند» يتطلب سائقًا', () => {
  it('إسناد سائق صالح يجعل الطلب «مُسند» باسمه', async () => {
    const o = freshOrder();
    await assignDriver(o.id, 'd3');
    expect(stored(o)).toMatchObject({
      status: 'assigned',
      driver_id: 'd3',
      driver_name: 'تركي الحارثي',
    });
  });

  it('حساب السائق التجريبي سائق صالح أيضًا', async () => {
    const o = freshOrder();
    await assignDriver(o.id, DEMO_DRIVER_ID);
    expect(stored(o)).toMatchObject({ status: 'assigned', driver_id: DEMO_DRIVER_ID });
  });

  it('«مُسند» يدويًا بلا سائق مرفوض والطلب كما هو', async () => {
    const o = freshOrder();
    const before = snapshot(o);
    await rejects(setOrderStatus(o.id, 'assigned'), 'دون سائق');
    expect(stored(o)).toEqual(before);
  });

  it('قائمة الحالة لا تعرض «مُسند» لطلب بلا سائق (نفس القاعدة)', () => {
    const o = freshOrder();
    const offered = nextOrderStatuses(o.status).filter((s) => !orderTransitionError(o, s));
    expect(offered).toEqual(['cancelled']);
  });

  it('سائق غير موجود مرفوض والطلب كما هو', async () => {
    const o = freshOrder();
    const before = snapshot(o);
    await rejects(assignDriver(o.id, 'd-missing'), 'السائق غير موجود');
    expect(stored(o)).toEqual(before);
  });

  it('لا إسناد بعد الإكمال أو الإلغاء', async () => {
    const cancelled = freshOrder();
    await setOrderStatus(cancelled.id, 'cancelled');
    const c0 = snapshot(stored(cancelled));
    await rejects(assignDriver(cancelled.id, 'd1'), 'الطلب ملغى');
    expect(stored(cancelled)).toEqual(c0);

    const done = freshOrder();
    await assignDriver(done.id, 'd1');
    for (const scan of FULL_TRIP) await advanceTripStage(done.id, scan);
    const d0 = snapshot(stored(done));
    await rejects(assignDriver(done.id, 'd2'), 'الطلب مكتمل');
    expect(stored(done)).toEqual(d0);
  });

  it('بيانات العرض التاريخية باقية كما هي', async () => {
    const rows = await listOrders({ status: 'all', branch: 'all', search: '' });
    const byId = (id: string) => rows.find((r) => r.id === id)!;
    expect(byId('o2')).toMatchObject({ status: 'assigned', driver_id: 'd2' });
    expect(byId('o7')).toMatchObject({ status: 'assigned', driver_id: DEMO_DRIVER_ID });
    // مكتمل بلا سائق في البيانات الأصلية — لا يُعاد كتابته
    expect(byId('o4')).toMatchObject({ status: 'completed', driver_id: null });
  });
});

/* ------------------------------ تسلسل مسح الرحلة ------------------------------ */
describe('تسلسل مسح الرحلة في الخدمة المشتركة', () => {
  async function assigned() {
    const o = freshOrder();
    await assignDriver(o.id, 'd1');
    return stored(o);
  }

  it('التسلسل الصحيح: ثلاث خطوات «قيد التنفيذ» ثم الإرجاع يكمل', async () => {
    const o = await assigned();
    const results = [];
    for (const scan of FULL_TRIP) results.push(await advanceTripStage(o.id, scan));
    expect(results).toEqual([
      { stage: 'picked_up', status: 'in_progress' },
      { stage: 'delivered', status: 'in_progress' },
      { stage: 'return_picked', status: 'in_progress' },
      { stage: 'returned', status: 'completed' },
    ]);
    expect(stored(o)).toMatchObject({ status: 'completed', trip_stage: 'returned' });
  });

  it('تخطّي خطوة مرفوض بلا أي تغيير', async () => {
    const o = await assigned();
    const before = snapshot(o);
    await rejects(advanceTripStage(o.id, 'customer_arrived'), 'لا يمكن تخطّي');
    expect(stored(o)).toEqual(before);
    await advanceTripStage(o.id, 'warehouse_out');
    const mid = snapshot(stored(o));
    await rejects(advanceTripStage(o.id, 'service_end'), 'الخطوة التالية: «تسليم للعميل»');
    expect(stored(o)).toEqual(mid);
  });

  it('مسح الإرجاع مباشرة بعد الإسناد مرفوض (لا قفز إلى مكتمل)', async () => {
    const o = await assigned();
    const before = snapshot(o);
    await rejects(advanceTripStage(o.id, 'warehouse_in'), 'من «مُسند» إلى «مكتمل»');
    expect(stored(o)).toEqual(before);
  });

  it('تكرار المسح مرفوض', async () => {
    const o = await assigned();
    await advanceTripStage(o.id, 'warehouse_out');
    const before = snapshot(stored(o));
    await rejects(advanceTripStage(o.id, 'warehouse_out'), 'تم مسح «استلام من السكن» مسبقًا');
    expect(stored(o)).toEqual(before);
  });

  it('مسح خطوة سابقة (خارج الترتيب) مرفوض', async () => {
    const o = await assigned();
    await advanceTripStage(o.id, 'warehouse_out');
    await advanceTripStage(o.id, 'customer_arrived');
    const before = snapshot(stored(o));
    await rejects(advanceTripStage(o.id, 'warehouse_out'), 'مسبقًا');
    expect(stored(o)).toEqual(before);
  });

  it('لا مسح بعد انتهاء الرحلة', async () => {
    const o = await assigned();
    for (const scan of FULL_TRIP) await advanceTripStage(o.id, scan);
    const before = snapshot(stored(o));
    await rejects(advanceTripStage(o.id, 'warehouse_in'), 'الطلب مكتمل');
    expect(stored(o)).toEqual(before);
  });

  it('لا إكمال يدوي بدون مسح الإرجاع، ثم مسح الإرجاع وحده يكمل', async () => {
    const o = await assigned();
    for (const scan of FULL_TRIP.slice(0, 3)) await advanceTripStage(o.id, scan);
    const before = snapshot(stored(o));
    await rejects(setOrderStatus(o.id, 'completed'), 'الرحلة لم تنتهِ');
    expect(stored(o)).toEqual(before);
    await advanceTripStage(o.id, 'warehouse_in');
    expect(stored(o).status).toBe('completed');
  });

  it('مسارات العرض القائمة باقية: o8 (استلام من السكن) يكمل رحلته', async () => {
    for (const scan of FULL_TRIP.slice(1)) await advanceTripStage('o8', scan);
    const rows = await listOrders({ status: 'all', branch: 'all', search: '' });
    expect(rows.find((r) => r.id === 'o8')).toMatchObject({
      status: 'completed',
      trip_stage: 'returned',
    });
  });
});

/* ------------------------- الرفض لا يفتح تقييم العاملة ------------------------- */
describe('الإجراءات المرفوضة لا تجعل الطلب مؤهلًا للتقييم', () => {
  it('مُسند بلا سائق، تخطّي المسح، والإكمال اليدوي أثناء الرحلة — كلها لا تفتح التقييم', async () => {
    const w = FALLBACK_WORKERS.find((x) => x.id === 'w8')!;
    const { requestNo } = await createMockRequestService().submit({
      clientToken: `driver-scan-${Math.random().toString(36).slice(2)}`,
      serviceName: 'تأجير يومي',
      price: { base: 300, vat: 45, total: 345 },
      worker: w,
      draft: {
        ...emptyDraft('daily_rental'),
        customerName: 'مشاعل الغامدي',
        phone: '0501234567',
        workerProfileId: w.id,
      },
    });
    const svc = getReviewService();
    const order = findDemoOrderByRequestNo(requestNo)!;
    const closed = () => svc.getReviewEligibility(requestNo, w.id);

    await setOrderStatus(order.id, 'assigned').catch(() => undefined);
    expect(await closed()).toMatchObject({ status: 'not_completed', serviceStatus: 'paid' });

    await assignDriver(order.id, 'd1');
    await advanceTripStage(order.id, 'warehouse_in').catch(() => undefined);
    await advanceTripStage(order.id, 'warehouse_out');
    await advanceTripStage(order.id, 'service_end').catch(() => undefined);
    await setOrderStatus(order.id, 'completed').catch(() => undefined);
    expect(await closed()).toMatchObject({ status: 'not_completed', serviceStatus: 'in_progress' });
    await expect(
      svc.addReview({ requestNo, workerId: w.id, rating: 5, comment: '' }),
    ).rejects.toMatchObject({ kind: 'not_completed' });

    // التسلسل المشروع حتى الإرجاع يفتح التقييم
    for (const scan of FULL_TRIP.slice(1)) await advanceTripStage(order.id, scan);
    expect(await closed()).toEqual({ status: 'eligible' });
  });
});
