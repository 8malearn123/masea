import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';
import { EXPIRY_WINDOW_KEY, RENEWAL_WINDOW_DAYS } from '@/features/contracts/lib/contractInsights';

export interface ExpiryWindow {
  /** مهلة التنبيه بالأيام. */
  days: number;
  /** true إذا كانت القيمة من إعدادات النظام، false إذا كانت القيمة الافتراضية. */
  configured: boolean;
  /** الإعدادات لم تُحمَّل بعد — لا تُعرض أعداد بالقيمة الافتراضية مؤقتًا. */
  isLoading: boolean;
}

/**
 * مهلة تنبيه انتهاء العقود — مصدر واحد لصفحة العقود ولوحة التحكم.
 * تُقرأ من إعدادات النظام (`contract_expiry_alert_days`)؛ إن لم يوجد المفتاح أو
 * كانت قيمته غير صالحة تُستخدم القيمة الافتراضية مع الإفصاح عن ذلك (configured=false).
 */
export function useExpiryWindow(): ExpiryWindow {
  const { data: config = [], isLoading } = useConfig();
  const has = config.some((c) => c.key === EXPIRY_WINDOW_KEY);
  const value = configValue(config, EXPIRY_WINDOW_KEY, RENEWAL_WINDOW_DAYS);
  const valid = Number.isFinite(value) && value >= 0;
  return {
    days: valid ? Math.floor(value) : RENEWAL_WINDOW_DAYS,
    configured: has && valid,
    isLoading,
  };
}
