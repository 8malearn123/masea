import { describe, expect, it } from 'vitest';
import {
  addWorkerReview,
  listRatings,
  listWorkerReviews,
  moderateRating,
  ratingSummaryOf,
} from '@/features/rating/api/rating.api';

describe('comment moderation — nothing is published automatically', () => {
  it('keeps a new review pending and hidden from visitors until approved', async () => {
    const before = ratingSummaryOf('w6').count;
    const r = await addWorkerReview({
      workerId: 'w6',
      workerName: 'فيث أتيينو',
      customerName: 'مها الزهراني',
      stars: 5,
      comment: 'ممتازة مع الأطفال ومنظّمة جداً.',
    });
    expect(r.status).toBe('pending');
    expect((await listWorkerReviews('w6')).some((x) => x.id === r.id)).toBe(false);
    expect(ratingSummaryOf('w6').count).toBe(before);
    // but it IS in the admin queue
    expect((await listRatings()).find((x) => x.id === r.id)?.status).toBe('pending');

    await moderateRating(r.id, 'approve');
    expect((await listWorkerReviews('w6')).some((x) => x.id === r.id)).toBe(true);
    expect(ratingSummaryOf('w6').count).toBe(before + 1);
  });

  it('supports reject, hold, soft delete and restore', async () => {
    const r = await addWorkerReview({
      workerId: 'w4',
      workerName: 'ديوي أنغرايني',
      customerName: '',
      stars: 1,
      comment: 'تعليق للاختبار',
    });
    expect(r.customer_name).toBe('عميل');

    await moderateRating(r.id, 'reject', 'غير مرتبط بالخدمة');
    let row = (await listRatings()).find((x) => x.id === r.id);
    expect(row?.status).toBe('rejected');
    expect(row?.moderation_note).toBe('غير مرتبط بالخدمة');

    await moderateRating(r.id, 'pending');
    expect((await listRatings()).find((x) => x.id === r.id)?.status).toBe('pending');

    await moderateRating(r.id, 'approve');
    expect((await listWorkerReviews('w4')).some((x) => x.id === r.id)).toBe(true);

    await moderateRating(r.id, 'delete');
    row = (await listRatings()).find((x) => x.id === r.id);
    expect(row?.deleted_at).toBeTruthy(); // soft delete — still in the log
    expect((await listWorkerReviews('w4')).some((x) => x.id === r.id)).toBe(false);

    await moderateRating(r.id, 'restore');
    expect((await listWorkerReviews('w4')).some((x) => x.id === r.id)).toBe(true);
  });

  it('rejects empty comments', async () => {
    await expect(
      addWorkerReview({
        workerId: 'w1',
        workerName: 'ماريا سانتوس',
        customerName: 'x',
        stars: 4,
        comment: '  ',
      }),
    ).rejects.toThrow();
  });

  it('never shows seeded pending or rejected reviews publicly', async () => {
    const pub = await listWorkerReviews('w1');
    expect(pub.every((x) => x.status === 'approved' && !x.deleted_at)).toBe(true);
    expect(pub.some((x) => x.id === 'rt19')).toBe(false);
  });
});
