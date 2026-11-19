<script lang="ts">
  import * as m from '#lib/paraglide/messages.js';

  let {
    label,
    value = $bindable(''),
    focusOnMount = false,
    disabled = false
  }: { label: string; value: string; focusOnMount?: boolean; disabled?: boolean } = $props();
  const id = $props.id();
</script>

<div class="field">
  <label class="label-text" for={id}>{label}</label>
  <input
    {id}
    class="input"
    bind:value
    placeholder={m.register_username_placeholder()}
    autocomplete="username"
    minlength="3"
    maxlength="16"
    pattern={'[A-Za-z0-9](?:[A-Za-z0-9_]|-){1,14}[A-Za-z0-9]'}
    aria-describedby={id + '-hint'}
    required
    {disabled}
    {@attach (input) => {
      if (focusOnMount && !disabled) input.focus();
    }}
  />
  <span class="field-hint" id={id + '-hint'}>{m.register_username_hint()}</span>
</div>
