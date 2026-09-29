import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, UserPlus } from 'lucide-react';
import { Card } from '@/shared/ui';
import { LeadForm } from '@/features/crm/components/LeadFormModal';

/** صفحة إضافة عميل محتمل جديد — تعود لأنبوب المبيعات بعد الحفظ أو الإلغاء. */
export default function LeadCreatePage() {
  const navigate = useNavigate();
  const back = () => navigate('/leads');

  return (
    <div>
      <Link
        to="/leads"
        className="mb-4 inline-flex items-center gap-1 text-sm text-purple hover:text-navy"
      >
        <ArrowRight size={16} /> العودة للعملاء المحتملين
      </Link>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-100 text-teal">
          <UserPlus size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">عميل محتمل جديد</h1>
          <p className="text-sm text-purple">أضف عميلاً محتملاً إلى خط المبيعات.</p>
        </div>
      </div>
      <Card className="max-w-2xl">
        <LeadForm lead={null} onDone={back} onCancel={back} />
      </Card>
    </div>
  );
}
