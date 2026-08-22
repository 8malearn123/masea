import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { QUERY_DEFAULTS } from '@/shared/lib/queryKeys';
import {
  addCampaign,
  listCampaigns,
  listLoyaltyTxns,
  listReferrals,
  removeCampaign,
  updateCampaign,
} from '@/features/loyalty/api/loyalty.api';
import {
  addWheelPrize,
  getAccount,
  listLoyaltyCustomers,
  listWheelPrizes,
  redeemPoints,
  removeWheelPrize,
  spinWheel,
  updateWheelPrize,
} from '@/features/loyalty/data/engine';
import type {
  Campaign,
  CampaignInput,
  WheelPrize,
  WheelPrizeInput,
} from '@/features/loyalty/types';

const ACCOUNT_KEY = ['loyalty', 'account'] as const;
const PRIZES_KEY = ['loyalty', 'wheel-prizes'] as const;
const CAMPAIGNS_KEY = ['loyalty', 'campaigns'] as const;

export function useLoyaltyTxns() {
  return useQuery({
    queryKey: ['loyalty', 'txns'],
    queryFn: listLoyaltyTxns,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useCampaigns() {
  return useQuery({
    queryKey: CAMPAIGNS_KEY,
    queryFn: listCampaigns,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useAddCampaign() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<Campaign, Error, CampaignInput>({
    mutationFn: async (input) => addCampaign(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CAMPAIGNS_KEY });
      toast.success('تمت إضافة الحملة');
    },
    onError: (e) => toast.error(e.message || 'تعذّرت إضافة الحملة'),
  });
}

export function useUpdateCampaign() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<Campaign, Error, { id: string; patch: Partial<CampaignInput> }>({
    mutationFn: async ({ id, patch }) => updateCampaign(id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CAMPAIGNS_KEY });
    },
    onError: (e) => toast.error(e.message || 'تعذّر تعديل الحملة'),
  });
}

export function useRemoveCampaign() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => removeCampaign(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CAMPAIGNS_KEY });
      toast.success('تم حذف الحملة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر حذف الحملة'),
  });
}

export function useReferrals() {
  return useQuery({
    queryKey: ['loyalty', 'referrals'],
    queryFn: listReferrals,
    staleTime: QUERY_DEFAULTS.staleTime,
  });
}

export function useLoyaltyCustomers() {
  return useQuery({
    queryKey: ['loyalty', 'customers'],
    queryFn: async () => listLoyaltyCustomers(),
    staleTime: 0,
  });
}

export function useLoyaltyAccount(customerId?: string) {
  return useQuery({
    queryKey: [...ACCOUNT_KEY, customerId ?? 'primary'],
    queryFn: async () => getAccount(customerId),
    staleTime: 0,
  });
}

export function useRedeemPoints(customerId?: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<number, Error, number>({
    mutationFn: async (points) => redeemPoints(points, customerId),
    onSuccess: (value) => {
      void qc.invalidateQueries({ queryKey: ACCOUNT_KEY });
      void qc.invalidateQueries({ queryKey: ['loyalty', 'customers'] });
      toast.success(`تم الاستبدال — رصيد ${value.toFixed(2)} ر.س في المحفظة`);
    },
    onError: (e) => toast.error(e.message || 'تعذّر استبدال النقاط'),
  });
}

export function useSpinWheel(customerId?: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<WheelPrize, Error, void>({
    mutationFn: async () => spinWheel(customerId),
    onSuccess: (prize) => {
      void qc.invalidateQueries({ queryKey: ACCOUNT_KEY });
      void qc.invalidateQueries({ queryKey: ['loyalty', 'customers'] });
      toast.success(
        prize.prize_type === 'none' ? 'حظ أوفر المرة القادمة!' : `مبروك! ربحت: ${prize.label}`,
      );
    },
    onError: (e) => toast.error(e.message || 'تعذّر تشغيل العجلة'),
  });
}

// --------------------------- wheel prize admin ---------------------------
export function useWheelPrizes() {
  return useQuery({ queryKey: PRIZES_KEY, queryFn: async () => listWheelPrizes(), staleTime: 0 });
}

export function useAddWheelPrize() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<WheelPrize, Error, WheelPrizeInput>({
    mutationFn: async (input) => addWheelPrize(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PRIZES_KEY });
      toast.success('تمت إضافة الجائزة');
    },
    onError: (e) => toast.error(e.message || 'تعذّرت إضافة الجائزة'),
  });
}

export function useUpdateWheelPrize() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<WheelPrize, Error, { id: string; patch: Partial<WheelPrizeInput> }>({
    mutationFn: async ({ id, patch }) => updateWheelPrize(id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PRIZES_KEY });
    },
    onError: (e) => toast.error(e.message || 'تعذّر تعديل الجائزة'),
  });
}

export function useRemoveWheelPrize() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => removeWheelPrize(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PRIZES_KEY });
      toast.success('تم حذف الجائزة');
    },
    onError: (e) => toast.error(e.message || 'تعذّر حذف الجائزة'),
  });
}
