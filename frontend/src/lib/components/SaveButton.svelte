<script lang="ts">
  import * as m from '$lib/paraglide/messages';

  interface Props {
    saving: boolean;
    saved: boolean;
  }

  let { saving, saved }: Props = $props();

  let label = $derived(
    saved ? m.settings_saved() : saving ? m.settings_saving() : m.settings_update()
  );
</script>

<button type="submit" class="btn-primary settings-btn-compact" disabled={saving} aria-live="polite">
  {label}
</button>
