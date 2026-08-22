# Arabic contract PDF — serverless rendering (Chromium/Playwright)

The browser path (print → Save as PDF) ships today via
`buildContractHtml()` + `openContractPrint()`. For an automated, pixel-accurate
server-side PDF, render the **same HTML** with Chromium in a serverless function.

> Not enabled by default: it requires heavy dependencies and a Node serverless
> runtime that can't be installed/verified in the current sandbox. Enable it on
> Vercel as below. **No LibreOffice.**

## Dependencies

```bash
npm i -w apps/web playwright-core @sparticuz/chromium
```

Embed **Alexandria** as base64 in the HTML `<style>` (`@font-face`) so the
renderer needs no network.

## Vercel function (`/api/contract-pdf.ts`)

```ts
import chromium from '@sparticuz/chromium';
import { chromium as playwright } from 'playwright-core';
// import { buildContractHtml } from '...';  // reuse the same template

export const config = { runtime: 'nodejs', maxDuration: 30 };

export default async function handler(req, res) {
  const html = buildContractHtml(/* contract, clauses (fetched via service-role on the server) */);
  const browser = await playwright.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();
  res.setHeader('Content-Type', 'application/pdf');
  res.send(pdf);
}
```

- The function runs server-side; data is fetched there (service-role key stays
  on the server — never in the client bundle).

## ZATCA e-invoice — separate document

The ZATCA-compliant tax invoice (with QR/UUID per Phase 2) is generated as its
**own** document, not merged into the contract PDF.

```
TODO(zatca): generate the e-invoice (Base64 TLV QR + signed XML) as a separate
artifact linked from the contract, via a dedicated /api/zatca-invoice function.
```
