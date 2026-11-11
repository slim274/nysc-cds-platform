<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import CoordinatorLayout from '#lib/components/CoordinatorLayout.svelte';
  import {
    ApiError,
    getCurrentUser,
    getMyCoordinatorGroups,
    listMyCoordinatorPresidents,
    logout
  } from '#lib/api/client.ts';
  import type {
    AuthUser,
    CoordinatorWorkspaceGroup,
    CdsPresidentDesignation
  } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let groups = $state<CoordinatorWorkspaceGroup[]>([]);
  let presidents = $state<CdsPresidentDesignation[]>([]);
  let loading = $state(true);
  let errorMessage = $state('');
  let searchTerm = $state('');
  let statusFilter = $state('all');
  let replacingPresident = $state<CdsPresidentDesignation | null>(null);
  let replacementMemberId = $state('');
  let replacementReason = $state('');
  let replacementSaving = $state(false);
  let successMessage = $state('');

  const groupById = $derived(new Map(groups.map((group) => [group.id, group])));
  const activeCount = $derived(presidents.filter((item) => item.status === 'active').length);
  const pendingCount = $derived(presidents.filter((item) => item.status === 'pending_activation').length);
  const formerCount = $derived(presidents.filter((item) => item.status === 'ended').length);
  const replacementCandidates = $derived(
    replacingPresident
      ? (groupById.get(replacingPresident.groupId)?.members ?? []).filter((member) =>
          member.memberId !== replacingPresident?.memberId &&
          !presidents.some((item) =>
            item.memberId === member.memberId &&
            (item.status === 'active' || item.status === 'pending_activation')
          )
        )
      : []
  );
  const visiblePresidents = $derived(presidents.filter((item) => {
    const query = searchTerm.trim().toLocaleLowerCase();
    const fullName = [item.firstName, item.middleName, item.lastName].filter(Boolean).join(' ').toLocaleLowerCase();
    const group = groupById.get(item.groupId);
    const matchesSearch = !query || fullName.includes(query) ||
      item.stateCode.toLocaleLowerCase().includes(query) ||
      (group?.name ?? '').toLocaleLowerCase().includes(query) ||
      (group?.code ?? '').toLocaleLowerCase().includes(query);
    return matchesSearch && (statusFilter === 'all' || item.status === statusFilter);
  }));

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
      presidents = leadershipRows;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load CDS President records.';
    } finally {
      loading = false;
    }
  }

  function statusLabel(status: string) {
    if (status === 'pending_activation') return 'Awaiting activation';
    if (status === 'ended') return 'Former President';
    return 'Active';
  }

  function memberName(item: CdsPresidentDesignation) {
    return [item.firstName, item.middleName, item.lastName].filter(Boolean).join(' ');
  }

  function formatDate(value: string | null) {
    return value ? new Date(value).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }) : '—';
  }

  function openReplacement(item: CdsPresidentDesignation) {
    const group = groupById.get(item.groupId);
    if (!group?.isActive) {
      errorMessage = 'This CDS group is no longer active. Contact your LGI before changing its leadership.';
      return;
    }
    replacingPresident = item;
    replacementMemberId = '';
    replacementReason = '';
    errorMessage = '';
    successMessage = '';
  }

  function closeReplacement() {
    if (replacementSaving) return;
    replacingPresident = null;
    replacementMemberId = '';
    replacementReason = '';
  }

  async function submitReplacement(event: SubmitEvent) {
    event.preventDefault();
    if (!replacingPresident) return;
    const reason = replacementReason.trim();
    if (reason.length < 10) {
      errorMessage = 'Provide a reason of at least 10 characters.';
      return;
    }
    if (!replacementMemberId || !replacementCandidates.some((member) => member.memberId === replacementMemberId)) {
      errorMessage = 'Choose an eligible active member from this CDS group.';
      return;
    }

    replacementSaving = true;
    errorMessage = '';
    try {
      const group = groupById.get(replacingPresident.groupId);
      const result = await designateCdsPresident(
        replacingPresident.groupId,
        replacementMemberId,
        true,
        reason
      );
      successMessage = result.status === 'active'
        ? result.memberName + ' is now President of ' + (group?.name ?? result.groupName) + '.'
        : result.memberName + ' has been designated. President access will activate after the member completes account registration.';
      replacingPresident = null;
      replacementMemberId = '';
      replacementReason = '';
      await loadPage();
    } catch (error) {
      errorMessage = error instanceof ApiError || error instanceof Error
        ? error.message
        : 'Unable to change the CDS President.';
    } finally {
      replacementSaving = false;
    }
  }

  async function signOut() {
    try {
      await logout();
    } finally {
      await goto('/login');
    }
  }
</script>

<svelte:head>
  <title>CDS Presidents | Coordinator Workspace</title>
  <meta name="description" content="View current, pending and former CDS Presidents for your assigned groups." />
</svelte:head>

{#if loading}
  <main class="state-screen"><div class="loader"></div><p>Loading CDS President records...</p></main>
{:else if !currentUser}
  <main class="state-screen"><h2>Coordinator workspace unavailable</h2><p>{errorMessage}</p><a href="/login">Return to sign in</a></main>
{:else}
  <CoordinatorLayout activePath="/coordinator/presidents" pageTitle="CDS Presidents" userEmail={currentUser.email} onSignOut={signOut}>
    <div class="module-content">
      <section class="page-intro">
        <div>
          <span class="eyebrow">CDS LEADERSHIP MANAGEMENT</span>
          <h2>CDS Presidents</h2>
          <p>View leadership records for your assigned CDS groups and replace a President when needed. Every change requires a reason and is retained in the leadership history.</p>
        </div>
        <a class="primary-button" href="/coordinator">Manage group designations</a>
      </section>

      {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}
      {#if successMessage}<div class="message success" role="status">{successMessage}</div>{/if}

      <section class="stats" aria-label="President summary">
        <article><span>Assigned CDS groups</span><strong>{groups.length}</strong></article>
        <article><span>Active Presidents</span><strong>{activeCount}</strong></article>
        <article><span>Awaiting activation</span><strong>{pendingCount}</strong></article>
        <article><span>Former Presidents</span><strong>{formerCount}</strong></article>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div><h3>President designation records</h3><p>Records are limited to your currently assigned CDS groups.</p></div>
          <span class="record-count">{visiblePresidents.length} of {presidents.length} records</span>
        </div>

        <div class="filters">
          <label>
            <span>Search Presidents or groups</span>
            <input type="search" bind:value={searchTerm} placeholder="Search name, state code or group..." />
          </label>
          <label>
            <span>Filter by status</span>
            <select bind:value={statusFilter}>
              <option value="all">All designations</option>
              <option value="active">Active Presidents</option>
              <option value="pending_activation">Awaiting activation</option>
              <option value="ended">Former Presidents</option>
            </select>
          </label>
        </div>

        {#if presidents.length === 0}
          <div class="empty">
            <div class="empty-icon">♙</div>
            <h3>No President designations yet</h3>
            <p>Once you designate a member from one of your assigned CDS groups, the record will appear here.</p>
            <a href="/coordinator">Go to Dashboard</a>
          </div>
        {:else if visiblePresidents.length === 0}
          <div class="empty"><h3>No matching records</h3><p>Try a different name, group or status filter.</p></div>
        {:else}
          <div class="president-list">
            {#each visiblePresidents as item (item.id)}
              {@const group = groupById.get(item.groupId)}
              <article class="president-card">
                <div class="person-avatar">{memberName(item).split(' ').filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div>
                <div class="person-details">
                  <strong>{memberName(item)}</strong>
                  <span>{item.stateCode}{item.memberEmail ? ' · ' + item.memberEmail : ''}</span>
                  <small>{group ? group.code + ' — ' + group.name : 'Previously assigned CDS group'}{group ? ' · ' + group.lgaName + ', ' + group.stateName : ''}</small>
                </div>
                <div class="designation-meta">
                  <span class:pending={item.status === 'pending_activation'} class:ended={item.status === 'ended'} class="status-pill">{statusLabel(item.status)}</span>
                  <small>Designated {formatDate(item.assignedAt)}</small>
                  {#if item.endedAt}<small>Ended {formatDate(item.endedAt)}</small>{/if}
                  {#if item.status === 'pending_activation'}<small class="account-pending">Member account activation pending</small>
                  {:else if item.accountUserId}<small class="account-active">Member account linked</small>{/if}
                  {#if item.status === 'ended'}
                    {#if item.endedReason}<small class="audit-detail">Reason: {item.endedReason}</small>{/if}
                    {#if item.endedByEmail}<small class="audit-detail">Changed by {item.endedByEmail}</small>{/if}
                  {:else if item.assignedByEmail}
                    <small class="audit-detail">Designated by {item.assignedByEmail}</small>
                  {/if}
                  {#if (item.status === 'active' || item.status === 'pending_activation') && group?.isActive}
                    <button class="change-button" type="button" onclick={() => openReplacement(item)}>Change President</button>
                  {/if}
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </section>

      <div class="scope-note">
        <strong>Your access is group-scoped</strong>
        <span>This directory only displays President records belonging to CDS groups actively assigned to your Coordinator account. Previous designations remain visible as historical records.</span>
      </div>
    </div>
  </CoordinatorLayout>
{/if}

{#if replacingPresident}
  {@const replacementGroup = groupById.get(replacingPresident.groupId)}
  <div class="modal-layer">
    <button class="modal-scrim" type="button" aria-label="Close change President dialog" onclick={closeReplacement}></button>
    <section class="replacement-modal" role="dialog" aria-modal="true" aria-labelledby="replacement-title">
      <header class="modal-heading">
        <div>
          <span class="eyebrow">LEADERSHIP CHANGE</span>
          <h2 id="replacement-title">Change CDS President</h2>
          <p>Replace the current designation for {replacementGroup?.code} — {replacementGroup?.name}.</p>
        </div>
        <button class="modal-close" type="button" aria-label="Close" onclick={closeReplacement} disabled={replacementSaving}>×</button>
      </header>
      <div class="outgoing-president">
        <span>Current President</span>
        <strong>{memberName(replacingPresident)}</strong>
        <small>{replacingPresident.stateCode}</small>
      </div>
      {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}
      <form onsubmit={submitReplacement}>
        <label class="form-field">
          <span>New President <b>*</b></span>
          <select bind:value={replacementMemberId} required disabled={replacementSaving || replacementCandidates.length === 0}>
            <option value="">Select an active member of this group</option>
            {#each replacementCandidates as member (member.memberId)}
              <option value={member.memberId}>{[member.firstName, member.middleName, member.lastName].filter(Boolean).join(' ')} · {member.stateCode}</option>
            {/each}
          </select>
          {#if replacementCandidates.length === 0}
            <small class="field-hint">There are no eligible active members available in this group.</small>
          {/if}
        </label>
        <label class="form-field">
          <span>Reason for replacement <b>*</b></span>
          <textarea bind:value={replacementReason} rows="4" maxlength="300" minlength="10" required disabled={replacementSaving} placeholder="Explain why the current President is being replaced (minimum 10 characters)."></textarea>
          <small class="field-hint">{replacementReason.trim().length}/300 characters · Minimum 10 characters</small>
        </label>
        <div class="audit-warning">
          The previous President's access to this CDS group will be revoked. Their designation, your reason and the Coordinator account making the change will remain in the leadership history.
        </div>
        <div class="modal-actions">
          <button class="cancel-button" type="button" onclick={closeReplacement} disabled={replacementSaving}>Cancel</button>
          <button class="confirm-button" type="submit" disabled={replacementSaving || !replacementMemberId || replacementReason.trim().length < 10 || replacementCandidates.length === 0}>
            {replacementSaving ? 'Updating...' : 'Confirm change'}
          </button>
        </div>
      </form>
    </section>
  </div>
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #f5f7f5; color: #19251e; font-family: Inter, Arial, sans-serif; }
  :global(button), :global(input), :global(select), :global(textarea) { font: inherit; }
  .module-content { width: 100%; min-width: 0; }
  .page-intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 22px; padding: 25px 28px; border: 1px solid #dcebe0; border-radius: 12px; background: #eaf3ed; }
  .eyebrow { color: #0a8050; font-size: 9px; font-weight: 800; letter-spacing: 1.4px; }
  .page-intro h2 { margin: 9px 0 7px; color: #19251e; font-size: 23px; }
  .page-intro p { max-width: 760px; margin: 0; color: #65766a; font-size: 11px; line-height: 1.7; }
  .primary-button { display: inline-flex; align-items: center; justify-content: center; min-height: 39px; padding: 9px 13px; border: 1px solid #0a5c37; border-radius: 8px; background: #0a5c37; color: #fff; font-size: 10px; font-weight: 700; text-decoration: none; white-space: nowrap; }
  .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 13px; margin-bottom: 20px; }
  .stats article { min-height: 88px; padding: 15px 17px; border: 1px solid #e5ebe6; border-radius: 10px; background: #fff; }
  .stats span, .stats strong { display: block; }
  .stats span { color: #819087; font-size: 10px; }
  .stats strong { margin-top: 7px; color: #123d27; font-size: 23px; }
  .panel { padding: 20px; border: 1px solid #e5ebe6; border-radius: 11px; background: #fff; }
  .panel-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; }
  .panel-heading h3 { margin: 0 0 5px; font-size: 15px; }
  .panel-heading p { margin: 0; color: #819087; font-size: 10px; line-height: 1.5; }
  .record-count { color: #819087; font-size: 9px; white-space: nowrap; }
  .filters { display: grid; grid-template-columns: minmax(240px, 1fr) minmax(190px, 260px); gap: 12px; margin: 18px 0; }
  .filters label { display: grid; gap: 6px; color: #344b3d; font-size: 10px; font-weight: 700; }
  .filters input, .filters select { width: 100%; min-height: 41px; padding: 8px 11px; border: 1px solid #dce5de; border-radius: 8px; background: #fff; color: #21372a; font-size: 11px; }
  .filters input:focus, .filters select:focus { outline: 3px solid #0a80501a; border-color: #0a8050; }
  .president-list { display: grid; }
  .president-card { display: grid; grid-template-columns: 42px minmax(0, 1fr) minmax(170px, auto); align-items: center; gap: 13px; padding: 14px 2px; border-top: 1px solid #edf1ed; }
  .person-avatar { width: 39px; height: 39px; display: grid; place-items: center; border-radius: 10px; background: #e6f1e9; color: #0a5c37; font-size: 11px; font-weight: 800; }
  .person-details { min-width: 0; }
  .person-details strong, .person-details span, .person-details small { display: block; overflow-wrap: anywhere; }
  .person-details strong { color: #253c2e; font-size: 11px; }
  .person-details span { margin-top: 4px; color: #607267; font-size: 9px; }
  .person-details small { margin-top: 4px; color: #819087; font-size: 9px; line-height: 1.5; }
  .designation-meta { display: grid; justify-items: end; gap: 5px; }
  .designation-meta small { color: #819087; font-size: 8px; text-align: right; }
  .status-pill { padding: 5px 8px; border-radius: 18px; background: #e7f4eb; color: #17603b; font-size: 8px; font-weight: 800; white-space: nowrap; }
  .status-pill.pending { background: #fff5e4; color: #94600e; }
  .status-pill.ended { background: #f0f1ef; color: #7b847e; }
  .account-pending { color: #94600e !important; }
  .account-active { color: #17603b !important; }
  .audit-detail { color: #65766a !important; line-height: 1.5; }
  .change-button { min-height: 30px; margin-top: 4px; padding: 6px 10px; border: 1px solid #0a8050; border-radius: 7px; background: #f2faf4; color: #0a6841; font-size: 9px; font-weight: 700; cursor: pointer; }
  .change-button:hover { background: #e4f2e8; }
  .modal-layer { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; overflow-y: auto; padding: 18px; }
  .modal-scrim { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; background: #071b10a8; }
  .replacement-modal { position: relative; width: min(100%, 560px); max-height: 94vh; overflow-y: auto; padding: 23px; border: 1px solid #e0e9e2; border-radius: 13px; background: #fff; box-shadow: 0 22px 70px #071e1250; }
  .modal-heading { display: flex; justify-content: space-between; gap: 15px; padding-bottom: 15px; border-bottom: 1px solid #edf1ed; }
  .modal-heading h2 { margin: 8px 0 5px; color: #1e3527; font-size: 19px; }
  .modal-heading p { margin: 0; color: #819087; font-size: 10px; line-height: 1.5; }
  .modal-close { width: 34px; height: 34px; border: 1px solid #e0e8e1; border-radius: 8px; background: #fff; color: #44554a; font-size: 22px; cursor: pointer; }
  .outgoing-president { display: grid; gap: 4px; margin: 15px 0; padding: 12px; border: 1px solid #e8ece8; border-radius: 8px; background: #f7f9f7; }
  .outgoing-president span { color: #819087; font-size: 9px; }
  .outgoing-president strong { color: #263d30; font-size: 12px; }
  .outgoing-president small { color: #819087; font-size: 9px; }
  .form-field { display: grid; gap: 7px; margin: 15px 0; color: #344b3d; font-size: 10px; font-weight: 700; }
  .form-field b { color: #a32920; }
  .form-field select, .form-field textarea { width: 100%; min-height: 42px; padding: 10px 11px; border: 1px solid #dce5de; border-radius: 8px; background: #fff; color: #26392d; font-size: 11px; font-weight: 400; }
  .form-field textarea { resize: vertical; line-height: 1.6; }
  .field-hint { color: #819087; font-size: 9px; font-weight: 400; }
  .audit-warning { padding: 12px; border: 1px solid #f0e3c7; border-radius: 8px; background: #fff9ed; color: #765c2b; font-size: 9px; line-height: 1.6; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 9px; padding-top: 16px; margin-top: 16px; border-top: 1px solid #edf1ed; }
  .cancel-button, .confirm-button { min-height: 39px; padding: 9px 14px; border-radius: 8px; font-size: 10px; font-weight: 700; cursor: pointer; }
  .cancel-button { border: 1px solid #dce5de; background: #fff; color: #355442; }
  .confirm-button { border: 1px solid #0a5c37; background: #0a5c37; color: #fff; }
  .confirm-button:disabled, .cancel-button:disabled, .modal-close:disabled { opacity: .5; cursor: not-allowed; }
  .empty { padding: 42px 18px; text-align: center; }
  .empty-icon { color: #0a8050; font-size: 28px; }
  .empty h3 { margin: 9px 0 6px; color: #253c2e; font-size: 14px; }
  .empty p { max-width: 520px; margin: 0 auto 12px; color: #819087; font-size: 10px; line-height: 1.7; }
  .empty a { color: #0a6841; font-size: 10px; font-weight: 700; text-decoration: none; }
  .scope-note { display: grid; gap: 5px; margin-top: 18px; padding: 14px 16px; border-radius: 9px; background: #eaf3ed; }
  .scope-note strong { color: #245c3c; font-size: 10px; }
  .scope-note span { color: #718078; font-size: 9px; line-height: 1.6; }
  .message { margin-bottom: 12px; padding: 11px 13px; border: 1px solid #efceca; border-radius: 8px; background: #fff3f2; color: #a32920; font-size: 10px; }
  .state-screen { min-height: 100vh; display: grid; place-content: center; justify-items: center; gap: 10px; color: #53665a; font-size: 12px; }
  .loader { width: 27px; height: 27px; border: 3px solid #dbe8de; border-top-color: #0a5c37; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 1050px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 760px) {
    .page-intro { align-items: flex-start; flex-direction: column; padding: 20px; }
    .stats { gap: 9px; }
    .stats article { min-height: 80px; padding: 12px; }
    .stats strong { font-size: 20px; }
    .panel { padding: 15px; }
    .filters { grid-template-columns: 1fr; }
    .president-card { grid-template-columns: 39px minmax(0, 1fr); align-items: start; }
    .designation-meta { grid-column: 2; justify-items: start; }
    .designation-meta small { text-align: left; }
    .panel-heading { align-items: flex-start; flex-direction: column; }
    .replacement-modal { padding: 17px; }
    .modal-actions { flex-direction: column-reverse; }
    .modal-actions button { width: 100%; }
  }
  @media (max-width: 380px) { .stats article { padding: 10px; } .stats span { font-size: 9px; } }
</style>
