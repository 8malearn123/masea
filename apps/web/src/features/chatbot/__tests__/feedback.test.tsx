/**
 * ملاحظات العملاء المرتبطة بالطلب (المرحلة الحادية عشرة): خدمة الملاحظات،
 * صياغة التأكيد الدقيقة، صندوق الموظفين، وإمكانية الوصول في لوحة المساعد.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/shared/ui';
import * as feedbackService from '@/features/chatbot/services/feedbackService';
import {
  feedbackConfirmation,
  listFeedback,
  requestNoIn,
  submitFeedback,
  updateFeedbackStatus,
} from '@/features/chatbot/services/feedbackService';
import { ChatWidget } from '@/features/chatbot/components/ChatWidget';
import { FeedbackInbox } from '@/features/chatbot/components/FeedbackInbox';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SEED_REQ = 'REQ-2A7F41C9'; // طلب العرض الجاهز

function wrap(ui: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <Routes>
            <Route path="*" element={ui} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('خدمة الملاحظات', () => {
  it('تُربط بالطلب إذا كان موجودًا، وإلا «ملاحظة عامة» دون اختلاق رقم', async () => {
    const linked = await submitFeedback({
      kind: 'comment',
      body: 'أحتاج تعديل الموعد',
      contextRequestNo: SEED_REQ,
    });
    expect(linked.note).toMatchObject({ request_no: SEED_REQ, status: 'new', kind: 'comment' });
    expect(linked.note.id).toMatch(/^NOTE-\d{4}$/);

    const general = await submitFeedback({ kind: 'comment', body: 'اقتراح عام' });
    expect(general.note.request_no).toBeNull();
    expect(general.unknownRequestNo).toBeNull();

    const unknown = await submitFeedback({ kind: 'comment', body: 'بخصوص REQ-00000000' });
    expect(unknown.note.request_no).toBeNull();
    expect(unknown.unknownRequestNo).toBe('REQ-00000000');
  });

  it('رقم الطلب المكتوب في النص يُقدَّم على سياق الصفحة', async () => {
    expect(requestNoIn(`طلبي رقم ${SEED_REQ.toLowerCase()} لو سمحت`)).toBe(SEED_REQ);
    const r = await submitFeedback({
      kind: 'comment',
      body: `بخصوص ${SEED_REQ}`,
      contextRequestNo: 'REQ-11111111',
    });
    expect(r.note.request_no).toBe(SEED_REQ);
  });

  it('أرقام مرجعية فريدة وثابتة، وتحقق من النص', async () => {
    const a = await submitFeedback({ kind: 'comment', body: 'أ' });
    const b = await submitFeedback({ kind: 'comment', body: 'ب' });
    expect(a.note.id).not.toBe(b.note.id);
    await expect(submitFeedback({ kind: 'comment', body: '   ' })).rejects.toThrow('اكتب ملاحظتك');
    await expect(submitFeedback({ kind: 'comment', body: 'ا'.repeat(1001) })).rejects.toThrow(
      '1000',
    );
  });

  it('صياغة التأكيد دقيقة: صندوق ملاحظات العرض، لا إرسال لفريق حقيقي', async () => {
    const linked = feedbackConfirmation(
      await submitFeedback({ kind: 'comment', body: 'x', contextRequestNo: SEED_REQ }),
    );
    expect(linked).toContain(`ومرتبطة بالطلب ${SEED_REQ}`);
    expect(linked).toContain('لا تُرسل لفريق خدمة عملاء حقيقي');
    expect(linked).not.toContain('سيصل');
    const general = feedbackConfirmation(await submitFeedback({ kind: 'comment', body: 'y' }));
    expect(general).toContain('كملاحظة عامة غير مرتبطة بطلب');
    const missing = feedbackConfirmation(
      await submitFeedback({ kind: 'comment', body: 'REQ-00000000' }),
    );
    expect(missing).toContain('لم نعثر على الطلب REQ-00000000');
  });

  it('القائمة الأحدث أولًا وتغيير الحالة', async () => {
    const r = await submitFeedback({ kind: 'comment', body: 'للمراجعة' });
    const list = await listFeedback();
    expect(list[0]?.id).toBe(r.note.id);
    expect(await updateFeedbackStatus(r.note.id, 'closed')).toMatchObject({ status: 'closed' });
    await expect(updateFeedbackStatus('NOTE-9999', 'closed')).rejects.toThrow('غير موجودة');
  });
});

describe('لوحة المساعد', () => {
  it('حوار معنون، يُغلق بـ Escape، والتركيز يدخل الحقل ثم يعود للزر', async () => {
    const user = userEvent.setup();
    render(wrap(<ChatWidget />));
    const launcher = screen.getByRole('button', { name: 'فتح مساعد العملاء' });
    expect(launcher).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(launcher);
    const dialog = screen.getByRole('dialog', { name: /مساعد/ });
    expect(within(dialog).getByLabelText('سؤالك للمساعد')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'فتح مساعد العملاء' })).toHaveFocus();
  });

  it('ملاحظة من صفحة ملف الطلب تُربط بالطلب برسالة دقيقة', async () => {
    const user = userEvent.setup();
    render(wrap(<ChatWidget />, `/order/request/${SEED_REQ}`));
    await user.click(screen.getByRole('button', { name: 'فتح مساعد العملاء' }));
    await user.click(screen.getByRole('button', { name: 'كتابة ملاحظة' }));
    expect(screen.getByText(new RegExp(`تُربط بالطلب ${SEED_REQ}`))).toBeInTheDocument();
    await user.type(screen.getByLabelText('نص الملاحظة'), 'العاملة وصلت متأخرة{Enter}');
    expect(await screen.findByText(new RegExp(`ومرتبطة بالطلب ${SEED_REQ}`))).toBeInTheDocument();
    expect(screen.queryByText(/سيصل فريق/)).toBeNull();
    const latest = (await listFeedback())[0]!;
    expect(latest).toMatchObject({ body: 'العاملة وصلت متأخرة', request_no: SEED_REQ });
  });
});

describe('صندوق ملاحظات الموظفين', () => {
  it('يعرض الرقم المرجعي والطلب المرتبط أو «ملاحظة عامة» والحالة والوسم التجريبي', async () => {
    render(wrap(<FeedbackInbox />));
    expect(await screen.findByText(/صندوق تجريبي/)).toBeInTheDocument();
    const linked = await screen.findByRole('listitem', { name: 'ملاحظة NOTE-0002' });
    expect(within(linked).getByRole('link', { name: /الطلب/ })).toHaveAttribute(
      'href',
      `/order/request/${SEED_REQ}`,
    );
    expect(linked).toHaveTextContent('قيد المراجعة');
    const general = screen.getByRole('listitem', { name: 'ملاحظة NOTE-0001' });
    expect(general).toHaveTextContent('ملاحظة عامة — غير مرتبطة بطلب');
    expect(general).toHaveTextContent('استفسار لم يُجب');
  });

  it('حالة الخطأ قابلة لإعادة المحاولة', async () => {
    const spy = vi.spyOn(feedbackService, 'listFeedback').mockRejectedValueOnce(new Error('x'));
    render(wrap(<FeedbackInbox />));
    expect(await screen.findByText('تعذّر تحميل الملاحظات.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByText(/NOTE-0001/)).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('حالة «لا توجد ملاحظات»', async () => {
    vi.spyOn(feedbackService, 'listFeedback').mockResolvedValue([]);
    render(wrap(<FeedbackInbox />));
    expect(await screen.findByText('لا توجد ملاحظات بعد')).toBeInTheDocument();
  });
});
