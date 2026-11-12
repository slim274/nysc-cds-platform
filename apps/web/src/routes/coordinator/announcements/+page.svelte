<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import CoordinatorLayout from '#lib/components/CoordinatorLayout.svelte';
  import AnnouncementsWorkspace from '#lib/components/AnnouncementsWorkspace.svelte';
  import { ApiError, getCurrentUser, logout } from '#lib/api/client.ts';
  import type { AuthUser } from '#lib/api/client.ts';
  let user = $state<AuthUser | null>(null);
  let loading = $state(true);
  onMount(() => { void load(); });
  async function load() {
    try {
      const session = await getCurrentUser();
      if (!session.roles.some((role) => role.code === 'CDS_COORDINATOR')) { await goto('/login'); return; }
      user = session.user;
    } catch (error) { if (error instanceof ApiError && error.status === 401) await goto('/login'); }
    finally { loading = false; }
  }
  async function signOut() { try { await logout(); } finally { await goto('/login'); } }
</script>
{#if loading}
  <main class="state">Loading…</main>
{:else if user}
  <CoordinatorLayout activePath="/coordinator/announcements" pageTitle="Announcements" userEmail={user.email} onSignOut={signOut}>
    <AnnouncementsWorkspace role="CDS_COORDINATOR" />
  </CoordinatorLayout>
{:else}
  <main class="state"><a href="/login">Return to sign in</a></main>
{/if}
<style>.state{min-height:100vh;display:grid;place-content:center;color:#65776b;font:12px Inter,Arial,sans-serif}</style>
