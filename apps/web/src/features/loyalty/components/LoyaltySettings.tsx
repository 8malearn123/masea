import { useState } from 'react';
import { Gift, Pencil, Plus, Power, Save, Settings2, Star, X } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Skeleton, ErrorState } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import {
  useLoyaltyConfig,
  useLoyaltyPackages,
  useLoyaltyTiers,
  useSavePackage,
  useUpdateLoyaltyConfig,
  useUpdateTier,
} from '@/features/loyalty/hooks/useLoyalty';
import { loyaltyConfigSchema, packageSchema } from '@/features/loyalty/api/loyaltySettings.api';
import type {
  LoyaltyConfig,
  LoyaltyPackage,
  LoyaltyPackageInput,
  TierInfo,
} from '@/features/loyalty/types';

const FIELDS: { key: keyof LoyaltyConfig; label: string; step?: string }[] = [
  { key: 'points_per_riyal', label: 'نقاط لكل ريال', step: '0.1' },
  { key: 'redeem_points_per_riyal', label: 'نقاط الاستبدال لكل ريال' },
  { key: 'referral_commission_pct', label: 'عمولة الإحالة (٪)' },
  { key: 'first_order_discount_pct', label: 'خصم الطلب الأول (٪)' },
  { key: 'wheel_spins_per_customer', label: 'محاولات عجلة الحظ لكل عميل' },
];

/* ------------------------------- config --------------------------------- */
export function LoyaltyConfigCard({ editable }: { editable: boolean }) {
  const { data, isLoading, isError, refetch } = useLoyaltyConfig();
  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;
  // key → reset the form when the saved config changes
  return <ConfigForm key={JSON.stringify(data)} cfg={data} editable={editable} />;
}

function ConfigForm({ cfg, editable }: { cfg: LoyaltyConfig; editable: boolean }) {
  const update = useUpdateLoyaltyConfig();
  const [form, setForm] = useState<LoyaltyConfig>(cfg);
  const [errors, setErrors] = useState<Partial<Record<keyof LoyaltyConfig, string>>>({});
  const dirty = FIELDS.some((f) => form[f.key] !== cfg[f.key]);

  function save() {
    const parsed = loyaltyConfigSchema.safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof LoyaltyConfig, string>> = {};
      for (const i of parsed.error.issues) next[i.path[0] as keyof LoyaltyConfig] ??= i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    update.mutate(parsed.data);
  }

  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
        <Settings2 size={16} /> إعدادات الولاء
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <Input
            key={f.key}
            label={f.label}
            type="number"
            min={0}
            step={f.step ?? '1'}
            className="num"
            value={Number.isFinite(form[f.key]) ? form[f.key] : ''}
            onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })}
            disabled={!editable}
            error={errors[f.key]}
          />
        ))}
      </div>
      {editable ? (
        <Button className="mt-4" disabled={!dirty} loading={update.isPending} onClick={save}>
          <Save size={15} /> حفظ الإعدادات
        </Button>
      ) : (
        <p className="mt-3 text-[11px] text-purple">التعديل متاح للإدارة (صلاحية إدارة الولاء).</p>
      )}
    </Card>
  );
}

/* -------------------------------- tiers --------------------------------- */
export function TiersCard({ editable }: { editable: boolean }) {
  const { data: tiers = [], isLoading, isError, refetch } = useLoyaltyTiers();
  const [editing, setEditing] = useState<TierInfo | null>(null);

  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
        <Star size={16} /> الفئات والمضاعفات
      </h2>
      {isLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
        <div className="space-y-2">
          {tiers.map((t) => (
            <div
              key={t.tier}
              className="flex items-center justify-between gap-2 rounded-lg bg-navy-50/50 px-3 py-2 text-sm"
            >
              <span className="text-navy-900">
                {t.label}{' '}
                <span className="num text-xs text-purple">(من {sar(t.min_spend)} ر.س)</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="num font-bold text-navy">×{t.multiplier}</span>
                {editable && (
                  <button
                    type="button"
                    onClick={() => setEditing(t)}
                    aria-label={`تعديل فئة ${t.label}`}
                    className="rounded-lg p-1 text-navy hover:bg-navy-100"
                  >
                    <Pencil size={14} />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {editing && <TierModal tier={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function TierModal({ tier, onClose }: { tier: TierInfo; onClose: () => void }) {
  const update = useUpdateTier();
  const [form, setForm] = useState({
    label: tier.label,
    min_spend: tier.min_spend,
    multiplier: tier.multiplier,
  });
  return (
    <Modal open onClose={onClose} title={`تعديل فئة ${tier.label}`}>
      <div className="space-y-4">
        <Input
          label="اسم الفئة"
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="حد الإنفاق للوصول (ر.س)"
            type="number"
            min={0}
            className="num"
            value={form.min_spend}
            onChange={(e) => setForm({ ...form, min_spend: Number(e.target.value) })}
          />
          <Input
            label="مضاعف النقاط"
            type="number"
            min={1}
            step="0.05"
            className="num"
            value={form.multiplier}
            onChange={(e) => setForm({ ...form, multiplier: Number(e.target.value) })}
          />
        </div>
        <p className="text-[11px] text-purple">
          الفئات ثابتة (برونز · فضي · ذهبي) ويُعدَّل اسمها وحدّها ومضاعفها؛ يجب أن يتصاعد حد الإنفاق
          من فئة لأخرى.
        </p>
        <Button
          className="w-full"
          loading={update.isPending}
          onClick={() => update.mutate({ tier: tier.tier, patch: form }, { onSuccess: onClose })}
        >
          حفظ
        </Button>
      </div>
    </Modal>
  );
}

/* ------------------------------- packages ------------------------------- */
export function PackagesCard({ editable }: { editable: boolean }) {
  const { data: packages = [], isLoading, isError, refetch } = useLoyaltyPackages();
  const save = useSavePackage();
  const [editing, setEditing] = useState<LoyaltyPackage | 'new' | null>(null);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <Gift size={16} /> الباقات
        </h2>
        {editable && (
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Plus size={14} /> باقة جديدة
          </Button>
        )}
      </div>
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : packages.length === 0 ? (
        <p className="text-sm text-purple">لا توجد باقات بعد.</p>
      ) : (
        <ul className="space-y-2">
          {packages.map((p) => (
            <li key={p.id} className="rounded-lg border border-navy-50 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-navy">
                  {p.name}
                  {!p.is_active && <Badge tone="neutral">معطّلة</Badge>}
                </span>
                <span className="num text-sm font-bold text-gold-600">
                  {sar(p.special_price)} ر.س
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-[11px] text-purple">{p.included.join(' · ')}</span>
                {editable && (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(p)}
                      className="inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2 py-1 text-[11px] text-navy hover:bg-navy-100"
                    >
                      <Pencil size={12} /> تعديل
                    </button>
                    <button
                      type="button"
                      disabled={save.isPending}
                      onClick={() =>
                        save.mutate({ id: p.id, input: { ...p, is_active: !p.is_active } })
                      }
                      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] ${p.is_active ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}
                    >
                      <Power size={12} /> {p.is_active ? 'تعطيل' : 'تفعيل'}
                    </button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing !== null && (
        <PackageModal pkg={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </Card>
  );
}

function PackageModal({ pkg, onClose }: { pkg: LoyaltyPackage | null; onClose: () => void }) {
  const save = useSavePackage();
  const [form, setForm] = useState<LoyaltyPackageInput>(
    pkg
      ? {
          name: pkg.name,
          included: [...pkg.included],
          special_price: pkg.special_price,
          is_active: pkg.is_active,
        }
      : { name: '', included: [], special_price: 0, is_active: true },
  );
  const [service, setService] = useState('');
  const [error, setError] = useState<string | null>(null);

  function addService() {
    const v = service.trim();
    if (!v || form.included.includes(v)) return;
    setForm({ ...form, included: [...form.included, v] });
    setService('');
  }

  function submit() {
    const parsed = packageSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'بيانات غير صحيحة');
      return;
    }
    setError(null);
    save.mutate({ id: pkg?.id ?? null, input: parsed.data }, { onSuccess: onClose });
  }

  return (
    <Modal open onClose={onClose} title={pkg ? 'تعديل باقة' : 'باقة جديدة'}>
      <div className="space-y-4">
        <Input
          label="اسم الباقة"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Input
          label="السعر الخاص (ر.س)"
          type="number"
          min={0}
          className="num"
          value={form.special_price || ''}
          onChange={(e) => setForm({ ...form, special_price: Number(e.target.value) })}
        />
        <div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="الخدمات المشمولة"
                value={service}
                placeholder="مثال: تأجير شهري"
                onChange={(e) => setService(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addService();
                  }
                }}
              />
            </div>
            <Button variant="outline" onClick={addService}>
              <Plus size={14} /> إضافة
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {form.included.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded-full bg-navy-50 px-2.5 py-1 text-xs text-navy"
              >
                {s}
                <button
                  type="button"
                  aria-label={`إزالة ${s}`}
                  onClick={() =>
                    setForm({ ...form, included: form.included.filter((x) => x !== s) })
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-navy">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            className="h-4 w-4 rounded border-navy-100"
          />
          مفعّلة وتظهر للعملاء
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button className="w-full" loading={save.isPending} onClick={submit}>
          حفظ الباقة
        </Button>
      </div>
    </Modal>
  );
}
