import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { BadgeCheck, FileDown, Lock, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Button, Card, EmptyState, Input, Skeleton } from '@/shared/ui';
import { sar, dateAr, dateTimeAr } from '@/shared/lib/format';
import { usePublicTrial } from '@/features/contracts/hooks/useTrials';
import {
  acceptTrial,
  type AcceptResult,
  type TrialDocument,
} from '@/features/contracts/api/trials.api';
import { openContractPrint } from '@/features/contracts/lib/contractHtml';
import { trialDocumentHtml } from '@/features/contracts/lib/trialContract/document';
import { TrialDocFrame } from '@/features/contracts/components/TrialDocFrame';

function esc(s: string | number): string {
  return String(s).replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch,
  );
}

/** نسخة المستند المقبول للطباعة/الحفظ (PDF من المتصفح). */
function acceptedHtml(d: TrialDocument, ref: string, at: string): string {
  const terms = d.terms.map((t, i) => `<li><b>${i + 1}.</b> ${esc(t)}</li>`).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>${esc(d.trial_no)}</title>
<link href="https://fonts.googleapis.com/css2?family=Alexandria:wght@400;600;700&family=JetBrains+Mono&display=swap" rel="stylesheet" />
<style>body{font-family:'Alexandria',sans-serif;color:#120E45;padding:40px}.num{font-family:'JetBrains Mono',monospace;direction:ltr;unicode-bidi:embed}
h1{color:#1B1564;font-size:18px}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:7px;border-bottom:1px solid #E3E1ED}td.k{color:#564E85;width:38%}
ol{list-style:none;padding:0;font-size:13px;line-height:1.9}.box{margin-top:18px;padding:12px;border:1px solid #1B1564;border-radius:12px;font-size:12px}</style></head>
<body><h1>ماسية الشرق للاستقدام — ${esc(d.terms_title)}</h1>
<table>
<tr><td class="k">رقم التجربة</td><td class="num">${esc(d.trial_no)}</td></tr>
<tr><td class="k">العميل</td><td>${esc(d.customer_name)}</td></tr>
<tr><td class="k">العاملة</td><td>${esc(d.worker_name)} ${d.nationality ? `— ${esc(d.nationality)}` : ''} ${d.profession ? `— ${esc(d.profession)}` : ''}</td></tr>
<tr><td class="k">السعر شامل الضريبة</td><td class="num">${esc(sar(d.total_amount))} ر.س</td></tr>
<tr><td class="k">عدد أيام التجربة</td><td class="num">${d.trial_days}</td></tr>
<tr><td class="k">تاريخ استلام العاملة</td><td class="num">${esc(d.receipt_date)}</td></tr>
<tr><td class="k">نهاية التجربة</td><td class="num">${esc(d.end_date)}</td></tr>
</table>
<h1>الشروط (النسخة ${d.terms_version})</h1><ol>${terms}</ol>
<p style="font-size:12px">${esc(d.notice)}</p>
<div class="box">قُبلت إلكترونياً في <span class="num">${esc(at)}</span> — مرجع القبول <span class="num">${esc(ref)}</span></div>
<script>window.onload=function(){window.print()}</script></body></html>`;
}

/**
 * صفحة عامة: العميل يراجع مستند التجربة ويقبله. فتح الصفحة لا يُسجّل قبولاً؛ القبول
 * يتطلب التحقق (آخر 4 من الهوية والجوال) وتأكيد القراءة وضغط «أوافق على شروط التجربة».
 */
export default function TrialAcceptPage() {
  const { token = '' } = useParams();
  const { data: v, isLoading, isError, error, refetch } = usePublicTrial(token);
  const [idLast4, setId] = useState('');
  const [phoneLast4, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AcceptResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setProblem(null);
    try {
      const r = await acceptTrial({ token, idLast4, phoneLast4, otp: otp || undefined });
      if (r.ok) setResult(r);
      else {
        setProblem(
          `${r.error ?? 'تعذّر التحقق'}${r.attempts_left !== undefined ? ` — المحاولات المتبقية: ${r.attempts_left}` : ''}`,
        );
        void refetch();
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'تعذّر تسجيل القبول');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-navy-50 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="text-center">
          <p className="text-lg font-bold text-navy">ماسية الشرق للاستقدام</p>
          <p className="text-sm text-purple">تجربة عاملة بغرض نقل الخدمات</p>
        </div>

        {isLoading ? (
          <Card>
            <Skeleton className="h-64 w-full" />
          </Card>
        ) : isError || !v ? (
          <Card>
            <EmptyState
              icon={TriangleAlert}
              title="تعذّر فتح الرابط"
              description={error instanceof Error ? error.message : 'الرابط غير صحيح'}
            />
          </Card>
        ) : result?.ok && result.document ? (
          <Card>
            <div className="flex flex-col items-center gap-2 text-center">
              <BadgeCheck size={40} className="text-teal" />
              <p className="text-lg font-bold text-navy">تم تسجيل قبولك</p>
              <p className="text-sm text-purple">
                مرجع القبول <span className="num font-bold text-navy">{result.reference}</span> ·{' '}
                <span className="num">{dateTimeAr(result.accepted_at ?? '')}</span>
              </p>
              <p className="text-xs text-purple">
                سيتواصل معك الفرع لاستكمال متطلبات التسليم قبل استلام العاملة.
              </p>
              <Button
                variant="outline"
                onClick={() =>
                  openContractPrint(
                    // عقد التجربة الرسمي بنفس تصميمه + ختم القبول؛ التجارب الأقدم بعرضها السابق
                    trialDocumentHtml(result.document!, {
                      autoPrint: true,
                      acceptance: {
                        reference: result.reference ?? '',
                        at: dateTimeAr(result.accepted_at ?? ''),
                      },
                    }) ??
                      acceptedHtml(
                        result.document!,
                        result.reference ?? '',
                        result.accepted_at ?? '',
                      ),
                  )
                }
              >
                <FileDown size={15} /> حفظ نسخة المستند المقبول
              </Button>
            </div>
          </Card>
        ) : (
          <>
            {trialDocumentHtml(v) ? (
              <Card className="p-2">
                <TrialDocFrame
                  title={v.terms_title}
                  testId="trial-accept-document"
                  html={trialDocumentHtml(v) ?? ''}
                />
                <p className="mt-2 rounded-lg bg-gold-100 p-2 text-xs text-navy">{v.notice}</p>
              </Card>
            ) : (
              <Card>
                <h1 className="mb-3 text-base font-bold text-navy">
                  {v.terms_title} · <span className="num">{v.trial_no}</span>
                </h1>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ['السعر شامل الضريبة', `${sar(v.total_amount)} ر.س`],
                    ['عدد أيام التجربة', String(v.trial_days)],
                    ['تاريخ استلام العاملة', dateAr(v.receipt_date)],
                    ['نهاية التجربة', dateAr(v.end_date)],
                  ].map(([k, val]) => (
                    <div key={k} className="rounded-xl bg-navy-50 p-3 text-center">
                      <p className="text-[11px] text-purple">{k}</p>
                      <p className="num text-base font-bold text-navy">{val}</p>
                    </div>
                  ))}
                </div>
                <dl className="mt-3 space-y-1 text-sm">
                  <div>
                    <dt className="inline text-purple">العميل: </dt>
                    <dd className="inline">{v.customer_name}</dd>
                  </div>
                  <div>
                    <dt className="inline text-purple">العاملة: </dt>
                    <dd className="inline">
                      {v.worker_name}
                      {v.nationality ? ` · ${v.nationality}` : ''}
                      {v.profession ? ` · ${v.profession}` : ''}
                    </dd>
                  </div>
                </dl>
                <h2 className="mb-2 mt-4 text-sm font-bold text-navy">
                  شروط التجربة المعتمدة (النسخة {v.terms_version})
                </h2>
                <ol className="space-y-2 text-sm leading-7">
                  {v.terms.map((t, i) => (
                    <li key={i}>
                      <span className="num font-bold text-gold-600">{i + 1}.</span> {t}
                    </li>
                  ))}
                </ol>
                <p className="mt-3 rounded-lg bg-gold-100 p-2 text-xs text-navy">{v.notice}</p>
              </Card>
            )}

            <Card>
              {v.link_state !== 'open' || v.status !== 'awaiting_acceptance' ? (
                <p className="flex items-center gap-2 text-sm text-purple">
                  <Lock size={16} />
                  {v.link_state === 'used' || v.accepted_at
                    ? 'سبق قبول هذه التجربة.'
                    : v.link_state === 'expired'
                      ? 'انتهت صلاحية الرابط — اطلب رابطاً جديداً من الفرع.'
                      : v.link_state === 'revoked'
                        ? 'هذا الرابط أُلغي — اطلب رابطاً جديداً من الفرع.'
                        : v.link_state === 'locked'
                          ? 'تجاوزت عدد المحاولات — تواصل مع الفرع.'
                          : 'التجربة ليست بانتظار القبول.'}
                </p>
              ) : (
                <div className="space-y-3">
                  <h2 className="flex items-center gap-1.5 text-sm font-bold text-navy">
                    <ShieldCheck size={16} /> التحقق من الهوية
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      label="آخر 4 أرقام من رقم الهوية"
                      inputMode="numeric"
                      maxLength={4}
                      className="num"
                      value={idLast4}
                      onChange={(e) => setId(e.target.value.replace(/\D/g, ''))}
                    />
                    <Input
                      label="آخر 4 أرقام من رقم الجوال"
                      inputMode="numeric"
                      maxLength={4}
                      className="num"
                      value={phoneLast4}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                    />
                    {v.otp_required && (
                      <Input
                        label="رمز التحقق المرسل إلى جوالك"
                        inputMode="numeric"
                        maxLength={6}
                        className="num"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                      />
                    )}
                  </div>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={read}
                      onChange={(e) => setRead(e.target.checked)}
                    />
                    قرأت بيانات العاملة والسعر والمدة وتاريخ الاستلام والشروط أعلاه.
                  </label>
                  {problem && <p className="text-sm text-red-700">{problem}</p>}
                  <Button
                    className="w-full"
                    size="lg"
                    disabled={
                      !read ||
                      idLast4.length !== 4 ||
                      phoneLast4.length !== 4 ||
                      (v.otp_required && otp.length !== 6)
                    }
                    loading={busy}
                    onClick={() => void accept()}
                  >
                    أوافق على شروط التجربة
                  </Button>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
