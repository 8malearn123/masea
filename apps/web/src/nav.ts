import {
  AlertTriangle,
  Building2,
  Bus,
  Clock,
  CreditCard,
  FileText,
  HardHat,
  Home,
  LayoutDashboard,
  Megaphone,
  ReceiptText,
  ScanLine,
  Settings2,
  Star,
  Target,
  UserCog,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { AppRole } from '@masiat/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: AppRole[]; // undefined = everyone
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    title: 'الرئيسية',
    items: [{ to: '/', label: 'لوحة التحكم', icon: LayoutDashboard }],
  },
  {
    title: 'العمليات',
    items: [
      { to: '/workers', label: 'العمالة', icon: HardHat },
      { to: '/customers', label: 'العملاء', icon: Users },
      { to: '/contracts', label: 'العقود', icon: FileText },
      { to: '/drivers', label: 'السائقون', icon: Bus },
      { to: '/scans', label: 'سجل المسح', icon: ScanLine },
    ],
  },
  {
    title: 'المالية',
    items: [
      { to: '/payments', label: 'المدفوعات', icon: CreditCard },
      { to: '/penalties', label: 'الغرامات', icon: AlertTriangle },
    ],
  },
  {
    title: 'الموارد البشرية',
    items: [
      {
        to: '/employees',
        label: 'الموظفون',
        icon: UserCog,
        roles: ['admin', 'hr', 'operations_manager'],
      },
      { to: '/payroll', label: 'الرواتب', icon: ReceiptText, roles: ['admin', 'hr', 'accountant'] },
      {
        to: '/attendance',
        label: 'الحضور',
        icon: Clock,
        roles: ['admin', 'hr', 'operations_manager'],
      },
    ],
  },
  {
    title: 'التسويق والولاء',
    items: [
      { to: '/loyalty', label: 'الولاء', icon: Star },
      { to: '/campaigns', label: 'الحملات', icon: Megaphone },
    ],
  },
  {
    title: 'الأهداف والسكن',
    items: [
      { to: '/targets', label: 'الأهداف', icon: Target },
      {
        to: '/housing',
        label: 'السكن',
        icon: Home,
        roles: ['admin', 'housing_supervisor', 'operations_manager'],
      },
    ],
  },
  {
    title: 'النظام',
    items: [
      { to: '/branches', label: 'الفروع', icon: Building2, roles: ['admin', 'operations_manager'] },
      { to: '/users', label: 'المستخدمون', icon: UserRound, roles: ['admin'] },
      { to: '/settings', label: 'الإعدادات', icon: Settings2 },
    ],
  },
];

export function visibleFor(role: AppRole | undefined, item: NavItem): boolean {
  if (!item.roles) return true;
  if (!role) return false;
  return item.roles.includes(role);
}
