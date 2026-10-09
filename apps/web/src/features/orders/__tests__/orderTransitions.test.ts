/**
 * قواعد تغيير حالة الطلب المركزية (`orderTransitionError`) وتطبيقها في خدمة
 * الطلبات المشتركة: الانتقالات الصالحة، المرفوضة، نهائية المكتمل والملغى،
 * الإكمال أثناء رحلة لم تنتهِ، وعدم تعديل الطلب المخزّن عند الرفض.
 */
import { describe, expect, it } from 'vitest';
import {
  advanceTripStage,
  assignDriver,
  findDemoOrderByRequestNo,
  listOrders,
  OrderTransitionError,
  setOrderStatus,
} from '@/features/orders/api/orders.api';
import {
  ORDER_TRANSITIONS,
  isTerminalOrderStatus,
  isTripUnfinished,
  orderTransitionError,
} from '@/features/orders/lib/orderStatus';
import type { Order, OrderStatus } from '@/features/orders/types';

const ALL: OrderStatus[] = ['new', 'paid', 'assigned', 'in_progress', 'completed', 'cancelled'];
/** طلب بحالة ومرحلة رحلة؛ بسائق افتراضيًا (قاعدة «مُسند بلا سائق» لها اختبارها). */
const at = (
  status: OrderStatus,
  trip_stage: Order['trip_stage'] = 'none',
  driver_id: string | null = 'd1',
) => ({ status, trip_stage, driver_id });

async function orderById(id: string): Promise<Order> {
  const rows = await listOrders({ status: 'all', branch: 'all', search: '' });
  return rows.find((o) => o.id === id)!;
}

describe('القواعد المركزية (orderTransitionError)', () => {
  it('كل انتقال في الجدول صالح، وكل ما عداه مرفوض', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const allowed = ORDER_TRANSITIONS[from].includes(to);
        expect(orderTransitionError(at(from), to) === null).toBe(allowed);
      }
    }
  });

  it('المكتمل والملغى نهائيان برسالة واضحة', () => {
    expect(isTerminalOrderStatus('completed')).toBe(true);
    expect(isTerminalOrderStatus('cancelled')).toBe(true);
    for (const to of ALL) {
      expect(orderTransitionError(at('completed', 'returned'), to)).toBe(
        'الطلب مكتمل ولا يمكن إعادة فتحه أو تغيير حالته.',
      );
      expect(orderTransitionError(at('cancelled'), to)).toBe('الطلب ملغى ولا يمكن تغيير حالته.');
    }
  });

  it('الرجوع لحالة سابقة مرفوض', () => {
    expect(orderTransitionError(at('in_progress'), 'assigned')).toBe(
      'لا يمكن نقل الطلب من «قيد التنفيذ» إلى «مُسند».',
    );
    expect(orderTransitionError(at('assigned'), 'paid')).not.toBeNull();
    expect(orderTransitionError(at('paid'), 'completed')).toBe(
      'لا يمكن نقل الطلب من «مدفوع» إلى «مكتمل».',
    );
  });

  it('الإكمال اليدوي مرفوض أثناء رحلة لم تنتهِ، ومسموح بلا رحلة', () => {
    for (const stage of ['picked_up', 'delivered', 'return_picked'] as const) {
      expect(isTripUnfinished(stage)).toBe(true);
      expect(orderTransitionError(at('in_progress', stage), 'completed')).toContain(
        'الرحلة لم تنتهِ',
      );
      // الإلغاء يبقى متاحًا كما في الجدول
      expect(orderTransitionError(at('in_progress', stage), 'cancelled')).toBeNull();
    }
    expect(isTripUnfinished('none')).toBe(false);
    expect(isTripUnfinished('returned')).toBe(false);
    expect(orderTransitionError(at('in_progress', 'none'), 'completed')).toBeNull();
  });

  it('المسح: يبقى «قيد التنفيذ» أثناء الرحلة ويكمل عند الإرجاع، ولا يقفز من «مدفوع»', () => {
    expect(orderTransitionError(at('assigned'), 'in_progress', 'scan')).toBeNull();
    expect(orderTransitionError(at('in_progress', 'picked_up'), 'in_progress', 'scan')).toBeNull();
    expect(
      orderTransitionError(at('in_progress', 'return_picked'), 'completed', 'scan'),
    ).toBeNull();
    expect(orderTransitionError(at('paid'), 'in_progress', 'scan')).not.toBeNull();
    expect(orderTransitionError(at('paid'), 'completed', 'scan')).not.toBeNull();
    expect(orderTransitionError(at('assigned'), 'completed', 'scan')).not.toBeNull();
  });
});

describe('خدمة الطلبات تطبّق القواعد ولا تعدّل الطلب عند الرفض', () => {
  it('مسار الموظف الصالح: مدفوع ← إسناد سائق ← قيد التنفيذ ← مكتمل', async () => {
    // o10 = طلب العرض REQ-2A7F41C9 (مدفوع)
    await assignDriver('o10', 'd2');
    expect((await orderById('o10')).status).toBe('assigned');
    for (const s of ['in_progress', 'completed'] as const) {
      await setOrderStatus('o10', s);
      expect((await orderById('o10')).status).toBe(s);
    }
    expect(findDemoOrderByRequestNo('REQ-2A7F41C9')?.id).toBe('o10'); // الربط بالطلب باقٍ
  });

  it('المكتمل لا يُعاد فتحه: خطأ واضح والطلب كما هو', async () => {
    const before = { ...(await orderById('o9')) };
    for (const s of ['in_progress', 'assigned', 'paid', 'new', 'cancelled'] as const) {
      const err = await setOrderStatus('o9', s).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OrderTransitionError);
      expect((err as Error).message).toBe('الطلب مكتمل ولا يمكن إعادة فتحه أو تغيير حالته.');
    }
    expect(await orderById('o9')).toEqual(before);
  });

  it('قفزة غير صالحة مرفوضة: «جديد» ← «مكتمل»', async () => {
    const before = { ...(await orderById('o5')) };
    await expect(setOrderStatus('o5', 'completed')).rejects.toThrow(
      'لا يمكن نقل الطلب من «جديد» إلى «مكتمل».',
    );
    expect(await orderById('o5')).toEqual(before);
  });

  it('إكمال يدوي أثناء الرحلة مرفوض، ومسح الإرجاع يكمل الطلب', async () => {
    // o3: قيد التنفيذ، سُلّمت للعميل (رحلة لم تنتهِ)
    const before = { ...(await orderById('o3')) };
    await expect(setOrderStatus('o3', 'completed')).rejects.toThrow('الرحلة لم تنتهِ');
    expect(await orderById('o3')).toEqual(before);
    await advanceTripStage('o3', 'service_end');
    await advanceTripStage('o3', 'warehouse_in');
    expect(await orderById('o3')).toMatchObject({ status: 'completed', trip_stage: 'returned' });
  });

  it('لا إسناد ولا مسح لطلب ملغى أو مكتمل', async () => {
    const cancelled = { ...(await orderById('o6')) };
    await expect(assignDriver('o6', 'd1')).rejects.toThrow('الطلب ملغى');
    await expect(advanceTripStage('o6', 'warehouse_out')).rejects.toThrow('الطلب ملغى');
    expect(await orderById('o6')).toEqual(cancelled);
    const done = { ...(await orderById('o4')) };
    await expect(assignDriver('o4', 'd1')).rejects.toThrow('الطلب مكتمل');
    expect(await orderById('o4')).toEqual(done);
  });

  it('الإسناد المشروع يبقى: طلب «مدفوع» يُسند لسائق', async () => {
    await assignDriver('o1', 'd1');
    expect(await orderById('o1')).toMatchObject({
      status: 'assigned',
      driver_id: 'd1',
      driver_name: 'عبدالرحمن الفيفي',
    });
  });

  it('طلب عرض غير موجود: خطأ واضح', async () => {
    await expect(setOrderStatus('o-missing', 'cancelled')).rejects.toThrow('الطلب غير موجود.');
    await expect(advanceTripStage('o-missing', 'warehouse_out')).rejects.toThrow(
      'الطلب غير موجود.',
    );
  });
});
