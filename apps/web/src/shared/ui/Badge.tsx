import type { ReactNode } from 'react';

export type BadgeTone = 'navy' | 'gold' | 'teal' | 'success' | 'danger' | 'neutral';

const TONES: Record<BadgeTone, string> = {
  navy: 'bg-navy-50 text-navy',
  gold: 'bg-gold-100 text-gold-600',
  teal: 'bg-teal-100 text-teal',
  success: 'bg-green-100 text-green-700',
  danger: 'bg-red-100 text-red-700',
  neutral: 'bg-gray-100 text-gray-600',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}
