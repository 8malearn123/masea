import { Info } from 'lucide-react';
import { RatingSummaryPanel, ReviewList } from '@/features/rating/components/RatingParts';

/**
 * تقييمات وتعليقات العملاء المرتبطة بالعاملة — من خدمة التقييمات
 * (`features/rating`). الإضافة تتم من ملف الطلب فقط، ليرتبط كل تقييم بطلب حقيقي
 * للعاملة نفسها (لا تقييمات عامة مجهولة المصدر).
 */
export function WorkerReviews({ workerId }: { workerId: string; workerName?: string }) {
  return (
    <div className="space-y-4">
      <RatingSummaryPanel workerId={workerId} />
      <p className="flex items-start gap-1.5 text-[11px] text-purple">
        <Info size={13} className="mt-0.5 shrink-0" />
        يقيّم العميل العاملة من ملف طلبه بعد الخدمة — تقييم واحد لكل طلب.
      </p>
      <ReviewList workerId={workerId} />
    </div>
  );
}
