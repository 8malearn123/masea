import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { execSync } from 'node:child_process';

// Build stamp shown in the header badge so the deployed build is always
// identifiable. Prefers Vercel's git env vars (available during CI builds),
// falls back to a local `git rev-parse` for `npm run build` on a workstation.
// Never hardcode a version number in the UI — this makes the badge deploy on
// its own with every push, so a stale badge now means a stale deployment.
function resolveBuildId(): string {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    (() => {
      try {
        return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      } catch {
        return '';
      }
    })();
  return sha ? sha.slice(0, 7) : 'dev';
}

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(resolveBuildId()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@masiat/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Split rarely-changing vendor libraries into their own long-cached
        // chunks so app-code deploys don't invalidate them and the browser can
        // fetch them in parallel. recharts is heavy and already splits on its
        // own via the lazy dashboards, so it gets its own bucket.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/.test(id))
            return 'vendor-react';
          if (/[\\/]node_modules[\\/](@tanstack[\\/]react-query|@supabase|zustand)[\\/]/.test(id))
            return 'vendor-data';
          if (/[\\/]node_modules[\\/]recharts[\\/]/.test(id)) return 'vendor-charts';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
