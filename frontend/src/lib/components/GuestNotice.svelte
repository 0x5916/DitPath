<script lang="ts">
  import { localizedHref } from '$lib/i18n.svelte';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    /** Optional classes for the wrapping <p> (e.g. `body-text`). */
    class?: string;
    /** Overrides the default trainer notice text (e.g. the forum's own notice). */
    message?: string;
  }

  let { class: className, message }: Props = $props();
</script>

<p class={className}>
  {message ?? m.trainer_guest_notice()}
  <a href={localizedHref('/login')} class="link">{m.nav_login()}</a>
  /
  <a href={localizedHref('/register')} class="link">{m.nav_register()}</a>
</p>
