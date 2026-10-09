import { AlertTriangle } from 'lucide-react';
import { Button } from '@/shared/ui/Button';

export function ErrorState({
  title = 'حدث خطأ',
  description = 'تعذّر تحميل البيانات. حاول مرة أخرى.',
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-red-100 bg-red-50/40 p-10 text-center">
      <AlertTriangle size={36} aria-hidden className="text-red-400" strokeWidth={1.6} />
      <p className="mt-3 font-bold text-red-700">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-red-600/80">{description}</p>
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          إعادة المحاولة
        </Button>
      )}
    </div>
  );
}
