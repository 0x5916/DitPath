import { expect, test } from '@playwright/test';
import { loadEnv } from 'vite';

test.use({ serviceWorkers: 'block' });

const googleEnabled = Boolean(
  loadEnv('production', process.cwd(), 'PUBLIC_GOOGLE_CLIENT_ID').PUBLIC_GOOGLE_CLIENT_ID
);

const signupNotice =
  'We use your email to verify your address and tell you about changes that affect access to your account. ' +
  'Support follow-ups and product updates are off by default. You can turn them on in Settings.';

const googleFixture = `
  let callback;
  window.google = { accounts: { id: {
    initialize(options) { callback = options.callback; },
    renderButton(host, options) {
      const button = document.createElement('button');
      button.textContent = 'Continue with Google';
      button.style.width = options.width + 'px';
      button.onclick = () => {
        options.click_listener();
        callback({ credential: 'local-test-credential' });
      };
      host.replaceChildren(button);
    }
  } } };
`;

for (const path of ['login', 'register']) {
  test(`${path} offers the configured sign-in methods and preserves password form entries`, async ({
    page
  }) => {
    let loads = 0;
    await page.route('https://accounts.google.com/**', (route) => {
      if (new URL(route.request().url()).pathname !== '/gsi/client') return route.abort();
      if (++loads === 1) return route.abort();
      return route.fulfill({ contentType: 'application/javascript', body: googleFixture });
    });
    await page.route('**/v1/auth/google', (route) =>
      route.fulfill({ status: 409, json: { code: 'GOOGLE_SIGNUP_REQUIRED' } })
    );
    await page.goto(`/en/${path}`);

    const name = page.getByLabel(path === 'login' ? 'Username or Email' : 'Username', {
      exact: true
    });
    const password = page.getByLabel('Password', { exact: true });
    const divider = page.getByText('or', { exact: true });
    const emailNotice = page.getByText(signupNotice, { exact: true });
    await name.fill('kept-name');
    await password.fill('local-draft');
    await expect(divider).toHaveCount(0);
    if (path === 'register') {
      await expect(emailNotice).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Register', exact: true })
      ).toHaveAccessibleDescription(signupNotice);
      await expect(page.getByRole('checkbox')).toHaveCount(0);
    } else await expect(emailNotice).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
      'href',
      '/en/privacy'
    );

    if (!googleEnabled) {
      await expect(page.getByRole('group', { name: 'Google sign-in' })).toHaveCount(0);
      await expect(password).toHaveValue('local-draft');
      expect(loads).toBe(0);
      return;
    }

    await expect(page.getByRole('alert')).toContainText('Google sign-in is unavailable');
    await expect(page.locator('.google-button')).toHaveCount(0);
    await page.getByRole('button', { name: 'Try again' }).click();
    const google = page.getByRole('button', { name: 'Continue with Google' });
    await expect(google).toBeFocused();
    const formField = await name.boundingBox();
    expect(await google.boundingBox()).toMatchObject({ x: formField?.x, width: formField?.width });
    await expect(divider).toBeVisible();
    expect(loads).toBe(2);
    await google.click();

    const googleName = page.getByLabel('Choose your Morsewell username');
    await expect(googleName).toBeFocused();
    await expect(emailNotice).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Create account', exact: true })
    ).toHaveAccessibleDescription(signupNotice);
    await expect(page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
      'href',
      '/en/privacy'
    );
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(name).toHaveCount(0);
    await expect(password).toHaveCount(0);
    await expect(divider).toHaveCount(0);
    await googleName.fill('two words');
    expect(
      await googleName.evaluate((input: HTMLInputElement) => input.validity.patternMismatch)
    ).toBe(true);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(google).toBeFocused();
    await expect(divider).toBeVisible();
    await expect(emailNotice).toHaveCount(path === 'register' ? 1 : 0);
    await expect(name).toHaveValue('kept-name');
    await expect(password).toHaveValue('local-draft');
  });
}
