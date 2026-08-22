import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}
interface State {
  hasError: boolean;
}

/** App-level error boundary — prevents the white screen of death. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // TODO(monitoring): forward to Sentry once a DSN is configured.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="grid min-h-screen place-items-center bg-navy-50 p-6 text-center">
          <div className="rounded-2xl bg-white p-8 shadow-card">
            <div className="text-4xl">😵</div>
            <h1 className="mt-3 text-lg font-bold text-navy">حدث خطأ غير متوقع</h1>
            <p className="mt-1 text-sm text-purple">نعتذر، حدث خلل في التطبيق.</p>
            <button
              onClick={() => window.location.reload()}
              className="btn-primary mt-5"
              type="button"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
