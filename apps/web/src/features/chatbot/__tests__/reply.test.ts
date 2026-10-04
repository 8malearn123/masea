import { describe, expect, it } from 'vitest';
import { answerFor, matchIntent, normalizeAr } from '@/features/chatbot/lib/reply';
import {
  CHAT_FALLBACK,
  listCustomerNotes,
  saveCustomerNote,
} from '@/features/chatbot/api/chatbot.api';

describe('مساعد العميل', () => {
  it('يوحّد الهمزات والتاء المربوطة والتشكيل', () => {
    expect(normalizeAr('إستقدام')).toBe('استقدام');
    expect(normalizeAr('مُناسبَة؟')).toBe('مناسبه');
  });

  it('يطابق السؤال مع النيّة الصحيحة رغم اختلاف الإملاء', () => {
    expect(matchIntent('ابغى استقدام عاملة')?.code).toBe('recruitment');
    expect(matchIntent('عندي مناسبه ابي احد يساعد')?.code).toBe('occasion');
    expect(matchIntent('كم السعر؟')?.code).toBe('pricing');
    expect(matchIntent('كيف اعرف ان العاملة متاحه')?.code).toBe('availability');
  });

  it('يعيد الإجابة الافتراضية لما لا يعرفه', () => {
    const a = answerFor('زذؤغ ثصقف');
    expect(a.intent).toBeNull();
    expect(a.text).toBe(CHAT_FALLBACK);
  });

  it('يرفق اقتراحات متابعة مع الإجابات التي لها متابعات', () => {
    expect(answerFor('وش الخدمات عندكم').followUps.length).toBeGreaterThan(0);
  });

  it('يسجّل تعليق العميل برقم مرجعي', () => {
    const before = listCustomerNotes().length;
    const note = saveCustomerNote('comment', 'الخدمة كانت ممتازة');
    expect(note.id).toMatch(/^NOTE-\d{4}$/);
    expect(listCustomerNotes().length).toBe(before + 1);
  });
});
