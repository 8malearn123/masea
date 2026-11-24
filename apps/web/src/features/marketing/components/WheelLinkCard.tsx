import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy, Sparkles } from 'lucide-react';
import { Button, Card, useToast } from '@/shared/ui';
import { dateTimeAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { createWheelLink, wheelLinkUrl } from '@/features/marketing/api/wheel.api';

/** رابط عجلة الحظ الآمن للعميل — يفتحه من جواله، صالح لمدة محددة ولمرة واحدة. */
export function WheelLinkCard({ customerId, fullName }: { customerId: string; fullName: string }) {
  const { can } = usePermissions();
  const toast = useToast();
  const [link, setLink] = useState<{ url: string; expires_at: string } | null>(null);
  const m = useMutation({
    mutationFn: () => createWheelLink(customerId, fullName),
    onSuccess: (r) => setLink({ url: wheelLinkUrl(r.token), expires_at: r.expires_at }),
    onError: (e: Error) => toast.error(e.message),
  });
  if (!can('loyalty', 'manage')) return null;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <Sparkles size={16} /> رابط عجلة الحظ للعميل
        </h2>
        <Button size="sm" variant="outline" loading={m.isPending} onClick={() => m.mutate()}>
          {link ? 'إصدار رابط جديد' : 'إنشاء رابط'}
        </Button>
      </div>
      {link ? (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center gap-2 rounded-xl bg-navy-50 p-2">
            <span className="num min-w-0 flex-1 truncate text-xs" dir="ltr">
              {link.url}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(link.url)
                  .then(() => toast.success('نُسخ الرابط'))
              }
            >
              <Copy size={13} /> نسخ
            </Button>
          </div>
          <p className="text-[11px] text-purple">
            صالح حتى <span className="num">{dateTimeAr(link.expires_at)}</span> ولمرة واحدة. الجوائز
            وفرصها معلنة للعميل، والخصم مقيّد بخدماته وحدّه الأعلى. لا يُعرض الرابط مرة أخرى بعد
            إغلاق هذه البطاقة.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-purple">
          ينشئ رابطاً آمناً يفتحه العميل من جواله ويدير العجلة بنفسه.
        </p>
      )}
    </Card>
  );
}
