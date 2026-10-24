/**
 * مسار العرض التجريبي كاملًا عبر الخدمات الحقيقية (بلا محاكاة للدوال):
 * طلب بنوع مستفيد وتفاصيل مكان شرطية ← ترشيح عاملة بالمطابقة والتوفّر ← مدة
 * الخدمة وتاريخ نهايتها ← ملف الطلب وتتبّعه ← إسناد سائق ← تسلسل مسح الرحلة
 * حتى الإرجاع للسكن ← تقييم العاملة بعد الاكتمال فقط ومنع التكرار ← ملاحظة
 * عميل مرتبطة بالطلب في صندوق العرض.
 */
import { describe, expect, it } from 'vitest';
import { FALLBACK_WORKERS } from '@/lib/funnel';
import { draftPeriod, emptyDraft, type OrderDraft } from '@/lib/orderTypes';
import { emptyPlaceDetails, HOME_CODE } from '@/features/requests/types';
import { periodDays } from '@/features/requests/lib/period';
import { createMockRequestService } from '@/features/requests/services/mockRequestService';
import { matchWorker, rankWorkers } from '@/features/catalog/lib/matching';
import { bookedRangesOf } from '@/features/catalog/lib/availability';
import {
  assignDriver,
  demoOrderStatusOf,
  findDemoOrderByRequestNo,
  listOrders,
  setOrderStatus,
} from '@/features/orders/api/orders.api';
import { nextOrderStatuses, orderTransitionError } from '@/features/orders/lib/orderStatus';
import { listMyTripScans, recordTripScan } from '@/features/gps/api/gps.api';
import {
  DUPLICATE_REVIEW_MESSAGE,
  getReviewService,
  REVIEW_NOT_READY_MESSAGE,
} from '@/features/rating/services/reviewService';
import { listFeedback, submitFeedback } from '@/features/chatbot/services/feedbackService';

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const START = addDays(new Date().toISOString().slice(0, 10), 45);

describe('مسار العرض الكامل: من الطلب حتى التقييم والملاحظة', () => {
  it('ينجح المسار المشروع وتُرفض كل خطوة غير صالحة دون أثر', async () => {
    /* ١) الطلب: منزل بأطفال وبلا كبار سن، تأجير يومي ٣ أيام */
    const draft: OrderDraft = {
      ...emptyDraft('daily_rental'),
      place: {
        ...emptyPlaceDetails(),
        beneficiaryType: HOME_CODE,
        floors: 2,
        rooms: 5,
        hasChildren: true,
        children: 2,
        hasElderly: false,
      },
      durationUnit: 'day',
      days: 3,
      startDate: START,
      customerName: 'لطيفة القحطاني',
      phone: '0551237788',
      nationalId: '1087765432',
      city: 'نجران',
      address: 'حي الفيصلية',
      branch: 'نجران',
    };

    /* ٢) المدة وتاريخ النهاية: ٣ أيام شاملة يوم البداية */
    const period = draftPeriod(draft)!;
    expect(period).toMatchObject({ startDate: START, unit: 'day', count: 3 });
    expect(period.endDate).toBe(addDays(START, 2));
    expect(periodDays(period)).toBe(3);

    /* ٣) الترشيح: الأعلى بين المتاحات طوال الفترة */
    const ranked = rankWorkers(FALLBACK_WORKERS, { place: draft.place, period });
    const pick = ranked.find((r) => r.match.available)!;
    expect(pick).toBeDefined();
    const worker = pick.worker;

    /* ٤) الإرسال وملف الطلب والتتبّع */
    const svc = createMockRequestService();
    const { requestNo } = await svc.submit({
      clientToken: `e2e-${Math.random().toString(36).slice(2)}`,
      serviceName: 'تأجير يومي',
      price: { base: 900, vat: 135, total: 1035 },
      worker,
      draft: { ...draft, workerProfileId: worker.id, matchScore: pick.match.score },
    });
    const file = (await svc.getFile(requestNo))!;
    expect(file).toMatchObject({
      service_code: 'daily_rental',
      customer_name: 'لطيفة القحطاني',
      worker: { id: worker.id, full_name: worker.full_name },
      match_score: pick.match.score,
      period: { startDate: START, endDate: addDays(START, 2), count: 3 },
    });
    expect(file.details).toMatchObject({
      beneficiaryType: 'home',
      locationDetails: {
        kind: 'home',
        floors: 2,
        rooms: 5,
        hasChildren: true,
        childrenCount: 2,
        hasElderly: false,
      },
    });
    expect(await svc.track(requestNo)).toMatchObject({
      request_no: requestNo,
      service_code: 'daily_rental',
      period: { endDate: addDays(START, 2) },
    });
    // الحجز سُجّل على جدول العاملة، فلم تعد متاحة لنفس الفترة
    expect(bookedRangesOf(worker.id).some((r) => r.request_no === requestNo)).toBe(true);
    expect(matchWorker(worker, { place: draft.place, period }).available).toBe(false);

    /* ٥) طلب التشغيل المرتبط: «مدفوع» بلا سائق */
    const order = findDemoOrderByRequestNo(requestNo)!;
    expect(order).toMatchObject({ status: 'paid', driver_id: null, trip_stage: 'none' });
    const review = getReviewService();
    const tryReview = () =>
      review.addReview({ requestNo, workerId: worker.id, rating: 5, comment: 'منظّمة ودقيقة' });

    // «مُسند» بلا سائق مرفوض، والتقييم مغلق
    await expect(setOrderStatus(order.id, 'assigned')).rejects.toThrow('دون سائق');
    await expect(tryReview()).rejects.toMatchObject({ message: REVIEW_NOT_READY_MESSAGE });

    /* ٦) إسناد سائق صالح */
    await assignDriver(order.id, 'd1');
    expect(findDemoOrderByRequestNo(requestNo)).toMatchObject({
      status: 'assigned',
      driver_id: 'd1',
    });

    /* ٧) تسلسل المسح: محاولات خاطئة تُسجَّل «مرفوض» ولا تغيّر شيئًا */
    const scan = (scanType: string) =>
      recordTripScan({ orderId: order.id, requestNo, barcode: 'MAS-W-1002', scanType });
    await expect(scan('warehouse_in')).rejects.toThrow('من «مُسند» إلى «مكتمل»');
    await scan('warehouse_out');
    await expect(scan('service_end')).rejects.toThrow('لا يمكن تخطّي');
    await scan('customer_arrived');
    await scan('service_end');
    // لا إكمال يدوي قبل مسح الإرجاع
    await expect(setOrderStatus(order.id, 'completed')).rejects.toThrow('الرحلة لم تنتهِ');
    expect(demoOrderStatusOf(requestNo)).toBe('in_progress');
    await expect(tryReview()).rejects.toMatchObject({ kind: 'not_completed' });

    /* ٨) مسح الإرجاع للسكن يكمل الخدمة */
    await scan('warehouse_in');
    expect(findDemoOrderByRequestNo(requestNo)).toMatchObject({
      status: 'completed',
      trip_stage: 'returned',
    });
    const log = (await listMyTripScans()).filter((e) => e.request_no === requestNo).reverse();
    expect(log.map((e) => `${e.scan_type}:${e.outcome}`)).toEqual([
      'warehouse_in:rejected',
      'warehouse_out:accepted',
      'service_end:rejected',
      'customer_arrived:accepted',
      'service_end:accepted',
      'warehouse_in:accepted',
    ]);

    /* ٩) التقييم بعد الاكتمال فقط، ومرة واحدة */
    expect(await review.getReviewEligibility(requestNo, worker.id)).toEqual({ status: 'eligible' });
    const row = await tryReview();
    expect(row).toMatchObject({ request_no: requestNo, worker_id: worker.id, stars: 5 });
    await expect(tryReview()).rejects.toMatchObject({
      kind: 'duplicate',
      message: DUPLICATE_REVIEW_MESSAGE,
    });
    // المكتمل لا يُعاد فتحه لإتاحة تقييم جديد
    await expect(setOrderStatus(order.id, 'in_progress')).rejects.toThrow('الطلب مكتمل');

    /* ١٠) ملاحظة العميل مرتبطة بالطلب في صندوق العرض */
    const linked = await submitFeedback({
      kind: 'comment',
      body: 'الخدمة ممتازة والسائق وصل في الموعد',
      contextRequestNo: requestNo,
    });
    expect(linked.note).toMatchObject({ request_no: requestNo, status: 'new' });
    const general = await submitFeedback({ kind: 'comment', body: 'اقتراح: إضافة فرع في أبها' });
    expect(general.note.request_no).toBeNull(); // لا رقم طلب مختلق
    const inbox = await listFeedback();
    expect(inbox.find((n) => n.id === linked.note.id)?.request_no).toBe(requestNo);
  });
});

describe('بيانات العرض القائمة تبقى قابلة للاستخدام تحت القواعد الجديدة', () => {
  it('كل طلب غير نهائي له خطوة مشروعة متاحة، والنهائي بلا خطوات', async () => {
    const rows = await listOrders({ status: 'all', branch: 'all', search: '' });
    const seeds = rows.filter((o) => /^o\d+$/.test(o.id));
    expect(seeds.length).toBeGreaterThanOrEqual(12);
    for (const o of seeds) {
      const offered = nextOrderStatuses(o.status).filter((s) => !orderTransitionError(o, s));
      const canAssign = !o.driver_id && o.status !== 'completed' && o.status !== 'cancelled';
      if (o.status === 'completed' || o.status === 'cancelled') expect(offered).toEqual([]);
      else expect(offered.length > 0 || canAssign).toBe(true);
    }
  });
});
