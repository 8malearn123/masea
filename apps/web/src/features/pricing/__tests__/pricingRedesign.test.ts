import { describe, expect, it } from 'vitest';
import {
  calcPriceDetail,
  DEFAULT_PRICING_CONFIG,
  ruleFloor,
  type Promotion,
} from '@/shared/lib/pricing';
import {
  buildSnapshot,
  calculate,
  EMPTY_CALC,
  priceArgsOf,
  type CalcInput,
} from '@/features/pricing/lib/engine';
import {
  listPricingRules,
  updatePricingRule,
  listRuleChanges,
  listAllPricingRules,
} from '@/features/pricing/api/pricing.api';
import {
  createQuote,
  listQuotes,
  logWhatsappOpened,
  setQuoteStatus,
  validateQuoteMeta,
} from '@/features/pricing/api/quotes.api';
import { listQuotes as listCrmQuotes } from '@/features/crm/api/crm.api';
import { effectiveStatus, listQuoteEvents } from '@/shared/lib/quotesLedger';
import { buildQuoteHtml } from '@/features/pricing/lib/quoteHtml';

const cfg = DEFAULT_PRICING_CONFIG;
const promo = (over: Partial<Promotion> = {}): Promotion => ({
  id: 'p1',
  name: 'خصم الطلب الأول',
  code: 'FIRST10',
  description: null,
  discount_pct: 10,
  discount_amount: null,
  service_codes: [],
  min_base_amount: null,
  max_discount_amount: null,
  starts_at: null,
  ends_at: null,
  usage_limit: null,
  usage_count: 0,
  is_active: true,
  requires_code: false,
  ...over,
});
const input = (over: Partial<CalcInput> = {}): CalcInput => ({ ...EMPTY_CALC, ...over });

describe('calculation parity — redesign must not change the numbers', () => {
  it('matches the previous calculator for every seeded rule and modifier combination', async () => {
    const rules = await listPricingRules();
    const combos: Partial<CalcInput>[] = [
      {},
      { quantity: 3 },
      { lateDays: 2 },
      { lateDays: 9 },
      { absenceDays: 7 },
      { cancelled: true },
      { promotion: promo() },
      { promotion: promo({ discount_pct: 99 }) }, // hits the floor
      { promotion: promo(), lateDays: 30, absenceDays: 2, cancelled: true, quantity: 2 },
    ];
    for (const r of rules) {
      for (const c of combos) {
        const i = input({
          service: r.service_code as CalcInput['service'],
          nationality: r.nationality ?? '',
          profession: r.profession ?? 'تنظيف',
          ...c,
        });
        const args = priceArgsOf(i);
        const before = calcPriceDetail(
          i.service,
          args,
          {
            promotion: i.promotion,
            promotionCode: i.couponCode,
            lateDays: i.lateDays,
            absenceDays: i.absenceDays,
            cancelled: i.cancelled,
            floor: ruleFloor(rules, i.service, args),
          },
          cfg,
        );
        const after = calculate(i, rules, cfg).detail;
        expect(after).toEqual(before);
      }
    }
  });

  it('summary lines explain the net exactly (base − discounts + fees = taxable amount)', async () => {
    const rules = await listPricingRules();
    const r = calculate(
      input({
        promotion: promo({ discount_pct: 99 }),
        lateDays: 8,
        cancelled: true,
        absenceDays: 3,
      }),
      rules,
      cfg,
    );
    const sum = Math.round(r.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    expect(sum).toBe(r.detail.net);
    expect(r.floorApplied).toBe(true);
    expect(r.lines.some((l) => l.key === 'floor')).toBe(true);
    expect(r.detail.vat).toBe(Math.round(r.detail.net * cfg.vat_rate * 100) / 100);
  });

  it('price list edits now reach the calculator (rules are the single source)', async () => {
    const rules = (await listPricingRules()).map((x) =>
      x.nationality === 'كينيا' && x.service_code === 'recruitment'
        ? { ...x, base_price: 13500 }
        : x,
    );
    expect(calculate(input({ nationality: 'كينيا' }), rules, cfg).base).toBe(13500);
  });
});

describe('validation & blockers', () => {
  it('rejects negative / fractional inputs', async () => {
    const rules = await listPricingRules();
    const r = calculate(input({ quantity: 0, lateDays: -1, absenceDays: 1.5 }), rules, cfg);
    expect(r.blockers[0]).toContain('صحّح');
  });
  it('a rejected coupon blocks the quote and explains why', async () => {
    const rules = await listPricingRules();
    const r = calculate(
      input({ promotion: promo({ requires_code: true }), couponCode: 'WRONG' }),
      rules,
      cfg,
    );
    expect(r.promotion?.ok).toBe(false);
    expect(r.blockers.join()).toContain('رمز كوبون');
  });
  it('no active rule → blocked', () => {
    expect(calculate(input(), [], cfg).blockers.join()).toContain('قاعدة');
  });
  it('quote meta validation', () => {
    expect(
      validateQuoteMeta({ customer_name: 'م', customer_phone: '123', valid_days: 0 }),
    ).toHaveLength(3);
    expect(
      validateQuoteMeta({
        customer_name: 'منيرة اليامي',
        customer_phone: '0555100202',
        valid_days: 7,
      }),
    ).toHaveLength(0);
  });
});

describe('quotes lifecycle', () => {
  it('stores an immutable snapshot — later price changes do not alter the quote', async () => {
    const rules = await listPricingRules();
    const q = await createQuote(
      {
        calc: input({ nationality: 'الفلبين' }),
        customer_name: 'خالد اليامي',
        customer_phone: '0555123456',
        valid_days: 7,
        notes: null,
      },
      { rules, cfg, actor: 'نورة العتيبي' },
    );
    expect(q.total_amount).toBe(18400);
    const rule = rules.find((r) => r.service_code === 'recruitment' && r.nationality === 'الفلبين');
    await updatePricingRule(
      rule!.id,
      {
        base_price: 17000,
        min_price: 15000,
        effective_from: '2026-11-01',
        reason: 'تحديث أسعار المكتب الخارجي',
      },
      'منصور المكرمي',
    );
    const after = (await listQuotes()).find((x) => x.id === q.id)!;
    expect(after.total_amount).toBe(18400);
    expect((after.snapshot as { detail: { total: number } }).detail.total).toBe(18400);
    expect(buildQuoteHtml(after)).toContain('18,400.00');
    expect((await listRuleChanges(rule!.id))[0]).toMatchObject({
      old_base: 16000,
      new_base: 17000,
      changed_by: 'منصور المكرمي',
    });
    expect(calculate(input({ nationality: 'الفلبين' }), await listPricingRules(), cfg).base).toBe(
      17000,
    );
  });

  it('price change requires a reason and valid floor', async () => {
    const [r] = await listAllPricingRules();
    await expect(
      updatePricingRule(
        r!.id,
        { base_price: 100, min_price: 200, effective_from: '2026-11-01', reason: 'سبب كافٍ' },
        'x',
      ),
    ).rejects.toThrow('الحد الأدنى');
    await expect(
      updatePricingRule(
        r!.id,
        { base_price: 100, min_price: 50, effective_from: '2026-11-01', reason: '' },
        'x',
      ),
    ).rejects.toThrow('سبب');
  });

  it('refuses a quote that breaks the pricing rules', async () => {
    const rules = await listPricingRules();
    await expect(
      createQuote(
        {
          calc: input({ promotion: promo({ requires_code: true }), couponCode: 'NOPE' }),
          customer_name: 'سعد',
          customer_phone: null,
          valid_days: 7,
          notes: null,
        },
        { rules, cfg, actor: 'x' },
      ),
    ).rejects.toThrow();
  });

  it('WhatsApp only logs the link opening — status unchanged; decisions are final', async () => {
    const rules = await listPricingRules();
    const q = await createQuote(
      {
        calc: input(),
        customer_name: 'هيا القحطاني',
        customer_phone: '0555000111',
        valid_days: 5,
        notes: null,
      },
      { rules, cfg, actor: 'نورة' },
    );
    logWhatsappOpened(q.id, 'نورة');
    expect((await listQuotes()).find((x) => x.id === q.id)?.status).toBe('draft');
    expect(listQuoteEvents(q.id).map((e) => e.type)).toEqual(['created', 'whatsapp_opened']);
    await setQuoteStatus(q.id, 'sent', 'نورة');
    await setQuoteStatus(q.id, 'accepted', 'نورة');
    await expect(setQuoteStatus(q.id, 'rejected', 'نورة')).rejects.toThrow();
  });

  it('open quotes past validity read as expired', () => {
    expect(effectiveStatus({ status: 'sent', valid_until: '2020-01-01' }, '2026-10-27')).toBe(
      'expired',
    );
    expect(effectiveStatus({ status: 'accepted', valid_until: '2020-01-01' }, '2026-10-27')).toBe(
      'accepted',
    );
  });

  it('pricing and CRM read the same quote records', async () => {
    const crm = await listCrmQuotes('lead-3');
    const pricing = await listQuotes();
    expect(crm[0]?.id).toBe('quote-1');
    expect(pricing.some((x) => x.id === 'quote-1')).toBe(true);
  });

  it('snapshot keeps inputs, rule, config and promotion', async () => {
    const rules = await listPricingRules();
    const i = input({ promotion: promo() });
    const s = buildSnapshot(i, calculate(i, rules, cfg), cfg);
    expect(s.inputs.promotion_id).toBe('p1');
    expect(s.rule?.base_price).toBeGreaterThan(0);
    expect(s.config.vat_rate).toBe(0.15);
  });
});
