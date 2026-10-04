import { create } from 'zustand';

/**
 * The customer's beneficiary choice made before the wizard (e.g. in the worker
 * catalog's filters panel). OrderWizard seeds the new draft's `place` from it so
 * the «نوع المستفيد» step opens already answered — the customer can still change it.
 * Codes come from the managed lists (الإعدادات → أنواع المستفيد / أنواع المناسبات).
 */
export interface BeneficiaryIntent {
  beneficiaryType: string;
  occasionType: string | null;
}

const EMPTY: BeneficiaryIntent = { beneficiaryType: '', occasionType: null };

interface OrderIntentState extends BeneficiaryIntent {
  setIntent: (patch: Partial<BeneficiaryIntent>) => void;
  clearIntent: () => void;
}

export const useOrderIntent = create<OrderIntentState>((set) => ({
  ...EMPTY,
  setIntent: (patch) => set(patch),
  clearIntent: () => set(EMPTY),
}));
