<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    ApiError,
    getCurrentUser,
    getMyCoordinatorDashboard,
    logout
  } from '#lib/api/client.ts';
  import type { AuthUser, CoordinatorDashboard } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let dashboard = $state<CoordinatorDashboard | null>(null);
  let loading = $state(true);
  let signingOut = $state(false);
  let errorMessage = $state('');

  onMount(() => {
    void loadPage();
  });

  async function loadPage() {
    loading = true;
    errorMessage = '';
    try {
      const session = await getCurrentUser();
      if (!session.roles.some((role) => role.code === 'CDS_COORDINATOR')) {
        await goto('/login');
        return;
      }
      currentUser = session.user;
      dashboard = await getMyCoordinatorDashboard();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load your dashboard.';
    } finally {
      loading = false;
    }
  }

  async function signOut() {
    signingOut = true;
    try {
      await logout();
    } finally {
      await goto('/login');
    }
  }

</script>

<svelte:head>
  <title>Coordinator Dashboard | NYSC CDS Platform</title>
  <meta name="description" content="Overview of your assigned CDS groups and Coordinator responsibilities." />
</svelte:head>

{#if loading}
  <main class="state-screen"><div class="loader"></div><p>Loading your Coordinator dashboard...</p></main>
{:else if !currentUser || !dashboard}
  <main class="state-screen"><h2>Dashboard unavailable</h2><p>{errorMessage}</p><a href="/login">Return to sign in</a></main>
{:else}
  <div class="workspace">
    <header class="topbar">
      <a class="brand" href="/coordinator" aria-label="Coordinator dashboard">
        <span class="brand-icon">N</span>
        <span><strong>NYSC CDS</strong><small>Coordinator workspace</small></span>
      </a>
      <nav class="topnav" aria-label="Coordinator navigation">
        <a class="active" href="/coordinator">Dashboard</a>
        <a href="/coordinator/handovers">Handovers</a>
      </nav>
      <div class="account"><div><strong>{currentUser.email}</strong><small>CDS Coordinator</small></div><button class="signout" type="button" onclick={signOut} disabled={signingOut}>{signingOut ? 'Signing out...' : 'Sign out'}</button></div>
    </header>

    <main class="content">
      <section class="welcome">
        <div><span class="eyebrow">COORDINATOR OVERVIEW</span><h1>Welcome back</h1><p>Here is an overview of the CDS groups currently assigned to your account.</p></div>
        <a class="outline-button" href="/coordinator/handovers">View handover inbox</a>
      </section>

      {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}

      <section class="stats" aria-label="Coordinator summary">
        <article class="stat-card"><span class="stat-icon">◎</span><div><small>Assigned CDS groups</small><strong>{dashboard.totalGroups}</strong></div></article>
        <article class="stat-card"><span class="stat-icon">♙</span><div><small>Active group members</small><strong>{dashboard.totalActiveMembers}</strong></div></article>
        <article class="stat-card"><span class="stat-icon">↔</span><div><small>Pending handovers</small><strong>{dashboard.pendingHandovers}</strong></div></article>
      </section>

      <section class="section-heading"><div><span class="eyebrow">YOUR RESPONSIBILITIES</span><h2>Assigned CDS groups</h2><p>Only groups assigned to your Coordinator account appear here.</p></div><span class="count">{dashboard.groups.length} groups</span></section>

      {#if dashboard.groups.length === 0}
        <section class="empty"><div class="empty-icon">◎</div><h3>No CDS groups assigned</h3><p>Your LGI administrator has not assigned a CDS group to your account yet. Contact your LGI administrator to request an assignment.</p></section>
      {:else}
        <section class="group-grid">
          {#each dashboard.groups as group (group.id)}
            <article class="group-card">
              <div class="group-top"><span class="group-code">{group.code}</span><span class:inactive={!group.isActive} class="group-status">{group.isActive ? 'Active' : 'Inactive'}</span></div>
              <h3>{group.name}</h3>
              <p class="location">{group.lgaName}, {group.stateName}</p>
              {#if group.description}<p class="description">{group.description}</p>{:else}<p class="description">No group description has been added.</p>{/if}
              <div class="capacity"><div><span>Members</span><strong>{group.currentMemberCount} / {group.maxCapacity}</strong></div><div class="bar"><span style="width: {Math.min(100, group.maxCapacity > 0 ? group.currentMemberCount / group.maxCapacity * 100 : 0)}%"></span></div><small>{group.availableCapacity} spaces available</small></div>
              <a class="card-link" href="/coordinator/groups/{group.id}">View group details <span aria-hidden="true">→</span></a>
            </article>
          {/each}
        </section>
      {/if}
    </main>
    <footer>NYSC CDS Management Platform · Coordinator Workspace</footer>
  </div>
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #f5f7f5; color: #19251e; font-family: Inter, Arial, sans-serif; }
  a { color: inherit; text-decoration: none; }
  button { font: inherit; }
  .workspace { min-height: 100vh; display: flex; flex-direction: column; }
  .topbar { min-height: 78px; display: flex; align-items: center; gap: 30px; padding: 13px clamp(18px, 4vw, 58px); border-bottom: 1px solid #e5ebe6; background: #fff; }
  .brand { display: flex; align-items: center; gap: 11px; flex-shrink: 0; }
  .brand-icon { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 9px; background: #0a5c37; color: #fff; font-weight: 800; font-size: 21px; }
  .brand strong, .brand small, .account strong, .account small { display: block; }
  .brand strong { color: #0a5c37; font-size: 13px; }
  .brand small, .account small { margin-top: 4px; color: #819087; font-size: 10px; }
  .topnav { display: flex; align-items: center; gap: 7px; flex: 1; }
  .topnav a { padding: 10px 12px; color: #637368; border-radius: 7px; font-size: 11px; font-weight: 600; }
  .topnav a.active, .topnav a:hover { color: #0a5c37; background: #eff6f1; }
  .account { display: flex; align-items: center; gap: 14px; }
  .account strong { max-width: 230px; overflow-wrap: anywhere; font-size: 10px; }
  .signout, .outline-button { padding: 9px 13px; border: 1px solid #d7e2da; border-radius: 8px; background: #fff; color: #27553b; font-size: 10px; font-weight: 700; cursor: pointer; }
  .content { width: min(100%, 1160px); margin: 0 auto; padding: 42px 22px; flex: 1; }
  .welcome { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; margin-bottom: 26px; }
  .eyebrow { color: #0a8050; font-size: 9px; font-weight: 700; letter-spacing: 1.4px; }
  h1 { margin: 9px 0 7px; font-size: clamp(26px, 4vw, 35px); }
  .welcome p, .section-heading p { margin: 0; color: #718078; font-size: 12px; line-height: 1.6; }
  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 42px; }
  .stat-card { display: flex; align-items: center; gap: 14px; padding: 19px; border: 1px solid #e5ebe6; border-radius: 11px; background: #fff; }
  .stat-icon { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 10px; background: #edf6ef; color: #0a8050; font-size: 23px; }
  .stat-card small, .stat-card strong { display: block; }
  .stat-card small { color: #819087; font-size: 10px; }
  .stat-card strong { margin-top: 5px; color: #123d27; font-size: 25px; }
  .section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 17px; }
  h2 { margin: 7px 0 5px; font-size: 21px; }
  .count { padding: 6px 10px; border-radius: 18px; background: #eaf4ed; color: #17613c; font-size: 10px; font-weight: 700; }
  .group-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .group-card, .empty { border: 1px solid #e5ebe6; border-radius: 12px; background: #fff; }
  .group-card { padding: 20px; }
  .group-top { display: flex; align-items: center; justify-content: space-between; }
  .group-code { color: #0a8050; font-size: 10px; font-weight: 800; letter-spacing: .7px; }
  .group-status { padding: 5px 9px; border-radius: 16px; background: #e9f6ed; color: #147244; font-size: 9px; font-weight: 700; }
  .group-status.inactive { background: #f1f2f1; color: #6d7770; }
  .group-card h3 { margin: 13px 0 5px; font-size: 17px; }
  .location { margin: 0; color: #718078; font-size: 10px; }
  .description { min-height: 34px; margin: 12px 0; color: #7b887f; font-size: 10px; line-height: 1.6; }
  .capacity { padding: 13px 0; border-top: 1px solid #edf1ed; }
  .capacity > div:first-child { display: flex; justify-content: space-between; margin-bottom: 9px; color: #6e7d73; font-size: 10px; }
  .capacity strong { color: #234a32; }
  .bar { height: 6px; overflow: hidden; border-radius: 8px; background: #edf1ed; }
  .bar span { display: block; height: 100%; border-radius: inherit; background: #0a8050; }
  .capacity small { display: block; margin-top: 7px; color: #8a958d; font-size: 9px; }
  .card-link { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding-top: 13px; border-top: 1px solid #edf1ed; color: #0a6a41; font-size: 10px; font-weight: 700; }
  .card-link:hover { color: #064526; }
  .empty { padding: 44px 20px; text-align: center; }
  .empty-icon { color: #0a8050; font-size: 30px; }
  .empty h3 { margin: 10px 0 7px; font-size: 16px; }
  .empty p { max-width: 520px; margin: 0 auto; color: #819087; font-size: 11px; line-height: 1.7; }
  .message { padding: 11px 13px; margin: 15px 0; border-radius: 8px; font-size: 11px; }
  .message.error { border: 1px solid #efceca; background: #fff3f2; color: #a32920; }
  footer { padding: 20px; border-top: 1px solid #e5ebe6; color: #89948c; font-size: 10px; text-align: center; }
  .state-screen { min-height: 100vh; display: grid; place-content: center; justify-items: center; gap: 10px; color: #53665a; font: 13px Inter, Arial, sans-serif; }
  .loader { width: 28px; height: 28px; border: 3px solid #dce8df; border-top-color: #0a8050; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 760px) { .topbar { flex-wrap: wrap; gap: 12px; } .topnav { order: 3; width: 100%; flex-basis: 100%; } .account { margin-left: auto; } .group-grid { grid-template-columns: 1fr; } }
  @media (max-width: 580px) { .content { padding: 30px 16px; } .welcome { align-items: flex-start; flex-direction: column; } .stats { grid-template-columns: 1fr; gap: 9px; margin-bottom: 32px; } .account strong { max-width: 155px; } .signout { padding: 8px 9px; } }
</style>
