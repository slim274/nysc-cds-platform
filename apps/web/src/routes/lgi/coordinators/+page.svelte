<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  import {
    ApiError,
    getCurrentUser,
    listCdsGroups,
    listCoordinators,
    createCoordinator,
    updateCoordinator,
    listCoordinatorHandovers,
    createCoordinatorHandover,
    logout
  } from '#lib/api/client.ts';

  import type {
    AuthUser,
    CdsGroupSummary,
    CoordinatorRecord,
    CoordinatorHandover,
    CoordinatorHandoverReason
  } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let groups = $state<CdsGroupSummary[]>([]);
  let coordinators = $state<CoordinatorRecord[]>([]);
  let handovers = $state<CoordinatorHandover[]>([]);
  let handoverOpen = $state(false);
  let handoverSaving = $state(false);
  let handoverGroupId = $state('');
  let handoverOutgoingId = $state('');
  let handoverIncomingId = $state('');
  let handoverReason = $state<CoordinatorHandoverReason>('resignation');
  let handoverNotes = $state('');
  let pendingActivitiesText = $state('');
  let upcomingEventsText = $state('');
  let outstandingTasksText = $state('');
  let handoverError = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let signingOut = $state(false);
  let mobileNavOpen = $state(false);
  let formOpen = $state(false);
  let editingCoordinator = $state<CoordinatorRecord | null>(null);
  let email = $state('');
  let selectedGroupIds = $state<string[]>([]);
  let search = $state('');
  let statusFilter = $state('all');
  let errorMessage = $state('');
  let formError = $state('');
  let noticeMessage = $state('');
  let activationToken = $state('');
  let activationEmail = $state('');

  const visibleCoordinators = $derived(coordinators.filter((coordinator) => {
    const matchesSearch = !search.trim() ||
      (coordinator.email ?? '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    const matchesStatus = statusFilter === 'all' || coordinator.accountStatus === statusFilter;
    return matchesSearch && matchesStatus;
  }));

  const handoverIncomingCandidates = $derived(
    coordinators.filter((coordinator) =>
      coordinator.userId !== handoverOutgoingId &&
      coordinator.accountStatus === 'active' &&
      coordinator.assignments.some((assignment) => assignment.isActive && assignment.groupId)
    )
  );

  const assignedGroupOwners = $derived.by(() => {
    const owners = new Map<string, string>();
    for (const coordinator of coordinators) {
      for (const assignment of coordinator.assignments) {
        if (assignment.isActive && assignment.groupId) {
          owners.set(assignment.groupId, coordinator.email ?? 'Another coordinator');
        }
      }
    }
    return owners;
  });

  onMount(() => {
    void loadPage();
  });

  async function loadPage() {
    loading = true;
    errorMessage = '';

    try {
      const session = await getCurrentUser();
      if (!session.roles.some((role) => role.code === 'LGI_ADMIN' && role.lgaId !== null)) {
        errorMessage = 'Your account needs an active LGA administrator assignment.';
        return;
      }

      currentUser = session.user;
      const [groupRows, coordinatorRows, handoverRows] = await Promise.all([
        listCdsGroups({ active: true }),
        listCoordinators(),
        listCoordinatorHandovers()
      ]);
      groups = groupRows;
      coordinators = coordinatorRows;
      handovers = handoverRows;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load coordinator management.';
    } finally {
      loading = false;
    }
  }

  function closeMobileNavigation() {
    mobileNavOpen = false;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      formOpen = false;
      handoverOpen = false;
      closeMobileNavigation();
    }
  }

  function resetForm() {
    editingCoordinator = null;
    email = '';
    selectedGroupIds = [];
    formError = '';
  }

  function openCreateForm() {
    resetForm();
    formOpen = true;
  }

  function openEditForm(coordinator: CoordinatorRecord) {
    editingCoordinator = coordinator;
    email = coordinator.email ?? '';
    selectedGroupIds = coordinator.assignments
      .filter((assignment) => assignment.isActive && assignment.groupId)
      .map((assignment) => assignment.groupId as string);
    formError = '';
    formOpen = true;
  }

  function toggleGroup(groupId: string, checked: boolean) {
    selectedGroupIds = checked
      ? [...new Set([...selectedGroupIds, groupId])]
      : selectedGroupIds.filter((id) => id !== groupId);
  }

  function groupIsTakenByAnotherCoordinator(groupId: string): boolean {
    const owner = assignedGroupOwners.get(groupId);
    return Boolean(owner && owner !== editingCoordinator?.email);
  }

  async function saveCoordinator(event: SubmitEvent) {
    event.preventDefault();
    formError = '';

    if (selectedGroupIds.length === 0) {
      formError = 'Select at least one CDS group.';
      return;
    }

    saving = true;
    try {
      if (editingCoordinator) {
        await updateCoordinator(editingCoordinator.userId, {
          groupIds: selectedGroupIds
        });
        noticeMessage = 'Coordinator group assignments updated.';
      } else {
        const result = await createCoordinator({
          email: email.trim(),
          groupIds: selectedGroupIds
        });
        if (result.activationToken) {
          activationToken = result.activationToken;
          activationEmail = result.email ?? email.trim();
          noticeMessage = 'Coordinator account created. Copy the development activation token below.';
        } else {
          noticeMessage = 'Coordinator assignments saved.';
        }
      }

      formOpen = false;
      resetForm();
      await loadPage();
    } catch (error) {
      formError = error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unable to save coordinator details.';
    } finally {
      saving = false;
    }
  }


  function openHandoverForm(
    coordinator: CoordinatorRecord,
    assignment: CoordinatorRecord['assignments'][number]
  ) {
    if (!assignment.groupId) return;
    handoverGroupId = assignment.groupId;
    handoverOutgoingId = coordinator.userId;
    handoverIncomingId = '';
    handoverReason = 'resignation';
    handoverNotes = '';
    pendingActivitiesText = '';
    upcomingEventsText = '';
    outstandingTasksText = '';
    handoverError = '';
    handoverOpen = true;
  }

  function splitHandoverItems(value: string): string[] {
    return value.split('\n').map((item) => item.trim()).filter(Boolean);
  }

  async function submitHandover(event: SubmitEvent) {
    event.preventDefault();
    handoverError = '';
    if (!handoverIncomingId) {
      handoverError = 'Select an active incoming Coordinator.';
      return;
    }
    if (handoverNotes.trim().length < 10) {
      handoverError = 'Provide handover notes of at least 10 characters.';
      return;
    }

    handoverSaving = true;
    try {
      const result = await createCoordinatorHandover({
        groupId: handoverGroupId,
        outgoingCoordinatorId: handoverOutgoingId,
        incomingCoordinatorId: handoverIncomingId,
        reason: handoverReason,
        handoverNotes: handoverNotes.trim(),
        pendingActivities: splitHandoverItems(pendingActivitiesText),
        upcomingEvents: splitHandoverItems(upcomingEventsText),
        outstandingTasks: splitHandoverItems(outstandingTasksText)
      });
      noticeMessage = `Responsibility for ${result.groupCode} has been transferred. The incoming Coordinator must review and accept the handover.`;
      handoverOpen = false;
      await loadPage();
    } catch (error) {
      handoverError = error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unable to start the handover.';
    } finally {
      handoverSaving = false;
    }
  }

  function handoverReasonLabel(reason: string) {
    return reason.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  async function toggleAccount(coordinator: CoordinatorRecord) {
    const isDisabled = coordinator.accountStatus === 'disabled';
    const action = isDisabled ? 'reactivate' : 'disable';
    if (!confirm(`Are you sure you want to ${action} ${coordinator.email ?? 'this coordinator'}?`)) return;

    errorMessage = '';
    noticeMessage = '';
    try {
      await updateCoordinator(coordinator.userId, { isEnabled: isDisabled });
      noticeMessage = `${coordinator.email ?? 'Coordinator'} account ${isDisabled ? 'reactivated' : 'disabled'}.`;
      await loadPage();
    } catch (error) {
      errorMessage = error instanceof ApiError ? error.message : 'Unable to update coordinator account.';
    }
  }

  async function copyActivationToken() {
    try {
      await navigator.clipboard.writeText(activationToken);
      noticeMessage = 'Activation token copied. Treat it as a password and share it securely.';
    } catch {
      errorMessage = 'Clipboard access is unavailable. Select and copy the token manually.';
    }
  }

  async function dismissActivationToken() {
    activationToken = '';
    activationEmail = '';
  }

  async function handleLogout() {
    signingOut = true;
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      await goto('/login');
    }
  }

  function statusLabel(status: string) {
    return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
</script>

<svelte:head>
  <title>CDS Coordinators | NYSC CDS Platform</title>
  <meta name="description" content="Manage CDS Coordinator accounts and group assignments within your assigned LGA(s)." />
</svelte:head>

<svelte:window onkeydown={handleWindowKeydown} />

{#if loading}
  <main class="state-screen"><div class="loader"></div><p>Loading coordinator management...</p></main>
{:else if !currentUser}
  <main class="state-screen"><h2>Coordinator management unavailable</h2><p>{errorMessage}</p><button class="primary-button" onclick={() => goto('/login')}>Return to login</button></main>
{:else}
  <div class="admin-shell">
    {#if mobileNavOpen}
      <button class="drawer-backdrop" type="button" aria-label="Close navigation menu" onclick={closeMobileNavigation}></button>
    {/if}

    <aside id="coordinator-sidebar" class="sidebar" class:open={mobileNavOpen} aria-label="LGI administration">
      <div class="brand">
        <div class="brand-icon">N</div>
        <div class="brand-copy"><strong>NYSC CDS</strong><span>LGI Administration</span></div>
        <button class="drawer-close" type="button" aria-label="Close navigation menu" onclick={closeMobileNavigation}>×</button>
      </div>

      <div class="nav-label">ADMINISTRATION</div>
      <nav aria-label="Primary navigation">
        <a class="nav-item" href="/lgi" onclick={closeMobileNavigation}><span class="nav-icon">▦</span><span>Dashboard</span></a>
        <div class="nav-item muted"><span class="nav-icon">♙</span><span>Corps Members</span><small>Soon</small></div>
        <div class="nav-item muted"><span class="nav-icon">▤</span><span>Batches &amp; Streams</span><small>Soon</small></div>
        <a class="nav-item" href="/lgi/cds-groups" onclick={closeMobileNavigation}><span class="nav-icon">◎</span><span>CDS Groups</span></a>
        <a class="nav-item" href="/lgi/course-catalogue" onclick={closeMobileNavigation}><span class="nav-icon">▤</span><span>Course Catalogue</span></a>
        <div class="nav-item muted"><span class="nav-icon">⌘</span><span>Course Mapping</span><small>Soon</small></div>
        <a class="nav-item active" href="/lgi/coordinators" aria-current="page" onclick={closeMobileNavigation}><span class="nav-icon">♧</span><span>CDS Coordinators</span></a>
        <div class="nav-item muted"><span class="nav-icon">✓</span><span>Attendance</span><small>Soon</small></div>
        <div class="nav-item muted"><span class="nav-icon">▣</span><span>Monthly Clearance</span><small>Soon</small></div>
        <div class="nav-item muted"><span class="nav-icon">▥</span><span>Reports</span><small>Soon</small></div>
      </nav>

      <div class="sidebar-footer">
        <div class="environment-status"><span class="status-indicator"></span>Development Environment</div>
        <button class="sidebar-logout" type="button" onclick={handleLogout} disabled={signingOut}>
          {signingOut ? 'Signing out...' : 'Sign out'}
        </button>
      </div>
    </aside>

    <section class="main-area">
      <header class="topbar">
        <div class="topbar-heading">
          <button class="menu-button" type="button" aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileNavOpen} aria-controls="coordinator-sidebar" onclick={() => (mobileNavOpen = !mobileNavOpen)}>
            <span></span><span></span><span></span>
          </button>
          <div><span class="breadcrumb">Administration / CDS Officials</span><h1>CDS Coordinators</h1></div>
        </div>
        <div class="account"><div class="avatar">LG</div><div class="account-copy"><strong>LGI Administrator</strong><span>{currentUser.email}</span></div></div>
      </header>

      <main class="page-content">
        {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}
        {#if noticeMessage}<div class="message success" role="status">{noticeMessage}</div>{/if}

        {#if activationToken}
          <section class="token-panel">
            <div>
              <span class="eyebrow">DEVELOPMENT INVITATION</span>
              <h2>Activation token generated</h2>
              <p>Account: <strong>{activationEmail}</strong>. Email delivery is not configured in this development environment.</p>
              <p>Share this one-time token securely. It expires after 24 hours and must not be committed or posted publicly. The Coordinator workspace is a later implementation step; this screen currently manages invitations and group assignments.</p>
            </div>
            <code>{activationToken}</code>
            <div class="token-actions">
              <button class="secondary-button" type="button" onclick={copyActivationToken}>Copy token</button>
              <button class="text-button" type="button" onclick={dismissActivationToken}>Dismiss</button>
            </div>
          </section>
        {/if}

        <section class="intro">
          <div><span class="eyebrow">CDS OFFICIALS</span><h2>Manage CDS Coordinators</h2><p>Invite coordinators and assign them to active CDS groups in your assigned LGA(s). A coordinator can be assigned to more than one group, but each group can have only one active coordinator.</p></div>
          <button class="primary-button" type="button" onclick={openCreateForm}>＋ Add coordinator</button>
        </section>

        <section class="summary-grid" aria-label="Coordinator summary">
          <article class="summary-card"><span>Coordinators</span><strong>{coordinators.length}</strong><small>Accounts assigned in your LGA scope</small></article>
          <article class="summary-card"><span>Active accounts</span><strong>{coordinators.filter((item) => item.accountStatus === 'active').length}</strong><small>Account credentials are activated</small></article>
          <article class="summary-card"><span>Pending activation</span><strong>{coordinators.filter((item) => item.accountStatus === 'pending_activation').length}</strong><small>Invitation awaiting activation</small></article>
          <article class="summary-card"><span>Assigned groups</span><strong>{coordinators.reduce((total, item) => total + item.assignments.filter((assignment) => assignment.isActive && assignment.groupId).length, 0)}</strong><small>Active coordinator-to-group assignments</small></article>
        </section>

        <section class="list-panel">
          <div class="panel-heading"><div><h3>Coordinator accounts</h3><p>Review account status and assigned CDS groups.</p></div></div>
          <form class="filters" onsubmit={(event) => event.preventDefault()}>
            <label><span>Search by email</span><input bind:value={search} placeholder="Search coordinator email..." /></label>
            <label><span>Account status</span><select bind:value={statusFilter}><option value="all">All statuses</option><option value="active">Active</option><option value="pending_activation">Pending activation</option><option value="disabled">Disabled</option><option value="suspended">Suspended</option></select></label>
          </form>

          {#if visibleCoordinators.length === 0}
            <div class="empty-state"><div class="empty-icon">♧</div><h3>No coordinators found</h3><p>Invite a coordinator and assign them to one or more active CDS groups.</p><button class="primary-button" type="button" onclick={openCreateForm}>Add first coordinator</button></div>
          {:else}
            <div class="coordinator-list">
              {#each visibleCoordinators as coordinator (coordinator.userId)}
                <article class="coordinator-card">
                  <div class="coordinator-heading">
                    <div class="person-icon">♧</div>
                    <div class="person-details"><h3>{coordinator.email ?? 'Email not available'}</h3><span class:pending={coordinator.accountStatus === 'pending_activation'} class:disabled={coordinator.accountStatus === 'disabled' || coordinator.accountStatus === 'suspended'} class="status-badge">{statusLabel(coordinator.accountStatus)}</span></div>
                    <div class="card-actions">
                      <button class="secondary-button" type="button" onclick={() => openEditForm(coordinator)}>Edit groups</button>
                      {#if coordinator.accountStatus === 'active' || coordinator.accountStatus === 'pending_activation'}
                        <button class="danger-button" type="button" onclick={() => void toggleAccount(coordinator)}>Disable</button>
                      {:else if coordinator.accountStatus === 'disabled'}
                        <button class="secondary-button" type="button" onclick={() => void toggleAccount(coordinator)}>Reactivate</button>
                      {/if}
                    </div>
                  </div>
                  <div class="assigned-groups">
                    <span class="assigned-label">Assigned CDS groups</span>
                    {#if coordinator.assignments.filter((assignment) => assignment.isActive && assignment.groupId).length === 0}
                      <span class="muted-copy">No active group assignments</span>
                    {:else}
                      <div class="group-chips">
                        {#each coordinator.assignments.filter((assignment) => assignment.isActive && assignment.groupId) as assignment}
                          <span class="group-chip">
                            {assignment.groupCode} · {assignment.groupName}
                            <button class="handover-link" type="button" onclick={() => openHandoverForm(coordinator, assignment)}>Transfer responsibility</button>
                          </span>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </section>


        <section class="list-panel handover-history">
          <div class="panel-heading"><div><h3>CDS group handover history</h3><p>Track coordinator changes and acknowledgement by the incoming Coordinator.</p></div></div>
          {#if handovers.length === 0}
            <p class="muted-copy history-empty">No coordinator handovers have been recorded yet.</p>
          {:else}
            <div class="handover-list">
              {#each handovers as handover (handover.id)}
                <article class="handover-card">
                  <div class="handover-card-heading">
                    <div><strong>{handover.groupCode} · {handover.groupName}</strong><small>{handoverReasonLabel(handover.reason)} · {new Date(handover.createdAt).toLocaleString()}</small></div>
                    <span class:accepted={handover.status === 'accepted'} class="handover-status">{handoverReasonLabel(handover.status)}</span>
                  </div>
                  <p><strong>Outgoing:</strong> {handover.outgoingCoordinatorEmail ?? 'Not available'} → <strong>Incoming:</strong> {handover.incomingCoordinatorEmail}</p>
                  <p class="handover-notes">{handover.handoverNotes}</p>
                  {#if handover.pendingActivities.length}<p><strong>Pending activities:</strong> {handover.pendingActivities.join(' · ')}</p>{/if}
                  {#if handover.upcomingEvents.length}<p><strong>Upcoming events:</strong> {handover.upcomingEvents.join(' · ')}</p>{/if}
                  {#if handover.outstandingTasks.length}<p><strong>Outstanding tasks:</strong> {handover.outstandingTasks.join(' · ')}</p>{/if}
                  {#if handover.acceptanceNotes}<p><strong>Incoming Coordinator:</strong> {handover.acceptanceNotes}</p>{/if}
                  {#if handover.acceptedAt}<small class="accepted-at">Acknowledged {new Date(handover.acceptedAt).toLocaleString()}</small>{:else if handover.status === 'pending_acceptance'}<small class="pending-at">Awaiting incoming Coordinator acknowledgement.</small>{/if}
                </article>
              {/each}
            </div>
          {/if}
        </section>

        <section class="info-panel">
          <h3>Coordinator access rules</h3>
          <p>Disabling an account revokes its active sessions and releases its groups while preserving inactive assignment history. Reactivating restores the account but does not reclaim groups; assign available groups again. All changes are restricted to your assigned LGA(s).</p>
        </section>
      </main>

      <footer class="page-footer">NYSC CDS Management Platform · Coordinator Management</footer>
    </section>
  </div>
{/if}


{#if handoverOpen}
  {@const selectedGroup = groups.find((group) => group.id === handoverGroupId)}
  {@const outgoingCoordinator = coordinators.find((coordinator) => coordinator.userId === handoverOutgoingId)}
  <div class="modal-layer">
    <button class="modal-scrim" type="button" aria-label="Close handover form" onclick={() => (handoverOpen = false)}></button>
    <div class="coordinator-modal handover-modal" role="dialog" aria-modal="true" aria-labelledby="handover-form-title">
      <div class="modal-header">
        <div><span class="eyebrow">CDS GROUP SUCCESSION</span><h2 id="handover-form-title">Transfer group responsibility</h2><p>{selectedGroup?.code} · {selectedGroup?.name}. Existing group records remain with the group.</p></div>
        <button class="modal-close" type="button" aria-label="Close handover form" onclick={() => (handoverOpen = false)}>×</button>
      </div>
      {#if handoverError}<div class="message error" role="alert">{handoverError}</div>{/if}
      <form class="coordinator-form" onsubmit={submitHandover}>
        <div class="email-readonly"><span>Outgoing Coordinator</span><strong>{outgoingCoordinator?.email}</strong></div>
        <label><span>Incoming Coordinator *</span>
          <select bind:value={handoverIncomingId} required>
            <option value="">Select an active Coordinator</option>
            {#each handoverIncomingCandidates as candidate (candidate.userId)}
              <option value={candidate.userId}>{candidate.email}</option>
            {/each}
          </select>
        </label>
        {#if handoverIncomingCandidates.length === 0}
          <p class="handover-warning">No other active Coordinator accounts are available in your LGA. Invite and activate a successor before starting this transfer.</p>
        {/if}
        <label><span>Reason for handover *</span>
          <select bind:value={handoverReason}>
            <option value="resignation">Resignation</option>
            <option value="transfer">Transfer to another unit</option>
            <option value="temporary_replacement">Temporary replacement</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label><span>Handover notes *</span><textarea bind:value={handoverNotes} rows="4" maxlength="10000" placeholder="Summarise the current position of the CDS group, important context and items the successor should know." required></textarea></label>
        <label><span>Pending activities (one per line)</span><textarea bind:value={pendingActivitiesText} rows="3" placeholder="Activities already started but not completed"></textarea></label>
        <label><span>Upcoming events (one per line)</span><textarea bind:value={upcomingEventsText} rows="3" placeholder="Scheduled meetings, outreach or events"></textarea></label>
        <label><span>Outstanding tasks (one per line)</span><textarea bind:value={outstandingTasksText} rows="3" placeholder="Actions that still need an owner or follow-up"></textarea></label>
        <div class="handover-warning">Starting the transfer immediately changes the active Coordinator assignment. The incoming Coordinator will then review these details and acknowledge the handover from their account.</div>
        <div class="modal-actions"><button class="secondary-button" type="button" onclick={() => (handoverOpen = false)} disabled={handoverSaving}>Cancel</button><button class="primary-button" type="submit" disabled={handoverSaving || handoverIncomingCandidates.length === 0}>{handoverSaving ? 'Transferring...' : 'Transfer responsibility'}</button></div>
      </form>
    </div>
  </div>
{/if}

{#if formOpen}
  <div class="modal-layer">
    <button class="modal-scrim" type="button" aria-label="Close coordinator form" onclick={() => (formOpen = false)}></button>
    <div class="coordinator-modal" role="dialog" aria-modal="true" aria-labelledby="coordinator-form-title">
      <div class="modal-header">
        <div><span class="eyebrow">CDS COORDINATOR</span><h2 id="coordinator-form-title">{editingCoordinator ? 'Update coordinator groups' : 'Invite a coordinator'}</h2><p>{editingCoordinator ? 'Change the CDS groups assigned to this coordinator.' : 'Create an account invitation and assign eligible CDS groups.'}</p></div>
        <button class="modal-close" type="button" aria-label="Close form" onclick={() => (formOpen = false)}>×</button>
      </div>
      {#if formError}<div class="message error" role="alert">{formError}</div>{/if}
      <form class="coordinator-form" onsubmit={saveCoordinator}>
        {#if !editingCoordinator}
          <label><span>Coordinator email address *</span><input type="email" bind:value={email} autocomplete="email" placeholder="coordinator@example.com" required /></label>
        {:else}
          <div class="email-readonly"><span>Coordinator account</span><strong>{editingCoordinator.email}</strong><small>Account status: {statusLabel(editingCoordinator.accountStatus)}</small></div>
        {/if}
        <fieldset class="group-fieldset">
          <legend>Assign CDS groups *</legend>
          <p>Select one or more active groups in your assigned LGA(s).</p>
          {#if groups.length === 0}
            <div class="empty-groups">No active CDS groups are available. Create a CDS group first.</div>
          {:else}
            <div class="group-options">
              {#each groups as group (group.id)}
                {@const assignedTo = assignedGroupOwners.get(group.id)}
                {@const unavailable = Boolean(assignedTo && assignedTo !== editingCoordinator?.email)}
                <label class:unavailable class="group-option">
                  <input type="checkbox" checked={selectedGroupIds.includes(group.id)} disabled={unavailable} onchange={(event) => toggleGroup(group.id, event.currentTarget.checked)} />
                  <span><strong>{group.code} — {group.name}</strong><small>{group.lgaName}, {group.stateName} · Capacity {group.currentMemberCount}/{group.maxCapacity}</small>{#if unavailable}<small class="taken-copy">Already assigned to {assignedTo}</small>{/if}</span>
                </label>
              {/each}
            </div>
          {/if}
          <div class="selection-count">{selectedGroupIds.length} group(s) selected</div>
        </fieldset>
        <div class="modal-actions"><button class="secondary-button" type="button" onclick={() => (formOpen = false)} disabled={saving}>Cancel</button><button class="primary-button" type="submit" disabled={saving || groups.length === 0}>{saving ? 'Saving...' : editingCoordinator ? 'Save assignments' : 'Create coordinator'}</button></div>
      </form>
    </div>
  </div>
{/if}

<style>

  textarea { width: 100%; min-height: 82px; resize: vertical; padding: 11px 12px; border: 1px solid #dce5de; border-radius: 8px; background: #fff; color: #21372a; font: inherit; font-size: 12px; line-height: 1.5; }
  textarea:focus { outline: 3px solid #0a80501a; border-color: #0a8050; }
  .group-chip { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .handover-link { padding: 3px 7px; border: 1px solid #c8decf; border-radius: 5px; background: #fff; color: #0a5c37; font-size: 9px; font-weight: 700; cursor: pointer; }
  .handover-history { margin-top: 18px; }
  .history-empty { padding: 20px 0; }
  .handover-list { display: grid; gap: 10px; margin-top: 16px; }
  .handover-card { padding: 15px; border: 1px solid #e5ebe6; border-radius: 9px; background: #fcfdfc; }
  .handover-card-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .handover-card-heading strong, .handover-card-heading small { display: block; }
  .handover-card-heading strong { color: #193b28; font-size: 12px; }
  .handover-card-heading small { margin-top: 5px; color: #819087; font-size: 9px; }
  .handover-status { padding: 5px 8px; border-radius: 20px; background: #fff4df; color: #9c6500; font-size: 9px; font-weight: 700; white-space: nowrap; }
  .handover-status.accepted { background: #e7f4eb; color: #087443; }
  .handover-card p { margin: 10px 0 0; color: #607267; font-size: 10px; line-height: 1.6; }
  .handover-card .handover-notes { padding: 10px; border-radius: 7px; background: #f2f6f3; white-space: pre-wrap; }
  .accepted-at, .pending-at { display: block; margin-top: 10px; color: #087443; font-size: 9px; }
  .pending-at { color: #9c6500; }
  .handover-warning { margin: 0; padding: 10px 12px; border: 1px solid #f0dfbd; border-radius: 8px; background: #fff9eb; color: #8a5a12; font-size: 10px; line-height: 1.6; }
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; overflow-x: hidden; background: #f5f7f5; color: #19251e; font-family: Inter, Arial, sans-serif; }
  :global(button), :global(input), :global(select) { font: inherit; }
  .admin-shell { min-height: 100vh; display: flex; }
  .sidebar { width: 255px; flex: 0 0 255px; display: flex; flex-direction: column; padding: 27px 17px; background: #073d27; color: #fff; }
  .brand { display: flex; align-items: center; gap: 12px; padding: 0 9px 35px; }
  .brand-icon { width: 40px; height: 40px; flex: 0 0 40px; display: grid; place-items: center; border-radius: 9px; background: #fff; color: #0a5c37; font-size: 21px; font-weight: 800; }
  .brand-copy strong, .brand-copy span { display: block; }
  .brand-copy strong { font-size: 16px; }
  .brand-copy span { margin-top: 4px; color: #b7d4c3; font-size: 10px; }
  .drawer-close { display: none; }
  .nav-label { padding: 0 10px 13px; color: #a6c6b3; font-size: 9px; font-weight: 700; letter-spacing: 1.5px; }
  nav { display: grid; gap: 5px; }
  .nav-item { min-height: 43px; display: flex; align-items: center; gap: 11px; padding: 0 11px; border-radius: 7px; color: #d1e0d7; font-size: 12px; text-decoration: none; }
  .nav-item.active { background: #0e6440; color: #fff; font-weight: 700; }
  .nav-item.muted { color: #d1e0d7; }
  .nav-item small { margin-left: auto; color: #a6c6b3; font-size: 8px; }
  .nav-icon { width: 20px; flex: 0 0 20px; text-align: center; font-size: 15px; }
  .sidebar-footer { margin-top: 24px; padding: 17px 9px 5px; border-top: 1px solid #ffffff1f; color: #a6c6b3; font-size: 10px; }
  .environment-status { display: flex; align-items: center; }
  .status-indicator { display: inline-block; width: 7px; height: 7px; margin-right: 7px; border-radius: 50%; background: #55d58a; }
  .sidebar-logout { width: 100%; min-height: 42px; margin-top: 15px; padding: 10px 12px; border: 1px solid #ffffff3d; border-radius: 8px; background: #ffffff14; color: #fff; text-align: left; font-size: 12px; font-weight: 600; cursor: pointer; }
  .main-area { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .topbar { position: sticky; top: 0; z-index: 15; min-height: 88px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 15px 34px; border-bottom: 1px solid #e8ece8; background: #fff; }
  .topbar-heading { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .menu-button { display: none; }
  .breadcrumb { color: #819087; font-size: 10px; }
  .topbar h1 { margin: 5px 0 0; font-size: 21px; }
  .account { display: flex; align-items: center; gap: 10px; }
  .avatar { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; background: #e6f1e9; color: #0a5c37; font-size: 12px; font-weight: 700; }
  .account-copy strong, .account-copy span { display: block; }
  .account-copy strong { font-size: 11px; }
  .account-copy span { max-width: 240px; overflow: hidden; margin-top: 4px; color: #819087; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .page-content { width: 100%; max-width: 1360px; margin: 0 auto; padding: 30px 32px; }
  .intro { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 23px; }
  .eyebrow { color: #0a8050; font-size: 9px; font-weight: 700; letter-spacing: 1.5px; }
  .intro h2 { margin: 9px 0 7px; font-size: 25px; }
  .intro p { max-width: 740px; margin: 0; color: #718078; font-size: 12px; line-height: 1.7; }
  .primary-button, .secondary-button, .danger-button, .text-button { min-height: 40px; display: inline-flex; align-items: center; justify-content: center; padding: 9px 14px; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; }
  .primary-button { border: 1px solid #0a5c37; background: #0a5c37; color: #fff; }
  .primary-button:hover:not(:disabled) { background: #064526; }
  .primary-button:disabled { opacity: .6; cursor: not-allowed; }
  .secondary-button { border: 1px solid #d7e2da; background: #fff; color: #27553b; }
  .danger-button { border: 1px solid #f0c9c6; background: #fff7f6; color: #b42318; }
  .text-button { border: 0; background: transparent; color: #587064; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 20px; }
  .summary-card { min-height: 98px; padding: 17px 19px; border: 1px solid #e5ebe6; border-radius: 10px; background: #fff; }
  .summary-card span, .summary-card small { display: block; color: #819087; font-size: 10px; }
  .summary-card strong { display: block; margin: 6px 0 4px; color: #123d27; font-size: 24px; }
  .list-panel { padding: 20px; border: 1px solid #e5ebe6; border-radius: 12px; background: #fff; }
  .panel-heading h3 { margin: 0; font-size: 15px; }
  .panel-heading p { margin: 5px 0 0; color: #819087; font-size: 11px; }
  .filters { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(170px, 240px); gap: 12px; margin: 20px 0; }
  .filters label, .coordinator-form > label { display: grid; gap: 7px; color: #344b3d; font-size: 11px; font-weight: 600; }
  input, select { width: 100%; min-height: 42px; padding: 0 12px; border: 1px solid #dce5de; border-radius: 8px; background: #fff; color: #21372a; font-size: 12px; }
  input:focus, select:focus { outline: 3px solid #0a80501a; border-color: #0a8050; }
  .coordinator-list { display: grid; gap: 12px; }
  .coordinator-card { padding: 17px; border: 1px solid #e8eee9; border-radius: 10px; }
  .coordinator-heading { display: flex; align-items: center; gap: 12px; }
  .person-icon { width: 38px; height: 38px; flex: 0 0 38px; display: grid; place-items: center; border-radius: 9px; background: #eaf3ed; color: #0a5c37; font-size: 17px; }
  .person-details { min-width: 0; flex: 1; }
  .person-details h3 { overflow-wrap: anywhere; margin: 0 0 7px; font-size: 13px; }
  .status-badge { display: inline-flex; align-items: center; padding: 4px 8px; border-radius: 20px; background: #e7f4eb; color: #087443; font-size: 9px; font-weight: 700; }
  .status-badge.pending { background: #fff4df; color: #9c6500; }
  .status-badge.disabled { background: #fcebea; color: #b42318; }
  .card-actions { display: flex; flex-wrap: wrap; gap: 7px; }
  .assigned-groups { display: grid; gap: 8px; margin: 16px 0 0 50px; padding-top: 13px; border-top: 1px solid #edf1ed; }
  .assigned-label { color: #819087; font-size: 10px; font-weight: 700; }
  .group-chips { display: flex; flex-wrap: wrap; gap: 7px; }
  .group-chip { padding: 6px 9px; border-radius: 6px; background: #f0f6f2; color: #28563b; font-size: 10px; }
  .muted-copy { color: #98a39b; font-size: 11px; }
  .empty-state { padding: 46px 20px; text-align: center; }
  .empty-icon { font-size: 28px; color: #0a8050; }
  .empty-state h3 { margin: 12px 0 6px; font-size: 15px; }
  .empty-state p { margin: 0 auto 17px; color: #819087; font-size: 11px; line-height: 1.7; }
  .info-panel, .token-panel { margin-top: 18px; padding: 18px 20px; border: 1px solid #dcebe0; border-radius: 10px; background: #f0f7f2; }
  .info-panel h3, .token-panel h2 { margin: 0 0 7px; color: #17472d; font-size: 14px; }
  .info-panel p, .token-panel p { margin: 4px 0; color: #607267; font-size: 11px; line-height: 1.7; }
  .token-panel { display: grid; gap: 11px; }
  .token-panel code { display: block; overflow-wrap: anywhere; padding: 12px; border: 1px solid #dce5de; border-radius: 8px; background: #fff; color: #123d27; font-size: 12px; }
  .token-actions { display: flex; align-items: center; gap: 8px; }
  .message { margin-bottom: 14px; padding: 11px 13px; border-radius: 8px; font-size: 11px; line-height: 1.6; }
  .message.error { border: 1px solid #efceca; background: #fff3f2; color: #a32920; }
  .message.success { border: 1px solid #cce6d3; background: #eef8f0; color: #16633b; }
  .page-footer { margin-top: auto; padding: 18px 32px; border-top: 1px solid #e8ece8; color: #89948c; font-size: 10px; }
  .state-screen { min-height: 100vh; display: grid; align-content: center; justify-items: center; gap: 12px; color: #53665a; font: 13px Inter, Arial, sans-serif; }
  .loader { width: 28px; height: 28px; border: 3px solid #dce8df; border-top-color: #0a8050; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .drawer-backdrop { display: none; }
  .sidebar-logout:hover { background: #ffffff24; }
  .modal-layer { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 20px; }
  .modal-scrim { position: absolute; inset: 0; width: 100%; border: 0; background: #071b10a8; }
  .coordinator-modal { position: relative; z-index: 1; width: min(100%, 620px); max-height: min(90vh, 850px); overflow-y: auto; padding: 24px; border: 1px solid #e5ebe6; border-radius: 14px; background: #fff; box-shadow: 0 24px 80px #0003; }
  .modal-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
  .modal-header h2 { margin: 8px 0 6px; font-size: 20px; }
  .modal-header p { margin: 0; color: #819087; font-size: 11px; line-height: 1.6; }
  .modal-close { width: 34px; height: 34px; border: 0; border-radius: 8px; background: #f1f5f2; color: #355b43; font-size: 21px; cursor: pointer; }
  .coordinator-form { display: grid; gap: 17px; }
  .email-readonly { display: grid; gap: 5px; padding: 11px 12px; border-radius: 8px; background: #f5f8f5; }
  .email-readonly span, .email-readonly small { color: #819087; font-size: 10px; }
  .email-readonly strong { color: #193b28; font-size: 12px; }
  .group-fieldset { min-width: 0; margin: 0; padding: 14px; border: 1px solid #e2eae3; border-radius: 9px; }
  .group-fieldset legend { padding: 0 5px; color: #2c4937; font-size: 11px; font-weight: 700; }
  .group-fieldset > p { margin: 0 0 12px; color: #819087; font-size: 10px; }
  .group-options { display: grid; gap: 7px; max-height: 290px; overflow-y: auto; }
  .group-option { display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid #e7ede8; border-radius: 8px; cursor: pointer; }
  .group-option > input { width: 16px; min-height: 16px; height: 16px; flex: 0 0 16px; margin-top: 2px; accent-color: #0a5c37; }
  .group-option span { display: grid; gap: 4px; min-width: 0; }
  .group-option strong { color: #253c2e; font-size: 11px; }
  .group-option small { color: #819087; font-size: 9px; line-height: 1.5; }
  .group-option.unavailable { background: #f7f8f7; cursor: not-allowed; opacity: .65; }
  .group-option .taken-copy { color: #a54840; }
  .selection-count { margin-top: 10px; color: #0a8050; font-size: 10px; font-weight: 700; }
  .empty-groups { padding: 14px; border-radius: 8px; background: #fff8eb; color: #8a5a12; font-size: 11px; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 9px; padding-top: 6px; }
  @media (max-width: 1050px) { .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 760px) {
    .sidebar { position: fixed; inset: 0 auto 0 0; z-index: 40; width: min(290px, 84vw); overflow-y: auto; transform: translateX(-105%); transition: transform .2s ease; }
    .sidebar.open { transform: translateX(0); }
    .drawer-backdrop { position: fixed; inset: 0; z-index: 35; display: block; border: 0; background: #071b1080; }
    .drawer-close { display: grid; place-items: center; width: 32px; height: 32px; margin-left: auto; border: 0; border-radius: 7px; background: #ffffff17; color: #fff; font-size: 20px; }
    .topbar { min-height: 72px; padding: 12px 16px; }
    .menu-button { width: 36px; height: 36px; display: grid; align-content: center; justify-items: center; gap: 4px; border: 1px solid #dce5de; border-radius: 8px; background: #fff; }
    .menu-button span { width: 15px; height: 2px; background: #24543a; }
    .account-copy { display: none; }
    .page-content { padding: 22px 16px; }
    .intro { align-items: flex-start; flex-direction: column; }
    .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
    .summary-card { padding: 13px; }
    .filters { grid-template-columns: 1fr; }
    .coordinator-heading { align-items: flex-start; flex-wrap: wrap; }
    .person-details { width: calc(100% - 55px); flex: 1 1 calc(100% - 55px); }
    .card-actions { width: 100%; margin-left: 50px; }
    .assigned-groups { margin-left: 0; }
    .list-panel { padding: 14px; }
    .coordinator-modal { padding: 18px; }
    .page-footer { padding: 16px; }
  }
  @media (max-width: 420px) {
    .summary-grid { grid-template-columns: 1fr 1fr; }
    .summary-card strong { font-size: 21px; }
    .token-actions, .modal-actions { flex-wrap: wrap; }
  }
</style>
