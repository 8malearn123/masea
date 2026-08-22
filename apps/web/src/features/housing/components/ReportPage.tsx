import { BarChart3 } from 'lucide-react';
import { HousingReport } from '@/features/housing/components/HousingReport';

/** Standalone page for the housing report (sidebar entry). */
export default function ReportPage() {
  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <BarChart3 size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">تقرير السكن</h1>
          <p className="text-sm text-purple">
            توزيع حالات العاملات ونسبة الحضور وآخر حركات الدخول والخروج.
          </p>
        </div>
      </div>
      <HousingReport />
    </div>
  );
}
