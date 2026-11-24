# Integrations — Payments, Notifications, Maps

All third-party secrets must live in **Supabase Edge Function** environment
variables (server-side), never in the client. The web/mobile clients only hold
_publishable_ keys.

## 💳 Payments

| Gateway      | Methods                 | Notes                                                               |
| ------------ | ----------------------- | ------------------------------------------------------------------- |
| **Moyasar**  | Mada, Apple Pay, credit | Primary KSA gateway. Publishable key on client; verify via webhook. |
| **Tamara**   | BNPL (split)            | Order create → redirect → webhook capture.                          |
| **HyperPay** | Mada / Visa fallback    | COPYandPAY checkout id from server.                                 |

### Flow (recommended)

1. Client requests a payment session from an Edge Function (`/payments/create`).
2. Edge Function calls the gateway with the **secret** key, returns a checkout id / URL.
3. Client completes payment in the gateway SDK/redirect.
4. Gateway → webhook → Edge Function verifies signature → inserts into `payments`
   and updates `contracts.amount_paid`.

Environment variables (Edge Functions):

```
MOYASAR_SECRET_KEY=
TAMARA_API_TOKEN=
TAMARA_NOTIFICATION_TOKEN=
HYPERPAY_ACCESS_TOKEN=
HYPERPAY_ENTITY_ID=
```

## 📲 WhatsApp — WhatsApp Business Platform (Cloud API)

عروض الحملات تُرسل من صفحة العملاء (تحديد ← «إرسال عرض عبر واتساب»). الرسائل تدخل طابور
`outbound_messages` (0102) وترسلها دالة الخادم `whatsapp-send` بقالب معتمد، وتصل الحالات
(مرسلة/تم التسليم/تمت القراءة/فشل) والردود عبر `whatsapp-webhook`. لا «مرسلة» قبل تأكيد Meta.

### المتطلبات من Meta

1. Meta Business موثّق + WhatsApp Business Account + رقم مخصّص للأعمال.
2. قالب تسويقي (Marketing) بالعربية بالمتغيرات `{{1}}` الاسم، `{{2}}` العرض، `{{3}}` تاريخ الانتهاء، معتمد —
   ثم يُسجَّل في النظام: الولاء والتسويق ← الإدارة ← قوالب واتساب (بنفس الاسم، والحالة «معتمد من Meta»).
3. System User بمفتاح دائم بصلاحية `whatsapp_business_messaging`، و Phone Number ID، و App Secret.

### التفعيل في Supabase

```
supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_APP_SECRET=... \
  WHATSAPP_VERIFY_TOKEN=<نص عشوائي> CRON_SECRET=<نص عشوائي>
supabase functions deploy whatsapp-send
supabase functions deploy whatsapp-webhook --no-verify-jwt
```

- في إعدادات تطبيق Meta ← Webhooks: الرابط `https://<project>.functions.supabase.co/whatsapp-webhook`،
  ورمز التحقق = `WHATSAPP_VERIFY_TOKEN`، والاشتراك في حقل `messages`.
- جدولة الإرسال كل دقيقة (pg_cron + pg_net):

```sql
select cron.schedule('whatsapp-send', '* * * * *', $$
  select net.http_post(url := 'https://<project>.functions.supabase.co/whatsapp-send',
                       headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>'))
$$);
```

- الحد اليومي ومحاولات إعادة الإرسال من الإعدادات (`whatsapp_daily_limit`، `whatsapp_max_attempts`).
- لا يُستخدم أي حل غير رسمي (أتمتة واتساب ويب أو أرقام شخصية) — يعرّض الرقم للحظر.

## 🗺️ Maps / GPS

- **Web:** Google Maps embeds via `VITE_GOOGLE_MAPS_API_KEY`.
- **Driver app:** `react-native-maps` + `expo-location`; each barcode scan stores
  `latitude`/`longitude` in `scans_log`.

## 📄 Reports

- **PDF:** `jsPDF` (contracts, invoices) — register an Arabic font for RTL output.
- **Excel:** `xlsx` (payroll, collections).
- **Charts:** `Recharts` (already used on the dashboard).
