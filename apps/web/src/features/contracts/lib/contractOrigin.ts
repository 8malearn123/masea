import type { ContractOrigin, ContractServiceCode } from '@/features/contracts/types';

/**
 * Default per-service contract origin for ماسية الشرق.
 *   • استقدام + نقل كفالة → مساند (العقد يُنشأ ويُوقّع على منصة مساند)
 *   • تأجير شهري/يومي     → داخلي (كامل دورة الحياة على نظامنا)
 *
 * This is the demo/offline fallback only. The live source of truth is the
 * managed `services.contract_origin` column (0049), read via `useServiceOrigins`.
 */
export const DEFAULT_SERVICE_ORIGIN: Record<ContractServiceCode, ContractOrigin> = {
  recruitment: 'musaned',
  sponsorship_transfer: 'musaned',
  monthly_rental: 'internal',
  daily_rental: 'internal',
};

export type ServiceOriginMap = Record<string, ContractOrigin>;

/** Resolve a service code to its contract origin, using the managed map first. */
export function originOf(
  map: ServiceOriginMap | undefined,
  serviceCode: string | null | undefined,
): ContractOrigin {
  if (!serviceCode) return 'internal';
  return (
    map?.[serviceCode] ?? DEFAULT_SERVICE_ORIGIN[serviceCode as ContractServiceCode] ?? 'internal'
  );
}

/** True when the contract's paperwork lives on منصة مساند, not our system. */
export function isMusaned(
  map: ServiceOriginMap | undefined,
  serviceCode: string | null | undefined,
): boolean {
  return originOf(map, serviceCode) === 'musaned';
}
