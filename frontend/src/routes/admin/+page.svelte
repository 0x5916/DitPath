<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getAuthSession, user } from '#lib/auth.ts';
  import { ApiError, getUserInfo } from '#lib/api.ts';
  import { createSessionScope } from '#lib/session-scope.ts';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';
  import Workspace from '#lib/components/admin/Workspace.svelte';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import LoadingSpinner from '#lib/components/LoadingSpinner.svelte';

  const scope = createSessionScope();
  let access = $state<'loading' | 'guest' | 'owner' | 'denied' | 'error'>('loading');
  let generation = $state(-1);
  async function check() {
    const current = scope.begin();
    access = 'loading';
    try {
      const info = await getUserInfo();
      if (current()) access = info.can_lookup_users ? 'owner' : 'denied';
    } catch (e) {
      if (current()) access = e instanceof ApiError && e.status === 401 ? 'guest' : 'error';
    }
  }
  onMount(() =>
    user.subscribe((account) => {
      const next = getAuthSession().generation;
      if (!account) {
        generation = -1;
        access = 'guest';
        return;
      }
      if (next !== generation) {
        generation = next;
        void check();
      }
    })
  );
  onDestroy(scope.dispose);
  function denied(status: number) {
    access = status === 401 ? 'guest' : 'denied';
  }
</script>

<svelte:head><title>{m.admin_title()} · Morsewell</title></svelte:head>
<div class="page-stack">
  <h1 class="page-title">{m.admin_title()}</h1>
  {#if access === 'owner'}
    {#key generation}<Workspace onDenied={denied} />{/key}
  {:else if access === 'guest'}
    <a class="btn-ghost" href={localizedHref('/login')}>{m.nav_login()}</a>
  {:else if access === 'denied'}<ErrorAlert message={m.admin_denied()} />
  {:else if access === 'error'}<ErrorAlert message={m.common_load_error()} /><button
      class="btn-ghost"
      onclick={check}>{m.common_retry()}</button
    >
  {:else}<LoadingSpinner />{/if}
</div>
