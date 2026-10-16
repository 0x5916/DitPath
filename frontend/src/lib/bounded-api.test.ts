import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('./auth', () => ({
  apiFetch,
  getAuthSession: () => ({ generation: 1 }),
  assertAuthSessionCurrent: () => {}
}));

import { getForumThreadReplies, getProgressSummary, getProgressPage } from './api';
import { buildForumReplyView } from './forum-replies';

describe('bounded history API consumers', () => {
  beforeEach(() => apiFetch.mockReset());

  it('requests one forum page and preserves its continuation and parent context', async () => {
    const reply = {
      id: 'reply',
      parent_id: 'parent',
      body: 'answer',
      author: null,
      is_deleted: false,
      created_at: '2026-10-16T00:00:00Z',
      children: [],
      parent_context: {
        author: { username: 'parent-author', call_sign: null },
        body: 'earlier context',
        is_deleted: false
      }
    };
    apiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [reply],
          total: 501,
          total_rows: 502,
          limit: 100,
          next_cursor: 'next'
        })
      )
    );
    const page = await getForumThreadReplies('thread/id', 'cursor|+/=');
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith(
      '/forum/threads/thread%2Fid/replies?limit=100&cursor=cursor%7C%2B%2F%3D'
    );
    expect(page.total_rows).toBe(502);
    expect(page.next_cursor).toBe('next');
    expect(buildForumReplyView(page.data).rows[0].reply.parent_context).toEqual(
      reply.parent_context
    );
    expect(buildForumReplyView(page.data).rows).toHaveLength(1);
  });

  it('preserves progress pagination so callers cannot mistake one page for full history', async () => {
    apiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ lesson: 4 }], limit: 7, next_cursor: 'next-progress' })
      )
    );
    const page = await getProgressPage({ limit: 7, cursor: 'prior|cursor' });
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith('/cw/progress?limit=7&cursor=prior%7Ccursor');
    expect(page).toEqual({ data: [{ lesson: '4' }], limit: 7, next_cursor: 'next-progress' });
  });

  it('uses a complete yearly summary without downloading history pages', async () => {
    const summary = { days: [{ date: '2024-02-29', count: 12000 }], recent: [] };
    apiFetch.mockResolvedValue(new Response(JSON.stringify(summary)));
    await expect(getProgressSummary(2024)).resolves.toEqual(summary);
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith('/cw/progress?year=2024');
  });
});
