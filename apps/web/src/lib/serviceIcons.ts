import { CalendarDays, Plane, Repeat2, Sparkles, type LucideIcon } from 'lucide-react';
import type { ServiceCode } from '@/lib/funnel';

/** أيقونة lucide لكل خدمة (بدل إيموجي حقل `icon` في بيانات الخدمات — CLAUDE.md). */
export const SERVICE_ICON: Record<ServiceCode, LucideIcon> = {
  recruitment: Plane,
  monthly_rental: CalendarDays,
  daily_rental: Sparkles,
  sponsorship_transfer: Repeat2,
};
