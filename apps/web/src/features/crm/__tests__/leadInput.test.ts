/** قواعد العميل المحتمل (0085) واليوم بتوقيت الرياض. */
import { describe, expect, it } from 'vitest';
import { leadInputError, normalizeSaudiPhone, parseLeadInput } from '@/features/crm/lib/leadInput';
import { riyadhDay } from '@/shared/lib/format';
import type { LeadInput } from '@/features/crm/api/crm.api';

const base: LeadInput = {
  full_name: 'فيصل آل منصور',
  phone: '0551239876',
  source_code: 'website',
  service_code: 'recruitment',
  stage_code: 'new',
  est_value: 16000,
  notes: null,
};

describe('العميل المحتمل', () => {
  it('الاسم مطلوب برسالة واضحة', () => {
    expect(leadInputError({ ...base, full_name: '  ' })).toBe('اسم العميل مطلوب');
  });
  it('الجوال 05xxxxxxxx ويُطبَّع من الصيغ الدولية', () => {
    expect(leadInputError({ ...base, phone: '12345' })).toContain('05xxxxxxxx');
    expect(normalizeSaudiPhone('+966 55 123 9876')).toBe('0551239876');
    expect(normalizeSaudiPhone('966551239876')).toBe('0551239876');
    expect(normalizeSaudiPhone('551239876')).toBe('0551239876');
    expect(normalizeSaudiPhone('')).toBeNull();
    expect(parseLeadInput({ ...base, phone: '+966551239876' }).phone).toBe('0551239876');
    expect(leadInputError({ ...base, phone: null })).toBeNull();
  });
  it('القيمة غير الرقمية أو السالبة مرفوضة (لا تصير 0 بصمت)', () => {
    expect(leadInputError({ ...base, est_value: Number('abc') })).toContain('رقم');
    expect(leadInputError({ ...base, est_value: -1 })).toContain('سالبة');
    expect(leadInputError(base)).toBeNull();
  });
});

describe('اليوم بتوقيت الرياض', () => {
  it('عملية 01:00 بتوقيت المملكة تقع في يومها', () => {
    expect(riyadhDay('2026-11-08T22:30:00Z')).toBe('2026-11-09');
    expect(riyadhDay('2026-11-09T20:59:00Z')).toBe('2026-11-09');
    expect(riyadhDay('2026-11-09T21:00:00Z')).toBe('2026-11-10');
  });
});
