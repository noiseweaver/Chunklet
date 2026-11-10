import { expect, test } from '@playwright/test';

test('capture, preview, commit, then reload offline and the block is still there', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-11-10T07:40:00Z') }); // 08:40 in Amsterdam
  await page.goto('./');

  // The service worker must control the page before we can go offline.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });

  const box = page.getByLabel('What do you need to do?');
  await box.fill('review PR 30m at 10, emails 20m');
  await expect(page.getByRole('list', { name: 'Preview' }).getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'Add 2' }).click();

  await expect(page.getByRole('button', { name: /^review PR, 10:00, 30 minutes/ })).toBeVisible();
  await expect(page.getByRole('region', { name: /unscheduled/i }).getByText('emails')).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: /^review PR, 10:00, 30 minutes/ })).toBeVisible();
  await expect(page.getByRole('region', { name: /unscheduled/i }).getByText('emails')).toBeVisible();
});

test('has an installable manifest', async ({ request, baseURL }) => {
  const res = await request.get(`${baseURL}manifest.webmanifest`);
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m).toMatchObject({ name: 'Chunklet', display: 'standalone' });
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
});
