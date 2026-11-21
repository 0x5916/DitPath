import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const thread = {
  id: '01900000-0000-7000-8000-000000000003',
  category: 'general',
  title: 'Copying my first callsign',
  body: 'What helped you hear the letters?',
  author: { username: 'operator', call_sign: null },
  reply_count: 1,
  created_at: '2026-10-10T10:00:00Z',
  updated_at: '2026-10-10T10:00:00Z'
};

async function signedIn(page: Page, verified = true, ready?: Promise<void>) {
  await page.addInitScript(() => {
    const payload = btoa(
      JSON.stringify({
        sub: '01900000-0000-7000-8000-000000000001',
        exp: Date.now() / 1000 + 3600
      })
    );
    localStorage.setItem('access_token', `fixture.${payload}.fixture`);
    localStorage.setItem('username', 'operator');
  });
  await page.route('**/v1/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/v1/user/me', async (route) => {
    await ready;
    await route.fulfill({ json: { username: 'operator', email_verified: verified } });
  });
}

async function checkTargets(...controls: Locator[]) {
  for (const locator of controls) {
    const targets = await locator.all();
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box?.width ?? 0, target.toString()).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0, target.toString()).toBeGreaterThanOrEqual(44);
    }
  }
}

test('guest can open login, register, cancel, and recover a filtered list at phone width', async ({
  page,
  browserName
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = true;
  await page.route('**/v1/forum/threads?**', (route) => {
    if (fail) return route.fulfill({ status: 503, json: { code: 'FORUM_QUERY_FAILED' } });
    const data = new URL(route.request().url()).searchParams.has('category') ? [] : [thread];
    return route.fulfill({ json: { data, total: data.length } });
  });
  await page.goto('/en/forum?category=help');
  const forum = page.locator('.forum-page');
  await expect(forum.getByRole('alert')).toContainText('Failed to load the forum');
  fail = false;
  await forum.getByRole('button', { name: 'Try again' }).click();
  await expect(forum.getByRole('heading', { name: 'Nothing in Help yet' })).toBeVisible();
  const filters = forum.getByRole('navigation', { name: 'Forum categories' });
  await checkTargets(filters.getByRole('link'));
  await expect(filters.getByRole('link', { name: 'Help' })).toHaveAttribute('aria-current', 'page');

  const open = forum.getByRole('button', { name: 'New thread' });
  await open.press('Enter');
  const composer = forum.getByRole('region', { name: 'Start a new thread' });
  await expect(composer.getByRole('heading')).toBeFocused();
  await expect(forum.locator('.btn-primary')).toHaveCount(1);
  const login = composer.getByRole('link', { name: 'Login' });
  const register = composer.getByRole('link', { name: 'Register' });
  const cancel = composer.getByRole('button', { name: 'Cancel' });
  await expect(login).toHaveAttribute('href', '/en/login');
  await expect(register).toHaveAttribute('href', '/en/register');
  await checkTargets(login, register, cancel);
  for (const action of [login, register, cancel]) {
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(action).toBeFocused();
  }
  await page.keyboard.press('Enter');
  await expect(open).toBeFocused();
  const reset = forum.locator('.forum-empty').getByRole('link', { name: 'All' });
  await checkTargets(reset);
  await reset.click();
  await expect(forum.getByRole('heading', { name: thread.title })).toBeVisible();
});

test('unverified composer stays dismissible during lookup and directs the learner to Settings', async ({
  page
}) => {
  const profile = Promise.withResolvers<void>();
  await signedIn(page, false, profile.promise);
  await page.route('**/v1/forum/threads?**', (r) => r.fulfill({ json: { data: [], total: 0 } }));
  await page.goto('/en/forum');
  const forum = page.locator('.forum-page');
  await expect(forum.getByRole('heading', { name: 'No threads yet' })).toBeVisible();
  const open = forum.getByRole('button', { name: 'New thread' });
  await open.click();
  const composer = forum.getByRole('region', { name: 'Start a new thread' });
  await expect(composer.getByRole('status')).toBeVisible();
  await composer.getByRole('button', { name: 'Cancel' }).click();
  await expect(open).toBeFocused();
  await open.click();
  profile.resolve();
  await expect(composer.getByText(/Verify your email address/)).toBeVisible();
  await expect(composer.getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'href',
    '/en/settings'
  );
  await expect(forum.locator('.btn-primary')).toHaveCount(1);
});

test('verified composer keeps a cancelled or failed draft and publishes it once on retry', async ({
  page
}) => {
  await signedIn(page);
  const submission = Promise.withResolvers<void>();
  const posts: unknown[] = [];
  let created: typeof thread | undefined;
  await page.route('**/v1/forum/threads**', async (route) => {
    if (route.request().method() === 'POST') {
      const draft = route.request().postDataJSON();
      posts.push(draft);
      if (posts.length === 1) {
        await submission.promise;
        return route.fulfill({ status: 503, json: { code: 'FORUM_CREATE_FAILED' } });
      }
      created = { ...thread, ...draft, id: '01900000-0000-7000-8000-000000000004' };
      return route.fulfill({ status: 201, json: { data: created } });
    }
    const category = new URL(route.request().url()).searchParams.get('category');
    const data = (created ? [created, thread] : [thread]).filter(
      (t) => !category || t.category === category
    );
    return route.fulfill({ json: { data, total: data.length } });
  });
  await page.goto('/en/forum');
  const forum = page.locator('.forum-page');
  await expect(forum.getByRole('heading', { name: thread.title })).toBeVisible();
  const open = forum.getByRole('button', { name: 'New thread' });
  const composer = forum.getByRole('region', { name: 'Start a new thread' });
  await open.click();
  const post = composer.getByRole('button', { name: 'Post thread' });
  await expect(forum.locator('.btn-primary')).toHaveCount(1);
  await post.click();
  await expect(composer.getByRole('alert')).toContainText('Enter a title');
  const draft = { category: 'help', title: 'Spacing practice', body: 'How do you space words?' };
  await composer.getByLabel('Category').selectOption(draft.category);
  await composer.getByLabel('Title').fill(draft.title);
  await composer.getByLabel('Message').fill(draft.body);
  const cancel = composer.getByRole('button', { name: 'Cancel' });
  await cancel.press('Enter');
  await expect(open).toBeFocused();
  await open.press('Enter');
  await expect(composer.getByLabel('Category')).toHaveValue(draft.category);
  await expect(composer.getByLabel('Title')).toHaveValue(draft.title);
  await expect(composer.getByLabel('Message')).toHaveValue(draft.body);
  await forum.getByRole('link', { name: 'Feedback', exact: true }).click();
  await post.click();
  await expect(composer.getByRole('button', { name: /Saving/ })).toBeDisabled();
  await expect(cancel).toBeDisabled();
  submission.resolve();
  await expect(composer.getByRole('alert')).toContainText('Could not publish your post');
  await expect(composer.getByLabel('Message')).toHaveValue(draft.body);
  await post.click();
  await expect(page).toHaveURL(/category=help$/);
  await expect(forum.getByRole('heading', { name: draft.title })).toBeVisible();
  expect(posts).toEqual([draft, draft]);
  await expect(open).toBeFocused();
  await open.press('Enter');
  await expect(composer.getByLabel('Title')).toHaveValue('');
  await expect(composer.getByLabel('Message')).toHaveValue('');
});

test('thread and reply actions retain full-size hit areas on mobile and desktop', async ({
  page
}) => {
  await signedIn(page);
  await page.route('**/v1/forum/threads?**', (r) =>
    r.fulfill({ json: { data: [thread], total: 1 } })
  );
  await page.route('**/v1/forum/threads/' + thread.id, (r) =>
    r.fulfill({ json: { data: thread } })
  );
  const reply = {
    id: '01900000-0000-7000-8000-000000000005',
    author: thread.author,
    body: 'I listen every day.',
    parent_id: null,
    is_deleted: false,
    created_at: thread.created_at,
    children: []
  };
  await page.route('**/v1/forum/threads/*/replies?**', (r) =>
    r.fulfill({ json: { data: [reply], total: 1 } })
  );
  await page.goto('/en/forum');
  await page.getByRole('link', { name: new RegExp(thread.title) }).click();
  await expect(page.getByText(reply.body)).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await checkTargets(page.getByRole('link', { name: 'Back to forum' }));
    await checkTargets(
      page.getByRole('button', { name: /^(Reply|Reply to thread|Delete|Delete thread)$/ })
    );
  }
});

test.describe('Forum category hit areas', () => {
  test.use({ hasTouch: true, reducedMotion: 'reduce' });
  for (const locale of ['en', 'de']) {
    for (const width of [320, 390]) {
      test(`filters reflow and accept edge taps in ${locale} at ${width}px`, async ({
        page,
        browserName
      }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.route('**/v1/forum/threads?**', (route) =>
          route.fulfill({ json: { data: [], total: 0 } })
        );
        await page.goto(`/${locale}/forum`);
        const filters = page.locator('.forum-filters');
        await expect(filters.locator('.filter-count')).toBeVisible();
        const links = filters.getByRole('link');
        await checkTargets(links);
        const bounds = await links.evaluateAll((items) =>
          items.map((item) => {
            const { x, y, right, bottom } = item.getBoundingClientRect();
            return { x, y, right, bottom };
          })
        );
        for (const [index, rect] of bounds.entries()) {
          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.right).toBeLessThanOrEqual(width);
          if (index > 0) {
            const previous = bounds[index - 1];
            const gap = rect.y === previous.y ? rect.x - previous.right : rect.y - previous.bottom;
            expect(gap).toBeGreaterThanOrEqual(7.99);
          }
        }
        if (width === 320 && locale === 'de') expect(bounds.at(-1)!.y).toBeGreaterThan(bounds[0].y);
        const all = links.first();
        await all.focus();
        await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
        await expect(links.nth(1)).toBeFocused();
        await expect(links.nth(1)).toHaveCSS('outline-style', 'solid');
        for (const link of [links.last(), all]) {
          const size = await link.boundingBox();
          await link.tap({ position: { x: size!.width - 3, y: size!.height - 3 } });
          await expect(link).toHaveAttribute('aria-current', 'page');
        }
        expect(new URL(page.url()).searchParams.has('category')).toBe(false);
      });
    }
  }
});
