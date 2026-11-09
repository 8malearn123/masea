import { BedDouble } from 'lucide-react';
import { DormsManager } from '@/features/housing/components/DormsManager';

/** صفحة «إدارة المساكن» (رابط في القائمة الجانبية لمن يملك housing.manage). */
export default function DormsPage() {
  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <BedDouble size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">إدارة المساكن</h1>
          <p className="text-sm text-purple">المساكن وسعتها ومشرفاتها — الإشغال محسوب تلقائيًا.</p>
        </div>
      </div>
      <DormsManager />
    </div>
  );
}
