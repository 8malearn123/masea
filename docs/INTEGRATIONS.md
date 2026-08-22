# Integrations — Payments, Notifications, Maps

All third-party secrets must live in **Supabase Edge Function** environment
variables (server-side), never in the client. The web/mobile clients only hold
*publishable* keys.

## 💳 Payments

| Gateway | Methods | Notes |
|---|---|---|
| **Moyasar** | Mada, Apple Pay, credit | Primary KSA gateway. Publishable key on client; verify via webhook. |
| **Tamara** | BNPL (split) | Order create → redirect → webhook capture. |
| **HyperPay** | Mada / Visa fallback | COPYandPAY checkout id from server. |

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

## 📲 Notifications — Twilio (WhatsApp + SMS)

Triggered server-side (Edge Function or DB webhook) on events such as:
contract created, payment received, absence reported, abandoned-cart reminder.

```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+9665XXXXXXX
TWILIO_SMS_FROM=
```

Suggested pattern: a `notifications` row insert + a `pg_net`/webhook call that
hits an Edge Function which sends WhatsApp first, falling back to SMS.

## 🗺️ Maps / GPS

- **Web:** Google Maps embeds via `VITE_GOOGLE_MAPS_API_KEY`.
- **Driver app:** `react-native-maps` + `expo-location`; each barcode scan stores
  `latitude`/`longitude` in `scans_log`.

## 📄 Reports

- **PDF:** `jsPDF` (contracts, invoices) — register an Arabic font for RTL output.
- **Excel:** `xlsx` (payroll, collections).
- **Charts:** `Recharts` (already used on the dashboard).
