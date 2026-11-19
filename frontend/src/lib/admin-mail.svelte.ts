import { createContext } from 'svelte';
import {
  ApiError,
  getUserInfo,
  type EmailReview,
  type MailRecipient,
  type EmailTopic
} from '#lib/api.ts';
import { getAuthSession, isAuthSessionCurrent, user } from '#lib/auth.ts';
import * as m from '#lib/paraglide/messages.js';
import { localizeApiError } from '#lib/errorLocalization.ts';

export const recipientLimit = 25;
export class MailDraft {
  recipients = $state.raw<MailRecipient[]>([]);
  topic = $state<EmailTopic>('support');
  subject = $state('');
  body = $state('');
  preview = $state.raw<EmailReview | null>(null);
  pending = $state<'preview' | 'send' | null>(null);
  // A lost queue response must retry the same signed review, even after navigation.
  attemptedReview: string | null = null;

  toggle(account: MailRecipient) {
    if (this.pending) return;
    if (this.recipients.some((r) => r.id === account.id)) {
      this.recipients = this.recipients.filter((r) => r.id !== account.id);
    } else if (this.recipients.length < recipientLimit) {
      const { id, username, email } = account;
      this.recipients = [...this.recipients, { id, username, email }];
    }
    this.preview = null;
  }
}

// The root layout owns this context so browser navigation preserves the draft.
// Replacing it when identity changes also invalidates pending component work.
export class AdminMailSession {
  owner = $state(false);
  draft = $state(new MailDraft());

  clear() {
    this.owner = false;
    this.draft = new MailDraft();
  }
  observe() {
    let generation = -1;
    let alive = true;
    const unsubscribe = user.subscribe((account) => {
      const session = getAuthSession();
      if (!account || generation !== session.generation) this.clear();
      if (!account) {
        generation = -1;
        return;
      }
      if (generation === session.generation && this.owner) return;
      generation = session.generation;
      void getUserInfo()
        .then((info) => {
          if (alive && isAuthSessionCurrent(session)) this.owner = info.can_lookup_users === true;
        })
        .catch(() => {});
    });
    return () => {
      alive = false;
      unsubscribe();
      this.clear();
    };
  }
}
export const [getAdminMailSession, setAdminMailSession] = createContext<AdminMailSession>();

export const topicLabels = { support: m.mail_support, product: m.mail_product };
export function mailReason(reason: string) {
  switch (reason) {
    case 'unverified':
      return m.mail_unverified();
    case 'opted_out':
      return m.mail_opted_out();
    case 'unavailable':
      return m.mail_unavailable();
    case 'changed':
      return m.mail_changed();
    case 'provider_rejected':
      return m.mail_rejected();
    case 'retry_expired':
      return m.mail_retry_expired();
    case 'owner_changed':
      return m.mail_owner_changed();
    case 'sending_disabled':
      return m.mail_disabled();
    default:
      return m.mail_other_reason();
  }
}
export function mailError(e: unknown) {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'MAIL_ADDRESS_CHANGED':
        return m.mail_changed();
      case 'MAIL_DISABLED':
        return m.mail_disabled();
      case 'MAIL_REVIEW_EXPIRED':
        return m.mail_expired();
      case 'MAIL_INVALID':
        return m.mail_invalid();
    }
  }
  return localizeApiError(e, m.common_load_error);
}
