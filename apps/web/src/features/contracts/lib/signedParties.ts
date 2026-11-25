import { dateTimeAr } from '@/shared/lib/format';
import type { ContractSignature } from '@/features/contracts/types';

/** توقيع طرف كما يُطبع في نهاية العقد: الصورة، الاسم، الصفة، التاريخ والوقت، بصمة المستند. */
export interface SignedPartyView {
  party: 'customer' | 'company';
  name: string;
  capacity: string;
  at: string;
  image: string | null;
  fingerprint: string | null;
}

const DEFAULT_CAPACITY = {
  customer: 'العميل (الطرف الثاني)',
  company: 'ممثل الشركة (الطرف الأول) — ماسية الشرق للاستقدام',
} as const;

/** آخر توقيع لكل طرف مع صورته (محلولة مسبقاً). لا توقيع مسجّل ← لا يُطبع شيء. */
export function signedParties(
  signatures: ContractSignature[],
  images: Record<string, string | null>,
): { customer: SignedPartyView | null; company: SignedPartyView | null } {
  const view = (t: 'customer' | 'company'): SignedPartyView | null => {
    const s = [...signatures].reverse().find((x) => x.signer_type === t);
    if (!s) return null;
    return {
      party: t,
      name: s.signer_name ?? '—',
      capacity: s.signer_capacity ?? DEFAULT_CAPACITY[t],
      at: dateTimeAr(s.signed_at),
      image: images[s.id] ?? null,
      fingerprint: s.document_sha256 ?? null,
    };
  };
  return { customer: view('customer'), company: view('company') };
}

export function escapeSig(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );
}

/** سطر بيانات الموقّع تحت مكان التوقيع. */
export function signerCaption(p: SignedPartyView | null): string {
  if (!p) return '';
  return `<div class="esig-cap"><b>${escapeSig(p.name)}</b><br/>${escapeSig(p.capacity)}<br/><span dir="ltr">${escapeSig(p.at)}</span></div>`;
}

/** بصمة المستند الموقّع (أول 16 خانة) — تطابق ما وقّع عليه الطرفان. */
export function fingerprintLine(parties: (SignedPartyView | null)[]): string {
  const fp = parties.find((p) => p?.fingerprint)?.fingerprint;
  return fp
    ? `<div class="esig-fp">وُقّع إلكترونياً — بصمة المستند SHA-256: <span dir="ltr">${escapeSig(fp.slice(0, 16))}…</span></div>`
    : '';
}

export const ESIG_CSS =
  '.esig-cap{margin-top:4px;font-size:11px;line-height:1.5;color:#120E45}.esig-fp{margin-top:6px;font-size:10px;color:#564E85;text-align:center}';
