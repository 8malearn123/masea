import { create } from 'zustand';

/**
 * The customer's beneficiary choice made before the wizard (e.g. in the worker
 * catalog's filters panel). OrderWizard seeds the new draft from it so the
 * «نوع المستفيد» step opens already answered — the customer can still change it.
 */
export interface BeneficiaryIntent {
  beneficiaryType: string;
  beneficiaryLabel: string;
  eventType: string;
  eventLabel: string;
}

const EMPTY: BeneficiaryIntent = {
  beneficiaryType: '',
  beneficiaryLabel: '',
  eventType: '',
  eventLabel: '',
};

interface OrderIntentState extends BeneficiaryIntent {
  setIntent: (patch: Partial<BeneficiaryIntent>) => void;
  clearIntent: () => void;
}

export const useOrderIntent = create<OrderIntentState>((set) => ({
  ...EMPTY,
  setIntent: (patch) => set(patch),
  clearIntent: () => set(EMPTY),
}));
