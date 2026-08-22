import {
  CalendarCheck,
  Clock,
  FileText,
  Gauge,
  HandCoins,
  IdCard,
  LayoutGrid,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type HrSection =
  | 'overview'
  | 'employees'
  | 'attendance'
  | 'leave'
  | 'payroll'
  | 'eos'
  | 'documents'
  | 'performance'
  | 'visas';

/** HR sections — surfaced as primary sidebar links under «الموارد البشرية». */
export const HR_SECTIONS: { key: HrSection; label: string; icon: LucideIcon; slug: string }[] = [
  { key: 'overview', label: 'نظرة عامة', icon: LayoutGrid, slug: '' },
  { key: 'employees', label: 'الموظفون', icon: Users, slug: 'employees' },
  { key: 'attendance', label: 'الحضور', icon: Clock, slug: 'attendance' },
  { key: 'leave', label: 'الإجازات', icon: CalendarCheck, slug: 'leave' },
  { key: 'payroll', label: 'الرواتب', icon: Wallet, slug: 'payroll' },
  { key: 'eos', label: 'نهاية الخدمة', icon: HandCoins, slug: 'eos' },
  { key: 'documents', label: 'المستندات', icon: FileText, slug: 'documents' },
  { key: 'performance', label: 'الأداء', icon: Gauge, slug: 'performance' },
  { key: 'visas', label: 'التأشيرات والإقامات', icon: IdCard, slug: 'visas' },
];

/** slug → section key (for routing). */
export function sectionFromSlug(slug: string | undefined): HrSection {
  return HR_SECTIONS.find((s) => s.slug === (slug ?? ''))?.key ?? 'overview';
}
