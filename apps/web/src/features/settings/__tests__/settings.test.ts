import { describe, expect, it } from 'vitest';
import {
  listConfig,
  listSources,
  listStages,
  newCode,
  saveSource,
  updateConfig,
} from '@/features/settings/api/settings.api';

describe('settings — managed lists & config', () => {
  it('lists lead sources and pipeline stages', async () => {
    expect((await listSources()).length).toBeGreaterThanOrEqual(5);
    expect((await listStages()).some((s) => s.code === 'won')).toBe(true);
  });

  it('adds a new source and toggles an existing one', async () => {
    const before = (await listSources()).length;
    await saveSource(
      { code: newCode('source'), name_ar: 'انستغرام', is_active: true, sort_order: 9 },
      true,
    );
    expect((await listSources()).length).toBe(before + 1);

    const first = (await listSources())[0]!;
    await saveSource({ ...first, is_active: !first.is_active }, false);
    expect((await listSources()).find((s) => s.code === first.code)?.is_active).toBe(
      !first.is_active,
    );
  });

  it('exposes editable business values and updates one', async () => {
    const cfg = await listConfig();
    expect(cfg.some((c) => c.key === 'vat_rate')).toBe(true);
    await updateConfig('commission_rate', 3);
    expect((await listConfig()).find((c) => c.key === 'commission_rate')?.value).toBe(3);
  });
});
