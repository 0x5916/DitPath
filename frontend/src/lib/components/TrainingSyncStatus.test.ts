import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import TrainingSyncStatus from './TrainingSyncStatus.svelte';

vi.mock('#lib/i18n.svelte.ts', () => ({ localizedHref: (path: string) => `/en${path}` }));

const account = { owner: 'account:one', pending: 0, error: null, syncing: false };

describe('training sync presentation', () => {
  it.each([
    { ...account, owner: 'unclaimed' },
    account,
    { ...account, synced: true },
    { ...account, syncing: true },
    { ...account, syncing: true, pending: 2 }
  ])('leaves routine status out of learning pages: %j', (props) => {
    const { body } = render(TrainingSyncStatus, { props });
    expect(body).not.toContain('<aside');
    expect(body).not.toContain('<button');
  });

  it('links waiting uploads to the full controls without adding a sync button', () => {
    const { body } = render(TrainingSyncStatus, { props: { ...account, pending: 3 } });
    expect(body).toContain('3 changes waiting to sync');
    expect(body).toContain('href="/en/settings#sync-storage"');
    expect(body).not.toContain('<button');
  });

  it.each([false, true])(
    'keeps download failures visible with zero uploads (syncing %s)',
    (syncing) => {
      const { body } = render(TrainingSyncStatus, {
        props: { ...account, syncing, error: 'TRAINING_SYNC_FAILED' }
      });
      expect(body).toContain('Sync needs attention');
      expect(body).toContain('href="/en/settings#sync-storage"');
    }
  );

  it('surfaces terminal evidence rejections without blocking valid synchronization', () => {
    const collapsed = render(TrainingSyncStatus, {
      props: { ...account, synced: true, rejected: 2 }
    }).body;
    expect(collapsed).toContain('Sync needs attention');
    expect(collapsed).toContain('href="/en/settings#sync-storage"');
    const expanded = render(TrainingSyncStatus, {
      props: { ...account, expanded: true, synced: true, rejected: 2, onSync() {} }
    }).body;
    expect(expanded).toContain('Some history could not sync');
    expect(expanded).toContain('Permanently rejected records: 2');
    expect(expanded).not.toContain('blocked by rejected evidence');
    expect(expanded).toContain('Sync now');
  });

  it('distinguishes retryable, permanently rejected and dependency-blocked records', () => {
    const { body } = render(TrainingSyncStatus, {
      props: {
        ...account,
        expanded: true,
        synced: false,
        pending: 3,
        rejected: 2,
        blocked: 4,
        onSync() {}
      }
    });
    expect(body).toContain('3 changes are waiting to sync');
    expect(body).toContain('Permanently rejected records: 2');
    expect(body).toContain('Records blocked by rejected evidence: 4');
    expect(body).not.toContain('Synced across your devices');
  });

  it('keeps the normal fully synchronized state concise', () => {
    const { body } = render(TrainingSyncStatus, {
      props: { ...account, expanded: true, synced: true, onSync() {} }
    });
    expect(body).toContain('Synced across your devices');
    expect(body).not.toContain('waiting to sync');
    expect(body).not.toContain('permanently rejected');
    expect(body).not.toContain('blocked by');
  });

  it('keeps manual synchronization and explicit history import in expanded details', () => {
    const { body } = render(TrainingSyncStatus, {
      props: {
        ...account,
        expanded: true,
        synced: true,
        unclaimedCount: 2,
        onSync() {},
        onImport() {}
      }
    });
    expect(body).toContain('Synced across your devices');
    expect(body).toContain('Sync now');
    expect(body).toContain('2 unclaimed history records');
    expect(body).toContain('Import history from this device');
  });

  it('explains device-only history without account controls for a guest', () => {
    const { body } = render(TrainingSyncStatus, {
      props: {
        ...account,
        owner: 'unclaimed',
        expanded: true,
        unclaimedCount: 2,
        onSync() {},
        onImport() {}
      }
    });
    expect(body).toContain('Saved on this device');
    expect(body).not.toContain('<button');
  });
});
