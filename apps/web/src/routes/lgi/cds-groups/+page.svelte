<script lang="ts">
  import { onMount } from 'svelte';
  import LgiSidebar from '#lib/components/LgiSidebar.svelte';
  import { goto } from '$app/navigation';

  import {
    ApiError,
    getCurrentUser,
    getCdsGroupReferenceData,
    listCdsGroups,
    listCdsGroupDeclines,
    getCdsGroup,
    createCdsGroup,
    updateCdsGroup,
    getCdsGroupRoster,
    assignCdsGroupMember,
    endCdsGroupMemberMembership,
    listLgiCourses,
    getCourseDisciplineLabel,
    logout
  } from '#lib/api/client.ts';

  import type {
    AuthUser,
    CdsGroupSummary,
    CdsGroupDecline,
    CdsGroupReferenceData,
    CdsGroupDetail,
    CreateCdsGroupInput,
    CdsGroupRoster
  } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let referenceData = $state<CdsGroupReferenceData>({ lgas: [], courses: [] });
  let groups = $state<CdsGroupSummary[]>([]);
  let pendingDeclines = $state<CdsGroupDecline[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let signingOut = $state(false);
  let mobileNavOpen = $state(false);
  let formOpen = $state(false);
  let editingGroup = $state<CdsGroupDetail | null>(null);
  let errorMessage = $state('');
  let formError = $state('');
  let search = $state('');
  let selectedLga = $state('');
  let statusFilter = $state('all');
  let courseSearch = $state('');
  let courseCategory = $state('all');
  let rosterGroup = $state<CdsGroupSummary | null>(null);
  let roster = $state<CdsGroupRoster | null>(null);
  let rosterSearch = $state('');
  let rosterLoading = $state(false);
  let rosterSavingMemberId = $state('');
  let rosterError = $state('');
  let rosterNotice = $state('');

  let form = $state({
    lgaId: '',
    code: '',
    name: '',
    description: '',
    maxCapacity: 30,
    courseIds: [] as string[],
    isActive: true
  });

  const activeGroupCount = $derived(groups.filter((group) => group.isActive).length);
  const totalMembers = $derived(groups.reduce((total, group) => total + group.currentMemberCount, 0));
  const totalCapacity = $derived(groups.reduce((total, group) => total + group.maxCapacity, 0));
  const courseCategories = $derived([...new Set(referenceData.courses.map((course) => course.disciplineCategory))].sort());
  const visibleCourses = $derived(referenceData.courses.filter((course) => {
    const query = courseSearch.trim().toLocaleLowerCase();
    const matchesSearch = !query ||
      course.name.toLocaleLowerCase().includes(query) ||
      (course.aliases ?? []).some((alias) => alias.toLocaleLowerCase().includes(query));
    const matchesCategory = courseCategory === 'all' || course.disciplineCategory === courseCategory;
    return matchesSearch && matchesCategory;
  }));

  onMount(() => {
    void loadPage();
  });

  async function loadPage() {
    loading = true;
    errorMessage = '';

    try {
      const userResponse = await getCurrentUser();
      const isLGI = userResponse.roles.some((role) => role.code === 'LGI_ADMIN');

      if (!isLGI) {
        errorMessage = 'Your account does not have LGI administrator permissions.';
        return;
      }

      currentUser = userResponse.user;
      referenceData = await getCdsGroupReferenceData();
      const sharedCourses = await listLgiCourses();
      referenceData = {
        ...referenceData,
        courses: sharedCourses.map((course) => ({
          id: course.id,
          name: course.name,
          disciplineCategory: course.disciplineCategory,
          aliases: course.aliases.map((alias) => alias.name)
        }))
      };

      if (!selectedLga && referenceData.lgas.length > 0) {
        selectedLga = referenceData.lgas[0].id;
      }

      await loadGroups();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }

      errorMessage = error instanceof Error
        ? error.message
        : 'Unable to load CDS group management.';
    } finally {
      loading = false;
    }
  }

  async function loadGroups() {
    const [nextGroups, nextDeclines] = await Promise.all([
      listCdsGroups({
        lgaId: selectedLga || undefined,
        search: search.trim() || undefined,
        active: statusFilter === 'all'
          ? undefined
          : statusFilter === 'active'
      }),
      listCdsGroupDeclines({ lgaId: selectedLga || undefined })
    ]);
    groups = nextGroups;
    pendingDeclines = nextDeclines;
  }

  async function applyFilters(event: SubmitEvent) {
    event.preventDefault();
    errorMessage = '';

    try {
      await loadGroups();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to filter CDS groups.';
    }
  }

  function resetForm() {
    form = {
      lgaId: selectedLga || referenceData.lgas[0]?.id || '',
      code: '',
      name: '',
      description: '',
      maxCapacity: 30,
      courseIds: [],
      isActive: true
    };
    editingGroup = null;
    formError = '';
  }

  function openCreateForm() {
    resetForm();
    formOpen = true;
  }

  async function openEditForm(group: CdsGroupSummary) {
    formError = '';
    errorMessage = '';

    try {
      const detail = await getCdsGroup(group.id);
      editingGroup = detail;
      form = {
        lgaId: detail.lgaId,
        code: detail.code,
        name: detail.name,
        description: detail.description ?? '',
        maxCapacity: detail.maxCapacity,
        courseIds: detail.courses.map((course) => course.id),
        isActive: detail.isActive
      };
      formOpen = true;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to open this CDS group.';
    }
  }

  function toggleCourse(courseId: string, checked: boolean) {
    form.courseIds = checked
      ? [...form.courseIds, courseId]
      : form.courseIds.filter((id) => id !== courseId);
  }

  async function saveGroup(event: SubmitEvent) {
    event.preventDefault();
    formError = '';

    if (form.courseIds.length === 0) {
      formError = 'Select at least one eligible course.';
      return;
    }

    if (!form.lgaId) {
      formError = 'Select an LGA for this CDS group.';
      return;
    }

    saving = true;

    try {
      if (editingGroup) {
        await updateCdsGroup(editingGroup.id, {
          code: form.code,
          name: form.name,
          description: form.description.trim() || null,
          maxCapacity: Number(form.maxCapacity),
          courseIds: form.courseIds,
          isActive: form.isActive
        });
      } else {
        const input: CreateCdsGroupInput = {
          lgaId: form.lgaId,
          code: form.code,
          name: form.name,
          description: form.description.trim() || null,
          maxCapacity: Number(form.maxCapacity),
          courseIds: form.courseIds
        };

        await createCdsGroup(input);
        selectedLga = form.lgaId;
      }

      formOpen = false;
      await loadGroups();
    } catch (error) {
      formError = error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unable to save this CDS group.';
    } finally {
      saving = false;
    }
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

  function closeMobileNavigation() {
    mobileNavOpen = false;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (formOpen) {
        formOpen = false;
      }
      closeMobileNavigation();
    }
  }

  async function openRoster(group: CdsGroupSummary) {
    rosterGroup = group;
    roster = null;
    rosterSearch = '';
    rosterError = '';
    rosterNotice = '';
    await loadRoster();
  }

  async function loadRoster() {
    if (!rosterGroup) return;
    rosterLoading = true;
    rosterError = '';
    try {
      roster = await getCdsGroupRoster(rosterGroup.id, rosterSearch);
      groups = groups.map((group) => group.id === rosterGroup?.id
        ? { ...group, currentMemberCount: roster!.group.currentMemberCount, availableCapacity: roster!.group.availableCapacity }
        : group);
    } catch (error) {
      rosterError = error instanceof ApiError || error instanceof Error
        ? error.message
        : 'Unable to load the group roster.';
    } finally {
      rosterLoading = false;
    }
  }

  async function assignMember(memberId: string) {
    if (!rosterGroup) return;
    rosterSavingMemberId = memberId;
    rosterError = '';
    rosterNotice = '';
    try {
      await assignCdsGroupMember(rosterGroup.id, memberId);
      rosterNotice = 'Corps Member assigned successfully.';
      await loadRoster();
      await loadGroups();
    } catch (error) {
      rosterError = error instanceof ApiError || error instanceof Error
        ? error.message
        : 'Unable to assign this Corps Member.';
    } finally {
      rosterSavingMemberId = '';
    }
  }

  async function removeMember(memberId: string) {
    if (!rosterGroup) return;
    const confirmed = window.confirm('End this Corps Member’s active membership in the selected CDS group?');
    if (!confirmed) return;
    rosterSavingMemberId = memberId;
    rosterError = '';
    rosterNotice = '';
    try {
      await endCdsGroupMemberMembership(rosterGroup.id, memberId);
      rosterNotice = 'Membership ended. The member can now be assigned to another eligible CDS group.';
      await loadRoster();
      await loadGroups();
    } catch (error) {
      rosterError = error instanceof ApiError || error instanceof Error
        ? error.message
        : 'Unable to end this membership.';
    } finally {
      rosterSavingMemberId = '';
    }
  }

  function closeRoster() {
    if (rosterSavingMemberId) return;
    rosterGroup = null;
    roster = null;
    rosterError = '';
    rosterNotice = '';
  }

  function capacityPercent(group: CdsGroupSummary) {
    return Math.min(100, Math.round((group.currentMemberCount / group.maxCapacity) * 100));
  }

  function declineCountForGroup(groupId: string): number {
    return pendingDeclines.filter((item) => item.groupId === groupId).length;
  }

  function declineReasonLabel(reason: CdsGroupDecline['reason']): string {
    const labels: Record<NonNullable<CdsGroupDecline['reason']>, string> = {
      schedule_conflict: 'Schedule conflict',
      accessibility: 'Accessibility needs',
      location: 'Location',
      personal: 'Personal reasons',
      other: 'Other'
    };
    return reason ? labels[reason] : 'Not specified';
  }
</script>

<svelte:head>
  <title>CDS Groups | NYSC CDS Platform</title>
  <meta name="description" content="Manage CDS groups, course eligibility and group capacity." />
</svelte:head>

<svelte:window onkeydown={handleWindowKeydown} />

{#if loading}
  <main class="state-screen">
    <div class="loader"></div>
    <p>Loading CDS group management...</p>
  </main>
{:else if errorMessage && !currentUser}
  <main class="state-screen">
    <h2>Unable to open CDS Group Management</h2>
    <p>{errorMessage}</p>
    <button class="primary-button" onclick={() => goto('/login')}>Return to login</button>
  </main>
{:else}
  <div class="admin-shell">
    <LgiSidebar activePath="/lgi/cds-groups" open={mobileNavOpen} signingOut={signingOut} onClose={closeMobileNavigation} onSignOut={handleLogout} />

    <section class="main-area">
      <header class="topbar">
        <div class="topbar-heading">
          <button class="menu-button" type="button" aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileNavOpen} aria-controls="lgi-sidebar" onclick={() => (mobileNavOpen = !mobileNavOpen)}>
            <span></span><span></span><span></span>
          </button>
          <div>
            <span class="breadcrumb">Administration / CDS Groups</span>
            <h1>CDS Groups</h1>
          </div>
        </div>
        <div class="account">
          <div class="avatar">LG</div>
          <div class="account-copy"><strong>LGI Administrator</strong><span>{currentUser?.email}</span></div>
        </div>
      </header>

      <main class="page-content">
        {#if errorMessage}
          <div class="inline-error" role="alert">{errorMessage}</div>
        {/if}

        <section class="page-intro">
          <div>
            <span class="eyebrow">GROUP ADMINISTRATION</span>
            <h2>Manage CDS groups</h2>
            <p>Create groups, define eligible courses and control membership capacity.</p>
          </div>
          <button class="primary-button create-button" type="button" onclick={openCreateForm} disabled={referenceData.lgas.length === 0 || referenceData.courses.length === 0}>
            <span aria-hidden="true">＋</span> Create CDS group
          </button>
        </section>

        <section class="stats-grid" aria-label="CDS group summary">
          <article class="stat-card"><span>Total groups</span><strong>{groups.length}</strong><small>In the selected LGA</small></article>
          <article class="stat-card"><span>Active groups</span><strong>{activeGroupCount}</strong><small>Currently accepting members</small></article>
          <article class="stat-card"><span>Allocated members</span><strong>{totalMembers}</strong><small>Across listed groups</small></article>
          <article class="stat-card"><span>Total capacity</span><strong>{totalCapacity}</strong><small>Combined group capacity</small></article>
          <article class:stat-card-alert={pendingDeclines.length > 0} class="stat-card">
            <span>Declined placements</span>
            <strong>{pendingDeclines.length}</strong>
            <small>{pendingDeclines.length > 0 ? 'Awaiting a new CDS group' : 'No placement follow-up needed'}</small>
          </article>
        </section>

        <section class="declines-panel" aria-labelledby="declines-title" aria-live="polite">
          <header class="declines-header">
            <div class="declines-icon" aria-hidden="true">!</div>
            <div class="declines-heading">
              <span class="eyebrow">ACTION REQUIRED</span>
              <h2 id="declines-title">Declined CDS placements</h2>
              <p>Corps Members who declined their assignment and do not yet have another active CDS group.</p>
            </div>
            <span class:declines-count-active={pendingDeclines.length > 0} class="declines-count">{pendingDeclines.length} pending</span>
          </header>
          {#if pendingDeclines.length === 0}
            <div class="declines-empty">No declined placements are currently awaiting a new group.</div>
          {:else}
            <div class="declines-list">
              {#each pendingDeclines as decline (decline.membershipId)}
                <article class="decline-row">
                  <div class="decline-member">
                    <strong>{decline.lastName}, {decline.firstName} {decline.middleName ?? ''}</strong>
                    <span>{decline.stateCode}{decline.courseName ? ` · ${decline.courseName}` : ''}</span>
                  </div>
                  <div class="decline-details">
                    <span class="declined-group-label">Declined {decline.groupName} ({decline.groupCode})</span>
                    <span><strong>Reason:</strong> {declineReasonLabel(decline.reason)}</span>
                    {#if decline.notes}
                      <p>{decline.notes}</p>
                    {/if}
                  </div>
                  <time datetime={decline.declinedAt ?? undefined}>{decline.declinedAt ? new Date(decline.declinedAt).toLocaleString() : 'Date unavailable'}</time>
                </article>
              {/each}
            </div>
          {/if}
        </section>

        <section class="groups-panel">
          <form class="filters" onsubmit={applyFilters}>
            <label class="search-field">
              <span>Search groups</span>
              <input bind:value={search} placeholder="Search by group name" />
            </label>
            <label>
              <span>Local Government Area</span>
              <select bind:value={selectedLga} onchange={() => void loadGroups()}>
                {#each referenceData.lgas as lga}
                  <option value={lga.id}>{lga.name}, {lga.stateName}</option>
                {/each}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select bind:value={statusFilter}>
                <option value="all">All groups</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <button class="filter-button" type="submit">Apply filters</button>
          </form>

          {#if referenceData.lgas.length === 0}
            <div class="empty-state">
              <div class="empty-icon">⌖</div>
              <h3>No LGA assignment found</h3>
              <p>Your LGI account needs an active LGA role assignment before it can manage CDS groups.</p>
            </div>
          {:else if referenceData.courses.length === 0}
            <div class="empty-state">
              <div class="empty-icon">⌘</div>
              <h3>No active courses available</h3>
              <p>Add active course records before creating a CDS group and mapping its eligibility.</p>
            </div>
          {:else if groups.length === 0}
            <div class="empty-state">
              <div class="empty-icon">◎</div>
              <h3>No CDS groups found</h3>
              <p>Create the first CDS group for this LGA and map its eligible courses.</p>
              <button class="primary-button" type="button" onclick={openCreateForm}>Create first group</button>
            </div>
          {:else}
            <div class="group-grid">
              {#each groups as group (group.id)}
                <article class="group-card">
                  <div class="group-card-top">
                    <span class="group-code">{group.code}</span>
                    <span class:inactive={!group.isActive} class="status-badge">{group.isActive ? 'Active' : 'Inactive'}</span>
                  </div>
                  {#if declineCountForGroup(group.id) > 0}
                    <div class="group-decline-flag">{declineCountForGroup(group.id)} declined placement{declineCountForGroup(group.id) === 1 ? '' : 's'} awaiting reassignment</div>
                  {/if}
                  <h3>{group.name}</h3>
                  <p class="group-location">{group.lgaName}, {group.stateName}</p>
                  {#if group.description}
                    <p class="group-description">{group.description}</p>
                  {:else}
                    <p class="group-description muted-copy">No description provided.</p>
                  {/if}

                  <div class="capacity-heading"><span>Group capacity</span><strong>{group.currentMemberCount} / {group.maxCapacity}</strong></div>
                  <div class="capacity-track"><span style={`width: ${capacityPercent(group)}%`}></span></div>
                  <div class="capacity-foot"><span>{group.availableCapacity} spaces available</span><span>{capacityPercent(group)}% utilised</span></div>

                  <div class="card-actions">
                    <button type="button" class="secondary-button" onclick={() => void openEditForm(group)}>View / Edit</button>
                    <button type="button" class="primary-button" onclick={() => void openRoster(group)}>Manage members</button>
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </section>
      </main>

      <footer class="page-footer">NYSC CDS Management Platform · Version 0.1.0</footer>
    </section>
  </div>
{/if}

{#if formOpen}
  <div class="modal-layer">
    <button class="modal-scrim" type="button" aria-label="Close group form" onclick={() => (formOpen = false)}></button>
    <section class="group-modal" role="dialog" aria-modal="true" aria-labelledby="group-form-title">
      <div class="modal-header">
        <div>
          <span class="eyebrow">CDS GROUP DETAILS</span>
          <h2 id="group-form-title">{editingGroup ? 'Update CDS group' : 'Create CDS group'}</h2>
          <p>{editingGroup ? 'Update group details, eligibility and capacity.' : 'Set up a group and define which courses are eligible.'}</p>
        </div>
        <button class="modal-close" type="button" aria-label="Close form" onclick={() => (formOpen = false)}>×</button>
      </div>

      {#if formError}<div class="inline-error" role="alert">{formError}</div>{/if}

      <form class="group-form" onsubmit={saveGroup}>
        {#if !editingGroup}
          <label>
            <span>Local Government Area *</span>
            <select bind:value={form.lgaId} required>
              {#each referenceData.lgas as lga}
                <option value={lga.id}>{lga.name}, {lga.stateName}</option>
              {/each}
            </select>
          </label>
        {/if}

        <div class="form-row">
          <label>
            <span>Group code *</span>
            <input bind:value={form.code} placeholder="e.g. ICT-01" minlength="2" maxlength="30" required />
          </label>
          <label>
            <span>Maximum capacity *</span>
            <input type="number" bind:value={form.maxCapacity} min="1" max="10000" required />
          </label>
        </div>

        <label>
          <span>Group name *</span>
          <input bind:value={form.name} placeholder="e.g. ICT Community Development Group" minlength="3" maxlength="160" required />
        </label>

        <label>
          <span>Description</span>
          <textarea bind:value={form.description} rows="3" maxlength="2000" placeholder="Describe the group's focus and activities (optional)."></textarea>
        </label>

        <fieldset class="course-fieldset">
          <legend>Eligible courses *</legend>
          <p>Select academic courses from the shared catalogue. Search also recognises course aliases.</p>

          <div class="course-picker-tools">
            <input
              class="course-search"
              type="search"
              bind:value={courseSearch}
              placeholder="Search course or alternate name..."
              aria-label="Search eligible courses"
            />
            <select bind:value={courseCategory} aria-label="Filter eligible courses by discipline">
              <option value="all">All disciplines</option>
              {#each courseCategories as category}
                <option value={category}>{getCourseDisciplineLabel(category)}</option>
              {/each}
            </select>
          </div>

          <div class="course-selection-actions">
            <span>{form.courseIds.length} selected</span>
            <div>
              <button type="button" onclick={() => (form.courseIds = [...new Set([...form.courseIds, ...visibleCourses.map((course) => course.id)])])} disabled={visibleCourses.length === 0}>Select visible</button>
              <button type="button" onclick={() => (form.courseIds = form.courseIds.filter((id) => !visibleCourses.some((course) => course.id === id)))} disabled={!visibleCourses.some((course) => form.courseIds.includes(course.id))}>Clear visible</button>
            </div>
          </div>

          {#if visibleCourses.length === 0}
            <div class="course-empty">No matching courses. Try another search or discipline.</div>
          {:else}
            <div class="course-options">
              {#each visibleCourses as course (course.id)}
                <label class="course-option">
                  <input
                    type="checkbox"
                    checked={form.courseIds.includes(course.id)}
                    onchange={(event) => toggleCourse(course.id, event.currentTarget.checked)}
                  />
                  <span>
                    <strong>{course.name}</strong>
                    <small>{getCourseDisciplineLabel(course.disciplineCategory)}</small>
                    {#if course.aliases && course.aliases.length > 0}
                      <small class="course-aliases">Also: {course.aliases.join(', ')}</small>
                    {/if}
                  </span>
                </label>
              {/each}
            </div>
          {/if}
        </fieldset>

        {#if editingGroup}
          <label class="active-toggle">
            <input type="checkbox" bind:checked={form.isActive} />
            <span><strong>Group is active</strong><small>Inactive groups cannot receive new allocations.</small></span>
          </label>
        {/if}

        <div class="modal-actions">
          <button class="secondary-button" type="button" onclick={() => (formOpen = false)} disabled={saving}>Cancel</button>
          <button class="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : editingGroup ? 'Save changes' : 'Create group'}</button>
        </div>
      </form>
    </section>
  </div>
{/if}

{#if rosterGroup}
  <div class="modal-layer roster-layer">
    <button class="modal-scrim" type="button" aria-label="Close member roster" onclick={closeRoster}></button>
    <section class="group-modal roster-modal" role="dialog" aria-modal="true" aria-labelledby="roster-title">
      <div class="modal-header">
        <div>
          <span class="eyebrow">CDS GROUP ROSTER</span>
          <h2 id="roster-title">{rosterGroup.name}</h2>
          <p>{rosterGroup.code} · {rosterGroup.lgaName}, {rosterGroup.stateName}</p>
        </div>
        <button class="modal-close" type="button" aria-label="Close roster" onclick={closeRoster} disabled={Boolean(rosterSavingMemberId)}>×</button>
      </div>

      {#if rosterError}<div class="inline-error" role="alert">{rosterError}</div>{/if}
      {#if rosterNotice}<div class="roster-success" role="status">{rosterNotice}</div>{/if}

      {#if roster}
        <div class="roster-summary">
          <div><span>Active members</span><strong>{roster.group.currentMemberCount} / {roster.group.maxCapacity}</strong></div>
          <div><span>Available spaces</span><strong>{roster.group.availableCapacity}</strong></div>
          <div><span>Eligible to add</span><strong>{roster.eligibleMembers.length}</strong></div>
        </div>

        <section class="roster-section">
          <div class="roster-section-heading">
            <div><h3>Current members</h3><p>Active Corps Members assigned to this group.</p></div>
          </div>
          {#if roster.members.length === 0}
            <div class="roster-empty">No Corps Members have been assigned to this group yet.</div>
          {:else}
            <div class="roster-list">
              {#each roster.members as member (member.membershipId)}
                <article class="roster-row">
                  <div class="roster-person">
                    <strong>{member.lastName}, {member.firstName} {member.middleName ?? ''}</strong>
                    <span>{member.stateCode} · {member.courseName ?? 'Course not recorded'}</span>
                    <small>Added {new Date(member.assignedAt).toLocaleDateString()}</small>
                  </div>
                  <div class="roster-actions">
                    <span class="roster-status">{member.profileStatus}</span>
                    <button class="text-danger" type="button" onclick={() => void removeMember(member.memberId)} disabled={Boolean(rosterSavingMemberId)}>
                      {rosterSavingMemberId === member.memberId ? 'Updating…' : 'End membership'}
                    </button>
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </section>

        <section class="roster-section">
          <div class="roster-section-heading">
            <div><h3>Manual placement &amp; reassignment</h3><p>Use this exception tool when automatic matching found no group or a member declined an assignment. Only unassigned members in this LGA whose course matches this group are listed.</p></div>
          </div>
          <form class="roster-search" onsubmit={(event) => { event.preventDefault(); void loadRoster(); }}>
            <input bind:value={rosterSearch} placeholder="Search by name or state code…" aria-label="Search eligible Corps Members" />
            <button class="secondary-button" type="submit" disabled={rosterLoading}>Search</button>
          </form>
          {#if !roster.group.isActive}
            <div class="roster-empty">This group is inactive. Reactivate it before adding members.</div>
          {:else if roster.group.availableCapacity <= 0}
            <div class="roster-empty">This group has reached its maximum capacity.</div>
          {:else if roster.eligibleMembers.length === 0}
            <div class="roster-empty">No eligible unassigned Corps Members found. Check their LGA, academic course and profile status.</div>
          {:else}
            <div class="roster-list eligible-list">
              {#each roster.eligibleMembers as member (member.id)}
                <article class="roster-row">
                  <div class="roster-person">
                    <strong>{member.lastName}, {member.firstName} {member.middleName ?? ''}</strong>
                    <span>{member.stateCode} · {member.courseName ?? 'Course not recorded'}</span>
                    <small>Profile: {member.profileStatus}</small>
                    {#if member.previousDecline}
                      <small class="previous-decline">Previously declined {member.previousDecline.groupName}{member.previousDecline.reason ? ` · ${member.previousDecline.reason.replaceAll('_', ' ')}` : ''}</small>
                      {#if member.previousDecline.notes}<small class="previous-decline-note">Member's note: {member.previousDecline.notes}</small>{/if}
                    {/if}
                  </div>
                  <button class="primary-button add-member-button" type="button" onclick={() => void assignMember(member.id)} disabled={Boolean(rosterSavingMemberId)}>
                    {rosterSavingMemberId === member.id ? 'Adding…' : 'Add to group'}
                  </button>
                </article>
              {/each}
            </div>
          {/if}
        </section>
      {:else if rosterLoading}
        <div class="roster-empty">Loading group roster…</div>
      {/if}

      <div class="modal-actions">
        <button class="secondary-button" type="button" onclick={closeRoster} disabled={Boolean(rosterSavingMemberId)}>Close</button>
      </div>
    </section>
  </div>
{/if}

<style>
  .roster-modal { width: min(100%, 900px); }
  .roster-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
  .roster-summary > div { display: grid; gap: 6px; padding: 13px 15px; border: 1px solid #e7eee8; border-radius: 9px; background: #f8fbf8; }
  .roster-summary span { color: #718078; font-size: 10px; }
  .roster-summary strong { color: #0a5c37; font-size: 19px; }
  .roster-section { margin-top: 21px; }
  .roster-section-heading h3 { margin: 0 0 4px; color: #1d3426; font-size: 14px; }
  .roster-section-heading p { margin: 0 0 12px; color: #819087; font-size: 10px; line-height: 1.5; }
  .roster-list { display: grid; border: 1px solid #e8eee9; border-radius: 9px; overflow: hidden; }
  .roster-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #edf1ed; }
  .roster-row:last-child { border-bottom: 0; }
  .roster-person { display: grid; gap: 4px; min-width: 0; }
  .roster-person strong { color: #263d30; font-size: 11px; }
  .roster-person span, .roster-person small { color: #718078; font-size: 9px; overflow-wrap: anywhere; }
  .roster-actions { display: flex; align-items: center; gap: 12px; }
  .roster-status { padding: 5px 8px; border-radius: 14px; background: #edf6ef; color: #16633b; font-size: 8px; font-weight: 700; text-transform: capitalize; white-space: nowrap; }
  .text-danger { border: 0; background: transparent; color: #a33b32; font-size: 9px; font-weight: 700; cursor: pointer; white-space: nowrap; }
  .text-danger:disabled { opacity: .5; cursor: wait; }
  .roster-search { display: flex; gap: 8px; margin-bottom: 10px; }
  .roster-search input { flex: 1; min-width: 0; min-height: 40px; padding: 9px 12px; border: 1px solid #dce5de; border-radius: 8px; font-size: 11px; }
  .roster-search button { min-width: 90px; }
  .add-member-button { min-height: 35px; padding: 8px 11px; font-size: 9px; white-space: nowrap; }
  .roster-empty { padding: 18px 14px; border: 1px dashed #dce7de; border-radius: 8px; background: #fafcfa; color: #718078; font-size: 10px; line-height: 1.6; text-align: center; }
  .previous-decline { color: #a15a28 !important; font-weight: 700; text-transform: capitalize; }
  .previous-decline-note { color: #7b6555 !important; font-style: italic; white-space: normal; }
  .roster-success { padding: 10px 12px; margin-top: 14px; border: 1px solid #cce6d3; border-radius: 8px; background: #eef8f0; color: #16633b; font-size: 10px; }
  @media (max-width: 600px) {
    .roster-summary { grid-template-columns: 1fr; }
    .roster-row { align-items: flex-start; flex-direction: column; }
    .roster-actions { width: 100%; justify-content: space-between; }
    .add-member-button { width: 100%; }
    .roster-search { flex-direction: column; }
    .roster-search button { width: 100%; }
  }

  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; overflow-x: hidden; background: #f5f7f5; color: #19251e; font-family: Inter, Arial, sans-serif; }
  :global(button), :global(input), :global(select), :global(textarea) { font: inherit; }

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
  .nav-icon { width: 20px; text-align: center; font-size: 16px; }
  .sidebar-footer { margin-top: 24px; padding: 17px 9px 5px; border-top: 1px solid #ffffff1f; color: #a6c6b3; font-size: 10px; }
  .environment-status { display: flex; align-items: center; }
  .status-indicator { width: 7px; height: 7px; margin-right: 7px; border-radius: 50%; background: #55d58a; }
  .sidebar-logout { width: 100%; min-height: 42px; margin-top: 15px; padding: 10px 12px; border: 1px solid #ffffff3d; border-radius: 8px; background: #ffffff14; color: #fff; text-align: left; font-size: 12px; font-weight: 600; cursor: pointer; }
  .sidebar-logout:hover { background: #ffffff24; }
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
  .account-copy span { max-width: 260px; overflow: hidden; margin-top: 4px; color: #819087; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .page-content { width: 100%; max-width: 1360px; margin: 0 auto; padding: 32px 34px; }
  .page-intro { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 25px; }
  .eyebrow { color: #0a8050; font-size: 9px; font-weight: 700; letter-spacing: 1.5px; }
  .page-intro h2 { margin: 9px 0 7px; font-size: 25px; }
  .page-intro p { margin: 0; color: #718078; font-size: 12px; line-height: 1.6; }
  .primary-button, .secondary-button, .filter-button { min-height: 42px; padding: 10px 15px; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; }
  .primary-button { border: 1px solid #0a5c37; background: #0a5c37; color: #fff; }
  .primary-button:hover:not(:disabled) { background: #064526; }
  .primary-button:disabled { opacity: .55; cursor: not-allowed; }
  .create-button { min-height: 46px; white-space: nowrap; }
  .create-button span { margin-right: 5px; font-size: 15px; }
  .secondary-button { border: 1px solid #dce5de; background: #fff; color: #44554a; }
  .secondary-button:hover { border-color: #0a5c37; color: #0a5c37; }
  .stats-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; margin-bottom: 22px; }
  .stat-card { min-width: 0; padding: 18px 20px; border: 1px solid #e8ece8; border-radius: 10px; background: #fff; }
  .stat-card-alert { border-color: #efc7a1; background: #fffaf4; }
  .stat-card-alert strong { color: #a85a16; }
  .stat-card > span { display: block; color: #718078; font-size: 10px; }
  .stat-card strong { display: block; margin: 9px 0 5px; color: #183d29; font-size: 25px; }
  .stat-card small { color: #89948c; font-size: 9px; }
  .groups-panel { padding: 20px; border: 1px solid #e8ece8; border-radius: 12px; background: #fff; }
  .declines-panel { margin-bottom: 20px; overflow: hidden; border: 1px solid #efcfad; border-radius: 12px; background: #fff; }
  .declines-header { display: flex; align-items: center; gap: 12px; padding: 17px 20px; background: #fff8ef; border-bottom: 1px solid #f5e7d8; }
  .declines-icon { width: 36px; height: 36px; flex: 0 0 36px; display: grid; place-items: center; border-radius: 10px; background: #ffead5; color: #a85a16; font-size: 19px; font-weight: 900; }
  .declines-heading { min-width: 0; flex: 1; }
  .declines-heading .eyebrow { color: #a85a16; }
  .declines-heading h2 { margin: 4px 0; color: #573c26; font-size: 15px; }
  .declines-heading p { margin: 0; color: #8c735d; font-size: 10px; line-height: 1.5; }
  .declines-count { flex: 0 0 auto; padding: 7px 10px; border-radius: 20px; background: #f4f1ed; color: #74685d; font-size: 9px; font-weight: 800; }
  .declines-count-active { background: #ffe8d1; color: #9b4f0c; }
  .declines-empty { padding: 18px 20px; color: #768278; font-size: 10px; }
  .declines-list { display: grid; }
  .decline-row { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(220px, 1.2fr) minmax(130px, auto); align-items: center; gap: 18px; padding: 15px 20px; border-bottom: 1px solid #f0eee9; }
  .decline-row:last-child { border-bottom: 0; }
  .decline-member { display: grid; gap: 5px; min-width: 0; }
  .decline-member strong { color: #263d30; font-size: 11px; }
  .decline-member span { color: #77857b; font-size: 9px; overflow-wrap: anywhere; }
  .decline-details { display: grid; gap: 5px; min-width: 0; color: #64746a; font-size: 9px; }
  .declined-group-label { color: #92551d; font-weight: 800; }
  .decline-details strong { color: #526357; }
  .decline-details p { margin: 0; color: #89948c; line-height: 1.5; overflow-wrap: anywhere; }
  .decline-row time { color: #89948c; font-size: 9px; text-align: right; }
  .group-decline-flag { display: inline-flex; width: fit-content; max-width: 100%; margin-top: 10px; padding: 6px 9px; border: 1px solid #f0d2b1; border-radius: 7px; background: #fff8ef; color: #9b5718; font-size: 9px; font-weight: 800; line-height: 1.35; }
  .filters { display: grid; grid-template-columns: minmax(180px, 1.5fr) minmax(180px, 1fr) minmax(130px, .7fr) auto; align-items: end; gap: 12px; margin-bottom: 20px; }
  .filters label, .group-form > label, .form-row label { display: grid; gap: 7px; color: #4a5c50; font-size: 10px; font-weight: 700; }
  .filters input, .filters select, .group-form input:not([type="checkbox"]), .group-form select, .group-form textarea { width: 100%; min-width: 0; min-height: 42px; padding: 10px 12px; border: 1px solid #dce5de; border-radius: 8px; outline: 0; background: #fff; color: #223328; font-size: 11px; }
  .filters input:focus, .filters select:focus, .group-form input:focus, .group-form select:focus, .group-form textarea:focus { border-color: #0a8050; box-shadow: 0 0 0 3px #0a805014; }
  .filter-button { border: 1px solid #dce5de; background: #f8faf8; color: #405448; }
  .filter-button:hover { border-color: #0a5c37; color: #0a5c37; }
  .group-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px; }
  .group-card { min-width: 0; padding: 20px; border: 1px solid #e8ece8; border-radius: 10px; background: #fff; }
  .group-card-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .group-code { padding: 6px 9px; border-radius: 6px; background: #edf5ef; color: #0a5c37; font-size: 9px; font-weight: 800; letter-spacing: .5px; }
  .status-badge { padding: 5px 8px; border-radius: 20px; background: #e8f5ec; color: #087443; font-size: 9px; font-weight: 700; }
  .status-badge.inactive { background: #f1f3f2; color: #758078; }
  .group-card h3 { margin: 15px 0 5px; color: #1d3426; font-size: 15px; line-height: 1.4; }
  .group-location { margin: 0; color: #0a8050; font-size: 10px; font-weight: 600; }
  .group-description { min-height: 32px; margin: 12px 0 18px; color: #718078; font-size: 10px; line-height: 1.6; }
  .muted-copy { color: #9aa39d; }
  .capacity-heading, .capacity-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .capacity-heading { color: #718078; font-size: 9px; }
  .capacity-heading strong { color: #32483a; font-size: 10px; }
  .capacity-track { height: 7px; overflow: hidden; margin: 9px 0 7px; border-radius: 10px; background: #edf1ee; }
  .capacity-track span { display: block; height: 100%; border-radius: inherit; background: #0a8050; }
  .capacity-foot { color: #89948c; font-size: 9px; }
  .card-actions { display: flex; justify-content: flex-end; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 18px; padding-top: 14px; border-top: 1px solid #edf0ed; }
  .card-actions button { min-width: 120px; border-radius: 8px; }
  .card-actions .secondary-button { border-color: #cfded2; }
  .card-actions .primary-button { margin-left: 0; }
  .empty-state { display: grid; justify-items: center; padding: 55px 20px; text-align: center; }
  .empty-icon { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 12px; background: #eaf3ed; color: #0a5c37; font-size: 23px; }
  .empty-state h3 { margin: 15px 0 6px; font-size: 15px; }
  .empty-state p { max-width: 410px; margin: 0 0 17px; color: #78847c; font-size: 11px; line-height: 1.7; }
  .inline-error { padding: 12px 14px; margin-bottom: 16px; border: 1px solid #f2cccc; border-radius: 8px; background: #fff0f0; color: #b42318; font-size: 11px; line-height: 1.5; }
  .page-footer { margin-top: auto; padding: 17px 34px; border-top: 1px solid #e8ece8; color: #89948c; font-size: 10px; }
  .state-screen { min-height: 100vh; display: grid; align-content: center; justify-items: center; gap: 10px; padding: 24px; text-align: center; }
  .state-screen p { color: #718078; font-size: 12px; }
  .loader { width: 28px; height: 28px; border: 3px solid #dbe8de; border-top-color: #0a5c37; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .modal-layer { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; overflow-y: auto; padding: 22px; }
  .modal-scrim { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; background: #10251980; cursor: pointer; }
  .group-modal { position: relative; z-index: 1; width: min(100%, 650px); max-height: min(92vh, 900px); overflow-y: auto; padding: 25px; border-radius: 14px; background: #fff; box-shadow: 0 22px 70px #071e1250; }
  .modal-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; margin-bottom: 20px; }
  .modal-header h2 { margin: 8px 0 5px; color: #1d3426; font-size: 20px; }
  .modal-header p { margin: 0; color: #718078; font-size: 11px; line-height: 1.6; }
  .modal-close { width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; border: 1px solid #e0e8e1; border-radius: 8px; background: #fff; color: #44554a; font-size: 23px; cursor: pointer; }
  .group-form { display: grid; gap: 15px; }
  .group-form textarea { min-height: 82px; resize: vertical; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }
  .course-fieldset { min-width: 0; margin: 0; padding: 14px; border: 1px solid #e1e9e2; border-radius: 9px; }
  .course-fieldset legend { padding: 0 5px; color: #405448; font-size: 10px; font-weight: 700; }
  .course-fieldset > p { margin: 0 0 10px; color: #819087; font-size: 10px; }
  .course-picker-tools { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(180px, 1fr); gap: 8px; margin-bottom: 10px; }
  .course-search, .course-picker-tools select { width: 100%; min-width: 0; min-height: 40px; padding: 9px 11px; border: 1px solid #dce5de; border-radius: 8px; background: #fff; font-size: 10px; }
  .course-selection-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; color: #0a5c37; font-size: 9px; font-weight: 700; }
  .course-selection-actions > div { display: flex; gap: 10px; }
  .course-selection-actions button { padding: 3px 0; border: 0; background: transparent; color: #0a6841; font-size: 9px; font-weight: 700; cursor: pointer; }
  .course-selection-actions button:disabled { opacity: .45; cursor: not-allowed; }
  .course-empty { padding: 18px 10px; border: 1px dashed #dce5de; border-radius: 8px; color: #819087; font-size: 10px; text-align: center; }
  .course-aliases { color: #89948c !important; font-weight: 400; line-height: 1.4; }
  .course-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; max-height: 280px; overflow-y: auto; padding: 2px; }
  .course-option { min-width: 0; display: flex !important; align-items: center; gap: 9px !important; padding: 10px; border: 1px solid #edf0ed; border-radius: 8px; cursor: pointer; }
  .course-option input { width: 15px; height: 15px; flex: 0 0 15px; accent-color: #0a5c37; }
  .course-option span, .course-option strong, .course-option small { display: block; min-width: 0; }
  .course-option strong { color: #304437; font-size: 10px; }
  .course-option small { margin-top: 3px; color: #89948c; font-size: 8px; }
  .active-toggle { display: flex !important; align-items: center; gap: 10px !important; padding: 12px; border: 1px solid #e8ece8; border-radius: 8px; }
  .active-toggle input { width: 16px; height: 16px; accent-color: #0a5c37; }
  .active-toggle span, .active-toggle strong, .active-toggle small { display: block; }
  .active-toggle strong { color: #304437; font-size: 10px; }
  .active-toggle small { margin-top: 4px; color: #819087; font-size: 9px; font-weight: 400; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 9px; padding-top: 8px; border-top: 1px solid #edf0ed; }
  .modal-actions button { min-width: 110px; }

  @media (max-width: 1150px) {
    .stats-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  @media (max-width: 1050px) {
    .sidebar { width: 220px; flex-basis: 220px; padding-inline: 14px; }
    .topbar { padding-inline: 22px; }
    .page-content { padding: 26px 22px; }
    .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .decline-row { grid-template-columns: 1fr 1fr; }
    .decline-row time { grid-column: 1 / -1; text-align: left; }
  }

  @media (max-width: 760px) {
    .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .declines-header { align-items: flex-start; flex-wrap: wrap; padding: 15px; }
    .declines-count { margin-left: 48px; }
    .decline-row { grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 14px 15px; }
    .decline-row time { grid-column: auto; }
    .card-actions { justify-content: stretch; }
    .card-actions button { flex: 1 1 145px; }
    .sidebar { position: fixed; inset: 0 auto 0 0; z-index: 40; width: min(290px, 86vw); height: 100vh; height: 100dvh; overflow-y: auto; padding: 22px 16px; transform: translateX(-105%); visibility: hidden; pointer-events: none; box-shadow: 12px 0 32px #0822142e; transition: transform 180ms ease, visibility 180ms ease; }
    .sidebar.open { transform: translateX(0); visibility: visible; pointer-events: auto; }
    .drawer-backdrop { position: fixed; inset: 0; z-index: 30; width: 100%; height: 100%; border: 0; background: #0a19107a; }
    .brand { width: 100%; padding: 0 9px 26px; }
    .drawer-close { width: 36px; height: 36px; flex: 0 0 36px; display: grid; place-items: center; margin-left: auto; padding: 0 0 3px; border: 1px solid #ffffff47; border-radius: 9px; background: #ffffff14; color: #fff; font-size: 28px; cursor: pointer; }
    .nav-label { display: block; }
    nav { display: grid; gap: 6px; }
    .nav-item { width: 100%; min-height: 46px; }
    .sidebar-footer { display: block; margin-top: 24px; }
    .topbar { min-height: 76px; padding: 13px 16px; gap: 10px; }
    .menu-button { width: 42px; height: 42px; flex: 0 0 42px; display: grid; place-content: center; gap: 5px; padding: 0; border: 1px solid #e1e9e2; border-radius: 9px; background: #fff; cursor: pointer; }
    .menu-button span { width: 18px; height: 2px; border-radius: 2px; background: #0a5c37; }
    .topbar h1 { font-size: 18px; }
    .breadcrumb { font-size: 9px; }
    .account-copy { display: none; }
    .page-content { padding: 22px 16px 28px; }
    .page-intro { align-items: flex-start; flex-direction: column; }
    .create-button { width: 100%; }
    .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .stat-card { padding: 15px; }
    .stat-card strong { font-size: 22px; }
    .filters { grid-template-columns: 1fr; }
    .filter-button { width: 100%; }
    .group-grid { grid-template-columns: 1fr; }
    .groups-panel { padding: 14px; }
    .page-footer { padding: 15px 16px; line-height: 1.5; }
  }

  @media (max-width: 480px) {
    .page-intro h2 { font-size: 22px; }
    .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .stat-card { padding: 13px; }
    .stat-card strong { font-size: 20px; }
    .stat-card small { font-size: 8px; }
    .form-row, .course-options, .course-picker-tools { grid-template-columns: 1fr; }
    .course-selection-actions { align-items: flex-start; flex-direction: column; }
    .modal-layer { padding: 10px; }
    .group-modal { max-height: 96vh; padding: 18px; border-radius: 12px; }
    .modal-actions { flex-direction: column-reverse; }
    .modal-actions button { width: 100%; }
  }

  @media (prefers-reduced-motion: reduce) {
    .sidebar { transition: none; }
    .loader { animation-duration: 1.8s; }
  }
</style>
