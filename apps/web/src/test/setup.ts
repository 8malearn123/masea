import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

/**
 * Mock the Supabase client so unit tests never touch the network: every query
 * resolves immediately with an "ignorable" error, which deterministically
 * drives the demo-fallback path the app uses offline. Both import paths
 * (`@/shared/lib/supabase` and the `@/lib/supabase` re-export) are covered.
 */
vi.mock('@/shared/lib/supabase', () => {
  const result = { data: null, error: { message: 'relation does not exist' } };
  const makeChain = (): unknown => {
    const promise = Promise.resolve(result);
    return new Proxy(() => undefined, {
      get(_t, prop) {
        if (prop === 'then') return promise.then.bind(promise);
        if (prop === 'catch') return promise.catch.bind(promise);
        if (prop === 'finally') return promise.finally.bind(promise);
        return () => makeChain();
      },
      apply() {
        return makeChain();
      },
    });
  };
  return {
    supabase: {
      from: () => makeChain(),
      rpc: () => Promise.resolve(result),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
    },
  };
});
