<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    ApiError,
    getCurrentUser,
    getMyCoordinatorGroup,
    logout
  } from '#lib/api/client.ts';
  import type { AuthUser, CoordinatorGroupDetail } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let group = $state<CoordinatorGroupDetail | null>(null);
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
      const pathSegments = window.location.pathname.split('/').filter(Boolean);
      const groupId = pathSegments[pathSegments.length - 1];
      if (!groupId) throw new Error('A CDS group ID is required.');
      group = await getMyCoordinatorGroup(groupId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load this CDS group.';
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

  function memberName(member: CoordinatorGroupDetail['members'][number]) {
    return [member.firstName, member.middleName, member.lastName].filter(Boolean).join(' ') || 'Unnamed member';
  }

  function label(value: string) {
    return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
</script>

<svelte:head>
  <title>{group ? group.code + ' | Coordinator Workspace' : 'CDS Group | Coordinator Workspace'}</title>
  <meta name="description" content="View details and active membership for an assigned CDS group." />
</svelte:head>

{#if loading}
  <main class="state-screen"><div class="loader"></div><p>Loading CDS group details...</p></main>
{:else if !currentUser || !group}
  <main class="state-screen"><h2>CDS group unavailable</h2><p>{errorMessage || 'This group may not be assigned to your Coordinator account.'}</p><a href="/coordinator">Return to dashboard</a></main>
{:else}
  <div class="workspace">
    <header class="topbar">
      <a class="brand" href="/coordinator"><span class="brand-icon">N</span><span><strong>NYSC CDS</strong><small>Coordinator workspace</small></span></a>
      <nav class="topnav" aria-label="Coordinator navigation"><a href="/coordinator">Dashboard</a><a href="/coordinator/handovers">Handovers</a></nav>
      <div class="account"><div><strong>{currentUser.email}</strong><small>CDS Coordinator</small></div><button class="signout" type="button" onclick={signOut} disabled={signingOut}>{signingOut ? 'Signing out...' : 'Sign out'}</button></div>
    </header>

    <main class="content">
      <a class="back-link" href="/coordinator">← Back to dashboard</a>
      <section class="hero">
        <div><span class="eyebrow">{group.code} · {group.lgaName}, {group.stateName}</span><h1>{group.name}</h1><p>{group.description || 'No group description has been added.'}</p></div>
        <span class:inactive={!group.isActive} class="status">{group.isActive ? 'Active group' : 'Inactive group'}</span>
      </section>

      <section class="stats" aria-label="Group summary">
        <article><small>Active members</small><strong>{group.currentMemberCount}</strong></article>
        <article><small>Maximum capacity</small><strong>{group.maxCapacity}</strong></article>
        <article><small>Available spaces</small><strong>{group.availableCapacity}</strong></article>
      </section>

      <section class="section">
        <div class="section-heading"><div><span class="eyebrow">GROUP CURRICULUM</span><h2>Mapped courses</h2></div><span class="count">{group.courses.length} courses</span></div>
        {#if group.courses.length === 0}
          <div class="empty-inline">No courses have been mapped to this group yet.</div>
        {:else}
          <div class="course-list">
            {#each group.courses as course (course.id)}
              <article class="course"><span class="course-icon">▤</span><div><strong>{course.name}</strong><small>{label(course.disciplineCategory)}</small></div></article>
            {/each}
          </div>
        {/if}
      </section>

      <section class="section">
        <div class="section-heading"><div><span class="eyebrow">GROUP ROSTER</span><h2>Active corps members</h2><p>These are the corps members currently assigned to this CDS group.</p></div><span class="count">{group.members.length} members</span></div>
        {#if group.members.length === 0}
          <div class="empty-inline">No active corps members are assigned to this group yet.</div>
        {:else}
          <div class="table-wrap">
            <table>
              <thead><tr><th>Corps member</th><th>State code</th><th>Call-up number</th><th>Profile status</th><th>Assigned</th></tr></thead>
              <tbody>
                {#each group.members as member (member.membershipId)}
                  <tr><td><strong>{memberName(member)}</strong></td><td>{member.stateCode}</td><td>{member.callUpNumber || '—'}</td><td><span class="profile-status">{label(member.profileStatus)}</span></td><td>{new Date(member.assignedAt).toLocaleDateString()}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
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
  .topnav { display: flex; gap: 7px; flex: 1; }
  .topnav a { padding: 10px 12px; color: #637368; border-radius: 7px; font-size: 11px; font-weight: 600; }
  .topnav a:hover { color: #0a5c37; background: #eff6f1; }
  .account { display: flex; align-items: center; gap: 14px; }
  .account strong { max-width: 230px; overflow-wrap: anywhere; font-size: 10px; }
  .signout { padding: 9px 13px; border: 1px solid #d7e2da; border-radius: 8px; background: #fff; color: #27553b; font-size: 10px; font-weight: 700; cursor: pointer; }
  .content { width: min(100%, 1160px); margin: 0 auto; padding: 34px 22px 45px; flex: 1; }
  .back-link { display: inline-block; margin-bottom: 23px; color: #0a6a41; font-size: 11px; font-weight: 700; }
  .hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
  .eyebrow { color: #0a8050; font-size: 9px; font-weight: 700; letter-spacing: 1.4px; }
  h1 { margin: 9px 0 7px; font-size: clamp(25px, 4vw, 34px); }
  .hero p, .section-heading p { max-width: 720px; margin: 0; color: #718078; font-size: 11px; line-height: 1.7; }
  .status, .count, .profile-status { padding: 6px 10px; border-radius: 16px; background: #e9f6ed; color: #147244; font-size: 9px; font-weight: 700; white-space: nowrap; }
  .status.inactive { background: #f1f2f1; color: #6d7770; }
  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 13px; margin: 25px 0 37px; }
  .stats article { padding: 17px 19px; border: 1px solid #e5ebe6; border-radius: 10px; background: #fff; }
  .stats small, .stats strong { display: block; }
  .stats small { color: #819087; font-size: 10px; }
  .stats strong { margin-top: 5px; color: #123d27; font-size: 24px; }
  .section { margin-top: 31px; }
  .section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 15px; margin-bottom: 15px; }
  h2 { margin: 7px 0 4px; font-size: 19px; }
  .course-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .course { display: flex; align-items: center; gap: 11px; padding: 13px; border: 1px solid #e5ebe6; border-radius: 9px; background: #fff; }
  .course-icon { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 8px; background: #edf6ef; color: #0a8050; }
  .course strong, .course small { display: block; }
  .course strong { font-size: 11px; }
  .course small { margin-top: 4px; color: #819087; font-size: 9px; }
  .empty-inline { padding: 23px; border: 1px dashed #d7e2da; border-radius: 9px; background: #fff; color: #819087; font-size: 11px; text-align: center; }
  .table-wrap { overflow-x: auto; border: 1px solid #e5ebe6; border-radius: 10px; background: #fff; }
  table { width: 100%; border-collapse: collapse; min-width: 720px; text-align: left; }
  th, td { padding: 13px 15px; border-bottom: 1px solid #edf1ed; font-size: 10px; }
  th { background: #f8faf8; color: #758379; font-size: 9px; letter-spacing: .4px; }
  td { color: #58695e; }
  td strong { color: #263e30; font-size: 10px; }
  .profile-status { display: inline-block; background: #f0f4f1; color: #52675a; }
  footer { padding: 20px; border-top: 1px solid #e5ebe6; color: #89948c; font-size: 10px; text-align: center; }
  .state-screen { min-height: 100vh; display: grid; place-content: center; justify-items: center; gap: 10px; color: #53665a; font: 13px Inter, Arial, sans-serif; text-align: center; padding: 20px; }
  .loader { width: 28px; height: 28px; border: 3px solid #dce8df; border-top-color: #0a8050; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 760px) { .topbar { flex-wrap: wrap; gap: 12px; } .topnav { order: 3; width: 100%; flex-basis: 100%; } .account { margin-left: auto; } .course-list { grid-template-columns: 1fr; } }
  @media (max-width: 580px) { .content { padding: 28px 16px; } .hero { flex-direction: column; } .stats { grid-template-columns: 1fr; gap: 9px; } .account strong { max-width: 155px; } .signout { padding: 8px 9px; } }
</style>
