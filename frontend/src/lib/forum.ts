import { getUserInfo, type ForumCategoryValue } from '$lib/api';
import * as m from '$lib/paraglide/messages';

/** Localized display label for one of the fixed forum categories. */
export function forumCategoryLabel(category: ForumCategoryValue): string {
  switch (category) {
    case 'general':
      return m.forum_category_general();
    case 'help':
      return m.forum_category_help();
    case 'showcase':
      return m.forum_category_showcase();
    case 'feedback':
      return m.forum_category_feedback();
  }
}

/** Whole-reply count label, shared by the thread list and the thread page. */
export function formatReplyCount(count: number): string {
  return count === 1 ? m.forum_reply_one() : m.forum_reply_many({ count: String(count) });
}

export type PostingStatus = 'guest' | 'unverified' | 'ready';

/**
 * Whether the current visitor may post: guests are prompted to log in, other
 * accounts are checked for a verified email. A failed lookup resolves to
 * `ready` so a transient error never locks the composer; the API still
 * rejects unverified posts with `EMAIL_NOT_VERIFIED`.
 */
export async function resolvePostingStatus(username: string | null): Promise<PostingStatus> {
  if (!username) return 'guest';

  try {
    const info = await getUserInfo();
    return info.email_verified ? 'ready' : 'unverified';
  } catch {
    return 'ready';
  }
}
