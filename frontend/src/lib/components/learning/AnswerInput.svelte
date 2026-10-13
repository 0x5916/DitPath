<script lang="ts">
  import { tick } from 'svelte';
  import type { InputMode } from '../../training/v2/types';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    disabled?: boolean;
    expectedLength?: number;
    autoFocus?: boolean;
    onSubmit: (text: string, mode: InputMode) => void;
  }

  let {
    disabled = false,
    expectedLength = 1,
    autoFocus = true,
    onSubmit = () => {}
  }: Props = $props();

  let inputVal = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);
  let composing = false;

  $effect(() => {
    if (!disabled && autoFocus && inputEl) {
      tick().then(() => {
        if (!disabled && autoFocus) inputEl?.focus();
      });
    }
  });

  function handleInput(event: Event) {
    if (disabled || composing || (event as InputEvent).isComposing) return;
    const target = event.target as HTMLInputElement;
    const clean = target.value.trim().toUpperCase();
    inputVal = clean;

    // Auto-submit when expected single character or group length is reached
    if (clean.length === expectedLength) {
      submit(clean, 'keyboard');
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (disabled || composing || event.isComposing || event.keyCode === 229) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (
        !event.repeat &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        inputVal.length === expectedLength
      ) {
        submit(inputVal, 'keyboard');
      }
    }
  }

  function submit(text: string, mode: InputMode) {
    if (disabled || text.trim() === '') return;
    const finalVal = text.trim().toUpperCase();
    inputVal = '';
    onSubmit(finalVal, mode);
  }
</script>

<div class="answer-input-container">
  <input
    bind:this={inputEl}
    type="text"
    class="answer-field"
    value={inputVal}
    {disabled}
    maxlength={expectedLength}
    autocomplete="off"
    autocapitalize="characters"
    spellcheck="false"
    placeholder="·"
    aria-label={m.lesson_answer_label()}
    aria-describedby="answer-instruction"
    oninput={handleInput}
    onkeydown={handleKeydown}
    oncompositionstart={() => (composing = true)}
    oncompositionend={(event) => {
      composing = false;
      handleInput(event);
    }}
  />
  <div class="input-instruction" id="answer-instruction">
    {expectedLength === 1
      ? m.lesson_type_character()
      : m.lesson_type_group({ count: expectedLength })}
  </div>
</div>

<style>
  .answer-input-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
  }

  .answer-field {
    width: 5.5rem;
    height: 5.5rem;
    background-color: var(--bg-surface);
    border: 2px solid var(--border-control);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 3rem;
    font-weight: 700;
    text-align: center;
    text-transform: uppercase;
    transition: border-color var(--transition-fast);
  }

  .answer-field:focus {
    border-color: var(--learning-current, var(--accent));
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .answer-field:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .input-instruction {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
</style>
