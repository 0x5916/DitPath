<script lang="ts">
  import { tick } from 'svelte';
  import type { InputMode } from '../../training/v2/types';
  import { acceptsAnswerReplay } from './keyboard';
  import * as m from '#lib/paraglide/messages.js';

  interface Props {
    disabled?: boolean;
    expectedLength?: number;
    autoFocus?: boolean;
    value?: string;
    onReplay?: () => void;
    onSubmit: (text: string, mode: InputMode) => void;
  }

  let {
    disabled = false,
    expectedLength = 1,
    autoFocus = true,
    value = $bindable(''),
    onReplay = () => {},
    onSubmit = () => {}
  }: Props = $props();

  let composing = false;
  const inputId = $props.id();
  let inputLength = $derived(
    Number.isFinite(expectedLength) ? Math.max(1, Math.trunc(expectedLength)) : 1
  );

  function focusWhenReady(input: HTMLInputElement) {
    if (disabled || !autoFocus) return;
    let active = true;
    void tick().then(() => {
      if (active && !disabled && autoFocus) input.focus();
    });
    return () => {
      active = false;
    };
  }

  function handleInput(event: Event) {
    if (disabled || composing || (event as InputEvent).isComposing) return;
    const target = event.target as HTMLInputElement;
    const clean = target.value.trim().toUpperCase();
    value = clean;
    target.value = clean;

    // Auto-submit when expected single character or group length is reached
    if (clean.length === inputLength) {
      submit(clean, 'keyboard');
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (disabled || composing || event.isComposing || event.keyCode === 229) return;

    if (acceptsAnswerReplay(event)) {
      event.preventDefault();
      event.stopPropagation();
      onReplay();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (
        !event.repeat &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        value.length === inputLength
      ) {
        submit(value, 'keyboard');
      }
    }
  }

  function submit(text: string, mode: InputMode) {
    if (disabled || text.trim() === '') return;
    const finalVal = text.trim().toUpperCase();
    value = '';
    onSubmit(finalVal, mode);
  }
</script>

<div class="answer-input-container">
  <input
    {@attach focusWhenReady}
    type="text"
    class="answer-field"
    {value}
    {disabled}
    maxlength={inputLength}
    style:--answer-length={inputLength}
    autocomplete="off"
    autocorrect="off"
    inputmode="text"
    enterkeyhint="done"
    autocapitalize="characters"
    spellcheck="false"
    aria-label={m.lesson_answer_label()}
    aria-describedby={`${inputId}-instruction`}
    oninput={handleInput}
    onkeydown={handleKeydown}
    oncompositionstart={() => (composing = true)}
    oncompositionend={(event) => {
      composing = false;
      handleInput(event);
    }}
  />
  <div class="input-instruction" id={`${inputId}-instruction`}>
    {inputLength === 1 ? m.lesson_type_character() : m.lesson_type_group({ count: inputLength })}
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
    width: min(100%, calc(var(--answer-length) * 1.1em + var(--space-6)));
    min-width: 5.5rem;
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
    border-color: var(--learning-current);
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
