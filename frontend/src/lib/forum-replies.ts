import type { ForumReply } from './api.ts';

export const MAX_FORUM_REPLY_NODES = 2000;
export const FORUM_REPLY_PAGE_SIZE = 100;
export type ForumReplyContent = Omit<ForumReply, 'children'>;
export interface ForumReplyRow {
  reply: ForumReplyContent;
  depth: number;
}
export interface ForumReplyView {
  rows: ForumReplyRow[];
  limited: boolean;
}

/** Bounded preorder traversal; never pass recursive payloads to presentation state. */
export function buildForumReplyView(input: unknown): ForumReplyView {
  const rows: ForumReplyRow[] = [];
  if (!Array.isArray(input)) return { rows, limited: true };
  const stack = [{ items: input as readonly unknown[], index: 0, depth: 0 }];
  const seen = new Set<string>();
  let examined = 0;
  let limited = false;

  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.items.length) {
      stack.pop();
      continue;
    }
    if (examined === MAX_FORUM_REPLY_NODES) {
      limited = true;
      break;
    }
    const value = frame.items[frame.index++];
    examined++;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      limited = true;
      continue;
    }
    const node = value as ForumReply;
    if (typeof node.id !== 'string' || !node.id || seen.has(node.id)) {
      limited = true;
      continue;
    }
    seen.add(node.id);
    const { children, ...reply } = node;
    rows.push({ reply, depth: frame.depth });
    if (Array.isArray(children) && children.length) {
      // Release exhausted ancestors; do not copy an unbounded sibling array.
      if (frame.index === frame.items.length) stack.pop();
      stack.push({ items: children, index: 0, depth: frame.depth + 1 });
    } else if (children != null && !Array.isArray(children)) {
      limited = true;
    }
  }
  return { rows, limited };
}
