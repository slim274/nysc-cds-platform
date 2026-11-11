<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    ApiError,
    getCurrentUser,
    getMyCoordinatorGroups,
    listMyCoordinatorPresidents,
    designateCdsPresident,
    logout
  } from '#lib/api/client.ts';
  import type {
    AuthUser,
    CoordinatorWorkspaceGroup,
    CdsPresidentDesignation
  } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let groups = $state<CoordinatorWorkspaceGroup[]>([]);
  let presidentHistory = $state<CdsPresidentDesignation[]>([]);
  let loading = $state(true);
  let savingGroupId = $state('');
  let selectedMembers = $state<Record<string, string>>({});
  let errorMessage = $state('');
  let noticeMessage = $state('');
  let mobileMenuOpen = $state(false);

  const totalMembers = $derived(groups.reduce((sum, group) => sum + group.currentMemberCount, 0));

  onMount(() => { void loadPage(); });

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
      const [groupRows, leadershipRows] = await Promise.all([
        getMyCoordinatorGroups(),
        listMyCoordinatorPresidents()
      ]);
      groups = groupRows;
      presidentHistory = leadershipRows;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load your Coordinator workspace.';
    } finally {
      loading = false;
    }
  }

  async function assignPresident(group: CoordinatorWorkspaceGroup) {
    const memberId = selectedMembers[group.id];
    if (!memberId) {
      errorMessage = 'Select an active member of this CDS group first.';
      return;
    }
    const replacing = Boolean(group.president);
    if (replacing && !confirm(`Replace the current President of ${group.code} — ${group.name}? The previous designation will be retained in the leadership history.`)) {
      return;
    }

    savingGroupId = group.id;
    errorMessage = '';
    noticeMessage = '';
    try {
      const result = await designateCdsPresident(group.id, memberId, replacing);
      noticeMessage = result.status === 'active'
        ? `${result.memberName} has been designated President of ${group.name}.`
        : `${result.memberName} has been designated. President access will activate when the member completes Corps Member registration.`;
      selectedMembers[group.id] = '';
      await loadPage();
    } catch (error) {
      errorMessage = error instanceof ApiError || error instanceof Error
        ? error.message
        : 'Unable to designate this CDS President.';
    } finally {
      savingGroupId = '';
    }
  }

  function memberName(member: { firstName: string; middleName: string | null; lastName: string }) {
    return [member.firstName, member.middleName, member.lastName].filter(Boolean).join(' ');
  }

  function statusLabel(value: string) {
    return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  async function signOut() {
    try { await logout(); } finally { await goto('/login'); }
  }
</script>

<svelte:head>
  <title>Coordinator Dashboard | NYSC CDS Platform</title>
  <meta name="description" content="Manage assigned CDS groups and designate group Presidents." />
</svelte:head>

{#if loading}
  <main class="state-screen"><div class="loader"></div><p>Loading your Coordinator workspace…</p></main>
{:else if !currentUser}
  <main class="state-screen"><h2>Coordinator workspace unavailable</h2><p>{errorMessage}</p><a href="/login">Return to sign in</a></main>
{:else}
  <div class="workspace">
    <header class="topbar">
      <a class="brand" href="/coordinator"><span class="brand-icon">N</span><span><strong>NYSC CDS</strong><small>Coordinator workspace</small></span></a>
      <button class="menu-toggle" type="button" aria-label="Toggle navigation" aria-expanded={mobileMenuOpen} onclick={() => (mobileMenuOpen = !mobileMenuOpen)}>☰</button>
      <nav class:open={mobileMenuOpen} aria-label="Coordinator navigation">
        <a class="active" href="/coordinator">Dashboard</a>
        <a href="/coordinator/course-mapping">Course mapping</a>
        <a href="/coordinator/documents">Documents</a>
        <a href="/coordinator/handovers">Handover inbox</a>
        <span class="user-email">{currentUser.email}</span>
        <button type="button" class="signout" onclick={signOut}>Sign out</button>
      </nav>
    </header>

    <main class="content">
      <div class="hero">
        <div><div class="eyebrow">CDS GROUP OPERATIONS</div><h1>Coordinator Dashboard</h1><p>Manage the CDS groups assigned to you, monitor their members and designate one President for each group.</p></div>
        <div class="hero-badge"><span></span>Coordinator access active</div>
      </div>

      {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}
      {#if noticeMessage}<div class="message success" role="status">{noticeMessage}</div>{/if}

      <section class="stats">
        <article><small>Assigned groups</small><strong>{groups.length}</strong></article>
        <article><small>Total active members</small><strong>{totalMembers}</strong></article>
        <article><small>Presidents designated</small><strong>{groups.filter((group) => group.president?.status === 'active').length}</strong></article>
        <article><small>Awaiting activation</small><strong>{groups.filter((group) => group.president?.status === 'pending_activation').length}</strong></article>
      </section>

      {#if groups.length === 0}
        <section class="empty"><div class="empty-icon">◎</div><h2>No CDS groups assigned</h2><p>Your LGI has not assigned any active CDS groups to your account. Contact your LGI to receive group responsibilities. Your standby account cannot access other LGA groups.</p></section>
      {:else}
        <section class="group-grid">
          {#each groups as group (group.id)}
            <article class="group-card">
              <div class="group-top"><span class="group-code">{group.code}</span><span class:inactive={!group.isActive} class="badge">{group.isActive ? 'Active' : 'Inactive'}</span></div>
              <h2>{group.name}</h2>
              <p class="location">{group.lgaName}, {group.stateName}</p>
              <div class="capacity"><div><span>Group capacity</span><strong>{group.currentMemberCount} / {group.maxCapacity}</strong></div><div class="track"><span style="width: {Math.min(100, group.currentMemberCount / group.maxCapacity * 100)}%"></span></div></div>

              <div class="president-panel">
                <div class="panel-label">CDS PRESIDENT</div>
                {#if group.president}
                  <div class="current-president">
                    <div><strong>{group.president.name}</strong><small>{group.president.status === 'active' ? 'President access active' : 'Waiting for member account activation'}</small></div>
                    <span class:pending={group.president.status === 'pending_activation'} class="status-pill">{statusLabel(group.president.status)}</span>
                  </div>
                {:else}
                  <p class="no-president">No President has been designated for this group.</p>
                {/if}

                <label class="select-label" for="president-{group.id}">{group.president ? 'Select a replacement from this group' : 'Select a President from this group'}</label>
                <div class="designation-row">
                  <select id="president-{group.id}" bind:value={selectedMembers[group.id]} disabled={!group.isActive || group.members.length === 0}>
                    <option value="">Choose an active group member</option>
                    {#each group.members as member (member.memberId)}
                      <option value={member.memberId}>{memberName(member)} · {member.stateCode}</option>
                    {/each}
                  </select>
                  <button class="primary-button" type="button" onclick={() => void assignPresident(group)} disabled={!group.isActive || !selectedMembers[group.id] || savingGroupId === group.id}>{savingGroupId === group.id ? 'Saving…' : group.president ? 'Replace President' : 'Designate President'}</button>
                </div>
                {#if group.members.length === 0}<p class="empty-members">This group has no active members to designate.</p>{/if}
              </div>

              <details class="members">
                <summary>View group members <span>{group.members.length}</span></summary>
                <div class="member-list">
                  {#each group.members as member (member.memberId)}
                    <div class="member-row"><div><strong>{memberName(member)}</strong><small>{member.stateCode}</small></div><span>{member.courseName ?? 'Course not recorded'}</span></div>
                  {/each}
                </div>
              </details>
            </article>
          {/each}
        </section>
      {/if}

      <section class="history">
        <div class="history-heading"><div><div class="eyebrow">LEADERSHIP RECORDS</div><h2>President designation history</h2><p>Active, pending and former Presidents for your currently assigned groups.</p></div><span>{presidentHistory.length} records</span></div>
        {#if presidentHistory.length === 0}
          <div class="history-empty">No President designations have been recorded for your assigned CDS groups.</div>
        {:else}
          <div class="history-list">
            {#each presidentHistory as item (item.id)}
              <div class="history-row"><div><strong>{item.firstName} {item.middleName ?? ''} {item.lastName}</strong><small>{item.stateCode} · {groups.find((group) => group.id === item.groupId)?.name ?? 'CDS Group'}</small></div><span class:ended={item.status === 'ended'} class:pending={item.status === 'pending_activation'} class="status-pill">{statusLabel(item.status)}</span><time>{new Date(item.assignedAt).toLocaleDateString()}</time></div>
            {/each}
          </div>
        {/if}
      </section>

      <section class="quick-links">
        <a href="/coordinator/course-mapping"><strong>Course mapping</strong><span>Review eligibility mappings for assigned groups →</span></a>
        <a href="/coordinator/documents"><strong>Document checklist</strong><span>Monitor published document requirements and submissions →</span></a>
        <a href="/coordinator/handovers"><strong>Handover inbox</strong><span>Review and acknowledge transferred responsibilities →</span></a>
      </section>

      <div class="policy"><strong>Your access is group-scoped</strong><span>Only CDS groups actively assigned to your account are visible here. You can designate one active member of each assigned group as President. Replacements are confirmed before the previous designation is ended.</span></div>
    </main>
    <footer>NYSC CDS Management Platform · Coordinator Workspace</footer>
  </div>
{/if}

<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#f4f7f5;color:#17251c;font-family:Inter,Arial,sans-serif}button,select{font:inherit}.workspace{min-height:100vh;display:flex;flex-direction:column}.topbar{min-height:76px;display:flex;justify-content:space-between;align-items:center;gap:18px;padding:12px clamp(16px,4vw,48px);background:#fff;border-bottom:1px solid #e5ebe6}.brand{display:flex;align-items:center;gap:10px;text-decoration:none}.brand-icon{width:40px;height:40px;display:grid;place-items:center;background:#0a5c37;border-radius:9px;color:#fff;font-size:21px;font-weight:800}.brand strong,.brand small{display:block}.brand strong{color:#0a5c37;font-size:13px}.brand small{margin-top:4px;color:#819087;font-size:9px}.topbar nav{display:flex;align-items:center;gap:17px}.topbar nav a{color:#65776b;font-size:10px;font-weight:700;text-decoration:none}.topbar nav a.active,.topbar nav a:hover{color:#0a6841}.user-email{color:#819087;font-size:9px}.signout{padding:8px 11px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#355442;font-size:9px;font-weight:700;cursor:pointer}.menu-toggle{display:none}
  .content{width:min(100%,1200px);margin:0 auto;padding:32px 22px;flex:1}.hero{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}.eyebrow{color:#0a8050;font-size:9px;font-weight:800;letter-spacing:1.3px}h1{margin:8px 0;font-size:clamp(24px,3vw,32px)}.hero p,.history-heading p{margin:0;color:#718078;font-size:12px;line-height:1.65}.hero-badge{display:flex;align-items:center;gap:7px;padding:9px 11px;border-radius:20px;background:#e8f5ec;color:#1c6840;font-size:9px;font-weight:700;white-space:nowrap}.hero-badge span{width:7px;height:7px;border-radius:50%;background:#2ba267}
  .stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:23px 0}.stats article{padding:15px 17px;border:1px solid #e3ebe5;border-radius:9px;background:#fff}.stats small,.stats strong{display:block}.stats small{color:#819087;font-size:9px}.stats strong{margin-top:7px;color:#12432b;font-size:22px}
  .group-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.group-card{padding:19px;border:1px solid #e3ebe5;border-radius:11px;background:#fff}.group-top{display:flex;justify-content:space-between;align-items:center}.group-code{padding:6px 8px;border-radius:6px;background:#edf6ef;color:#0a6841;font-size:9px;font-weight:800}.badge{padding:5px 8px;border-radius:15px;background:#e8f5ec;color:#0a6841;font-size:8px;font-weight:800}.badge.inactive{background:#f1f1ef;color:#78847d}.group-card h2{margin:13px 0 4px;color:#203b2b;font-size:16px}.location{margin:0;color:#819087;font-size:10px}.capacity{margin:18px 0}.capacity>div:first-child{display:flex;justify-content:space-between;margin-bottom:7px;color:#819087;font-size:9px}.capacity strong{color:#355442}.track{height:6px;overflow:hidden;border-radius:10px;background:#edf2ee}.track span{display:block;height:100%;border-radius:10px;background:#16824d}
  .president-panel{padding:13px;border:1px solid #e2ece4;border-radius:9px;background:#f8fbf8}.panel-label{color:#0a8050;font-size:8px;font-weight:800;letter-spacing:1px}.current-president{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:10px 0}.current-president strong,.current-president small{display:block}.current-president strong{color:#284632;font-size:11px}.current-president small{margin-top:4px;color:#819087;font-size:9px}.status-pill{padding:5px 8px;border-radius:15px;background:#e7f4eb;color:#17603b;font-size:8px;font-weight:800;white-space:nowrap}.status-pill.pending{background:#fff5e4;color:#94600e}.status-pill.ended{background:#f0f1ef;color:#7b847e}.no-president{margin:10px 0;color:#8a7760;font-size:10px}.select-label{display:block;margin:12px 0 6px;color:#53665a;font-size:9px;font-weight:700}.designation-row{display:flex;gap:8px}.designation-row select{min-width:0;flex:1;height:38px;padding:7px 9px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#35483a;font-size:9px}.primary-button{min-height:36px;padding:8px 11px;border:1px solid #0a5c37;border-radius:7px;background:#0a5c37;color:#fff;font-size:9px;font-weight:700;cursor:pointer}.primary-button:disabled{opacity:.45;cursor:not-allowed}.empty-members{margin:8px 0 0;color:#9b6a38;font-size:9px}
  .members{margin-top:14px;border-top:1px solid #edf1ed;padding-top:12px}.members summary{display:flex;justify-content:space-between;cursor:pointer;color:#355442;font-size:10px;font-weight:700}.members summary span{color:#819087}.member-list{display:grid;gap:7px;margin-top:10px}.member-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 9px;border-radius:6px;background:#f5f8f5}.member-row strong,.member-row small{display:block}.member-row strong{font-size:9px;color:#344b3b}.member-row small{margin-top:3px;color:#819087;font-size:8px}.member-row>span{color:#819087;font-size:8px;text-align:right}
  .history{padding:19px;margin-top:18px;border:1px solid #e3ebe5;border-radius:11px;background:#fff}.history-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:12px}.history-heading h2{margin:6px 0;font-size:15px}.history-heading>span{color:#819087;font-size:9px}.history-list{display:grid;margin-top:13px}.history-row{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:14px;padding:10px 0;border-top:1px solid #edf1ed}.history-row strong,.history-row small{display:block}.history-row strong{font-size:10px;color:#344b3b}.history-row small,.history-row time{margin-top:4px;color:#819087;font-size:8px}.history-empty{padding:18px 0;color:#819087;font-size:10px}
  .quick-links{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:18px}.quick-links a{display:grid;gap:6px;padding:14px;border:1px solid #e3ebe5;border-radius:9px;background:#fff;text-decoration:none}.quick-links strong{color:#245c3c;font-size:10px}.quick-links span{color:#819087;font-size:9px;line-height:1.5}.policy{display:grid;gap:5px;padding:14px 16px;margin-top:17px;border-radius:8px;background:#eaf4ed}.policy strong{color:#245c3c;font-size:10px}.policy span{color:#718078;font-size:9px;line-height:1.6}.message{padding:10px 13px;margin:12px 0;border-radius:7px;font-size:10px}.message.error{border:1px solid #efceca;background:#fff3f2;color:#a32920}.message.success{border:1px solid #cce6d3;background:#eef8f0;color:#16633b}.empty{padding:50px 22px;text-align:center;border:1px solid #e3ebe5;border-radius:11px;background:#fff}.empty h2{margin:9px 0;color:#203b2b;font-size:17px}.empty p{max-width:520px;margin:0 auto;color:#819087;font-size:11px;line-height:1.7}.empty-icon{color:#0a8050;font-size:30px}footer{padding:18px;text-align:center;color:#819087;font-size:9px}
  @media(max-width:850px){.topbar{flex-wrap:wrap}.menu-toggle{display:block;margin-left:auto;padding:7px 10px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#355442}.topbar nav{display:none;width:100%;align-items:flex-start;flex-direction:column;gap:12px;padding:12px 0 5px}.topbar nav.open{display:flex}.group-grid{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.quick-links{grid-template-columns:1fr 1fr}}
  @media(max-width:520px){.content{padding:24px 13px}.hero{flex-direction:column}.stats{gap:8px}.stats article{padding:12px}.stats strong{font-size:19px}.designation-row{flex-direction:column}.designation-row button{width:100%}.history-row{grid-template-columns:1fr auto}.history-row time{grid-column:1/-1}.quick-links{grid-template-columns:1fr}.history-heading{align-items:flex-start;flex-direction:column}}
</style>
