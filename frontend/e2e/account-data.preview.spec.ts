import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { loadEnv } from 'vite';

test.use({ serviceWorkers: 'block' });

const sectionNames = [
  'Appearance & language',
  'Sound defaults',
  'Sync & storage',
  'Learning evidence',
  'Account',
  'Account data',
  'Advanced preferences'
];

const operatorId = '12345678-1234-4123-8123-123456789abc';
function tokenFor(id: string) {
  const claims = Buffer.from(
    JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  return `test.${claims}.test`;
}
async function downloadArchive(page: Page, section: Locator) {
  const downloading = page.waitForEvent('download');
  await section.getByRole('button', { name: 'Download JSON' }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/^morsewell-account-.*\.json$/);
  return JSON.parse(await readFile((await file.path())!, 'utf8'));
}

const legacySession = {
  session_id: 'legacy:81f25d5e-042c-4897-9b69-950c94bc91ff',
  source_kind: 'legacy_v1',
  status: 'completed',
  lesson: 4,
  accuracy: 0.9,
  char_wpm: 20,
  eff_wpm: 12,
  event_ids: [],
  occurred_at: '2026-10-10T10:00:00.000Z',
  occurred_at_source: 'legacy_server_receipt'
};

async function settings(
  page: Page,
  password: boolean,
  initial?: { hash: string; profileReady: Promise<void> }
) {
  const accessToken = tokenFor(operatorId);
  await page.addInitScript((token) => {
    if (sessionStorage.getItem('fixture-initialized')) return;
    sessionStorage.setItem('fixture-initialized', 'yes');
    localStorage.setItem('username', 'operator');
    localStorage.setItem('access_token', token);
    localStorage.setItem('refresh_token', 'test-refresh');
  }, accessToken);
  let epoch = 1;
  let challengeNumber = 0;
  const deletes: unknown[] = [];
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/v1/user/me' && request.method() === 'DELETE') {
      const proof = request.postDataJSON();
      deletes.push(proof);
      if (password && proof.current_password !== 'confirmed')
        return route.fulfill({ status: 401, json: { code: 'INVALID_CREDENTIALS' } });
      if (!password) {
        expect(request.headers()['x-opencw-auth']).toBe('google');
        if (
          proof.challenge !== `fixture-challenge-${challengeNumber}` ||
          proof.credential !== `fixture-proof-${challengeNumber}`
        )
          return route.fulfill({ status: 401, json: { code: 'GOOGLE_CREDENTIAL_INVALID' } });
      }
      return route.fulfill({ status: 204 });
    }
    if (path === '/v1/user/progress') {
      expect(request.method()).toBe('DELETE');
      expect(request.headers()['x-training-epoch']).toBe(String(epoch));
      return route.fulfill({
        status: 204,
        headers: {
          'X-Training-Epoch': String(++epoch),
          'Access-Control-Expose-Headers': 'X-Training-Epoch'
        }
      });
    }
    if (path === '/v1/user/deletion-challenge') {
      expect(request.headers()['x-opencw-auth']).toBe('google');
      challengeNumber++;
      return route.fulfill({
        json: {
          challenge: `fixture-challenge-${challengeNumber}`,
          nonce: `fixture-nonce-${challengeNumber}`
        }
      });
    }
    if (path === '/v1/user/me') {
      await initial?.profileReady;
      return route.fulfill({
        json: {
          username: 'operator',
          email: 'operator@example.invalid',
          email_verified: true,
          call_sign: null,
          password_enabled: password,
          google_linked: !password
        }
      });
    }
    if (path === '/v1/settings/all')
      return route.fulfill({
        json: {
          cw_settings: { char_wpm: 20, eff_wpm: 12, freq: 600, start_delay: 0.5 },
          page_settings: { cur_lesson: epoch === 1 ? 4 : 1, language: 'en' }
        }
      });
    if (path === '/v1/settings/email-preferences')
      return route.fulfill({
        json: { email: 'operator@example.invalid', verified: true, support: true, product: false }
      });
    if (path === '/v1/training/snapshot')
      return route.fulfill({
        json: { character_masteries: [], suggested_step: 1, unlocked_step: 1 }
      });
    if (path.endsWith('/changes')) {
      const firstPage = !new URL(request.url()).searchParams.has('cursor');
      const history =
        path === '/v1/training/changes' &&
        firstPage &&
        epoch === 1 &&
        request.headers().authorization === `Bearer ${accessToken}`;
      return route.fulfill({
        headers: {
          'X-Training-Epoch': String(epoch),
          'Access-Control-Expose-Headers': 'X-Training-Epoch'
        },
        json: {
          changes: history ? [{ revision: '1', kind: 'session', record: legacySession }] : [],
          has_more: false,
          next_cursor: 'fixture-cursor'
        }
      });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(`/en/settings${initial?.hash ?? ''}`);
  if (!initial) await page.getByRole('link', { name: 'Account data' }).click();
  return {
    section: page.locator('#account-data'),
    dialog: page.getByRole('alertdialog'),
    deletes,
    epoch: () => epoch
  };
}

test('desktop Settings sidebar restores a deferred account link and follows browser history', async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const profile = Promise.withResolvers<void>();
  const { section } = await settings(page, true, {
    hash: '#account-data',
    profileReady: profile.promise
  });
  await expect(section).toHaveCount(0);
  profile.resolve();
  const rail = page
    .locator('nav')
    .filter({ has: page.getByRole('link', { name: 'Account data', exact: true }) });
  await expect(rail.getByRole('link')).toHaveText(sectionNames);
  await expect(
    section.getByRole('heading', { name: 'Account data', exact: true })
  ).toBeInViewport();
  const active = rail.locator('a[aria-current="location"]');
  await expect(active).toHaveText('Account data');
  const expectAligned = () =>
    expect
      .poll(() =>
        section.evaluate((element) =>
          Math.abs(
            element.getBoundingClientRect().top -
              parseFloat(getComputedStyle(element).scrollMarginBlockStart)
          )
        )
      )
      .toBeLessThanOrEqual(3);
  await expectAligned();
  const railBox = await rail.boundingBox();
  expect(railBox!.x + railBox!.width).toBeLessThan((await section.boundingBox())!.x);
  await expect(rail.getByRole('link', { name: 'Appearance & language' })).toBeInViewport();
  const sound = rail.getByRole('link', { name: 'Sound defaults' });
  await sound.focus();
  await sound.press('Enter');
  await expect(page).toHaveURL(/#sound-defaults$/);
  await expect(active).toHaveText('Sound defaults');
  await expect(page.locator('#sound-defaults h2')).toBeInViewport();
  await page.goBack();
  await expect(active).toHaveText('Account data');
  await page.goForward();
  await expect(active).toHaveText('Sound defaults');
  const scrollDistance = await page
    .locator('#learning-evidence')
    .evaluate(
      (section) =>
        Math.ceil(
          section.getBoundingClientRect().top -
            parseFloat(getComputedStyle(section).scrollMarginBlockStart)
        ) + 8
    );
  await page.mouse.move(900, 350);
  await page.mouse.wheel(0, scrollDistance);
  await expect(active).toHaveText('Learning evidence');
  await rail.getByRole('link', { name: 'Account data' }).click();
  await expect(active).toHaveText('Account data');
  await expectAligned();
});

test.describe('mobile Settings directory', () => {
  test.use({ hasTouch: true });
  test('opens a single section and restores the directory’s history, keyboard focus and scroll position', async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 380 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settings(page, true, { hash: '', profileReady: Promise.resolve() });
    const directory = page.getByRole('navigation', { name: 'Settings', exact: true });
    await expect(directory.getByRole('link')).toHaveText(sectionNames);
    await expect(page.locator('#preferences')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Download JSON' })).toHaveCount(0);
    const data = directory.getByRole('link', { name: 'Account data', exact: true });
    await data.scrollIntoViewIfNeeded();
    await data.focus();
    const y = await page.evaluate(() => scrollY);
    expect(y).toBeGreaterThan(0);
    await page.keyboard.press('Enter');
    const heading = page.getByRole('heading', { name: 'Account data', exact: true });
    await expect(page).toHaveURL(/#account-data$/);
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Download JSON' })).toBeVisible();
    await expect(directory).toBeHidden();
    await expect(page.locator('#sound-defaults')).toBeHidden();
    await page.goBack();
    await expect(data).toBeFocused();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(y, 0);
    await page.goForward();
    await expect(heading).toBeVisible();
    await page.getByRole('link', { name: 'Back to Settings' }).tap();
    await expect(data).toBeFocused();
    await expect(directory.getByRole('link')).toHaveText(sectionNames);
    await directory.getByRole('link', { name: 'Advanced preferences' }).tap();
    await expect(
      page.getByRole('spinbutton', { name: 'Starting lesson for practice' })
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  });

  test('restores the guest recovery deep link and directory', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 680 });
    await page.goto('/en/settings#device-recovery');
    const back = page.getByRole('link', { name: 'Back to Settings' });
    await expect(page.locator('#device-recovery h3')).toBeInViewport();
    await expect(page.locator('#learning-evidence')).toBeHidden();
    await back.tap();
    const directory = page.getByRole('navigation', { name: 'Settings', exact: true });
    await expect(directory.getByRole('link')).toHaveText(
      sectionNames.filter((n) => n !== 'Account data')
    );
    await directory.getByRole('link', { name: 'Appearance & language' }).click();
    await expect(page.getByRole('combobox', { name: 'Theme', exact: true })).toBeVisible();
    const opened = await page.evaluate(() => performance.timeOrigin);
    await page.goto('/en/settings#device-recovery');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(opened);
    await expect(page.locator('#device-recovery h3')).toBeInViewport();
    await expect(page.getByRole('combobox', { name: 'Theme', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete account' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  });

  test('restores delayed signed-in links across the desktop breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 680 });
    const back = page.getByRole('link', { name: 'Back to Settings' });
    const directory = page.getByRole('navigation', { name: 'Settings', exact: true });
    const profile = Promise.withResolvers<void>();
    const { section } = await settings(page, true, {
      hash: '#account-data',
      profileReady: profile.promise
    });
    await expect(section).toHaveCount(0);
    profile.resolve();
    await expect(section.getByRole('heading', { name: 'Account data' })).toBeInViewport();
    await expect(back).toBeVisible();
    await page.setViewportSize({ width: 960, height: 680 });
    await expect(directory.getByRole('link')).toHaveText(sectionNames);
    await expect(directory.locator('a[aria-current="location"]')).toHaveText('Account data');
    await expect(page.locator('#learning-evidence')).toBeVisible();
    await expect(back).toBeHidden();
    await page.setViewportSize({ width: 959, height: 680 });
    await expect(back).toBeVisible();
    await expect(page.locator('#learning-evidence')).toBeHidden();
    await expect(section).toBeVisible();
  });
});

test('guests have no account data actions', async ({ page }) => {
  await page.goto('/en/settings');
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await expect(page.locator('#account-data')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Account data' })).toHaveCount(0);
});

test('an open reset confirmation cannot erase a newer generation', async ({ page }) => {
  const { section, dialog, epoch } = await settings(page, true);
  await section.getByRole('button', { name: 'Reset progress' }).click();
  await dialog.getByRole('checkbox').check();
  await page.evaluate(() => {
    localStorage.setItem('morsewell.training-epoch.12345678-1234-4123-8123-123456789abc', '2');
  });
  await dialog.getByRole('button', { name: 'Reset progress' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Your progress changed');
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Reset progress' })).toBeDisabled();
  expect(epoch()).toBe(1);
});

test('signed-in learner downloads JSON, confirms reset and re-enters their password to delete', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 680 });
  const { section, dialog, deletes, epoch } = await settings(page, true);
  expect(await downloadArchive(page, section)).toMatchObject({
    account: { id: operatorId, username: 'operator' },
    preferences: { email: { support: true } },
    learning_progress: {
      sessions: [{ session_id: legacySession.session_id, lesson: 4, accuracy: 0.9 }]
    }
  });
  const reset = section.getByRole('button', { name: 'Reset progress' });
  await reset.click();
  const confirmReset = dialog.getByRole('button', { name: 'Reset progress' });
  await expect(confirmReset).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.press('Escape');
  await expect(reset).toBeFocused();
  expect(epoch()).toBe(1);
  await reset.click();
  await dialog.getByRole('checkbox').check();
  await confirmReset.click();
  await expect(section.getByRole('status')).toContainText('Your learning progress has been reset.');
  expect(epoch()).toBe(2);
  const afterReset = await downloadArchive(page, section);
  expect(afterReset).toMatchObject({
    account: { id: operatorId },
    preferences: {
      page: { language: 'en', cur_lesson: 1 },
      sound: { freq: 600 },
      email: { support: true }
    },
    learning_progress: { sessions: [], this_device: { sessions: [] } }
  });

  await page.emulateMedia({ colorScheme: 'dark' });
  await section.getByRole('button', { name: 'Delete account' }).click();
  await expect(dialog).toHaveAccessibleDescription(/replies from others in threads you started/);
  await expect(dialog.getByRole('button', { name: 'Delete account' })).toBeDisabled();
  await dialog.getByLabel('Current Password').fill('incorrect');
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/password is incorrect/);
  await expect(dialog.getByLabel('Current Password')).toHaveValue('');
  expect(deletes).toHaveLength(1);
  await dialog.getByLabel('Current Password').fill('confirmed');
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL(/\/en\/?$/);
  await expect(
    page.getByRole('status').filter({ hasText: 'Your account was deleted.' })
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('access_token'))).toBeNull();
});

test('Google deletion requires a fresh proof and explicit confirmation after a refused selection', async ({
  page
}) => {
  const configured =
    process.env.PUBLIC_GOOGLE_CLIENT_ID ??
    loadEnv('production', process.cwd(), 'PUBLIC_GOOGLE_CLIENT_ID').PUBLIC_GOOGLE_CLIENT_ID;
  test.skip(!configured, 'Requires a configured Google client ID');
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `let accept, proof; window.google = {accounts:{id:{
      initialize(options){ accept=options.callback; proof=options.nonce === 'fixture-nonce-1' ? 'wrong-google-account' : options.nonce.replace('nonce','proof'); },
      renderButton(host,options){const b=document.createElement('button'); b.textContent='Continue with Google'; b.onclick=()=>{ options.click_listener();accept({credential:proof}) }; host.replaceChildren(b);}
    }}};`
    })
  );
  const { section, dialog, deletes } = await settings(page, false);
  await section.getByRole('button', { name: 'Delete account' }).click();
  await dialog.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Google account selected');
  expect(deletes).toEqual([]);
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Delete account' })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('username'))).toBe('operator');
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await dialog.getByRole('button', { name: 'Continue with Google' }).click();
  expect(deletes).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL(/\/en\/?$/);
  expect(deletes).toEqual([
    { challenge: 'fixture-challenge-1', credential: 'wrong-google-account' },
    { challenge: 'fixture-challenge-2', credential: 'fixture-proof-2' }
  ]);
});

test('a failed export produces no partial download and a failed reset needs a new confirmation', async ({
  page
}) => {
  const { section, dialog, epoch } = await settings(page, true);
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.route(
    '**/v1/training/snapshot',
    (route) => route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } }),
    { times: 1 }
  );
  await section.getByRole('button', { name: 'Download JSON' }).click();
  await expect(section.getByRole('alert')).toHaveText('Couldn’t download your data. Try again.');
  expect(downloads).toBe(0);
  expect((await downloadArchive(page, section)).account.id).toBe(operatorId);
  await expect(section.getByRole('alert')).toHaveCount(0);
  await page.route(
    '**/v1/user/progress',
    (route) => route.fulfill({ status: 500, json: { code: 'DATABASE_FAILURE' } }),
    { times: 1 }
  );
  await section.getByRole('button', { name: 'Reset progress' }).click();
  const confirm = dialog.getByRole('button', { name: 'Reset progress' });
  await dialog.getByRole('checkbox').check();
  await confirm.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await expect(confirm).toBeDisabled();
  expect(epoch()).toBe(1);
  await dialog.getByRole('checkbox').check();
  await confirm.click();
  await expect(section.getByRole('status')).toContainText('Your learning progress has been reset.');
  expect(epoch()).toBe(2);
});

test('an expired session cannot submit an armed account deletion', async ({ page }) => {
  const { section, dialog, deletes } = await settings(page, true);
  await section.getByRole('button', { name: 'Delete account' }).click();
  await dialog.getByLabel('Current Password').fill('confirmed');
  await page.route('**/v1/auth/refresh', (route) =>
    route.fulfill({ status: 401, json: { code: 'INVALID_TOKEN' } })
  );
  await page.clock.setFixedTime(new Date(Date.now() + 2 * 60 * 60 * 1000));
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(section).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('access_token'))).toBeNull();
  expect(deletes).toEqual([]);
});

test('switching accounts discards an open deletion confirmation and an in-flight export', async ({
  page,
  context
}) => {
  const { section, dialog, deletes } = await settings(page, true);
  const secondId = '87654321-4321-4321-8321-cba987654321';
  const secondToken = tokenFor(secondId);
  await page.route('**/v1/user/me', (route) => {
    if (
      route.request().method() !== 'GET' ||
      route.request().headers().authorization !== `Bearer ${secondToken}`
    )
      return route.fallback();
    return route.fulfill({
      json: {
        username: 'second',
        email: 'second@example.invalid',
        email_verified: true,
        call_sign: null,
        password_enabled: true,
        google_linked: false
      }
    });
  });
  const started = Promise.withResolvers<void>(),
    settle = Promise.withResolvers<void>();
  await page.route(
    '**/v1/training/snapshot',
    async (route) => {
      started.resolve();
      await settle.promise;
      await route.fulfill({
        json: { character_masteries: [], suggested_step: 1, unlocked_step: 1 }
      });
    },
    { times: 1 }
  );
  let downloads = 0;
  page.on('download', () => downloads++);
  await section.getByRole('button', { name: 'Download JSON' }).click();
  await started.promise;
  await section.getByRole('button', { name: 'Delete account' }).click();
  await dialog.getByLabel('Current Password').fill('first-account-password');
  const peer = await context.newPage();
  try {
    await peer.goto(new URL('/robots.txt', page.url()).href);
    await peer.evaluate((token) => {
      localStorage.setItem('access_token', token);
      localStorage.setItem('refresh_token', 'second-refresh');
      localStorage.setItem('username', 'second');
    }, secondToken);
    await expect(dialog).toHaveCount(0);
  } finally {
    settle.resolve();
    await peer.close();
  }
  const archive = await downloadArchive(page, section);
  expect(archive.account).toMatchObject({
    id: secondId,
    username: 'second',
    email: 'second@example.invalid'
  });
  expect(archive.learning_progress.sessions).toEqual([]);
  expect(downloads).toBe(1);
  expect(deletes).toEqual([]);
  await section.getByRole('button', { name: 'Delete account' }).click();
  await expect(dialog.getByLabel('Current Password')).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Delete account' })).toBeDisabled();
});
