import { Hammer } from 'lucide-react';
import PageHeader from '@/components/PageHeader';

export default function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <PageHeader title={title} subtitle="هذه الوحدة قيد التطوير" />
      <div className="card flex flex-col items-center justify-center py-20 text-center">
        <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-navy-50 text-navy">
          <Hammer size={24} strokeWidth={1.6} />
        </span>
        <p className="text-sm text-purple">سيتم بناء واجهة «{title}» على نفس نمط وحدة العقود.</p>
      </div>
    </div>
  );
}
