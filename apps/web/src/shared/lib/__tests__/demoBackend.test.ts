import { describe, expect, it } from 'vitest';
import { isIgnorableWriteError } from '@/shared/lib/demoBackend';

describe('isIgnorableWriteError', () => {
  it('treats the demo-mode offline guard as non-fatal (with or without the AbortError prefix)', () => {
    expect(isIgnorableWriteError('AbortError: demo mode — offline')).toBe(true);
    expect(isIgnorableWriteError('demo mode — offline')).toBe(true);
  });

  it('surfaces real business errors from the backend', () => {
    expect(isIgnorableWriteError('لا يمكن تأكيد التوقيع قبل توقيع الطرفين')).toBe(false);
    expect(isIgnorableWriteError('new row violates row-level security policy')).toBe(false);
  });
});
