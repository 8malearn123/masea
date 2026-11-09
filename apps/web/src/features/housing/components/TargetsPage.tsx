import { Target } from 'lucide-react';
import { HousingTargets } from '@/features/housing/components/HousingTargets';
import { usePermissions } from '@/hooks/usePermissions';

/** Standalone page for the supervisor's housing targets (sidebar entry). */
export default function TargetsPage() {
  const { role } = usePermissions();
  const own = role === 'housing_supervisor';
  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <Target size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">
            {own ? 'مستهدفاتي' : 'مستهدفات مشرفات السكن'}
          </h1>
          <p className="text-sm text-purple">
            {own
              ? 'مستهدفات السكن المُسندة إليك: نسبة الإشغال والحضور والتقدّم.'
              : 'المستهدف والمحقَّق لكل مشرفة سكن ضمن نطاقك.'}
          </p>
        </div>
      </div>
      <HousingTargets />
    </div>
  );
}
