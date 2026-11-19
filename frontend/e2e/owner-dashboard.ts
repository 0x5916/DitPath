// Run by TestOwnerDashboardBrowser against its private HTTP server and PostgreSQL fixtures.
import { readFileSync } from 'node:fs';
import { chromium, expect, type Page } from '@playwright/test';

const { base, owner, learner, password, id }: Record<string, string> = JSON.parse(
  readFileSync(0, 'utf8')
);
const browser = await chromium.launch();
async function login(page: Page, username: string) {
  await page.goto('/en/login');
  await page.getByLabel('Username or Email').fill(username);
  await page.locator('[autocomplete="current-password"]').fill(password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).toHaveURL(base + '/en');
}
async function access(page: Page, expected: number) {
  const statuses = await page.evaluate(async (id) => {
    const token = localStorage.getItem('access_token');
    const headers: Record<string, string> = token ? { Authorization: 'Bearer ' + token } : {};
    const requests = [
      fetch('/v1/admin/reports/overview', { headers }),
      fetch('/v1/admin/users/search', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}'
      }),
      fetch('/v1/admin/users/' + id + '/report', { headers })
    ];
    return Promise.all(
      requests.map(async (request) => {
        const res = await request;
        return [res.status, res.headers.get('Cache-Control')];
      })
    );
  }, id);
  expect(statuses).toEqual(Array.from({ length: 3 }, () => [expected, 'no-store']));
}

try {
  const recipientContext = await browser.newContext({ baseURL: base, locale: 'en' });
  try {
    const recipientPage = await recipientContext.newPage();
    await login(recipientPage, learner);
    await recipientPage.goto('/en/settings');
    const support = recipientPage.getByRole('checkbox', {
      name: 'Support follow-ups',
      exact: true
    });
    await expect(support).not.toBeChecked();
    await expect(
      recipientPage.getByRole('checkbox', { name: 'Product updates' })
    ).not.toBeChecked();
    await support.focus();
    await support.press('Space');
    await expect(support).toBeChecked();
    await recipientPage.reload();
    await expect(support).toBeChecked();
  } finally {
    await recipientContext.close();
  }
  for (const viewport of [
    { width: 1280, height: 850 },
    { width: 390, height: 844 }
  ]) {
    const context = await browser.newContext({
      baseURL: base,
      viewport,
      locale: 'en',
      timezoneId: 'Asia/Singapore'
    });
    try {
      const page = await context.newPage();
      await page.goto('/en/admin');
      await expect(page.locator('main').getByRole('link', { name: 'Login' })).toBeVisible();
      await access(page, 401);
      await login(page, owner);
      if (viewport.width > 800) {
        await page.getByRole('button', { name: owner, exact: true }).press('Enter');
        await page.getByRole('menuitem', { name: 'Admin', exact: true }).press('Enter');
      } else {
        await page.goto('/en/more');
        await page.getByRole('link', { name: 'Admin', exact: true }).click();
      }
      await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
      await page.goto('/en/profile');
      await page.getByRole('link', { name: 'Admin', exact: true }).click();
      await page.getByRole('link', { name: '7 days', exact: true }).click();
      await page.getByRole('link', { name: /Completed sessions/ }).click();
      const search = page.getByRole('searchbox');
      await search.fill(learner);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.getByRole('link', { name: learner, exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Learner report · ' + learner })
      ).toBeVisible();
      await expect(page.getByText('Practice: Lesson 2')).toBeVisible();
      await expect(page.getByText('88%', { exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBeTruthy();
      await page.goBack();
      await expect(search).toHaveValue(learner);
      await expect(page.getByRole('link', { name: learner, exact: true })).toBeVisible();
      expect(page.url()).toContain('metric=sessions');
      expect(page.url()).not.toContain(learner);
      await expect(page.getByRole('link', { name: '7 days', exact: true })).toHaveAttribute(
        'aria-current',
        'true'
      );

      const selectedLearner = page.getByRole('checkbox', {
        name: 'Select ' + learner,
        exact: true
      });
      await selectedLearner.focus();
      await selectedLearner.press('Space');
      await page.getByRole('link', { name: 'Clear', exact: true }).click();
      await search.fill(owner);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Select ' + owner, exact: true }).check();
      await expect(page.getByRole('status').filter({ hasText: '2 of 25' })).toBeVisible();
      await page.getByRole('link', { name: 'Compose email', exact: true }).click();
      const subject = 'Browser fixture ' + viewport.width;
      await page.getByLabel('Subject', { exact: true }).fill(subject);
      await page.getByLabel('Message', { exact: true }).fill('Private support follow-up.');
      await page.getByRole('button', { name: 'Review email', exact: true }).press('Enter');
      await expect(page.getByRole('heading', { name: 'Review email', exact: true })).toBeFocused();
      await expect(page.getByText('support@example.invalid', { exact: true })).toBeVisible();
      await expect(page.getByText(/Excluded.*unverified/i)).toBeVisible();
      await page.goBack();
      await expect(page.getByLabel('Subject', { exact: true })).toHaveValue(subject);
      await page.getByRole('button', { name: 'Review email', exact: true }).click();
      await page.getByRole('button', { name: 'Send to 1 learner', exact: true }).press('Enter');
      await expect(page.getByRole('heading', { name: subject, exact: true })).toBeVisible();
      await expect(async () => {
        await page.getByRole('button', { name: 'Refresh status' }).click();
        await expect(page.getByText(/Accepted by mail provider/)).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 10000 });
      await page.getByRole('link', { name: 'Sent messages', exact: true }).first().click();
      await page.getByRole('link', { name: subject, exact: true }).click();
      await expect(page.getByText('Private support follow-up.', { exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBeTruthy();
      await page.getByRole('link', { name: 'User directory', exact: true }).click();
      await search.fill(learner);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByRole('link', { name: learner, exact: true })).toBeVisible();

      // Hold a real owner search response until another tab finishes signing out.
      const delayed = Promise.withResolvers<void>();
      let intercepted = false;
      await page.route('**/admin/users/search', async (route) => {
        const response = await route.fetch();
        intercepted = true;
        await delayed.promise;
        await route.fulfill({ response }).catch(() => {});
      });
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect.poll(() => intercepted).toBe(true);
      const other = await context.newPage();
      await other.setViewportSize({ width: 390, height: 844 });
      await other.goto('/en/more');
      await other.getByRole('button', { name: 'Logout', exact: true }).click();
      await expect(page.locator('main').getByRole('link', { name: 'Login' })).toBeVisible();
      delayed.resolve();
      await expect(page.getByRole('link', { name: learner, exact: true })).toHaveCount(0);
      await access(page, 401);
      await page.unrouteAll({ behavior: 'wait' });
      await login(page, learner);
      await page.goto('/en/admin');
      await expect(page.getByText('Owner access required.')).toBeVisible();
      await access(page, 403);
      console.log(
        'Passed owner navigation, consent, compose, review, send, history, drill-down, Back, logout and access checks at width ' +
          viewport.width
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
