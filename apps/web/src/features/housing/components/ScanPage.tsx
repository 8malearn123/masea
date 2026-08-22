import { ScanLine } from 'lucide-react';
import { ScanStation } from '@/features/housing/components/ScanStation';

/** Standalone page for the barcode scan station (sidebar entry). */
export default function ScanPage() {
  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <ScanLine size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">مسح الباركود</h1>
          <p className="text-sm text-purple">
            امسح باركود العاملة لعرض ملفها وتسجيل دخولها وخروجها من السكن.
          </p>
        </div>
      </div>
      <ScanStation />
    </div>
  );
}
