<script lang="ts">
  import type { Snippet } from 'svelte';
  import { PUBLIC_GOOGLE_CLIENT_ID } from '$app/env/public';
  import GoogleSignIn from '#lib/components/GoogleSignIn.svelte';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';

  interface Props {
    title: string;
    subtitle: string;
    loading: boolean;
    authRevision: number;
    footer: Snippet;
    children: Snippet;
  }

  let { title, subtitle, loading, authRevision, footer, children }: Props = $props();
</script>

<div class="page-narrow auth-layout">
  <div class="auth-card" class:with-google={PUBLIC_GOOGLE_CLIENT_ID}>
    <h1 class="page-title auth-title">{title}</h1>
    <p class="body-text auth-subtitle">{subtitle}</p>

    {#if PUBLIC_GOOGLE_CLIENT_ID}
      <GoogleSignIn disabled={loading} {authRevision} passwordForm={children} />
    {:else}
      {@render children()}
    {/if}

    <p class="body-text auth-footer-text">{@render footer()}</p>
    <p class="body-text auth-footer-text">
      <a class="link" href={localizedHref('/privacy')}>{m.privacy_title()}</a>
    </p>
  </div>
</div>

<style>
  .auth-card {
    max-width: 26rem;
    margin-left: auto;
    margin-right: auto;
    padding: 0;
  }

  .auth-card.with-google {
    max-width: min(26rem, 400px);
  }

  /* `.page-title` already carries the h1 scale; the card only owns the gap.
     No rule here: the title and its subtitle are one unit, and the card's own
     border already bounds the pair. */
  .auth-title {
    margin-bottom: var(--space-2);
  }

  .auth-subtitle {
    margin-bottom: var(--space-4);
  }

  .auth-footer-text {
    margin: var(--space-4) 0 0;
    text-align: center;
  }

  @media (max-width: 639px) {
    .auth-card {
      padding: 0;
    }
  }
</style>
