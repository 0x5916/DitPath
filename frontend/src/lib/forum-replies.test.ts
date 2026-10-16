import { describe, expect, it } from 'vitest';
import type { ForumReply } from './api';
import { buildForumReplyView, FORUM_REPLY_PAGE_SIZE, MAX_FORUM_REPLY_NODES } from './forum-replies';

function reply(id: string, children: ForumReply[] = []): ForumReply {
  return {
    id,
    parent_id: null,
    body: `Reply ${id}`,
    author: { username: 'alice', call_sign: null },
    is_deleted: false,
    created_at: '2026-10-13T00:00:00Z',
    children
  };
}

function chain(length: number): ForumReply[] {
  let children: ForumReply[] = [];
  for (let index = length - 1; index >= 0; index--) children = [reply(String(index), children)];
  return children;
}

describe('bounded forum reply view', () => {
  it('preserves preorder, tombstones, orphan parent IDs, and the original input', () => {
    const leaf = reply('leaf');
    const deleted = { ...reply('deleted', [leaf]), body: null, author: null, is_deleted: true };
    const root = reply('root', [deleted, reply('sibling')]);
    const orphan = { ...reply('orphan'), parent_id: 'missing-parent' };
    const input = [root, orphan];
    const before = JSON.stringify(input);
    for (const node of [root, deleted, leaf, root.children[1], orphan]) {
      Object.freeze(node.children);
      Object.freeze(node);
    }
    Object.freeze(input);

    const view = buildForumReplyView(input);
    expect(view.rows.map(({ reply: node, depth }) => [node.id, depth])).toEqual([
      ['root', 0],
      ['deleted', 1],
      ['leaf', 2],
      ['sibling', 1],
      ['orphan', 0]
    ]);
    expect(view.rows[1].reply).toMatchObject({ body: null, author: null, is_deleted: true });
    expect(view.rows[4].reply.parent_id).toBe('missing-parent');
    expect(view.rows).toHaveLength(5);
    expect(view.rows.every(({ reply: node }) => !('children' in node))).toBe(true);
    expect(view.limited).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('handles a 50,000-level chain without recursion and retains logical depth', () => {
    const view = buildForumReplyView(chain(50_000));
    expect(view.rows).toHaveLength(MAX_FORUM_REPLY_NODES);
    expect(view.rows[0]).toMatchObject({ reply: { id: '0' }, depth: 0 });
    expect(view.rows.at(-1)).toMatchObject({
      reply: { id: String(MAX_FORUM_REPLY_NODES - 1) },
      depth: MAX_FORUM_REPLY_NODES - 1
    });
    expect(view.limited).toBe(true);
  });

  it('bounds a broad input while preserving the first replies in order', () => {
    const view = buildForumReplyView(Array.from({ length: 50_000 }, (_, i) => reply(String(i))));
    expect(view.rows).toHaveLength(MAX_FORUM_REPLY_NODES);
    expect(
      view.rows.every(({ reply: node, depth }, i) => node.id === String(i) && depth === 0)
    ).toBe(true);
    expect(view.limited).toBe(true);
    expect(FORUM_REPLY_PAGE_SIZE).toBe(100);
  });

  it.each(['broad', 'deep'])('accepts exactly the node budget for a %s tree', (shape) => {
    const input =
      shape === 'deep'
        ? chain(MAX_FORUM_REPLY_NODES)
        : Array.from({ length: MAX_FORUM_REPLY_NODES }, (_, i) => reply(String(i)));
    const view = buildForumReplyView(input);
    expect(view.rows).toHaveLength(MAX_FORUM_REPLY_NODES);
    expect(view.limited).toBe(false);
  });

  it('marks a single pending node beyond the budget as limited', () => {
    const view = buildForumReplyView(chain(MAX_FORUM_REPLY_NODES + 1));
    expect(view.rows).toHaveLength(MAX_FORUM_REPLY_NODES);
    expect(view.limited).toBe(true);
  });

  it('skips duplicate IDs and cyclic children without duplicating keyed rows', () => {
    const root = reply('root');
    root.children = [reply('child', [root]), reply('child', [reply('hidden')])];
    const view = buildForumReplyView([root, reply('last')]);
    expect(view.rows.map(({ reply: node }) => node.id)).toEqual(['root', 'child', 'last']);
    expect(view.limited).toBe(true);
  });

  it.each(['root', 'children'])(
    'counts skipped slots against the budget in %s arrays',
    (location) => {
      const nested = location === 'children';
      let numericReads = 0;
      const input = new Proxy(
        Array.from({ length: 50_000 }, (_, i) => (i % 2 ? null : reply('same'))),
        {
          get(target, property, receiver) {
            if (typeof property === 'string' && /^(0|[1-9]\d*)$/.test(property)) {
              numericReads++;
              if (numericReads > MAX_FORUM_REPLY_NODES)
                throw new Error('Inspection budget exceeded');
            }
            return Reflect.get(target, property, receiver);
          }
        }
      );
      const view = buildForumReplyView(
        nested ? [{ ...reply('container'), children: input }] : input
      );
      expect(numericReads).toBe(MAX_FORUM_REPLY_NODES - Number(nested));
      expect(view.rows.map(({ reply: node }) => node.id)).toEqual(
        nested ? ['container', 'same'] : ['same']
      );
      expect(view.limited).toBe(true);
    }
  );

  it('skips malformed nodes and ignores malformed children while retaining valid replies', () => {
    const view = buildForumReplyView([
      null,
      7,
      {},
      { ...reply('bad-children'), children: {} },
      reply('ok')
    ]);
    expect(view.rows.map(({ reply: node }) => node.id)).toEqual(['bad-children', 'ok']);
    expect(view.limited).toBe(true);
  });

  it.each([undefined, null, {}, 7])('marks non-array root %s as limited', (input) => {
    expect(buildForumReplyView(input)).toEqual({ rows: [], limited: true });
  });

  it('accepts an empty reply list', () => {
    expect(buildForumReplyView([])).toEqual({ rows: [], limited: false });
  });
});
