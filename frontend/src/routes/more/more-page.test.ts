import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import * as m from '#lib/paraglide/messages.js';
import MorePage from './+page.svelte';

describe('More page navigation labels', () => {
  it('uses the full Recall & Review label for the learning entry', () => {
    const { body } = render(MorePage, { props: {} });

    expect(body).toMatch(/href="[^"]*\/morse\/review"/);
    expect(body.replaceAll('&amp;', '&')).toContain(m.review_page_title());
  });
});
