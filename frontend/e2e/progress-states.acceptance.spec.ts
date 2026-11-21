import { expect, test } from '@playwright/test';
import { EVIDENCE_DB, resetToHome, startAndType } from './helpers';

const characters = '/en/morse/progress?view=characters&status=met';

test('a new learner can start their first lesson even from a filtered Characters URL', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await resetToHome(page);
  await page.goto(characters);
  await expect(page.getByRole('heading', { name: 'No training history yet' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Character status' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to Lessons' }).click();
  await expect(page).toHaveURL(/\/en\/morse\/learn$/);
  await expect(page.getByRole('button', { name: 'Start lesson 1' })).toBeVisible();
});

test('listening to practice without submitting records exposure without a guided character result', async ({
  page
}) => {
  await resetToHome(page);
  await page.goto('/en/morse/practice');
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.goto(characters);
  await expect(
    page.getByRole('heading', { name: 'No guided character records yet' })
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'View practice history' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Character status' })).toHaveCount(0);
});

test('a saved free-practice session appears in activity and history without a guided result', async ({
  page
}) => {
  await resetToHome(page);
  await page.goto('/en/morse/practice');
  const answer = await startAndType(page);
  await answer.press('Enter');
  await expect(page.getByText('Practice result saved on this device')).toBeVisible();
  await page.goto('/en/morse/progress');
  const activity = page.getByRole('region', { name: 'Recent activity summary' });
  await expect(activity.locator('.session-metric .metric-val')).toHaveText('1');
  await expect(activity.locator('.accuracy-measure')).toHaveText('Not measured');
  await page.getByRole('link', { name: 'Characters', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No guided character records yet' })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show all characters' })).toHaveCount(0);
  await page.getByRole('link', { name: 'View practice history' }).click();
  await expect(page.getByText('Practice: Lesson 1', { exact: true })).toBeVisible();
});

test('an empty status filter resets to all recorded characters and returns keyboard focus', async ({
  page
}) => {
  await resetToHome(page, 'Returning learner / populated history');
  await page.goto(characters);
  const filter = page.getByRole('combobox', { name: 'Character status' });
  await expect(filter).toHaveValue('met');
  await expect(page.getByText('No characters match this status.')).toBeVisible();
  await page.getByRole('button', { name: 'Show all characters' }).press('Enter');
  await expect(filter).toHaveValue('all');
  await expect(filter).toBeFocused();
  await expect(page).toHaveURL(/view=characters&status=all$/);
  const records = page.getByRole('region', { name: 'Characters' });
  await expect(records.locator('summary strong')).toHaveText(['K', 'M']);
  await page.goBack();
  await expect(filter).toHaveValue('met');
  await expect(page.getByText('No characters match this status.')).toBeVisible();
  await filter.selectOption('all');
  await expect(page).toHaveURL(/view=characters&status=all$/);
  await expect(records.locator('summary strong')).toHaveText(['K', 'M']);
  await records.locator('summary').first().press('Enter');
  await expect(records.getByRole('heading', { name: 'Past milestones' })).toBeVisible();
});

test('loading and a storage failure stay distinct from empty history and retry recovers', async ({
  page
}) => {
  await resetToHome(page, 'Returning learner / populated history');
  await page.evaluate(() =>
    sessionStorage.setItem('acceptance.loadingUntil', String(Date.now() + 2500))
  );
  await page.addInitScript((database) => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, version) {
      if (name === database && !sessionStorage.getItem('test.enableEvidenceRead')) {
        throw new DOMException('Fixture: history unavailable', 'InvalidStateError');
      }
      return open.call(this, name, version);
    };
  }, EVIDENCE_DB);
  await page.goto(characters);
  const error = page.getByRole('alert').filter({ hasText: 'Progress could not be read' });
  await expect(error).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No training history yet' })).toHaveCount(0);
  await page.evaluate(() => sessionStorage.setItem('test.enableEvidenceRead', '1'));
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect(page.getByText('No characters match this status.')).toBeVisible();
  await page.evaluate(() =>
    sessionStorage.setItem('acceptance.loadingUntil', String(Date.now() + 2500))
  );
  await page.reload();
  await expect(page.locator('.progress-container .loading-card[role=status]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No training history yet' })).toHaveCount(0);
  await expect(page.getByText('No characters match this status.')).toBeVisible();
});
