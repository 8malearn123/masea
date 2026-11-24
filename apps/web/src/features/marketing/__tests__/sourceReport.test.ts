import { describe, expect, it } from 'vitest';
import {
  campaignStatus,
  computeSourceReport,
  type ReportData,
} from '@/features/marketing/api/analytics.api';

const base = { from: '2026-11-01', to: '2026-11-30', branch: null, service: null } as const;
const k = (o: Partial<ReportData['contracts'][number]>): ReportData['contracts'][number] => ({
  id: 'k',
  customer_id: 'c1',
  status: 'draft',
  created_at: '2026-11-10T09:00:00Z',
  total_amount: 1150,
  base_amount: 1000,
  amount_paid: 0,
  service_code: 'monthly_rental',
  created_by: null,
  branch: 'نجران',
  ...o,
});

const data: ReportData = {
  leads: [
    {
      source_code: 'snapchat',
      customer_id: 'c1',
      created_at: '2026-11-02T10:00:00Z',
      branch: 'نجران',
      service_code: 'monthly_rental',
    },
    {
      source_code: 'snapchat',
      customer_id: null,
      created_at: '2026-11-03T10:00:00Z',
      branch: 'نجران',
      service_code: 'monthly_rental',
    },
    {
      source_code: 'tiktok',
      customer_id: null,
      created_at: '2026-11-04T10:00:00Z',
      branch: 'جازان',
      service_code: 'daily_rental',
    },
  ],
  contracts: [
    k({
      id: 'k1',
      status: 'signed',
      amount_paid: 600,
      acquisition_source_code: 'snapchat',
      source_code: 'snapchat',
      credit_net: 100,
    }),
    k({
      id: 'k2',
      created_at: '2026-11-20T09:00:00Z',
      acquisition_source_code: 'snapchat',
      source_code: 'tiktok',
    }),
    k({ id: 'k3', customer_id: 'c9', status: 'cancelled', acquisition_source_code: 'snapchat' }),
    k({ id: 'k4', customer_id: 'c8', acquisition_source_code: null, source_code: null }),
  ],
  customers: [{ id: 'c1', source_code: 'snapchat', first_contact_at: '2026-11-02', branch: null }],
  spend: [
    {
      campaign_id: 'cp',
      platform_code: 'snapchat',
      branch: null,
      service_codes: [],
      spend_date: '2026-11-05',
      amount: 2000,
    },
  ],
};

describe('source report (mirror of 0099)', () => {
  it('separates value, revenue and collected; counts the customer once', () => {
    const rows = computeSourceReport(data, { ...base, model: 'acquisition' });
    const snap = rows.find((r) => r.source_code === 'snapchat')!;
    expect(snap.contracts).toBe(2); // cancelled excluded
    expect(snap.new_customers).toBe(1);
    expect(snap.contract_value).toBe(2300);
    expect(snap.revenue).toBe(900); // only the signed one, minus its credit note
    expect(snap.collected).toBe(600);
    expect(snap.leads).toBe(2);
    expect(snap.converted_leads).toBe(1);
    expect(snap.conversion_rate).toBe(0.5);
    expect(snap.cpl).toBe(1000);
    expect(snap.cac).toBe(2000);
    expect(snap.roas).toBe(0.45);
    // the legacy contract without a source stays «غير محدد»
    expect(rows.find((r) => r.source_code === null)?.contracts).toBe(1);
  });

  it('the contract model moves the second contract to TikTok without changing the customer', () => {
    const rows = computeSourceReport(data, { ...base, model: 'contract' });
    expect(rows.find((r) => r.source_code === 'tiktok')?.contracts).toBe(1);
    expect(rows.find((r) => r.source_code === 'tiktok')?.roas).toBeNull(); // no spend → no ROAS
    expect(rows.find((r) => r.source_code === 'snapchat')?.contracts).toBe(1);
  });

  it('filters by branch and service', () => {
    const rows = computeSourceReport(data, {
      ...base,
      branch: 'جازان',
      service: 'daily_rental',
      model: 'acquisition',
    });
    expect(rows.find((r) => r.source_code === 'tiktok')?.leads).toBe(1);
    expect(rows.find((r) => r.source_code === 'snapchat')?.leads ?? 0).toBe(0);
  });

  it('a campaign is not active after its end date', () => {
    const now = '2026-11-24T00:00:00Z';
    expect(
      campaignStatus({ is_active: true, start_at: '2026-11-01', end_at: '2026-11-20' }, now),
    ).toBe('ended');
    expect(
      campaignStatus(
        {
          is_active: true,
          start_at: '2026-11-01',
          end_at: '2026-11-20',
          extended_until: '2026-12-01',
        },
        now,
      ),
    ).toBe('active');
    expect(
      campaignStatus({ is_active: false, start_at: '2026-11-01', end_at: '2026-12-20' }, now),
    ).toBe('paused');
    expect(
      campaignStatus({ is_active: true, start_at: '2026-12-01', end_at: '2026-12-20' }, now),
    ).toBe('scheduled');
  });
});
