import { expect, test } from '@playwright/test';

// Critical path: a visitor can reach login and sign in with a demo account,
// then lands on the dashboard. (Requires the dev server + browsers installed.)
test('demo login reaches the dashboard', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();

  // One-click demo account (المدير العام)
  await page.getByRole('button', { name: /منصور المكرمي/ }).click();

  await expect(page.getByText('لوحة التحكم')).toBeVisible();
});
