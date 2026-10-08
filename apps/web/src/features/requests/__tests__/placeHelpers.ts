import { screen, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { addDays, today } from '@/features/requests/lib/period';

type User = ReturnType<typeof userEvent.setup>;

/** يجيب عن سؤال نعم/لا في خطوة مكان الخدمة. */
export async function answer(user: User, question: string, yes: boolean) {
  const group = await screen.findByRole('group', { name: question });
  await user.click(within(group).getByRole('button', { name: yes ? 'نعم' : 'لا' }));
}

/** أقل إجابات المنزل المطلوبة: لا أطفال ولا كبار سن. */
export async function answerHome(user: User) {
  await answer(user, 'هل يوجد أطفال؟', false);
  await answer(user, 'هل يوجد كبار سن؟', false);
}

/** تاريخ بعد n يومًا من اليوم — الاختبارات لا تتقادم مع مرور الوقت. */
export function futureDay(n: number): string {
  return addDays(today(), n);
}
