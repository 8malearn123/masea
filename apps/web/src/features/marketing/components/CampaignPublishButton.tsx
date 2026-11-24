import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Rocket } from 'lucide-react';
import { Button, useToast } from '@/shared/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { publishCampaign } from '@/features/loyalty/api/loyalty.api';
import type { Campaign } from '@/features/loyalty/types';

/** تفعيل حملة «مسودة» — قبلها لا يُقبل كوبونها ولا تُرسل عروضها. */
export function CampaignPublishButton({ campaign }: { campaign: Campaign }) {
  const { can } = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => publishCampaign(campaign.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['loyalty'] });
      void qc.invalidateQueries({ queryKey: ['marketing'] });
      toast.success('فُعّلت الحملة — تعمل ضمن تاريخ بدايتها ونهايتها');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!campaign.is_draft || !can('loyalty', 'manage')) return null;
  return (
    <Button size="sm" loading={m.isPending} onClick={() => m.mutate()}>
      <Rocket size={14} /> تفعيل الحملة
    </Button>
  );
}
