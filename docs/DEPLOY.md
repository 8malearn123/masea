# النشر ورابط المعاينة الدائم (Live Preview)

الهدف: رابط دائم يتحدّث تلقائيًا مع كل تعديل (Continuous Deployment) عبر **Vercel + GitHub**.

```
git push  ─►  GitHub  ─►  Vercel (auto build)  ─►  رابط دائم محدّث
```

## المتطلبات
- الكود مرفوع على GitHub: `mubark555/-`
- حساب Vercel (مجاني): https://vercel.com

## خطوة لمرة واحدة — ربط Vercel بالمستودع
1. ادخل https://vercel.com → **Add New… → Project**.
2. اختر **Import Git Repository** ثم المستودع `-`.
3. الإعدادات تُقرأ تلقائيًا من `vercel.json` (لا تغيّر شيئًا):
   - Framework: **Vite**
   - Install: `npm install`
   - Build: `npm run build --workspace apps/web`
   - Output: `apps/web/dist`
4. أضف متغيرات البيئة (Environment Variables):
   | المفتاح | القيمة |
   |---|---|
   | `VITE_SUPABASE_URL` | رابط مشروع Supabase |
   | `VITE_SUPABASE_ANON_KEY` | مفتاح anon |
   | `VITE_GOOGLE_MAPS_API_KEY` | (اختياري) |
5. **Deploy**.

بعدها:
- **Production URL دائم** يتحدّث مع كل push على الفرع الرئيسي.
- **Preview URL** تلقائي لكل فرع/PR (مثل فرع `claude/vibrant-mendel-2DIjD`).

## بديل سريع عبر سطر الأوامر (من جهازك)
```bash
npm i -g vercel
vercel            # أول مرة: ينشئ المشروع + رابط معاينة
vercel --prod     # رابط الإنتاج الدائم
```

## ملاحظة عن GitHub Actions
يوجد Workflow جاهز في `.github/workflows/web.yml` ينشر إلى Vercel عند الدفع إلى `main`.
لتفعيله أضف هذه الـ Secrets في GitHub (Settings → Secrets → Actions):
`VERCEL_TOKEN` · `VERCEL_ORG_ID` · `VERCEL_PROJECT_ID`.
> ربط Vercel↔GitHub المباشر (الخطوات أعلاه) أبسط ولا يحتاج Secrets.

## الموبايل (Expo)
تطبيقات الموبايل لا يكون لها «رابط ويب» للمعاينة. للمعاينة الحيّة:
- **Expo Go** على جوالك: `cd apps/driver && npm start` ثم امسح QR.
- للتوزيع: `eas update` (تحديثات OTA حيّة) أو `eas build` لملفات APK/IPA.
