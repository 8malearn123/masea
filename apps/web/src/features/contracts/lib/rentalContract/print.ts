import type { SignedPartyView } from '@/features/contracts/lib/signedParties';
import QRCode from 'qrcode';
import logoAsset from '@/assets/brand/masiat-logo.jpg';
import { zatcaQr } from '@/features/accounting/data/zatca';
import { templateFieldKeys, type RentalTemplateDoc } from './template';
import { buildRentalContractData, placeholderData, type RentalContractSource } from './fields';
import { buildRentalContractHtml } from './render';

/** يبني صفحة العقد الكاملة (شعار + QR + البنود) جاهزة للطباعة أو الحفظ PDF. */
export async function rentalContractHtml(
  doc: RentalTemplateDoc,
  source: RentalContractSource,
  opts: {
    watermark?: string | null;
    autoPrint?: boolean;
    signatures?: { employee?: string | null; customer?: string | null };
    signers?: { employee?: SignedPartyView | null; customer?: SignedPartyView | null };
  } = {},
): Promise<string> {
  const data = buildRentalContractData(source);
  let qr: string | null = null;
  try {
    qr = data.qr.vatNumber
      ? await QRCode.toDataURL(zatcaQr(data.qr), { margin: 0, width: 360 })
      : null;
  } catch {
    qr = null; // الـ QR تكميلي — لا يمنع إصدار العقد
  }
  return buildRentalContractHtml(doc, data, {
    logoUrl: absoluteLogo(),
    qrDataUrl: qr,
    watermark: opts.watermark ?? null,
    autoPrint: opts.autoPrint ?? false,
    ...(opts.signatures ? { signatures: opts.signatures } : {}),
    ...(opts.signers ? { signers: opts.signers } : {}),
  });
}

function absoluteLogo(): string {
  return typeof window !== 'undefined' ? new URL(logoAsset, window.location.href).href : logoAsset;
}

/** معاينة القالب نفسه: النص الثابت كاملاً والحقول المتغيّرة بأسمائها. */
export function templatePreviewHtml(doc: RentalTemplateDoc, watermark: string | null): string {
  return buildRentalContractHtml(doc, placeholderData(templateFieldKeys(doc)), {
    logoUrl: absoluteLogo(),
    watermark,
  });
}
