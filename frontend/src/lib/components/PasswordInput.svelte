<script lang="ts">
  import { Eye, EyeOff } from '@lucide/svelte';
  import type { FullAutoFill } from 'svelte/elements';

  interface Props {
    id?: string;
    value: string;
    placeholder?: string;
    autocomplete?: FullAutoFill;
    minlength?: number;
    required?: boolean;
    showLabel: string;
    hideLabel: string;
  }

  let {
    id,
    value = $bindable(''),
    placeholder,
    autocomplete,
    minlength,
    required = false,
    showLabel,
    hideLabel
  }: Props = $props();

  let visible = $state(false);
</script>

<!-- Wraps a text input so the eye toggle can flip its `type` between `password`
     and `text` without a second, separately-tracked field. The toggle button
     must stay out of any wrapping `<label>` for the input — nesting it inside
     one lets the accname algorithm fold the button's own label into the
     input's accessible name (e.g. "Password Show password"). Callers should
     pair this with an explicit `<label for={id}>` instead of wrapping it. -->
<div class="password-field">
  <input
    {id}
    type={visible ? 'text' : 'password'}
    bind:value
    class="input password-input"
    {placeholder}
    {autocomplete}
    {minlength}
    {required}
  />
  <button
    type="button"
    class="password-toggle"
    onclick={() => (visible = !visible)}
    aria-label={visible ? hideLabel : showLabel}
    aria-pressed={visible}
  >
    {#if visible}
      <EyeOff size={16} aria-hidden="true" />
    {:else}
      <Eye size={16} aria-hidden="true" />
    {/if}
  </button>
</div>

<style>
  .password-field {
    position: relative;
    display: flex;
  }

  .password-input {
    flex: 1;
    min-width: 0;
    padding-right: 2.5rem;
  }

  .password-toggle {
    position: absolute;
    top: 50%;
    right: 0.35rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.85rem;
    height: 1.85rem;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    transform: translateY(-50%);
    transition: color var(--transition-fast);
  }

  .password-toggle:hover {
    color: var(--text-primary);
  }

  .password-toggle:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  @media (pointer: coarse) {
    .password-toggle {
      width: 2.25rem;
      height: 2.25rem;
    }
  }
</style>
