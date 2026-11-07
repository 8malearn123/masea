import { CodeScanner } from '@/shared/ui/CodeScanner';
import { resolveWorkerByBarcode } from '@/features/housing/api/housing.api';
import type { Resident } from '@/features/housing/types';

/**
 * Worker barcode scanner (housing / trips): the shared CodeScanner resolved to a
 * worker by barcode or iqama number. Calls `onResolved` with the matched worker.
 */
export function BarcodeScanner({ onResolved }: { onResolved: (worker: Resident) => void }) {
  return (
    <CodeScanner
      placeholder="أدخل الباركود أو رقم الإقامة يدوياً"
      notFoundText="لا توجد عاملة بهذا الباركود."
      onCode={(code) => {
        const w = resolveWorkerByBarcode(code);
        if (w) onResolved(w);
        return !!w;
      }}
    />
  );
}
