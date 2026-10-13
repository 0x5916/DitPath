// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

declare module 'svelte/elements' {
  // Svelte types autocorrect for <input> but not for <textarea>.
  interface HTMLTextareaAttributes {
    autocorrect?: 'on' | 'off';
  }
}

export {};
