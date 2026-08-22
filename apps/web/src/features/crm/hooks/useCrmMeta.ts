import type { BadgeTone } from '@/shared/ui/Badge';
import { useConfig, useSources, useStages } from '@/features/settings/hooks/useSettings';

/** Presentation tone per known stage code (color is design, not data). */
const STAGE_TONE: Record<string, BadgeTone> = {
  new: 'neutral',
  contacted: 'teal',
  quoted: 'gold',
  negotiation: 'navy',
  won: 'success',
  lost: 'danger',
};

/**
 * Live CRM reference data — labels, order, sources and the commission rate are
 * read from the managed settings (lead_stages / lead_sources / app_config), so
 * edits in الإعدادات take effect across the sales workspace immediately.
 */
export function useCrmMeta() {
  const { data: stages = [] } = useStages();
  const { data: sources = [] } = useSources();
  const { data: config = [] } = useConfig();

  const activeStages = stages.filter((s) => s.is_active);
  const stageOrder = activeStages.map((s) => s.code);

  const stageLabel = (code: string) => stages.find((s) => s.code === code)?.name_ar ?? code;
  const stageTone = (code: string): BadgeTone => STAGE_TONE[code] ?? 'navy';
  const sourceLabel = (code: string | null | undefined) =>
    code ? (sources.find((s) => s.code === code)?.name_ar ?? code) : '';

  const commissionRate = (config.find((c) => c.key === 'commission_rate')?.value ?? 2.5) / 100;

  return {
    stages,
    activeStages,
    stageOrder,
    stageLabel,
    stageTone,
    sources: sources.filter((s) => s.is_active),
    sourceLabel,
    commissionRate,
  };
}
