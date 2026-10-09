/**
 * سجل مسح الرحلة من شاشة السائق: كل محاولة تُسجَّل (لا يُحذف دليل المحاولة)،
 * والمقبول يُميَّز عن المرفوض مع سبب الرفض، والمرفوض لا يغيّر الطلب ولا الرحلة،
 * والمسحات المقبولة لطلب ما تطابق مرحلة رحلته تمامًا.
 */
import { describe, expect, it } from 'vitest';
import { listMyTripScans, recordTripScan } from '@/features/gps/api/gps.api';
import {
  addLocalOrder,
  assignDriver,
  findDemoOrderByRequestNo,
} from '@/features/orders/api/orders.api';
import { stageIndex, TRIP_STEPS } from '@/features/orders/lib/trip';
import type { Order } from '@/features/orders/types';

const BARCODE = 'MAS-W-1001';
let seq = 0;

async function assignedOrder(): Promise<Order> {
  seq += 1;
  const request_no = `REQ-S${String(seq).padStart(7, '0')}`;
  addLocalOrder({
    request_no,
    customer_name: 'هند العتيبي',
    service_code: 'daily_rental',
    branch: 'جازان',
    total_amount: 345,
  });
  const order = findDemoOrderByRequestNo(request_no)!;
  await assignDriver(order.id, 'd2');
  return findDemoOrderByRequestNo(request_no)!;
}

const scan = (o: Order, scanType: string, barcode = BARCODE) =>
  recordTripScan({ orderId: o.id, requestNo: o.request_no, barcode, scanType });
const latest = async () => (await listMyTripScans())[0]!;
const stored = (o: Order) => ({ ...findDemoOrderByRequestNo(o.request_no)! });

describe('سجل مسح الرحلة', () => {
  it('المسح المقبول: يُسجَّل «مقبول» مرتبطًا بالطلب وتتقدّم الرحلة', async () => {
    const o = await assignedOrder();
    const res = await scan(o, 'warehouse_out');
    expect(res).toMatchObject({ stage: 'picked_up', status: 'in_progress' });
    expect(await latest()).toMatchObject({
      scan_type: 'warehouse_out',
      request_no: o.request_no,
      outcome: 'accepted',
    });
    expect((await latest()).reason).toBeUndefined();
    expect(stored(o)).toMatchObject({ trip_stage: 'picked_up', status: 'in_progress' });
  });

  it('المسح خارج الترتيب: المحاولة تبقى في السجل موسومة «مرفوض» بالسبب، والطلب كما هو', async () => {
    const o = await assignedOrder();
    const before = stored(o);
    const count = (await listMyTripScans()).length;
    await expect(scan(o, 'service_end')).rejects.toThrow('لا يمكن تخطّي');
    const log = await listMyTripScans();
    expect(log).toHaveLength(count + 1); // لا حذف ولا إخفاء للمحاولة
    expect(log[0]).toMatchObject({
      scan_type: 'service_end',
      request_no: o.request_no,
      outcome: 'rejected',
    });
    expect(log[0]!.reason).toContain('الخطوة التالية: «استلام من السكن»');
    expect(stored(o)).toEqual(before);
  });

  it('المسح المكرر: مرفوض ومسجّل، والرحلة لا تتقدّم', async () => {
    const o = await assignedOrder();
    await scan(o, 'warehouse_out');
    const before = stored(o);
    await expect(scan(o, 'warehouse_out')).rejects.toThrow('مسبقًا');
    expect(await latest()).toMatchObject({ outcome: 'rejected', scan_type: 'warehouse_out' });
    expect(stored(o)).toEqual(before);
  });

  it('باركود غير معروف: لا تسجيل ولا تغيير (كما كان)', async () => {
    const o = await assignedOrder();
    const before = stored(o);
    const count = (await listMyTripScans()).length;
    await expect(scan(o, 'warehouse_out', 'MAS-W-0000')).rejects.toThrow('لا توجد عاملة');
    expect(await listMyTripScans()).toHaveLength(count);
    expect(stored(o)).toEqual(before);
  });

  it('اتساق السجل مع الرحلة: المقبول فقط يطابق الخطوات بالترتيب، والإرجاع يكمل', async () => {
    const o = await assignedOrder();
    const attempts = [
      'warehouse_out',
      'warehouse_in', // تخطٍّ
      'customer_arrived',
      'customer_arrived', // تكرار
      'warehouse_out', // رجوع
      'service_end',
      'warehouse_in',
      'warehouse_in', // بعد الانتهاء
    ];
    for (const s of attempts) await scan(o, s).catch(() => undefined);

    const mine = (await listMyTripScans()).filter((e) => e.request_no === o.request_no).reverse();
    expect(mine).toHaveLength(attempts.length);
    expect(mine.every((e) => e.outcome === 'accepted' || e.outcome === 'rejected')).toBe(true);
    const accepted = mine.filter((e) => e.outcome === 'accepted').map((e) => e.scan_type);
    expect(accepted).toEqual(TRIP_STEPS.map((s) => s.scan));
    expect(mine.filter((e) => e.outcome === 'rejected')).toHaveLength(4);

    const final = stored(o);
    expect(final).toMatchObject({ status: 'completed', trip_stage: 'returned' });
    expect(accepted).toHaveLength(stageIndex(final.trip_stage) + 1);
  });
});
