import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SettingsData from './SettingsData.svelte';

const props = { pending: 0, error: null, syncing: false, synced: true };

describe('settings synchronization clarity', () => {
  it('keeps device-only language for a guest', () => {
    const { body } = render(SettingsData, {
      props: { ...props, owner: 'unclaimed' }
    });
    expect(body).toContain('Review results stay on this device');
    expect(body).not.toContain('newer learning evidence can synchronize');
  });

  it('distinguishes legacy local review results from syncable account evidence', () => {
    const { body } = render(SettingsData, {
      props: { ...props, owner: 'account:one' }
    });
    expect(body).toContain('Older review results from this device stay local');
    expect(body).toContain('newer learning evidence can synchronize with your account');
    expect(body).not.toContain('Review results stay on this device');
  });
});
