import { CodeScanner } from '@/shared/ui/CodeScanner';
import { findWorkerByCode, OUT_OF_BRANCH } from '@/features/housing/api/housing.api';
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
      onCode={async (code) => {
        // البحث في الخادم ضمن نطاق المستخدم (find_worker_by_code، 0082)
        const { resident, outOfScope } = await findWorkerByCode(code);
        if (resident) onResolved(resident);
        return resident ? true : outOfScope ? OUT_OF_BRANCH : false;
      }}
    />
  );
}
