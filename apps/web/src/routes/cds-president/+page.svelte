<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    ApiError,
    getCurrentUser,
    getMyPresidentGroups,
    logout
  } from '#lib/api/client.ts';
  import type { AuthUser, PresidentWorkspaceGroup } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let groups = $state<PresidentWorkspaceGroup[]>([]);
  let loading = $state(true);
  let errorMessage = $state('');
  let menuOpen = $state(false);

  const totalMembers = $derived(groups.reduce((sum, group) => sum + group.members.length, 0));

  onMount(() => { void loadPage(); });

  async function loadPage() {
    loading = true;
    errorMessage = '';
    try {
      const session = await getCurrentUser();
      if (!session.roles.some((role) => role.code === 'CDS_PRESIDENT')) {
        await goto('/login');
        return;
      }
      currentUser = session.user;
      groups = await getMyPresidentGroups();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load your President workspace.';
    } finally {
      loading = false;
    }
  }

  function memberName(member: { firstName: string; middleName: string | null; lastName: string }) {
    return [member.firstName, member.middleName, member.lastName].filter(Boolean).join(' ');
  }

  async function signOut() {
    try { await logout(); } finally { await goto('/login'); }
  }
</script>

<svelte:head>
  <title>CDS President Dashboard | NYSC CDS Platform</title>
  <meta name="description" content="View your assigned CDS group and member roster." />
</svelte:head>

{#if loading}
  <main class="state-screen"><div class="loader"></div><p>Loading your CDS President workspace…</p></main>
{:else if !currentUser}
  <main class="state-screen"><h2>President workspace unavailable</h2><p>{errorMessage}</p><a href="/login">Return to sign in</a></main>
{:else}
  <div class="workspace">
    <header class="topbar president-workspace-topbar">
      <a class="brand" href="/cds-president"><span class="brand-icon">N</span><span><strong>NYSC CDS</strong><small>President workspace</small></span></a>
      <div class="president-header-controls">
        <button class="menu-toggle" type="button" aria-label="Toggle navigation" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>☰</button>
      </div>
      <nav class:open={menuOpen} class="president-navigation president-header-nav" aria-label="President navigation">
        <a class="active" href="/cds-president">Dashboard</a>
         <a href="/cds-president/attendance">Attendance</a>
        <a href="/cds-president/announcements">Announcements</a>
        <a href="/corps-member">Corps Member portal</a>
        <span class="user-email">{currentUser.email}</span>
        <button class="signout" type="button" onclick={signOut}>Sign out</button>
      </nav>
    </header>

    <main class="content">
      <div class="hero">
        <div><div class="eyebrow">CDS GROUP LEADERSHIP</div><h1>President Dashboard</h1><p>View your assigned CDS group, member roster and group information. Your access is limited to the group(s) for which you hold an active President assignment.</p></div>
        <span class="role-badge"><span></span>President access active</span>
      </div>

      {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}

      <section class="stats">
        <article><small>Assigned CDS groups</small><strong>{groups.length}</strong></article>
        <article><small>Total group members</small><strong>{totalMembers}</strong></article>
      </section>

      {#if groups.length === 0}
        <section class="empty"><div class="empty-icon">◎</div><h2>No active President assignment found</h2><p>Your account is authenticated, but there is no active CDS President role linked to an active group. Contact your CDS Coordinator or LGI to review your designation.</p></section>
      {:else}
        <section class="groups">
          {#each groups as group (group.id)}
            <article class="group-card">
              <div class="group-top"><span class="group-code">{group.code}</span><span class="badge">Active President</span></div>
              <h2>{group.name}</h2>
              <p class="location">{group.lgaName}, {group.stateName}</p>
              {#if group.description}<p class="description">{group.description}</p>{/if}
              <div class="members-heading"><div><strong>Group members</strong><small>Current active CDS membership roster</small></div><span>{group.members.length} members</span></div>
              {#if group.members.length === 0}
                <div class="empty-roster">There are currently no active members in this group.</div>
              {:else}
                <div class="member-list">
                  {#each group.members as member (member.memberId)}
                    <div class="member-row"><div><strong>{memberName(member)}</strong><small>{member.stateCode}</small></div><span>{member.courseName ?? 'Course not recorded'}</span></div>
                  {/each}
                </div>
              {/if}
            </article>
          {/each}
        </section>
      {/if}

      <section class="responsibilities">
        <div class="eyebrow">PRESIDENT RESPONSIBILITIES</div>
        <h2>Group operations</h2>
        <div class="responsibility-grid">
          <article><span>01</span><div><strong>Member coordination</strong><p>Use your group roster to coordinate participation and raise member issues to your Coordinator.</p></div></article>
          <article><span>02</span><div><strong>Attendance and activities</strong><p>Attendance recording and CDS activity reporting will be added in the next operational module.</p></div></article>
          <article><span>03</span><div><strong>Announcements</strong><p>President announcements will be submitted for Coordinator approval before they are published to members.</p></div></article>
        </div>
      </section>
      <div class="policy"><strong>Access and approval rules</strong><span>You cannot add or remove members, change group assignments, designate another President or access groups outside your current President assignment.</span></div>
    </main>
    <footer>NYSC CDS Management Platform · President Workspace</footer>
  </div>
{/if}

<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#f4f7f5;color:#17251c;font-family:Inter,Arial,sans-serif}button{font:inherit}.workspace{min-height:100vh;display:flex;flex-direction:column}.topbar{min-height:76px;display:flex;justify-content:space-between;align-items:center;gap:18px;padding:12px clamp(16px,4vw,48px);background:#fff;border-bottom:1px solid #e5ebe6}.brand{display:flex;align-items:center;gap:10px;text-decoration:none}.brand-icon{width:40px;height:40px;display:grid;place-items:center;background:#0a5c37;border-radius:9px;color:#fff;font-size:21px;font-weight:800}.brand strong,.brand small{display:block}.brand strong{color:#0a5c37;font-size:13px}.brand small{margin-top:4px;color:#819087;font-size:9px}.topbar nav{display:flex;align-items:center;gap:17px}.topbar nav a{color:#65776b;font-size:10px;font-weight:700;text-decoration:none}.topbar nav a.active,.topbar nav a:hover{color:#0a6841}.user-email{color:#819087;font-size:9px}.signout{padding:8px 11px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#355442;font-size:9px;font-weight:700;cursor:pointer}.menu-toggle{display:none}
  .content{width:min(100%,1120px);margin:0 auto;padding:32px 22px;flex:1}.hero{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}.eyebrow{color:#0a8050;font-size:9px;font-weight:800;letter-spacing:1.3px}h1{margin:8px 0;font-size:clamp(24px,3vw,32px)}.hero p{max-width:700px;margin:0;color:#718078;font-size:12px;line-height:1.65}.role-badge{display:flex;align-items:center;gap:7px;padding:9px 11px;border-radius:20px;background:#e8f5ec;color:#1c6840;font-size:9px;font-weight:700;white-space:nowrap}.role-badge span{width:7px;height:7px;border-radius:50%;background:#2ba267}
  .stats{display:grid;grid-template-columns:repeat(2,minmax(0,180px));gap:12px;margin:23px 0}.stats article{padding:15px 17px;border:1px solid #e3ebe5;border-radius:9px;background:#fff}.stats small,.stats strong{display:block}.stats small{color:#819087;font-size:9px}.stats strong{margin-top:7px;color:#12432b;font-size:22px}
  .groups{display:grid;gap:14px}.group-card{padding:20px;border:1px solid #e3ebe5;border-radius:11px;background:#fff}.group-top{display:flex;justify-content:space-between;align-items:center}.group-code{padding:6px 8px;border-radius:6px;background:#edf6ef;color:#0a6841;font-size:9px;font-weight:800}.badge{padding:5px 8px;border-radius:15px;background:#e8f5ec;color:#0a6841;font-size:8px;font-weight:800}.group-card h2{margin:13px 0 4px;color:#203b2b;font-size:17px}.location{margin:0;color:#819087;font-size:10px}.description{margin:9px 0 0;color:#718078;font-size:10px;line-height:1.6}.members-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:20px 0 10px;padding-bottom:10px;border-bottom:1px solid #edf1ed}.members-heading strong,.members-heading small{display:block}.members-heading strong{font-size:11px;color:#344b3b}.members-heading small{margin-top:4px;color:#819087;font-size:8px}.members-heading>span{color:#0a6841;font-size:9px;font-weight:700}.member-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.member-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 10px;border-radius:6px;background:#f5f8f5}.member-row strong,.member-row small{display:block}.member-row strong{color:#344b3b;font-size:9px}.member-row small{margin-top:4px;color:#819087;font-size:8px}.member-row>span{color:#819087;font-size:8px;text-align:right}.empty-roster{padding:18px;text-align:center;color:#819087;font-size:10px;background:#f7faf7;border-radius:7px}
  .responsibilities{padding:19px;margin-top:18px;border:1px solid #e3ebe5;border-radius:11px;background:#fff}.responsibilities h2{margin:7px 0 15px;font-size:15px}.responsibility-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.responsibility-grid article{display:flex;gap:10px;padding:12px;border-radius:8px;background:#f6f9f6}.responsibility-grid article>span{color:#0a8050;font-size:11px;font-weight:800}.responsibility-grid strong{color:#355442;font-size:10px}.responsibility-grid p{margin:5px 0 0;color:#819087;font-size:9px;line-height:1.55}.policy{display:grid;gap:5px;padding:14px 16px;margin-top:17px;border-radius:8px;background:#eaf4ed}.policy strong{color:#245c3c;font-size:10px}.policy span{color:#718078;font-size:9px;line-height:1.6}.message{padding:10px 13px;margin:12px 0;border-radius:7px;font-size:10px}.message.error{border:1px solid #efceca;background:#fff3f2;color:#a32920}.empty{padding:50px 22px;text-align:center;border:1px solid #e3ebe5;border-radius:11px;background:#fff}.empty h2{margin:9px 0;color:#203b2b;font-size:17px}.empty p{max-width:520px;margin:0 auto;color:#819087;font-size:11px;line-height:1.7}.empty-icon{color:#0a8050;font-size:30px}footer{padding:18px;text-align:center;color:#819087;font-size:9px}
  .president-header-controls{display:none;align-items:center;gap:10px;flex:0 0 auto}
  @media(max-width:850px){
    .topbar{flex-wrap:wrap;gap:10px}
    .president-header-controls{display:flex;align-items:center;gap:10px;margin-left:auto}
    .menu-toggle{display:grid;place-items:center;width:38px;height:38px;flex:0 0 38px;margin:0;padding:0;border:1px solid #dce5de;border-radius:8px;background:#fff;color:#355442;cursor:pointer}
    .topbar nav{display:none;width:100%;align-items:flex-start;flex-direction:column;gap:12px;padding:12px 0 5px}
    .topbar nav.open{display:flex}
    .responsibility-grid{grid-template-columns:1fr 1fr}
  }
  @media(max-width:560px){.content{padding:24px 13px}.hero{flex-direction:column}.stats{grid-template-columns:1fr 1fr}.member-list,.responsibility-grid{grid-template-columns:1fr}.member-row>span{max-width:42%;}}
</style>
