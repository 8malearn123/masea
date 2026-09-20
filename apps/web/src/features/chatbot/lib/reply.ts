/**
 * مطابقة سؤال العميل مع نيّات قاعدة المعرفة (Prototype — بلا نموذج خارجي).
 * التطبيع العربي يوحّد الهمزات والتاء المربوطة والألف المقصورة ويزيل التشكيل،
 * حتى يتطابق «مناسبة» مع «مناسبه» و«إستقدام» مع «استقدام».
 */
import { CHAT_FALLBACK, CHAT_INTENTS, type ChatIntent } from '@/features/chatbot/api/chatbot.api';

export function normalizeAr(text: string): string {
  return text
    .replace(/[ً-ْـ]/g, '') // تشكيل وتطويل
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export interface ChatAnswer {
  /** النيّة المطابقة — null عند عدم وجود مطابقة. */
  intent: ChatIntent | null;
  text: string;
  followUps: string[];
}

/** أفضل نيّة مطابقة للسؤال: الأعلى عدد كلمات مفتاحية مطابقة، ثم الأطول. */
export function matchIntent(
  question: string,
  intents: ChatIntent[] = CHAT_INTENTS,
): ChatIntent | null {
  const q = normalizeAr(question);
  if (!q) return null;
  let best: ChatIntent | null = null;
  let bestScore = 0;
  for (const intent of intents) {
    let score = 0;
    for (const keyword of intent.keywords) {
      const k = normalizeAr(keyword);
      if (k && q.includes(k)) score += k.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = intent;
    }
  }
  return best;
}

export function answerFor(question: string, intents: ChatIntent[] = CHAT_INTENTS): ChatAnswer {
  const intent = matchIntent(question, intents);
  if (!intent) return { intent: null, text: CHAT_FALLBACK, followUps: [] };
  return { intent, text: intent.answer, followUps: intent.followUps ?? [] };
}
