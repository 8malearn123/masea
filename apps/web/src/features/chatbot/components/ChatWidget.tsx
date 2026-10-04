import { useEffect, useRef, useState } from 'react';
import { Bot, MessageSquare, NotebookPen, Send, UserRound, X } from 'lucide-react';
import { BRAND } from '@masiat/shared';
import {
  CHAT_GREETING,
  CHAT_SUGGESTIONS,
  saveCustomerNote,
} from '@/features/chatbot/api/chatbot.api';
import { answerFor } from '@/features/chatbot/lib/reply';

interface ChatMessage {
  id: number;
  from: 'bot' | 'user';
  text: string;
  followUps?: string[];
}

type Mode = 'chat' | 'comment';

let msgSeq = 0;
const nextId = () => ++msgSeq;

/**
 * مساعد العميل: يجيب عن الاستفسارات من قاعدة معرفة ماسية الشرق، ويستقبل
 * تعليقات العملاء ويعطيها رقمًا مرجعيًا. يظهر في صفحات العميل فقط.
 */
export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('chat');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: nextId(), from: 'bot', text: CHAT_GREETING, followUps: CHAT_SUGGESTIONS },
  ]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // scrollIntoView غير متاح في كل البيئات (jsdom مثلًا) — التمرير تحسين لا شرط.
    if (open && typeof endRef.current?.scrollIntoView === 'function') {
      endRef.current.scrollIntoView({ block: 'end' });
    }
  }, [messages, open]);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setInput('');

    if (mode === 'comment') {
      const note = saveCustomerNote('comment', text);
      setMessages((m) => [
        ...m,
        { id: nextId(), from: 'user', text },
        {
          id: nextId(),
          from: 'bot',
          text: `شكرًا لك — سُجّل تعليقك برقم ${note.id} وسيصل فريق خدمة العملاء. تحب تسأل عن شيء آخر؟`,
          followUps: CHAT_SUGGESTIONS.slice(0, 2),
        },
      ]);
      setMode('chat');
      return;
    }

    const answer = answerFor(text);
    if (!answer.intent) saveCustomerNote('inquiry', text); // استفسار لم نغطِّه — يصل للفريق
    setMessages((m) => [
      ...m,
      { id: nextId(), from: 'user', text },
      {
        id: nextId(),
        from: 'bot',
        text: answer.text,
        ...(answer.followUps.length > 0 ? { followUps: answer.followUps } : {}),
      },
    ]);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 left-4 z-40 inline-flex items-center gap-2 rounded-full bg-navy px-4 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-navy-700 lg:bottom-6"
        aria-label="فتح مساعد العملاء"
      >
        <Bot size={18} /> مساعد العملاء
      </button>
    );
  }

  return (
    <div
      dir="rtl"
      className="fixed bottom-24 left-4 z-40 flex h-[30rem] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-navy-100 lg:bottom-6"
    >
      <header className="flex items-center justify-between bg-navy px-4 py-3 text-white">
        <span className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/15">
            <Bot size={17} />
          </span>
          <span>
            <span className="block text-sm font-bold">مساعد {BRAND.client.nameAr}</span>
            <span className="block text-[10px] text-navy-100/80">يجيب فورًا · تجريبي</span>
          </span>
        </span>
        <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق المساعد">
          <X size={18} />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto bg-navy-50/60 p-3">
        {messages.map((m) => (
          <div key={m.id}>
            <div className={`flex gap-2 ${m.from === 'user' ? 'flex-row-reverse' : ''}`}>
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                  m.from === 'bot' ? 'bg-navy text-white' : 'bg-gold text-white'
                }`}
              >
                {m.from === 'bot' ? <Bot size={14} /> : <UserRound size={14} />}
              </span>
              <p
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                  m.from === 'bot'
                    ? 'bg-white text-navy-900 ring-1 ring-navy-100'
                    : 'bg-navy text-white'
                }`}
              >
                {m.text}
              </p>
            </div>
            {m.followUps && m.followUps.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 ps-9">
                {m.followUps.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => send(f)}
                    className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-navy ring-1 ring-navy-100 transition hover:bg-navy-50"
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="border-t border-navy-100 bg-white p-2.5">
        {mode === 'comment' && (
          <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-gold-100 px-2.5 py-1.5 text-[11px] text-gold-600">
            <NotebookPen size={12} /> اكتب تعليقك وسيصل فريق خدمة العملاء.
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode((x) => (x === 'comment' ? 'chat' : 'comment'))}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition ${
              mode === 'comment' ? 'bg-gold text-white' : 'bg-navy-50 text-navy hover:bg-navy-100'
            }`}
            aria-label="كتابة تعليق"
            title="كتابة تعليق"
          >
            <MessageSquare size={16} />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send(input);
            }}
            placeholder={mode === 'comment' ? 'اكتب تعليقك…' : 'اكتب سؤالك…'}
            className="flex-1 rounded-xl border border-navy-100 px-3 py-2 text-sm outline-none focus:border-navy"
          />
          <button
            type="button"
            onClick={() => send(input)}
            disabled={!input.trim()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-navy text-white transition hover:bg-navy-700 disabled:opacity-40"
            aria-label="إرسال"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
