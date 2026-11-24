import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Skeleton, useToast } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import {
  CHANNEL_LABEL,
  consentSchema,
  getConsent,
  setConsent,
  type Channel,
} from '@/features/marketing/api/offers.api';

/** موافقة العميل على الرسائل التسويقية — شرط إرسال العروض له. */
export function ConsentCard({ customerId }: { customerId: string }) {
  const { can } = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['marketing', 'consent', customerId],
    queryFn: () => getConsent(customerId),
  });
  const [open, setOpen] = useState(false);
  const canEdit = can('customers', 'edit') || can('loyalty', 'manage');
  const revoke = useMutation({
    mutationFn: () => setConsent(customerId, false, [], ''),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['marketing'] });
      toast.success('أُلغيت الموافقة — لن تُرسل له عروض');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const c = q.data;
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <BellRing size={16} /> الموافقة على الرسائل التسويقية
        </h2>
        {canEdit &&
          c &&
          (c.granted ? (
            <Button
              size="sm"
              variant="ghost"
              loading={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              إلغاء الموافقة
            </Button>
          ) : (
            <Button size="sm" onClick={() => setOpen(true)}>
              تسجيل موافقة
            </Button>
          ))}
      </div>
      {q.isLoading ? (
        <Skeleton className="h-8 w-full" />
      ) : c?.granted ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="success">موافق</Badge>
          {c.channels.map((ch) => (
            <Badge key={ch} tone="navy">
              {CHANNEL_LABEL[ch]}
            </Badge>
          ))}
          <span className="text-xs text-purple">
            {c.source}
            {c.at ? ` · ${dateAr(c.at)}` : ''}
          </span>
        </p>
      ) : (
        <p className="text-sm text-purple">
          {c?.opted_out_at ? `ألغى الموافقة ${dateAr(c.opted_out_at)}` : 'لا موافقة مسجّلة'} — لا
          تُرسل له عروض تسويقية.
        </p>
      )}
      {open && <GrantModal customerId={customerId} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function GrantModal({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [channels, setChannels] = useState<Channel[]>(['whatsapp']);
  const [source, setSource] = useState('');
  const parsed = consentSchema.safeParse({ channels, source });
  const err = parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
  const m = useMutation({
    mutationFn: () => setConsent(customerId, true, channels, source),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['marketing'] });
      toast.success('سُجّلت الموافقة');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title="تسجيل موافقة على الرسائل التسويقية">
      <div className="space-y-3">
        <fieldset className="flex flex-wrap gap-4">
          {(Object.keys(CHANNEL_LABEL) as Channel[]).map((ch) => (
            <label key={ch} className="flex items-center gap-1.5 text-sm text-navy">
              <input
                type="checkbox"
                className="h-4 w-4 accent-navy"
                checked={channels.includes(ch)}
                onChange={(e) =>
                  setChannels((all) =>
                    e.target.checked ? [...all, ch] : all.filter((x) => x !== ch),
                  )
                }
              />
              {CHANNEL_LABEL[ch]}
            </label>
          ))}
        </fieldset>
        <Input
          label="مصدر الموافقة (كيف ومتى وافق العميل)"
          placeholder="مثال: موافقة مكتوبة في فرع نجران"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
        <p className="text-[11px] text-purple">
          سجّل الموافقة فقط إذا وافق العميل فعلاً؛ يمكنه إلغاؤها في أي وقت.
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
