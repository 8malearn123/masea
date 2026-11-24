import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Select, Skeleton, useToast } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useSources } from '@/features/settings/hooks/useSettings';
import {
  changeCustomerAcquisition,
  noteRequired,
  setCustomerAcquisition,
  sourceLabelOf,
  UNSPECIFIED_SOURCE,
} from '@/features/marketing/api/attribution.api';
import { useCustomerAcquisition } from '@/features/marketing/components/MarketingSection';

const MANAGERS = ['admin', 'branch_manager', 'operations_manager'];

/** مصدر اكتساب العميل في ملفه: «غير محدد» للقدامى، تسجيله مرة، وتصحيحه بصلاحية وسبب. */
export function CustomerSourceCard({ customerId }: { customerId: string }) {
  const { can, role } = usePermissions();
  const { data: sources = [] } = useSources();
  const q = useCustomerAcquisition(customerId);
  const [mode, setMode] = useState<'set' | 'change' | null>(null);
  const acq = q.data ?? null;
  const canSet = can('customers', 'edit') || can('contracts', 'create') || can('leads', 'create');
  const canChange = MANAGERS.includes(role ?? '');
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <Megaphone size={16} /> مصدر العميل الأصلي
        </h2>
        {!q.isLoading && !acq && canSet && (
          <Button size="sm" onClick={() => setMode('set')}>
            تسجيل المصدر
          </Button>
        )}
        {acq && canChange && (
          <Button size="sm" variant="ghost" onClick={() => setMode('change')}>
            تصحيح المصدر
          </Button>
        )}
      </div>
      {q.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : acq ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-navy-900">
          <Badge tone="navy">{sourceLabelOf(sources, acq.source_code)}</Badge>
          {acq.source_note && <span>{acq.source_note}</span>}
          {acq.first_contact_at && (
            <span className="text-xs text-purple">
              أول تواصل <span className="num">{dateAr(acq.first_contact_at)}</span>
            </span>
          )}
        </p>
      ) : (
        <p className="text-sm text-purple">{UNSPECIFIED_SOURCE} — لم يُسجَّل مصدر لهذا العميل.</p>
      )}
      {mode && (
        <SourceModal
          customerId={customerId}
          mode={mode}
          current={acq?.source_code ?? ''}
          sources={sources}
          role={role ?? null}
          onClose={() => setMode(null)}
        />
      )}
    </Card>
  );
}

function SourceModal({
  customerId,
  mode,
  current,
  sources,
  role,
  onClose,
}: {
  customerId: string;
  mode: 'set' | 'change';
  current: string;
  sources: NonNullable<ReturnType<typeof useSources>['data']>;
  role: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [src, setSrc] = useState(current);
  const [note, setNote] = useState('');
  const [first, setFirst] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const needsNote = noteRequired(sources, src);
  const err = !src
    ? 'اختر المصدر'
    : needsNote && note.trim().length < 2
      ? 'وضّح المصدر'
      : mode === 'change' && reason.trim().length < 5
        ? 'سبب التصحيح مطلوب'
        : null;
  const m = useMutation({
    mutationFn: () =>
      mode === 'set'
        ? setCustomerAcquisition(customerId, {
            source_code: src,
            source_note: needsNote ? note.trim() : null,
            campaign_id: null,
            first_contact_at: first || null,
          })
        : changeCustomerAcquisition(customerId, src, needsNote ? note.trim() : null, reason, role),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['marketing'] });
      toast.success(mode === 'set' ? 'سُجّل مصدر العميل' : 'صُحّح مصدر العميل وسُجّل السبب');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'set' ? 'تسجيل مصدر العميل' : 'تصحيح مصدر العميل'}
    >
      <div className="space-y-3">
        <Select
          label="المصدر"
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          options={[
            { value: '', label: 'اختر…' },
            ...sources.filter((s) => s.is_active).map((s) => ({ value: s.code, label: s.name_ar })),
          ]}
        />
        {needsNote && (
          <Input label="توضيح المصدر" value={note} onChange={(e) => setNote(e.target.value)} />
        )}
        {mode === 'set' ? (
          <Input
            label="تاريخ أول تواصل"
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            value={first}
            onChange={(e) => setFirst(e.target.value)}
          />
        ) : (
          <Input label="سبب التصحيح" value={reason} onChange={(e) => setReason(e.target.value)} />
        )}
        <p className="text-[11px] text-purple">
          {mode === 'set'
            ? 'يُسجَّل مرة واحدة — لا تخمّن: إن لم يُعرف المصدر اتركه «غير محدد».'
            : 'التصحيح يُسجَّل في سجل التدقيق مع السبب، ولا يغيّر لقطة المصدر على العقود السابقة.'}
        </p>
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
