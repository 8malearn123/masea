/**
 * موضع زر المساعد العائم على الشاشات الصغيرة. الزر لا يغطي أبدًا عنصرًا مهمًا
 * (أزرار التالي/السابق/الدفع، الشريط السفلي، الحقول): يبقى في الزاوية إن كانت
 * حرة، وإلا يرتفع لأقرب موضع حر فوق العنصر، وإلا يختفي مؤقتًا حتى يمرّر
 * المستخدم (أسفل كل صفحة مساحة محجوزة له على الجوال، فيعود للظهور عندها).
 * دالة نقية (أبعاد فقط) ليسهل اختبارها خارج المتصفح.
 */
export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface FabGeometry {
  viewportHeight: number;
  /** المسافة الافتراضية من الحافة السفلية واليسرى. */
  base: number;
  /** قطر الزر. */
  size: number;
  /** هامش الأمان بين الزر والعنصر. */
  gap: number;
  /** أقصى ارتفاع مسموح (نسبة من الشاشة) — لا يطفو الزر وسط المحتوى. */
  maxRise?: number;
}

export interface FabPlacement {
  bottom: number;
  hidden: boolean;
}

export function fabPlacement(obstacles: Rect[], g: FabGeometry): FabPlacement {
  const solid = obstacles.filter((r) => r.bottom > r.top && r.right > r.left);
  const left = g.base;
  const right = g.base + g.size;
  const isFree = (bottom: number) => {
    const top = g.viewportHeight - bottom - g.size;
    const bot = g.viewportHeight - bottom;
    return !solid.some(
      (r) =>
        r.left < right + g.gap &&
        r.right > left - g.gap &&
        r.top < bot + g.gap &&
        r.bottom > top - g.gap,
    );
  };
  const maxBottom = g.viewportHeight * (g.maxRise ?? 0.4);
  const candidates = [g.base, ...solid.map((r) => g.viewportHeight - r.top + g.gap)]
    .filter((b) => b >= g.base && b <= maxBottom)
    .sort((a, b) => a - b);
  for (const bottom of candidates) if (isFree(bottom)) return { bottom, hidden: false };
  return { bottom: g.base, hidden: true };
}
