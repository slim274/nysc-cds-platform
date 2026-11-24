<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import LgiSidebar from '#lib/components/LgiSidebar.svelte';
  import AnnouncementsWorkspace from '#lib/components/AnnouncementsWorkspace.svelte';
  import { ApiError, getCurrentUser, logout } from '#lib/api/client.ts';
  import type { AuthUser } from '#lib/api/client.ts';
  let user = $state<AuthUser | null>(null);
  let loading = $state(true);
  let mobileOpen = $state(false);
  onMount(() => { void load(); });
  async function load() {
    try {
      const session = await getCurrentUser();
      if (!session.roles.some((role) => role.code === 'LGI_ADMIN')) { await goto('/login'); return; }
      user = session.user;
    } catch (error) { if (error instanceof ApiError && error.status === 401) await goto('/login'); }
    finally { loading = false; }
  }
  async function signOut() { try { await logout(); } finally { await goto('/login'); } }
</script>
<svelte:head><title>CDS Announcements | NYSC CDS Platform</title></svelte:head>
{#if loading}
  <main class="state">Loading…</main>
{:else if user}
  <div class="dashboard">
    <LgiSidebar activePath="/lgi/announcements" open={mobileOpen} onClose={() => (mobileOpen = false)} onSignOut={signOut} />
    <section class="main">
      <header class="topbar">
        <button class="menu" type="button" aria-label="Toggle navigation" aria-expanded={mobileOpen} onclick={() => (mobileOpen = !mobileOpen)}>☰</button>
        <div><small>Administration / CDS Announcements</small><h1>CDS Announcements</h1></div>
        <div class="account">
          <div class="avatar">LG</div>
          <div class="account-copy">
            <strong>LGI Administrator</strong>
            <span>{user.email}</span>
          </div>
        </div>
      </header>
      <main class="content"><AnnouncementsWorkspace role="LGI_ADMIN" /></main>
      <footer>NYSC CDS Management Platform · LGI Administration</footer>
    </section>
  </div>
{:else}
  <main class="state"><a href="/login">Return to sign in</a></main>
{/if}
<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#f4f7f5;color:#17251c;font-family:Inter,Arial,sans-serif}.dashboard{min-height:100vh;display:flex}.main{min-width:0;flex:1;display:flex;flex-direction:column}.topbar{min-height:74px;display:flex;align-items:center;gap:14px;padding:12px 24px;border-bottom:1px solid #e5ebe6;background:#fff}.topbar small{color:#819087;font-size:9px}.topbar h1{margin:5px 0 0;font-size:19px}.account{display:flex;align-items:center;gap:10px;margin-left:auto}.avatar{width:36px;height:36px;flex:0 0 36px;display:grid;place-items:center;border-radius:50%;background:#e7f2ea;color:#0a5c37;font-size:10px;font-weight:800}.account-copy strong,.account-copy span{display:block}.account-copy strong{color:#294534;font-size:10px}.account-copy span{max-width:220px;margin-top:4px;overflow:hidden;color:#819087;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.menu{display:none;padding:8px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#24583a}.content{flex:1;min-width:0;padding:10px 15px 28px}footer{padding:16px 22px;border-top:1px solid #e8ece8;color:#89948c;font-size:9px}.state{min-height:100vh;display:grid;place-content:center;color:#65776b;font:12px Inter,Arial,sans-serif}@media(max-width:760px){.menu{display:block}.topbar{padding:12px 14px}.account-copy{display:none}.content{padding:8px 10px 24px}}
</style>
