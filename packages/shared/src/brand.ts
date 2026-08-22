/**
 * Masiat Alsharq — Brand system
 * Client: Masiat Alsharq Recruitment Co. (ماسية الشرق للاستقدام)
 * Vendor: Qimmah Code (قمة كود) — Contract QUO-000105
 */

export const BRAND = {
  client: {
    nameAr: 'ماسية الشرق للاستقدام',
    nameEn: 'Masiat Alsharq Recruitment Co.',
  },
  vendor: {
    nameAr: 'قمة كود',
    nameEn: 'Qimmah Code',
  },
  contract: 'QUO-000105',
  colors: {
    navy: '#1B1564',   // product primary
    gold: '#C8970A',   // product accent
    purple: '#564E85', // UI vendor primary
    teal: '#58B3B3',   // UI vendor secondary
  },
  fonts: {
    sans: 'Alexandria',
    mono: 'JetBrains Mono',
  },
  direction: 'rtl' as const,
} as const;

export const BRANCHES = ['نجران', 'جازان', 'شرورة', 'حبونا'] as const;
export type BranchName = (typeof BRANCHES)[number];

/** VAT rate used across contracts (15% KSA). */
export const VAT_RATE = 0.15;

/** GOSI contribution rates. */
export const GOSI = {
  saudi: { employee: 0.0975, company: 0.1175 },
  nonSaudi: { employee: 0, company: 0.02 },
} as const;
