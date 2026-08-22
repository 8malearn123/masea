/**
 * Local demo mode — lets visitors explore the ERP without a real Supabase
 * account. Matching credentials produce a mock session + profile that is
 * persisted in localStorage and restored on reload. No backend required.
 */
import type { Session } from '@supabase/supabase-js';
import type { AppRole, UserProfile } from '@masiat/shared';

export interface DemoAccount {
  email: string;
  password: string;
  name: string;
  role: AppRole;
  branch: string;
  desc: string;
}

export const DEMO_PASSWORD = 'demo1234';

/** One demo account per role (section 4 of the RBAC spec). */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    email: 'gm@demo.masea',
    password: DEMO_PASSWORD,
    name: 'منصور المكرمي',
    role: 'admin',
    branch: 'نجران',
    desc: 'صلاحية كاملة + إدارة الصلاحيات',
  },
  {
    email: 'ops@demo.masea',
    password: DEMO_PASSWORD,
    name: 'فهد الشهري',
    role: 'operations_manager',
    branch: 'نجران',
    desc: 'العمليات عبر كل الفروع',
  },
  {
    email: 'branch@demo.masea',
    password: DEMO_PASSWORD,
    name: 'سعد آل مريح',
    role: 'branch_manager',
    branch: 'جازان',
    desc: 'إدارة فرعه فقط',
  },
  {
    email: 'sales@demo.masea',
    password: DEMO_PASSWORD,
    name: 'نورة العتيبي',
    role: 'sales',
    branch: 'شرورة',
    desc: 'المبيعات والعقود والتسعير',
  },
  {
    email: 'cc@demo.masea',
    password: DEMO_PASSWORD,
    name: 'ريم الزهراني',
    role: 'call_center',
    branch: 'حبونا',
    desc: 'مركز الاتصال والطلبات',
  },
  {
    email: 'driver@demo.masea',
    password: DEMO_PASSWORD,
    name: 'ماجد الحربي',
    role: 'driver',
    branch: 'نجران',
    desc: 'تطبيق الجوال فقط',
  },
  {
    email: 'housing@demo.masea',
    password: DEMO_PASSWORD,
    name: 'منى الغامدي',
    role: 'housing_supervisor',
    branch: 'جازان',
    desc: 'تطبيق السكن فقط',
  },
  {
    email: 'hr@demo.masea',
    password: DEMO_PASSWORD,
    name: 'خالد الدوسري',
    role: 'hr',
    branch: 'نجران',
    desc: 'الموارد البشرية والرواتب',
  },
  {
    email: 'acc@demo.masea',
    password: DEMO_PASSWORD,
    name: 'بدر المالكي',
    role: 'accountant',
    branch: 'نجران',
    desc: 'المالية والمدفوعات والتقارير',
  },
  {
    email: 'ext@demo.masea',
    password: DEMO_PASSWORD,
    name: 'ياسر الأنصاري',
    role: 'external_office',
    branch: 'شرورة',
    desc: 'تعديل محدود لمسار الاستقدام',
  },
];

const KEY = 'masea_demo_session';

export function findDemoAccount(email: string, password: string): DemoAccount | undefined {
  const e = email.trim().toLowerCase();
  return DEMO_ACCOUNTS.find((a) => a.email === e && a.password === password);
}

export function demoProfile(acc: DemoAccount): UserProfile {
  return {
    id: `demo-${acc.role}`,
    full_name: acc.name,
    role: acc.role,
    branch_id: null,
    is_active: true,
    created_at: new Date().toISOString(),
  };
}

export function demoSession(acc: DemoAccount): Session {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: `demo-${acc.role}`,
    refresh_token: 'demo-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: {
      id: `demo-${acc.role}`,
      email: acc.email,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: { provider: 'demo' },
      user_metadata: { full_name: acc.name },
      created_at: new Date().toISOString(),
    },
  } as unknown as Session;
}

export function saveDemo(acc: DemoAccount): void {
  localStorage.setItem(KEY, acc.email);
}

export function loadDemo(): DemoAccount | undefined {
  const email = localStorage.getItem(KEY);
  if (!email) return undefined;
  return DEMO_ACCOUNTS.find((a) => a.email === email);
}

/**
 * True when a demo account is signed in — there is no real backend to reach, so
 * data-layer requests should fail fast and let callers use seed data instantly
 * instead of waiting out a network timeout on an unprovisioned/paused project.
 */
export function isDemoActive(): boolean {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function clearDemo(): void {
  localStorage.removeItem(KEY);
}
