import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { ToastProvider } from '@/shared/ui';
import App from '@/App';
import './index.css';

/**
 * The real app mount. Split out of main.tsx so the whole module graph — the
 * Supabase client included — is only imported once the environment is known
 * good, and so a failure while loading it is catchable instead of blanking
 * the page.
 */
export function mount(root: HTMLElement): void {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ToastProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
