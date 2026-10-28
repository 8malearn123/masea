import { useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  BadgePercent,
  Calculator,
  CheckCircle2,
  FileText,
  Hourglass,
  ListChecks,
  ScrollText,
  Settings2,
  Tag,
} from 'lucide-react';
import { StatTile } from '@/shared/ui';
import { DEFAULT_PRICING_CONFIG } from '@/shared/lib/pricing';
import { effectiveStatus } from '@/shared/lib/quotesLedger';
import { usePermissions } from '@/hooks/usePermissions';
import { usePricingConfig, usePricingRules } from '@/features/pricing/hooks/usePricingRules';
import { useQuotes } from '@/features/pricing/hooks/useQuotes';
import { usePromotions } from '@/features/pricing/hooks/usePromotions';
import { CalculatorTab } from '@/features/pricing/components/CalculatorTab';
import { PriceListTab } from '@/features/pricing/components/PriceListTab';
import { QuotesTab } from '@/features/pricing/components/QuotesTab';
import { DiscountsManager, promoState } from '@/features/pricing/components/DiscountsManager';
import { LogTab } from '@/features/pricing/components/LogTab';
import { SettingsTab } from '@/features/pricing/components/SettingsTab';

type Tab = 'calc' | 'prices' | 'quotes' | 'discounts' | 'log' | 'settings';
const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
  { key: 'calc', label: 'حاسبة التسعير', icon: Calculator },
  { key: 'prices', label: 'قائمة الأسعار', icon: ListChecks },
  { key: 'quotes', label: 'عروض الأسعار', icon: FileText },
  { key: 'discounts', label: 'الخصومات والكوبونات', icon: BadgePercent },
  { key: 'log', label: 'سجل التسعير', icon: ScrollText },
  { key: 'settings', label: 'الإعدادات', icon: Settings2 },
];
const isTab = (v: string | null): v is Tab => TABS.some((t) => t.key === v);

/** التسعير وعروض الأسعار — one place for prices, discounts and quotes. */
export default function PricingBoard() {
  const { can } = usePermissions();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = isTab(raw) ? raw : 'calc';
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const { data: rules = [], isLoading: rulesLoading } = usePricingRules();
  const { data: cfg = DEFAULT_PRICING_CONFIG } = usePricingConfig();
  const { data: quotes = [], isLoading: quotesLoading } = useQuotes();
  const { data: promos = [], isLoading: promosLoading } = usePromotions();

  const go = (t: Tab, extra: Record<string, string> = {}) =>
    setParams(
      () => {
        const n = new URLSearchParams();
        if (t !== 'calc') n.set('tab', t);
        for (const [k, v] of Object.entries(extra)) n.set(k, v);
        return n;
      },
      { replace: false },
    );

  function onKey(e: React.KeyboardEvent, i: number) {
    // RTL: ArrowLeft moves to the NEXT tab visually
    const n = TABS.length;
    let j: number | null = null;
    if (e.key === 'ArrowLeft') j = (i + 1) % n;
    else if (e.key === 'ArrowRight') j = (i - 1 + n) % n;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    if (j === null) return;
    e.preventDefault();
    const target = TABS[j];
    if (target) go(target.key);
    tabRefs.current[j]?.focus();
  }

  const eff = quotes.map((q) => effectiveStatus(q));
  const kpi = {
    rules: rules.length,
    pending: eff.filter((s) => s === 'draft' || s === 'sent').length,
    accepted: eff.filter((s) => s === 'accepted').length,
    promos: promos.filter((p) => promoState(p) === 'active').length,
  };
  const dash = (loading: boolean, v: number) => (loading ? '…' : v);

  return (
    <div>
      <header className="mb-5 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-navy-50 text-navy">
          <Tag size={21} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">التسعير وعروض الأسعار</h1>
          <p className="text-sm text-purple">
            إدارة الأسعار والخصومات وإنشاء عروض أسعار دقيقة للعملاء من مكان واحد
          </p>
        </div>
      </header>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="قواعد الأسعار النشطة"
          value={dash(rulesLoading, kpi.rules)}
          icon={ListChecks}
          onClick={() => go('prices', { lst: 'active' })}
        />
        <StatTile
          label="عروض قيد الانتظار"
          value={dash(quotesLoading, kpi.pending)}
          icon={Hourglass}
          tone="warning"
          hint="مسودة أو مرسلة"
          onClick={() => go('quotes', { qs: 'pending' })}
        />
        <StatTile
          label="العروض المقبولة"
          value={dash(quotesLoading, kpi.accepted)}
          icon={CheckCircle2}
          tone="success"
          onClick={() => go('quotes', { qs: 'accepted' })}
        />
        <StatTile
          label="الخصومات النشطة"
          value={dash(promosLoading, kpi.promos)}
          icon={BadgePercent}
          onClick={() => go('discounts')}
        />
      </div>

      <div
        role="tablist"
        aria-label="أقسام التسعير"
        className="mb-5 flex gap-1 overflow-x-auto rounded-2xl bg-navy-50 p-1"
      >
        {TABS.map((t, i) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              id={`pricing-tab-${t.key}`}
              role="tab"
              type="button"
              aria-selected={active}
              aria-controls={`pricing-panel-${t.key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => go(t.key)}
              onKeyDown={(e) => onKey(e, i)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-navy ${
                active ? 'bg-white text-navy shadow-card' : 'text-purple hover:text-navy'
              }`}
            >
              <t.icon size={15} aria-hidden /> {t.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`pricing-panel-${tab}`}
        aria-labelledby={`pricing-tab-${tab}`}
        key={tab}
        className="animate-[fadeIn_.15s_ease-out]"
      >
        {tab === 'calc' && (
          <CalculatorTab cfg={cfg} rules={rules} onQuoteCreated={() => go('quotes')} />
        )}
        {tab === 'prices' && <PriceListTab />}
        {tab === 'quotes' && <QuotesTab cfg={cfg} rules={rules} />}
        {tab === 'discounts' && <DiscountsManager editable={can('pricing', 'manage')} />}
        {tab === 'log' && <LogTab />}
        {tab === 'settings' && <SettingsTab cfg={cfg} />}
      </div>
    </div>
  );
}
