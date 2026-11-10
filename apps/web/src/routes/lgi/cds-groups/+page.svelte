<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  import {
    ApiError,
    getCurrentUser,
    getCdsGroupReferenceData,
    listCdsGroups,
    getCdsGroup,
    createCdsGroup,
    updateCdsGroup,
    listLgiCourses,
    getCourseDisciplineLabel,
    logout
  } from '#lib/api/client.ts';

  import type {
    AuthUser,
    CdsGroupSummary,
    CdsGroupReferenceData,
    CdsGroupDetail,
    CreateCdsGroupInput
  } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let referenceData = $state<CdsGroupReferenceData>({ lgas: [], courses: [] });
  let groups = $state<CdsGroupSummary[]>([]);
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
    groups = await listCdsGroups({
      lgaId: selectedLga || undefined,
      search: search.trim() || undefined,
      active: statusFilter === 'all'
        ? undefined
        : statusFilter === 'active'
    });
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

  function capacityPercent(group: CdsGroupSummary) {
    return Math.min(100, Math.round((group.currentMemberCount / group.maxCapacity) * 100));
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
    {#if mobileNavOpen}
      <button class="drawer-backdrop" type="button" aria-label="Close navigation menu" onclick={closeMobileNavigation}></button>
    {/if}

    <aside id="lgi-sidebar" class="sidebar" class:open={mobileNavOpen} aria-label="LGI administration">
      <div class="brand">
        <div class="brand-icon">N</div>
        <div class="brand-copy">
          <strong>NYSC CDS</strong>
          <span>Management Platform</span>
        </div>
        <button class="drawer-close" type="button" aria-label="Close navigation menu" onclick={closeMobileNavigation}>×</button>
      </div>

      <div class="nav-label">ADMINISTRATION</div>
      <nav aria-label="Primary navigation">
        <a class="nav-item" href="/lgi" onclick={closeMobileNavigation}><span class="nav-icon">▦</span><span>Dashboard</span></a>
        <div class="nav-item muted"><span class="nav-icon">♙</span><span>Corps Members</span><small>Soon</small></div>
        <div class="nav-item muted"><span class="nav-icon">▤</span><span>Batches & Streams</span><small>Soon</small></div>
        <a class="nav-item active" href="/lgi/cds-groups" aria-current="page" onclick={closeMobileNavigation}><span class="nav-icon">◎</span><span>CDS Groups</span></a>
        <a class="nav-item" href="/lgi/course-catalogue" onclick={closeMobileNavigation}><span class="nav-icon">▤</span><span>Course Catalogue</span></a>
        <div class="nav-item muted"><span class="nav-icon">⌘</span><span>Course Mapping</span><small>Soon</small></div>
        <a class="nav-item" href="/lgi/coordinators" onclick={closeMobileNavigation}><span class="nav-icon">♧</span><span>CDS Coordinators</span></a>
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

<style>
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
  .stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 22px; }
  .stat-card { min-width: 0; padding: 18px 20px; border: 1px solid #e8ece8; border-radius: 10px; background: #fff; }
  .stat-card > span { display: block; color: #718078; font-size: 10px; }
  .stat-card strong { display: block; margin: 9px 0 5px; color: #183d29; font-size: 25px; }
  .stat-card small { color: #89948c; font-size: 9px; }
  .groups-panel { padding: 20px; border: 1px solid #e8ece8; border-radius: 12px; background: #fff; }
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
  .card-actions { display: flex; justify-content: flex-end; margin-top: 18px; padding-top: 14px; border-top: 1px solid #edf0ed; }
  .card-actions button { min-width: 100px; }
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

  @media (max-width: 1050px) {
    .sidebar { width: 220px; flex-basis: 220px; padding-inline: 14px; }
    .topbar { padding-inline: 22px; }
    .page-content { padding: 26px 22px; }
    .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  @media (max-width: 760px) {
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
    .stats-grid { gap: 8px; }
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
