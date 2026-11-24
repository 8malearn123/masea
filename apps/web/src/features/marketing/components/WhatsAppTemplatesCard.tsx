import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareText, Pencil, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Select,
  Skeleton,
  useToast,
} from '@/shared/ui';
import { usePermissions } from '@/hooks/usePermissions';
import {
  listTemplates,
  META_STATUS_LABEL,
  saveTemplate,
  templateSchema,
  type WaTemplate,
} from '@/features/marketing/api/whatsapp.api';

/** قوالب رسائل واتساب التسويقية: تُنشأ وتُعتمد في WhatsApp Manager ثم تُسجَّل هنا بنفس الاسم. */
export function WhatsAppTemplatesCard() {
  const { can } = usePermissions();
  const q = useQuery({ queryKey: ['marketing', 'wa-templates'], queryFn: listTemplates });
  const [editing, setEditing] = useState<WaTemplate | 'new' | null>(null);
  const manage = can('loyalty', 'manage');
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <MessageSquareText size={16} /> قوالب واتساب التسويقية
        </h2>
        {manage && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus size={14} /> قالب
          </Button>
        )}
      </div>
      <p className="mb-3 text-[11px] text-purple">
        الرسالة التسويقية لا تُرسل إلا بقالب معتمد من Meta. أنشئ القالب في WhatsApp Manager (فئة
        Marketing) بالمتغيرات
        {' {{1}} '}الاسم{' {{2}} '}العرض{' {{3}} '}تاريخ الانتهاء، ثم سجّله هنا بالاسم نفسه وحدّث
        حالته بعد الاعتماد.
      </p>
      {q.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={MessageSquareText} title="لا قوالب مسجّلة" />
      ) : (
        <ul className="divide-y divide-navy-50 text-sm">
          {(q.data ?? []).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-navy">{t.name_ar}</span>
                <span className="num mr-2 text-[11px] text-purple" dir="ltr">
                  {t.provider_name}
                </span>
                <span className="block truncate text-xs text-purple">{t.body}</span>
              </span>
              <Badge
                tone={
                  t.meta_status === 'approved'
                    ? 'success'
                    : t.meta_status === 'rejected'
                      ? 'danger'
                      : 'gold'
                }
              >
                {META_STATUS_LABEL[t.meta_status]}
              </Badge>
              {!t.is_active && <Badge tone="neutral">معطّل</Badge>}
              {manage && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                  <Pencil size={13} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <TemplateModal
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function TemplateModal({
  template,
  onClose,
}: {
  template: WaTemplate | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    name_ar: template?.name_ar ?? '',
    provider_name: template?.provider_name ?? '',
    language: template?.language ?? 'ar',
    body: template?.body ?? 'أهلاً {{1}}، {{2}} — العرض ساري حتى {{3}}. ماسية الشرق للاستقدام',
    meta_status: template?.meta_status ?? 'pending',
    is_active: template?.is_active ?? true,
  });
  const parsed = templateSchema.safeParse(f);
  const err = parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
  const m = useMutation({
    mutationFn: () => saveTemplate(f, template?.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['marketing', 'wa-templates'] });
      toast.success('حُفظ القالب');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title={template ? 'تعديل قالب' : 'قالب واتساب جديد'}>
      <div className="space-y-3">
        <Input
          label="اسم القالب (للموظفين)"
          value={f.name_ar}
          onChange={(e) => setF({ ...f, name_ar: e.target.value })}
        />
        <Input
          label="اسم القالب في WhatsApp Manager"
          dir="ltr"
          value={f.provider_name}
          onChange={(e) => setF({ ...f, provider_name: e.target.value })}
        />
        <label className="block text-sm font-medium text-navy-900">
          نص القالب كما اعتُمد
          <textarea
            className="mt-1 min-h-24 w-full rounded-xl border border-navy-100 p-3 text-sm"
            value={f.body}
            onChange={(e) => setF({ ...f, body: e.target.value })}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="حالة الاعتماد في Meta"
            value={f.meta_status}
            onChange={(e) =>
              setF({ ...f, meta_status: e.target.value as WaTemplate['meta_status'] })
            }
            options={(Object.keys(META_STATUS_LABEL) as WaTemplate['meta_status'][]).map((s) => ({
              value: s,
              label: META_STATUS_LABEL[s],
            }))}
          />
          <label className="flex items-end gap-2 pb-2 text-sm text-navy">
            <input
              type="checkbox"
              checked={f.is_active}
              onChange={(e) => setF({ ...f, is_active: e.target.checked })}
            />
            مفعّل
          </label>
        </div>
        {err && <p className="text-[11px] text-gold-600">{err}</p>}
        <Button
          className="w-full"
          disabled={Boolean(err)}
          loading={m.isPending}
          onClick={() => m.mutate()}
        >
          حفظ
        </Button>
      </div>
    </Modal>
  );
}
