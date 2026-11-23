/** مع خادم حقيقي لا يُتجاهل أي خطأ كتابة (كان «not found» و«uuid» و«Failed to fetch» تُعرض نجاحًا). */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/env')>()),
  isBackendConfigured: true,
}));
vi.mock('@/lib/demo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/demo')>()),
  isDemoActive: () => false,
}));

import { isDemoMode, isIgnorableWriteError } from '@/shared/lib/demoBackend';

describe('isIgnorableWriteError مع خادم حقيقي', () => {
  it('كل خطأ يصل للمستخدم', () => {
    expect(isDemoMode()).toBe(false);
    for (const m of [
      'Failed to fetch',
      'invalid input syntax for type uuid: "pm-1"',
      'Bucket not found',
      'permission denied for table quotes',
      'relation "x" does not exist',
    ])
      expect(isIgnorableWriteError(m)).toBe(false);
  });
});
