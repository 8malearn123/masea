import { CalendarCheck } from 'lucide-react';
import { AttendanceTab } from '@/features/housing/components/AttendanceTab';

/** Standalone page for daily attendance (sidebar entry). */
export default function AttendancePage() {
  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <CalendarCheck size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">تحضير العاملات</h1>
          <p className="text-sm text-purple">
            سجّل حالة كل عاملة اليوم: حاضرة، غائبة، في خدمة، أو إجازة.
          </p>
        </div>
      </div>
      <AttendanceTab />
    </div>
  );
}
