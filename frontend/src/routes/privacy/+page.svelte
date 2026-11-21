<script lang="ts">
  import * as m from '#lib/paraglide/messages.js';

  const supportGroup = 'morsewell-support@googlegroups.com';
</script>

<article class="page-narrow body-text body-text--prose">
  <header>
    <h1 class="page-title">{m.privacy_title()}</h1>
    <p>{m.privacy_intro()}</p>
  </header>

  <section>
    <h2 class="section-title">{m.privacy_practice_title()}</h2>
    <p>{m.privacy_practice_body()}</p>
    <p>{m.privacy_account_body()}</p>
  </section>

  <section>
    <h2 class="section-title">{m.privacy_google_title()}</h2>
    <p>{m.privacy_google_button()}</p>
    <p>{m.privacy_google_identity()}</p>
    <a class="link standalone-target" href="https://policies.google.com/privacy"
      >{m.privacy_google_policy()}</a
    >
  </section>

  <section>
    <h2 class="section-title">{m.privacy_sharing_title()}</h2>
    <p>{m.privacy_forum_body()}</p>
    <p>{m.privacy_providers_body()}</p>
  </section>

  <section>
    <h2 class="section-title">{m.privacy_choices_title()}</h2>
    <p>{m.privacy_local_controls()}</p>
    <p>{m.privacy_google_controls()}</p>
    <a class="link standalone-target" href="https://myaccount.google.com/linkedapps"
      >{m.privacy_google_links()}</a
    >
  </section>

  <section>
    <h2 class="section-title">{m.privacy_contact_title()}</h2>
    <p>{m.privacy_contact_body()}</p>
    <a class="link standalone-target" href="mailto:privacy@morsewell.com">privacy@morsewell.com</a>
    <p>{m.privacy_contact_routing()}</p>
    <a class="link standalone-target" href={`mailto:${supportGroup}`}>{supportGroup}</a>
    <p>{m.privacy_retention_body()}</p>
  </section>
</article>

<style>
  p {
    margin: var(--space-2) 0;
  }
</style>
