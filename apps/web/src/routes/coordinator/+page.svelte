<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import CoordinatorSidebar from '#lib/components/CoordinatorSidebar.svelte';
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
  let mobileNavOpen = $state(false);
  let signingOut = $state(false);

  const totalMembers = $derived(groups.reduce((sum, group) => sum + group.currentMemberCount, 0));
  const activePresidents = $derived(groups.filter((group) => group.president?.status === 'active').length);
  const pendingPresidents = $derived(groups.filter((group) => group.president?.status === 'pending_activation').length);

  onMount(() => { void loadPage(); });

  function closeMobileNavigation() {
    mobileNavOpen = false;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeMobileNavigation();
  }

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
    if (replacing && !confirm('Replace the current President of ' + group.code + ' — ' + group.name + '? The previous designation will be retained in the leadership history.')) {
      return;
    }

    savingGroupId = group.id;
    errorMessage = '';
    noticeMessage = '';
    try {
      const result = await designateCdsPresident(group.id, memberId, replacing);
      noticeMessage = result.status === 'active'
        ? result.memberName + ' has been designated President of ' + group.name + '.'
        : result.memberName + ' has been designated. President access will activate when the member completes Corps Member registration.';
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
  <meta name="description" content="Manage assigned CDS groups and designate group Presidents." />
</svelte:head>

<svelte:window onkeydown={handleWindowKeydown} />

{#if loading}
  <main class="loading-screen"><div class="loader"></div><p>Verifying your account...</p></main>
{:else if errorMessage && !currentUser}
  <main class="error-screen">
    <h2>Access unavailable</h2>
    <p>{errorMessage}</p>
    <button type="button" onclick={() => goto('/login')}>Return to login</button>
  </main>
{:else if currentUser}
  <div class="dashboard">
    <CoordinatorSidebar
      activePath="/coordinator"
      open={mobileNavOpen}
      signingOut={signingOut}
      onClose={closeMobileNavigation}
      onSignOut={signOut}
    />

    <section class="main-content">
      <header class="topbar">
        <div class="topbar-heading">
          <button
            class="mobile-menu-button"
            type="button"
            aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileNavOpen}
            aria-controls="coordinator-sidebar"
            onclick={() => (mobileNavOpen = !mobileNavOpen)}
          >
            <span></span><span></span><span></span>
          </button>
          <div class="page-heading">
            <span class="breadcrumb">CDS Operations / Dashboard</span>
            <h1>Coordinator Dashboard</h1>
          </div>
        </div>
        <div class="account">
          <div class="avatar">CD</div>
          <div class="account-details">
            <strong>CDS Coordinator</strong>
            <span>{currentUser.email}</span>
          </div>
        </div>
      </header>

      <main class="content">
        <section class="welcome">
          <div>
            <span class="eyebrow">CDS GROUP OPERATIONS</span>
            <h2>Welcome to your Coordinator workspace</h2>
            <p>Manage the CDS groups assigned to you, monitor their members and designate one President for each group.</p>
          </div>
          <div class="welcome-icon">✦</div>
        </section>

        {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}
        {#if noticeMessage}<div class="message success" role="status">{noticeMessage}</div>{/if}

        <section class="section-heading">
          <div>
            <h2>Group Overview</h2>
            <p>A summary of your assigned groups and leadership designations.</p>
          </div>
        </section>

        <section class="summary-grid" aria-label="Coordinator summary">
          <article class="summary-card"><span>Assigned groups</span><strong>{groups.length}</strong><small>CDS groups under your care</small></article>
          <article class="summary-card"><span>Total active members</span><strong>{totalMembers}</strong><small>Across your assigned groups</small></article>
          <article class="summary-card"><span>Presidents designated</span><strong>{activePresidents}</strong><small>Active President access</small></article>
          <article class="summary-card"><span>Awaiting activation</span><strong>{pendingPresidents}</strong><small>Pending member registration</small></article>
        </section>

        <section class="section-heading group-section-heading">
          <div>
            <h2>My CDS Groups</h2>
            <p>Manage group leadership and view members for groups assigned to your account.</p>
          </div>
        </section>

        {#if groups.length === 0}
          <section class="empty-state">
            <div class="empty-icon">◎</div>
            <h3>No CDS groups assigned</h3>
            <p>Your LGI has not assigned any active CDS groups to your account. Contact your LGI to receive group responsibilities. Your standby account cannot access other LGA groups.</p>
          </section>
        {:else}
          <section class="group-grid">
            {#each groups as group (group.id)}
              <article class="group-card">
                <div class="group-top">
                  <div><span class="group-code">{group.code}</span><h3>{group.name}</h3><p class="location">{group.lgaName}, {group.stateName}</p></div>
                  <span class:inactive={!group.isActive} class="badge">{group.isActive ? 'Active' : 'Inactive'}</span>
                </div>

                <div class="capacity">
                  <div><span>Group capacity</span><strong>{group.currentMemberCount} / {group.maxCapacity}</strong></div>
                  <div class="track"><span style="width: {Math.min(100, group.currentMemberCount / group.maxCapacity * 100)}%"></span></div>
                </div>

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
                        <option value={member.memberId} disabled={member.memberId === group.president?.memberId}>{memberName(member)} · {member.stateCode}{member.memberId === group.president?.memberId ? ' · Current President' : ''}</option>
                      {/each}
                    </select>
                    <button class="primary-button" type="button" onclick={() => void assignPresident(group)} disabled={!group.isActive || !selectedMembers[group.id] || savingGroupId === group.id}>
                      {savingGroupId === group.id ? 'Saving...' : group.president ? 'Replace President' : 'Designate President'}
                    </button>
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

        <section class="list-panel history">
          <div class="panel-heading history-heading">
            <div><span class="eyebrow">LEADERSHIP RECORDS</span><h3>President designation history</h3><p>Active, pending and former Presidents for your currently assigned groups.</p></div>
            <span class="record-count">{presidentHistory.length} records</span>
          </div>
          {#if presidentHistory.length === 0}
            <div class="history-empty">No President designations have been recorded for your assigned CDS groups.</div>
          {:else}
            <div class="history-list">
              {#each presidentHistory as item (item.id)}
                <div class="history-row">
                  <div><strong>{item.firstName} {item.middleName ?? ''} {item.lastName}</strong><small>{item.stateCode} · {groups.find((group) => group.id === item.groupId)?.name ?? 'CDS Group'}</small></div>
                  <span class:ended={item.status === 'ended'} class:pending={item.status === 'pending_activation'} class="status-pill">{statusLabel(item.status)}</span>
                  <time>{new Date(item.assignedAt).toLocaleDateString()}</time>
                </div>
              {/each}
            </div>
          {/if}
        </section>

        <section class="section-heading quick-heading">
          <div><h2>Quick Access</h2><p>Continue managing your CDS responsibilities.</p></div>
        </section>
        <section class="feature-grid quick-links">
          <a class="feature-card quick-card" href="/coordinator/course-mapping"><div class="feature-icon blue">⌘</div><h3>Course Mapping</h3><p>Review eligibility mappings for the CDS groups assigned to you.</p><span class="feature-link">Open course mapping →</span></a>
          <a class="feature-card quick-card" href="/coordinator/documents"><div class="feature-icon green">▣</div><h3>Document Checklist</h3><p>Monitor published document requirements and member submissions.</p><span class="feature-link">Open document checklist →</span></a>
          <a class="feature-card quick-card" href="/coordinator/handovers"><div class="feature-icon purple">⇄</div><h3>Handover Inbox</h3><p>Review and acknowledge transferred group responsibilities.</p><span class="feature-link">Open handover inbox →</span></a>
        </section>

        <section class="account-status">
          <div><h3>Your access is group-scoped</h3><p>Only CDS groups actively assigned to your account are visible. You can designate one active member of each assigned group as President. Replacements are confirmed before the previous designation is ended.</p></div>
          <span class="verified-badge"><span></span>Coordinator access active</span>
        </section>
      </main>

      <footer>NYSC CDS Management Platform · Coordinator Workspace</footer>
    </section>
  </div>
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; overflow-x: hidden; background: #f5f7f5; color: #19251e; font-family: Inter, Arial, sans-serif; }
  :global(button), :global(input), :global(select) { font: inherit; }
  .dashboard { min-height: 100vh; display: flex; }
  .main-content { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .topbar { position: sticky; top: 0; z-index: 15; min-height: 88px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 15px 34px; border-bottom: 1px solid #e8ece8; background: #fff; }
  .topbar-heading { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .mobile-menu-button { display: none; }
  .breadcrumb { color: #819087; font-size: 10px; }
  .topbar h1 { margin: 5px 0 0; font-size: 21px; }
  .account { display: flex; align-items: center; gap: 10px; }
  .avatar { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; background: #e6f1e9; color: #0a5c37; font-size: 12px; font-weight: 700; }
  .account-details strong, .account-details span { display: block; }
  .account-details strong { font-size: 11px; }
  .account-details span { margin-top: 4px; color: #819087; font-size: 10px; }
  .content { width: 100%; max-width: 1250px; margin: 0 auto; padding: 32px 34px; }
  .welcome { min-height: 145px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 30px; border-radius: 12px; background: #eaf3ed; }
  .eyebrow { color: #0a8050; font-size: 9px; font-weight: 700; letter-spacing: 1.5px; }
  .welcome h2 { margin: 12px 0 8px; font-size: 23px; }
  .welcome p { max-width: 760px; margin: 0; color: #65766a; font-size: 12px; line-height: 1.7; }
  .welcome-icon { width: 57px; height: 57px; flex: 0 0 57px; display: grid; place-items: center; border-radius: 12px; background: #0a5c37; color: #fff; font-size: 26px; }
  .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 15px; margin: 31px 0 15px; }
  .section-heading h2 { margin: 0 0 5px; font-size: 16px; }
  .section-heading p { margin: 0; color: #819087; font-size: 11px; line-height: 1.6; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 5px; }
  .summary-card { min-height: 98px; padding: 17px 19px; border: 1px solid #e5ebe6; border-radius: 10px; background: #fff; }
  .summary-card span, .summary-card small { display: block; color: #819087; font-size: 10px; }
  .summary-card strong { display: block; margin: 6px 0 4px; color: #123d27; font-size: 24px; }
  .summary-card small { font-size: 9px; }
  .group-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .group-card { min-width: 0; padding: 21px; border: 1px solid #e5ebe6; border-radius: 10px; background: #fff; }
  .group-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .group-code { display: inline-block; padding: 6px 8px; border-radius: 6px; background: #e4f2e8; color: #0a6841; font-size: 9px; font-weight: 800; }
  .group-card h3 { margin: 13px 0 5px; color: #193b28; font-size: 15px; }
  .location { margin: 0; color: #819087; font-size: 10px; }
  .badge { flex: 0 0 auto; padding: 5px 8px; border-radius: 20px; background: #e7f4eb; color: #087443; font-size: 9px; font-weight: 700; }
  .badge.inactive { background: #f1f1ef; color: #78847d; }
  .capacity { margin: 19px 0 16px; }
  .capacity > div:first-child { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 7px; color: #819087; font-size: 9px; }
  .capacity strong { color: #355442; }
  .track { height: 6px; overflow: hidden; border-radius: 10px; background: #edf2ee; }
  .track span { display: block; height: 100%; border-radius: 10px; background: #16824d; }
  .president-panel { padding: 14px; border: 1px solid #e2ece4; border-radius: 9px; background: #f8fbf8; }
  .panel-label { color: #0a8050; font-size: 8px; font-weight: 800; letter-spacing: 1px; }
  .current-president { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 10px 0; }
  .current-president strong, .current-president small { display: block; }
  .current-president strong { color: #284632; font-size: 11px; }
  .current-president small { margin-top: 4px; color: #819087; font-size: 9px; }
  .status-pill { padding: 5px 8px; border-radius: 20px; background: #e7f4eb; color: #17603b; font-size: 8px; font-weight: 800; white-space: nowrap; }
  .status-pill.pending { background: #fff5e4; color: #94600e; }
  .status-pill.ended { background: #f0f1ef; color: #7b847e; }
  .no-president { margin: 10px 0; color: #8a7760; font-size: 10px; }
  .select-label { display: block; margin: 12px 0 6px; color: #53665a; font-size: 9px; font-weight: 700; }
  .designation-row { display: flex; align-items: stretch; gap: 8px; }
  .designation-row select { min-width: 0; min-height: 40px; flex: 1; padding: 7px 9px; border: 1px solid #dce5de; border-radius: 8px; background: #fff; color: #35483a; font-size: 10px; }
  .primary-button { min-height: 40px; padding: 9px 13px; border: 1px solid #0a5c37; border-radius: 8px; background: #0a5c37; color: #fff; font-size: 10px; font-weight: 700; cursor: pointer; }
  .primary-button:hover:not(:disabled) { background: #064526; }
  .primary-button:disabled { opacity: .5; cursor: not-allowed; }
  .empty-members { margin: 9px 0 0; color: #9b6a38; font-size: 9px; }
  .members { margin-top: 15px; padding-top: 12px; border-top: 1px solid #edf1ed; }
  .members summary { display: flex; justify-content: space-between; cursor: pointer; color: #355442; font-size: 10px; font-weight: 700; }
  .members summary span { color: #819087; }
  .member-list { display: grid; gap: 7px; margin-top: 10px; }
  .member-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px; border-radius: 6px; background: #f5f8f5; }
  .member-row strong, .member-row small { display: block; }
  .member-row strong { color: #344b3b; font-size: 9px; }
  .member-row small { margin-top: 3px; color: #819087; font-size: 8px; }
  .member-row > span { color: #819087; font-size: 8px; text-align: right; }
  .list-panel { padding: 20px; border: 1px solid #e5ebe6; border-radius: 12px; background: #fff; }
  .panel-heading h3 { margin: 0; font-size: 15px; }
  .panel-heading p { margin: 5px 0 0; color: #819087; font-size: 11px; line-height: 1.6; }
  .history { margin-top: 23px; }
  .history-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 15px; }
  .history-heading h3 { margin: 8px 0 0; }
  .record-count { color: #819087; font-size: 9px; white-space: nowrap; }
  .history-empty { padding: 23px 0 5px; color: #819087; font-size: 10px; }
  .history-list { display: grid; margin-top: 14px; }
  .history-row { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 14px; padding: 11px 0; border-top: 1px solid #edf1ed; }
  .history-row strong, .history-row small { display: block; }
  .history-row strong { color: #344b3b; font-size: 10px; }
  .history-row small, .history-row time { margin-top: 4px; color: #819087; font-size: 8px; }
  .feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .feature-card { min-width: 0; padding: 20px; border: 1px solid #e8ece8; border-radius: 10px; background: #fff; text-decoration: none; }
  .feature-icon { width: 39px; height: 39px; display: grid; place-items: center; border-radius: 9px; font-size: 18px; }
  .green { background: #e4f2e8; color: #0a8050; }
  .blue { background: #e7f0fd; color: #346ec5; }
  .purple { background: #eee9fd; color: #7857c9; }
  .feature-card h3 { margin: 15px 0 8px; color: #19251e; font-size: 13px; }
  .feature-card p { min-height: 38px; margin: 0 0 13px; color: #7b887f; font-size: 10px; line-height: 1.7; }
  .feature-link { color: #0a8050; font-size: 10px; font-weight: 600; }
  .quick-heading { margin-top: 30px; }
  .quick-card { display: block; }
  .quick-card:hover { border-color: #c8dece; box-shadow: 0 5px 18px #0a5c370c; }
  .account-status { display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-top: 22px; padding: 19px 22px; border: 1px solid #dcebe0; border-radius: 10px; background: #eaf3ed; }
  .account-status h3 { margin: 0 0 5px; color: #17472d; font-size: 12px; }
  .account-status p { max-width: 820px; margin: 0; color: #607267; font-size: 10px; line-height: 1.7; }
  .verified-badge { padding: 8px 11px; border-radius: 20px; background: #e8f5ec; color: #087443; font-size: 10px; white-space: nowrap; }
  .verified-badge span { display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; background: #159451; }
  .empty-state { padding: 46px 20px; border: 1px solid #e8ece8; border-radius: 10px; background: #fff; text-align: center; }
  .empty-icon { color: #0a8050; font-size: 28px; }
  .empty-state h3 { margin: 12px 0 6px; font-size: 15px; }
  .empty-state p { max-width: 520px; margin: 0 auto; color: #819087; font-size: 11px; line-height: 1.7; }
  .message { margin: 15px 0 0; padding: 11px 13px; border-radius: 8px; font-size: 11px; line-height: 1.6; }
  .message.error { border: 1px solid #efceca; background: #fff3f2; color: #a32920; }
  .message.success { border: 1px solid #cce6d3; background: #eef8f0; color: #16633b; }
  footer { margin-top: auto; padding: 17px 34px; border-top: 1px solid #e8ece8; color: #89948c; font-size: 10px; }
  .loading-screen, .error-screen { min-height: 100vh; display: grid; place-content: center; justify-items: center; gap: 4px; padding: 25px; text-align: center; }
  .loading-screen p, .error-screen p { color: #738178; font-size: 13px; }
  .loader { width: 27px; height: 27px; border: 3px solid #dbe8de; border-top-color: #0a5c37; border-radius: 50%; animation: spin .8s linear infinite; }
  .error-screen button { margin-top: 12px; padding: 11px 18px; border: 0; border-radius: 7px; background: #0a5c37; color: #fff; cursor: pointer; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 1050px) {
    .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .feature-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .group-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 760px) {
    .topbar { min-height: 76px; padding: 13px 16px; flex-wrap: wrap; gap: 12px; }
    .mobile-menu-button { display: grid; flex: 0 0 42px; width: 42px; height: 42px; place-content: center; gap: 5px; padding: 0; border: 1px solid #e1e9e2; border-radius: 9px; background: #fff; cursor: pointer; }
    .mobile-menu-button span { display: block; width: 18px; height: 2px; border-radius: 2px; background: #0a5c37; }
    .account-details { display: none; }
    .topbar { padding-inline: 14px; }
    .content { padding: 22px 16px 28px; }
    .welcome { min-height: 0; padding: 22px 19px; }
    .welcome h2 { font-size: 20px; line-height: 1.3; }
    .welcome-icon { display: none; }
    .section-heading { margin-top: 26px; }
    .summary-grid { gap: 9px; }
    .summary-card { min-height: 88px; padding: 13px; }
    .summary-card strong { font-size: 21px; }
    .group-grid, .feature-grid { grid-template-columns: 1fr; gap: 12px; }
    .group-card { padding: 17px; }
    .designation-row { flex-direction: column; }
    .designation-row .primary-button { width: 100%; }
    .history-row { grid-template-columns: 1fr auto; }
    .history-row time { grid-column: 1 / -1; }
    .history-heading { align-items: flex-start; flex-direction: column; }
    .account-status { align-items: flex-start; flex-direction: column; padding: 18px; }
    .verified-badge { white-space: normal; }
    footer { padding: 15px 16px; line-height: 1.5; }
  }
  @media (max-width: 380px) {
    .content { padding-inline: 13px; }
    .welcome { padding: 18px 16px; }
    .summary-card { padding: 11px; }
    .summary-card span { font-size: 9px; }
    .summary-card strong { font-size: 19px; }
  }
  @media (prefers-reduced-motion: reduce) { .loader { animation-duration: 1.8s; } }
</style>
