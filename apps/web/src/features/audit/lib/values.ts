import { CONTRACT_STATUS_LABEL } from '@/features/contracts/lib/contractState';
import { QUOTE_STATUS_LABEL } from '@/features/crm/types';
import { ORDER_STATUS_LABEL } from '@/features/orders/lib/orderStatus';
import { ROLE_META } from '@/lib/permissions';
import { formatAuditValue } from '@/shared/lib/auditTrail';

/** قيم الحالات والأدوار بأسمائها العربية من مصادرها القائمة (لا قوائم مكرّرة). */
const STATUS_BY_ENTITY: Record<string, Record<string, string>> = {
  contracts: CONTRACT_STATUS_LABEL,
  quotes: QUOTE_STATUS_LABEL,
  service_requests: ORDER_STATUS_LABEL,
};

export function auditValueLabel(entity: string, field: string, value: unknown): string {
  if (typeof value === 'string') {
    if (field === 'status') {
      const label = STATUS_BY_ENTITY[entity]?.[value];
      if (label) return label;
    }
    if (field === 'role' || field === 'role_code') {
      const meta = ROLE_META[value as keyof typeof ROLE_META];
      if (meta) return meta.label;
    }
  }
  return formatAuditValue(value);
}
