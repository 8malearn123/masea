import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { Button, Input, Modal, useToast } from '@/shared/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { extendCampaign } from '@/features/marketing/api/wheel.api';
import type { Campaign } from '@/features/loyalty/types';

const MANAGERS = ['admin', 'operations_manager', 'branch_manager'];

/** تمديد الحملة بصلاحية إدارية وسبب — كوبونات الحملة تُمدَّد معها. */
export function CampaignExtendButton({ campaign }: { campaign: Campaign }) {
  const { can, role } = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () =>
      extendCampaign(
        campaign.id,
        new Date(`${until}T23:59:59`).toISOString(),
        reason,
        role ?? null,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['loyalty'] });
      void qc.invalidateQueries({ queryKey: ['marketing'] });
      toast.success('مُدّدت الحملة وسُجّل السبب');
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!can('loyalty', 'manage') || !MANAGERS.includes(role ?? '')) return null;
  const err = !until
    ? 'حدّد تاريخ النهاية الجديد'
    : reason.trim().length < 5
      ? 'سبب التمديد مطلوب'
      : null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CalendarPlus size={14} /> تمديد الحملة
      </Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title={`تمديد «${campaign.name}»`}>
          <div className="space-y-3">
            <Input
              label="النهاية الجديدة"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
            <Input label="السبب" value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="text-[11px] text-purple">
              يُسجَّل التمديد مع السبب، وتُمدَّد كوبونات الحملة التي كانت تنتهي بنهايتها.
            </p>
            {err && <p className="text-[11px] text-gold-600">{err}</p>}
            <Button
              className="w-full"
              disabled={Boolean(err)}
              loading={m.isPending}
              onClick={() => m.mutate()}
            >
              تمديد
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
