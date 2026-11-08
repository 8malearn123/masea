/** Demo store of the HR reference lists (0075 seeds) — shared by the demo APIs. */
import { DEFAULT_LOOKUPS } from '@/features/hr/lib/lookups';
import type { HrLookup } from '@/features/hr/types';

export const LOOKUP_STORE: HrLookup[] = DEFAULT_LOOKUPS.map((l) => ({ ...l }));
