import { envError } from '@/shared/lib/env';
import { renderBootError } from '@/app/bootError';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

if (envError) {
  renderBootError(
    root,
    'إعداد ناقص — متغيّرات البيئة',
    `${envError}\n\nSet these in your host's environment variables\n(Vercel → Settings → Environment Variables), then redeploy.\nVite inlines them at build time, so a redeploy is required.`,
  );
} else {
  // Dynamic import: defers loading the app (and everything it pulls in) until
  // the env check has passed, and turns any module-level failure downstream
  // into a visible message instead of a blank page.
  import('./bootstrap')
    .then((m) => m.mount(root))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[boot]', err);
      renderBootError(
        root,
        'فشل تحميل التطبيق',
        err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err),
      );
    });
}
