<script lang="ts">
  import { onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    BookOpen,
    ChevronRight,
    Cloud,
    Info,
    LogIn,
    LogOut,
    MessageSquare,
    Settings,
    SlidersHorizontal,
    User,
    UserPlus,
    Radio
  } from '@lucide/svelte';
  import { createSessionScope } from '#lib/session-scope.ts';
  import { logout, user } from '#lib/auth.ts';
  import { localizedHref as href } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';

  const scope = createSessionScope();
  onDestroy(scope.dispose);
  const groups = [
    {
      label: m.more_app_section,
      links: [
        { path: '/morse/learn', label: m.nav_learn, icon: Radio },
        { path: '/morse', label: m.morse_title, icon: BookOpen }
      ]
    },
    {
      label: m.more_community_section,
      links: [
        { path: '/forum', label: m.nav_forum, icon: MessageSquare },
        { path: '/about', label: m.nav_about, icon: Info }
      ]
    },
    {
      label: m.more_personal_section,
      links: [
        { path: '/profile', label: m.nav_profile, icon: User },
        { path: '/settings', label: m.nav_settings, icon: Settings },
        {
          path: '/settings',
          hash: '#preferences',
          label: m.settings_appearance_title,
          icon: SlidersHorizontal
        },
        {
          path: '/settings',
          hash: '#sync-storage',
          label: m.settings_sync_storage_title,
          icon: Cloud
        }
      ]
    }
  ];

  async function handleLogout() {
    const pending = logout();
    const current = scope.capture();
    await pending;
    if (current()) await goto(href('/'));
  }
</script>

<div class="page-narrow page-stack">
  <h1 class="page-title">{m.nav_more()}</h1>
  {#each groups as group (group.label)}
    <section>
      <h2 class="section-title">{group.label()}</h2>
      <ul class="more-list">
        {#each group.links as link (link.path + (link.hash ?? ''))}
          <li>
            <a href={`${href(link.path)}${link.hash ?? ''}`} class="more-link">
              <link.icon size={20} aria-hidden="true" /><span>{link.label()}</span><ChevronRight
                size={16}
                aria-hidden="true"
              />
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
  <div class="account-actions">
    {#if $user}
      <button type="button" class="btn-ghost" onclick={() => void handleLogout()}
        ><LogOut size={18} aria-hidden="true" />{m.nav_logout()}</button
      >
    {:else}
      <a class="btn-ghost" href={href('/login')}
        ><LogIn size={18} aria-hidden="true" />{m.nav_login()}</a
      >
      <a class="link" href={href('/register')}
        ><UserPlus size={18} aria-hidden="true" />{m.nav_register()}</a
      >
    {/if}
  </div>
</div>

<style>
  .section-title {
    margin: 0 0 var(--space-2);
    font-size: var(--text-lg);
    font-weight: 600;
  }
  .more-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .more-link {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--answer-target-min);
    color: var(--text-primary);
    text-decoration: none;
    padding: var(--space-2) 0;
  }
  .more-link span {
    flex: 1;
  }
  .more-link:hover {
    color: var(--accent);
  }
  .more-link :global(svg) {
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .account-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-4);
  }
  .account-actions a,
  .account-actions button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--answer-target-min);
  }
</style>
