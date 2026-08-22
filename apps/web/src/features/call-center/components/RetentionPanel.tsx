import { useMemo } from 'react';
import { ShieldAlert, PhoneCall, UserRound, Gift } from 'lucide-react';
import { Badge, Button, Card } from '@/shared/ui';
import { useTickets } from '@/features/call-center/hooks/useTickets';
import { listDirectory } from '@/features/call-center/data/directory';
import {
  assessCustomer,
  RISK_LABEL,
  RISK_TONE,
  type RiskLevel,
} from '@/features/call-center/data/retention';

function Kpi({
  label,
  value,
  tone = 'text-navy',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card className="py-4">
      <p className="text-xs text-purple">{label}</p>
      <p className={`num mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </Card>
  );
}

const RANK: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

export function RetentionPanel({ onCall }: { onCall: (phone: string) => void }) {
  const { data: tickets = [] } = useTickets();

  const rows = useMemo(() => {
    const openByPhone = (phone: string) => {
      const key = phone.replace(/\D/g, '').slice(-9);
      return tickets.filter(
        (t) => t.phone.replace(/\D/g, '').slice(-9) === key && t.status !== 'resolved',
      ).length;
    };
    return listDirectory()
      .map((c) => ({ c, a: assessCustomer(c, openByPhone(c.phone)) }))
      .sort((x, y) => RANK[x.a.risk] - RANK[y.a.risk] || y.a.score - x.a.score);
  }, [tickets]);

  const counts = {
    high: rows.filter((r) => r.a.risk === 'high').length,
    medium: rows.filter((r) => r.a.risk === 'medium').length,
    low: rows.filter((r) => r.a.risk === 'low').length,
  };

  return (
    <div>
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Kpi label="خطر مرتفع" value={String(counts.high)} tone="text-red-600" />
        <Kpi label="خطر متوسط" value={String(counts.medium)} tone="text-gold-600" />
        <Kpi label="مستقر" value={String(counts.low)} tone="text-green-600" />
      </div>

      <div className="mb-4 flex items-center gap-2 text-sm text-purple">
        <ShieldAlert size={16} className="text-red-500" />
        العملاء مرتّبون حسب احتمال الفقد — ابدأ بالأعلى خطراً.
      </div>

      <div className="space-y-3">
        {rows.map(({ c, a }) => (
          <Card key={c.phone} className="py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-navy-50 font-bold text-navy">
                  {c.name.charAt(0)}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-navy">{c.name}</p>
                    <Badge tone={RISK_TONE[a.risk]}>خطر {RISK_LABEL[a.risk]}</Badge>
                    <Badge tone="neutral">{c.segment}</Badge>
                  </div>
                  <p className="num mt-0.5 text-[11px] text-purple">
                    {c.phone} · {c.city}
                  </p>
                  {c.worker && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-purple">
                      <UserRound size={11} className="text-gold-600" /> {c.worker.name} ·{' '}
                      {c.worker.status}
                    </p>
                  )}
                  <ul className="mt-1.5 list-disc space-y-0.5 pr-4 text-[11px] text-purple">
                    {a.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                  <div className="mt-2 rounded-lg bg-navy-50/60 p-2 text-[11px] text-navy">
                    <span className="font-bold">التوصية: </span>
                    {a.action}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Gift size={12} className="text-gold-600" />
                    {a.offers.map((o) => (
                      <span
                        key={o.id}
                        className="rounded-full bg-gold-100 px-2 py-0.5 text-[10px] font-medium text-gold-600"
                      >
                        {o.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <Button variant="primary" size="sm" onClick={() => onCall(c.phone)}>
                <span className="flex items-center gap-1.5">
                  <PhoneCall size={14} /> مكالمة احتفاظ
                </span>
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
