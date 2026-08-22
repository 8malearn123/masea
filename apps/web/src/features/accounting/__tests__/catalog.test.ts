import { describe, expect, it } from 'vitest';
import {
  addCatalogItem,
  listCatalog,
  toggleCatalogItem,
  updateCatalogItem,
} from '@/features/accounting/api/accounting.api';

describe('products & services catalog', () => {
  it('seeds Masiat services mapped to revenue accounts', async () => {
    const items = await listCatalog();
    expect(items.length).toBeGreaterThanOrEqual(7);
    const recruit = items.find((i) => i.service_code === 'recruitment');
    expect(recruit?.revenue_code).toBe('4100');
    expect(items.every((i) => /^4\d{3}$/.test(i.revenue_code))).toBe(true);
  });

  it('adds, edits and disables a catalog item (CRUD)', async () => {
    const created = addCatalogItem({
      name_ar: 'خدمة استشارة',
      kind: 'service',
      service_code: null,
      revenue_code: '4500',
      unit: 'hour',
      default_price: 300,
      taxable: true,
    });
    expect(created.is_active).toBe(true);

    updateCatalogItem(created.id, { default_price: 350 });
    toggleCatalogItem(created.id, false);
    const after = (await listCatalog()).find((i) => i.id === created.id);
    expect(after?.default_price).toBe(350);
    expect(after?.is_active).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(() =>
      addCatalogItem({
        name_ar: '  ',
        kind: 'product',
        service_code: null,
        revenue_code: '4500',
        unit: 'unit',
        default_price: 10,
        taxable: true,
      }),
    ).toThrow();
  });
});
