import { describe, expect, it } from 'vitest';
import { SERVICE_FLOWS, SERVICE_CODES } from '@/lib/wizardConfig';
import { beneficiarySummary, emptyDraft } from '@/lib/orderTypes';

describe('order wizard — beneficiary step', () => {
  it('opens every service flow with نوع المستفيد', () => {
    for (const code of SERVICE_CODES) {
      expect(SERVICE_FLOWS[code][0]?.key).toBe('beneficiary');
    }
  });

  it('summarises the beneficiary and, for events only, the event type', () => {
    const home = {
      ...emptyDraft('daily_rental'),
      beneficiaryType: 'home',
      beneficiaryLabel: 'منزل',
    };
    expect(beneficiarySummary(home)).toBe('منزل');

    const wedding = {
      ...emptyDraft('daily_rental'),
      beneficiaryType: 'event',
      beneficiaryLabel: 'مناسبة أو فعالية',
      eventType: 'wedding',
      eventLabel: 'حفل زواج',
    };
    expect(beneficiarySummary(wedding)).toBe('مناسبة أو فعالية — حفل زواج');
    expect(beneficiarySummary(emptyDraft('recruitment'))).toBe('—');
  });
});
