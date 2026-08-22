import { Target } from 'lucide-react';
import { HousingTargets } from '@/features/housing/components/HousingTargets';

/** Standalone page for the supervisor's housing targets (sidebar entry). */
export default function TargetsPage() {
  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <Target size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">مستهدفاتي</h1>
          <p className="text-sm text-purple">
            مستهدفات السكن المُسندة إليك: نسبة الإشغال والحضور والتقدّم.
          </p>
        </div>
      </div>
      <HousingTargets />
    </div>
  );
}
