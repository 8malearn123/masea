import { useMemo, useState } from 'react';
import { Search, UserRound, Check } from 'lucide-react';
import { Badge, Card, Input } from '@/shared/ui';
import { useLoyaltyCustomers } from '@/features/loyalty/hooks/useLoyalty';
import { TIER_TONE } from '@/features/loyalty/types';

export function CustomerPicker({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  const { data: customers = [] } = useLoyaltyCustomers();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return customers;
    return customers.filter((c) => c.name.includes(q) || c.phone.includes(q));
  }, [customers, search]);

  return (
    <Card className="mb-5">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-navy">
        <UserRound size={16} /> استعلام عن عميل
      </h2>
      <div className="relative">
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple">
          <Search size={16} />
        </span>
        <Input
          placeholder="بحث بالاسم أو الجوال"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pr-9"
        />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c) => {
          const selected = c.id === value;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id)}
              className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 text-right transition ${
                selected
                  ? 'border-navy bg-navy-50 ring-1 ring-navy'
                  : 'border-navy-100 bg-white hover:bg-navy-50/50'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-navy">{c.name}</span>
                  {selected && <Check size={13} className="shrink-0 text-navy" />}
                </div>
                <p className="num mt-0.5 text-[11px] text-purple">{c.phone}</p>
              </div>
              <div className="shrink-0 text-left">
                <Badge tone={TIER_TONE[c.tier]}>{c.tier_label}</Badge>
                <p className="num mt-1 text-[11px] font-bold text-gold-600">{c.points_balance} ن</p>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="col-span-full py-3 text-center text-xs text-purple/60">
            لا يوجد عميل مطابق
          </p>
        )}
      </div>
    </Card>
  );
}
