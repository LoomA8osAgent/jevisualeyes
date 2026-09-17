import {test, expect} from '@playwright/test';

/** E2E smoke: prompt → fixture compose → studio. Runs against a fixture-mode server;
 *  no provider credits are spent. */

test('prompt screen renders and lists demo affordances', async({page})=>{
  await page.goto('/');
  await expect(page.getByText('Describe music. Get an editable composition.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Compose'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Open hand-authored demo'})).toBeVisible();
});

test('fixture compose completes and opens the studio', async({page})=>{
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByPlaceholder(/wistful 3\/4 waltz/).fill('upbeat chiptune loop, 8 bars');
  await page.getByRole('button',{name:'Compose'}).click();
  // fixture provider may complete before the progress screen is observable —
  // assert on the terminal state, not the transient "Composing" view
  await expect(page.getByRole('button',{name:'Export MIDI'})).toBeVisible({timeout:150_000});
  await expect(page.locator('.arrlane').first()).toBeVisible();
});

test('demo project opens with notes and transport', async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Open hand-authored demo'}).click();
  await expect(page.getByRole('button',{name:'Export MIDI'})).toBeVisible();
  await expect(page.locator('.arrnote').first()).toBeVisible();
});
