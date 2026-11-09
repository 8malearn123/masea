import { addLocalDriver } from '@/features/orders/api/orders.api';

let driverSeq = 0;

/**
 * سائق «متاح» جديد في مخزن العرض لكل اختبار: الإسناد يجعل السائق «في مهمة»
 * فلا يُعاد استخدام سائق مشغول بين الاختبارات.
 */
export function freshDriver(branch: string | null = null): string {
  driverSeq += 1;
  const id = `t-driver-${driverSeq}`;
  addLocalDriver({
    id,
    full_name: `سائق اختبار ${driverSeq}`,
    phone: null,
    branch,
    status: 'available',
    vehicle_no: null,
    rating: 5,
  });
  return id;
}
