import type { ReportsData } from '@/features/reports/types';

const DATA: ReportsData = {
  monthly: [
    { month: 'يناير', contracts: 38, revenue: 342000 },
    { month: 'فبراير', contracts: 45, revenue: 405000 },
    { month: 'مارس', contracts: 52, revenue: 489000 },
    { month: 'أبريل', contracts: 41, revenue: 376000 },
    { month: 'مايو', contracts: 58, revenue: 531000 },
    { month: 'يونيو', contracts: 49, revenue: 462000 },
  ],
  branches: [
    { branch: 'نجران', contracts: 112, revenue: 1024000 },
    { branch: 'جازان', contracts: 86, revenue: 798000 },
    { branch: 'شرورة', contracts: 41, revenue: 372000 },
    { branch: 'حبونا', contracts: 44, revenue: 411000 },
  ],
  services: [
    { name: 'استقدام', value: 168 },
    { name: 'تأجير شهري', value: 74 },
    { name: 'خدمة يومية', value: 31 },
    { name: 'نقل كفالة', value: 10 },
  ],
};

export async function getReports(): Promise<ReportsData> {
  return DATA;
}
