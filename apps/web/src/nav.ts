import type { AppRole } from '@masiat/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles?: AppRole[]; // undefined = everyone
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    title: 'الرئيسية',
    items: [{ to: '/', label: 'لوحة التحكم', icon: '📊' }],
  },
  {
    title: 'العمليات',
    items: [
      { to: '/workers', label: 'العمالة', icon: '👷' },
      { to: '/customers', label: 'العملاء', icon: '🧑‍💼' },
      { to: '/contracts', label: 'العقود', icon: '📄' },
      { to: '/drivers', label: 'السائقون', icon: '🚐' },
      { to: '/scans', label: 'سجل المسح', icon: '📷' },
    ],
  },
  {
    title: 'المالية',
    items: [
      { to: '/payments', label: 'المدفوعات', icon: '💳' },
      { to: '/penalties', label: 'الغرامات', icon: '⚠️' },
    ],
  },
  {
    title: 'الموارد البشرية',
    items: [
      { to: '/employees', label: 'الموظفون', icon: '🧑‍💻', roles: ['admin', 'hr', 'operations_manager'] },
      { to: '/payroll', label: 'الرواتب', icon: '🧾', roles: ['admin', 'hr', 'accountant'] },
      { to: '/attendance', label: 'الحضور', icon: '🕒', roles: ['admin', 'hr', 'operations_manager'] },
    ],
  },
  {
    title: 'التسويق والولاء',
    items: [
      { to: '/loyalty', label: 'الولاء', icon: '⭐' },
      { to: '/campaigns', label: 'الحملات', icon: '📣' },
    ],
  },
  {
    title: 'الأهداف والسكن',
    items: [
      { to: '/targets', label: 'الأهداف', icon: '🎯' },
      { to: '/housing', label: 'السكن', icon: '🏠', roles: ['admin', 'housing_supervisor', 'operations_manager'] },
    ],
  },
  {
    title: 'النظام',
    items: [
      { to: '/branches', label: 'الفروع', icon: '🏢', roles: ['admin', 'operations_manager'] },
      { to: '/users', label: 'المستخدمون', icon: '👤', roles: ['admin'] },
      { to: '/settings', label: 'الإعدادات', icon: '⚙️' },
    ],
  },
];

export function visibleFor(role: AppRole | undefined, item: NavItem): boolean {
  if (!item.roles) return true;
  if (!role) return false;
  return item.roles.includes(role);
}
