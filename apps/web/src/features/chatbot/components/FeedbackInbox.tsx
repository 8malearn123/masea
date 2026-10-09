import { Link } from 'react-router-dom';
import { FlaskConical, Inbox, MessageSquareText } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/shared/ui';
import { dateTimeAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import {
  FEEDBACK_STATUS_LABEL,
  type CustomerNote,
  type FeedbackStatus,
} from '@/features/chatbot/api/chatbot.api';
import { listFeedback, updateFeedbackStatus } from '@/features/chatbot/services/feedbackService';

const STATUS_TONE: Record<FeedbackStatus, 'gold' | 'navy' | 'success'> = {
  new: 'gold',
  in_review: 'navy',
  closed: 'success',
};

const KIND_LABEL: Record<CustomerNote['kind'], string> = {
  comment: 'ملاحظة',
  inquiry: 'استفسار لم يُجب',
};

/**
 * صندوق ملاحظات العملاء (من مساعد الموقع) للموظفين — عرض تجريبي في الذاكرة:
 * الرقم المرجعي، الطلب المرتبط أو «ملاحظة عامة»، التاريخ، والحالة. تغيير الحالة
 * يخضع لصلاحية تعديل مركز الاتصال.
 */
export function FeedbackInbox() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const editable = can('call_center', 'edit');
  const {
    data = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['feedback', 'list'],
    queryFn: listFeedback,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; status: FeedbackStatus }) => updateFeedbackStatus(v.id, v.status),
    onSettled: () => qc.invalidateQueries({ queryKey: ['feedback'] }),
  });

  return (
    <section
      className="rounded-2xl border border-navy-100 bg-white p-4"
      aria-label="ملاحظات العملاء"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <MessageSquareText size={16} /> ملاحظات العملاء من المساعد
        </h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
          <FlaskConical size={12} /> صندوق تجريبي — محفوظ في ذاكرة العرض فقط
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState description="تعذّر تحميل الملاحظات." onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="لا توجد ملاحظات بعد"
          description="تظهر هنا ملاحظات العملاء المرسلة من مساعد الموقع."
        />
      ) : (
        <ul className="space-y-2.5">
          {data.map((n) => (
            <li
              key={n.id}
              className="rounded-xl border border-navy-100 p-3.5"
              aria-label={`ملاحظة ${n.id}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="num font-bold text-navy">{n.id}</span>
                  <Badge tone="neutral">{KIND_LABEL[n.kind]}</Badge>
                  {n.request_no ? (
                    <Link
                      to={`/order/request/${n.request_no}`}
                      className="font-semibold text-navy hover:underline"
                    >
                      الطلب <span className="num">{n.request_no}</span>
                    </Link>
                  ) : (
                    <span className="text-purple">ملاحظة عامة — غير مرتبطة بطلب</span>
                  )}
                </span>
                <Badge tone={STATUS_TONE[n.status]}>{FEEDBACK_STATUS_LABEL[n.status]}</Badge>
              </div>
              <p className="mt-2 break-words text-sm leading-relaxed text-navy-900 [overflow-wrap:anywhere]">
                {n.body}
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="num text-[11px] text-purple">{dateTimeAr(n.created_at)}</span>
                {editable && (
                  <label className="flex items-center gap-1.5 text-[11px] text-purple">
                    الحالة
                    <select
                      value={n.status}
                      onChange={(e) =>
                        update.mutate({ id: n.id, status: e.target.value as FeedbackStatus })
                      }
                      className="rounded-lg border border-navy-100 bg-white px-2 py-1 text-xs text-navy outline-none focus:border-navy"
                    >
                      {(Object.keys(FEEDBACK_STATUS_LABEL) as FeedbackStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {FEEDBACK_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
