import type { AppRole } from '@masiat/shared';
import type { BadgeTone } from '@/shared/ui/Badge';

export interface SystemUser {
  id: string;
  full_name: string;
  email: string;
  role: AppRole;
  branch: string;
  is_active: boolean;
  last_login: string;
}

export const USER_STATUS_TONE: Record<'active' | 'inactive', BadgeTone> = {
  active: 'success',
  inactive: 'neutral',
};
