<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  import {
    ApiError,
    getCurrentUser,
    logout,
    getCourseCategories,
    listLgiAdminCourses,
    createCatalogueCourse,
    updateCatalogueCourse,
    importCourseCsv
  } from '#lib/api/client.ts';

  import type {
    AuthUser,
    CourseCategory,
    CourseCatalogueItem
  } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let categories = $state<CourseCategory[]>([]);
  let courses = $state<CourseCatalogueItem[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let importing = $state(false);
  let signingOut = $state(false);
  let mobileNavOpen = $state(false);
  let formOpen = $state(false);
  let editingCourse = $state<CourseCatalogueItem | null>(null);
  let errorMessage = $state('');
  let formError = $state('');
  let noticeMessage = $state('');
  let search = $state('');
  let categoryFilter = $state('all');
  let statusFilter = $state('all');

  let form = $state({
    name: '',
    disciplineCategory: 'UNCLASSIFIED',
    aliasesText: '',
    isActive: true
  });

  const activeCount = $derived(courses.filter((course) => course.isActive).length);
  const inactiveCount = $derived(courses.length - activeCount);
  const aliasCount = $derived(courses.reduce((total, course) => total + course.aliases.length, 0));

  onMount(() => {
    void loadPage();
  });

  async function loadPage() {
    loading = true;
    errorMessage = '';

    try {
      const response = await getCurrentUser();
      const isLGI = response.roles.some((role) => role.code === 'LGI_ADMIN');

      if (!isLGI) {
        await goto('/login');
        return;
      }

      currentUser = response.user;
      categories = await getCourseCategories();
      await loadCourses();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error
        ? error.message
        : 'Unable to load the course catalogue.';
    } finally {
      loading = false;
    }
  }

  async function loadCourses() {
    courses = await listLgiAdminCourses({
      q: search.trim() || undefined,
      category: categoryFilter === 'all' ? undefined : categoryFilter,
      status: statusFilter as 'active' | 'inactive' | 'all'
    });
  }

  async function applyFilters(event: SubmitEvent) {
    event.preventDefault();
    errorMessage = '';
    noticeMessage = '';
    try {
      await loadCourses();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to filter courses.';
    }
  }

  function resetForm() {
    form = {
      name: '',
      disciplineCategory: 'UNCLASSIFIED',
      aliasesText: '',
      isActive: true
    };
    editingCourse = null;
    formError = '';
  }

  function openCreateForm() {
    resetForm();
    formOpen = true;
  }

  function openEditForm(course: CourseCatalogueItem) {
    editingCourse = course;
    form = {
      name: course.name,
      disciplineCategory: course.disciplineCategory,
      aliasesText: course.aliases.map((alias) => alias.name).join(', '),
      isActive: course.isActive
    };
    formError = '';
    formOpen = true;
  }

  function parseAliases(value: string): string[] {
    return [...new Set(value.split(',').map((alias) => alias.trim()).filter(Boolean))];
  }

  async function saveCourse(event: SubmitEvent) {
    event.preventDefault();
    formError = '';
    saving = true;

    try {
      const aliases = parseAliases(form.aliasesText);

      if (editingCourse) {
        await updateCatalogueCourse(editingCourse.id, {
          name: form.name,
          disciplineCategory: form.disciplineCategory,
          aliases,
          isActive: form.isActive
        });
        noticeMessage = 'Course updated successfully.';
      } else {
        await createCatalogueCourse({
          name: form.name,
          disciplineCategory: form.disciplineCategory,
          aliases
        });
        noticeMessage = 'Course added to the shared catalogue.';
      }

      formOpen = false;
      await loadCourses();
    } catch (error) {
      formError = error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unable to save this course.';
    } finally {
      saving = false;
    }
  }

  async function handleCsvUpload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      errorMessage = 'Please select a CSV file.';
      return;
    }
    if (file.size > 1_000_000) {
      errorMessage = 'CSV upload must not exceed 1 MB.';
      return;
    }

    importing = true;
    errorMessage = '';
    noticeMessage = '';

    try {
      const result = await importCourseCsv(await file.text());
      noticeMessage = `Import complete: ${result.inserted} added, ${result.updated} updated, ${result.aliasesAdded} aliases added (${result.totalProcessed} rows).`;
      await loadCourses();
    } catch (error) {
      errorMessage = error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unable to import the CSV file.';
    } finally {
      importing = false;
    }
  }

  async function toggleCourseStatus(course: CourseCatalogueItem) {
    const action = course.isActive ? 'deactivate' : 'reactivate';
    if (!confirm(`Are you sure you want to ${action} "${course.name}"?`)) return;

    errorMessage = '';
    noticeMessage = '';

    try {
      await updateCatalogueCourse(course.id, { isActive: !course.isActive });
      noticeMessage = `${course.name} has been ${course.isActive ? 'deactivated' : 'reactivated'}.`;
      await loadCourses();
    } catch (error) {
      errorMessage = error instanceof ApiError ? error.message : 'Unable to update course status.';
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
      formOpen = false;
      closeMobileNavigation();
    }
  }

  function categoryLabel(code: string) {
    return categories.find((category) => category.code === code)?.label ?? code;
  }
</script>

<svelte:head>
  <title>LGI Course Catalogue | NYSC CDS Platform</title>
  <meta name="description" content="Manage the shared academic course catalogue from the LGI administration module." />
</svelte:head>

<svelte:window onkeydown={handleWindowKeydown} />

{#if loading}
  <main class="state-screen"><div class="loader"></div><p>Loading course catalogue...</p></main>
{:else if !currentUser}
  <main class="state-screen"><h2>Catalogue unavailable</h2><p>{errorMessage}</p><button class="primary-button" onclick={() => goto('/login')}>Return to login</button></main>
{:else}
  <div class="admin-shell">
    {#if mobileNavOpen}
      <button class="drawer-backdrop" type="button" aria-label="Close navigation menu" onclick={closeMobileNavigation}></button>
    {/if}

    <aside id="platform-sidebar" class="sidebar" class:open={mobileNavOpen} aria-label="LGI administration">
      <div class="brand">
        <div class="brand-icon">N</div>
        <div class="brand-copy"><strong>NYSC CDS</strong><span>LGI Administration</span></div>
        <button class="drawer-close" type="button" aria-label="Close navigation menu" onclick={closeMobileNavigation}>×</button>
      </div>

      <div class="nav-label">ADMINISTRATION</div>
      <nav aria-label="LGI navigation">
        <a class="nav-item" href="/lgi" onclick={closeMobileNavigation}><span>▦</span>Dashboard</a>
        <a class="nav-item" href="/lgi/cds-groups" onclick={closeMobileNavigation}><span>◎</span>CDS Groups</a>
        <a class="nav-item active" href="/lgi/course-catalogue" aria-current="page" onclick={closeMobileNavigation}><span>▤</span>Course Catalogue</a>
      </nav>

      <div class="sidebar-footer">
        <span class="status-dot"></span>LGI Administrator
        <button class="sidebar-logout" type="button" onclick={handleLogout} disabled={signingOut}>{signingOut ? 'Signing out...' : 'Sign out'}</button>
      </div>
    </aside>

    <section class="main-area">
      <header class="topbar">
        <div class="topbar-heading">
          <button class="menu-button" type="button" aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileNavOpen} aria-controls="platform-sidebar" onclick={() => (mobileNavOpen = !mobileNavOpen)}>
            <span></span><span></span><span></span>
          </button>
          <div><span class="breadcrumb">Administration / Shared Reference Data</span><h1>Course Catalogue</h1></div>
        </div>
        <div class="account"><div class="avatar">LG</div><div class="account-copy"><strong>LGI Administrator</strong><span>{currentUser.email}</span></div></div>
      </header>

      <main class="page-content">
        {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}
        {#if noticeMessage}<div class="message success" role="status">{noticeMessage}</div>{/if}

        <section class="intro">
          <div><span class="eyebrow">SHARED REFERENCE DATA</span><h2>Academic course catalogue</h2><p>Maintain the shared academic course catalogue used across all LGAs. Changes made here—including additions, edits, imports and deactivations—apply platform-wide.</p></div>
          <button class="primary-button" type="button" onclick={openCreateForm}>＋ Add course</button>
        </section>

        <section class="stats-grid" aria-label="Catalogue summary">
          <article class="stat-card"><span>Courses shown</span><strong>{courses.length}</strong><small>Matching current filters</small></article>
          <article class="stat-card"><span>Active courses</span><strong>{activeCount}</strong><small>Available for group mapping</small></article>
          <article class="stat-card"><span>Inactive courses</span><strong>{inactiveCount}</strong><small>Preserved historical records</small></article>
          <article class="stat-card"><span>Course aliases</span><strong>{aliasCount}</strong><small>Recognised alternate names</small></article>
        </section>

        <section class="catalogue-panel">
          <div class="panel-heading"><div><h3>Catalogue records</h3><p>Search, filter, edit and maintain standard course names.</p></div>
            <div class="import-actions">
              <a class="secondary-button template-link" href="/api/lgi/course-catalogue/template">Download CSV template</a>
              <label class="upload-button" class:busy={importing}>
                {importing ? 'Importing...' : '↑ Import CSV'}
                <input type="file" accept=".csv,text/csv" onchange={handleCsvUpload} disabled={importing} />
              </label>
            </div>
          </div>

          <form class="filters" onsubmit={applyFilters}>
            <label><span>Search course or alias</span><input bind:value={search} placeholder="e.g. Computer Science" /></label>
            <label><span>Discipline category</span><select bind:value={categoryFilter}><option value="all">All categories</option>{#each categories as category}<option value={category.code}>{category.label}</option>{/each}</select></label>
            <label><span>Record status</span><select bind:value={statusFilter}><option value="all">All records</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
            <button class="filter-button" type="submit">Apply filters</button>
          </form>

          {#if courses.length === 0}
            <div class="empty-state"><div class="empty-icon">▤</div><h3>No courses found</h3><p>Try another search or import a CSV file with the catalogue template.</p><button class="primary-button" type="button" onclick={openCreateForm}>Add first course</button></div>
          {:else}
            <div class="course-list">
              {#each courses as course (course.id)}
                <article class="course-row">
                  <div class="course-main"><div class="course-mark">C</div><div class="course-name"><h4>{course.name}</h4><p>{categoryLabel(course.disciplineCategory)}</p>{#if course.aliases.length > 0}<div class="aliases"><span>Also known as:</span> {course.aliases.map((alias) => alias.name).join(' · ')}</div>{/if}</div></div>
                  <div class="course-actions"><span class:inactive={!course.isActive} class="status-badge">{course.isActive ? 'Active' : 'Inactive'}</span><button class="text-button" type="button" onclick={() => openEditForm(course)}>Edit</button><button class="text-button" type="button" onclick={() => void toggleCourseStatus(course)}>{course.isActive ? 'Deactivate' : 'Reactivate'}</button></div>
                </article>
              {/each}
            </div>
          {/if}
        </section>

        <section class="import-help">
          <h3>CSV import format</h3>
          <p>Use columns <code>name</code>, <code>disciplineCategory</code> and optional <code>aliases</code>. Separate aliases with a vertical bar (|). Import is limited to 1 MB and 1,000 rows per upload. Existing canonical course names are updated; aliases are added without deleting existing aliases.</p>
          <p>Available category codes: {categories.map((category) => category.code).join(', ')}.</p>
        </section>
      </main>
      <footer class="page-footer">NYSC CDS Management Platform · LGI Shared Course Catalogue</footer>
    </section>
  </div>
{/if}

{#if formOpen}
  <div class="modal-layer">
    <button class="modal-scrim" type="button" aria-label="Close course form" onclick={() => (formOpen = false)}></button>
    <section class="course-modal" role="dialog" aria-modal="true" aria-labelledby="course-modal-title">
      <div class="modal-header"><div><span class="eyebrow">COURSE RECORD</span><h2 id="course-modal-title">{editingCourse ? 'Edit course' : 'Add course'}</h2><p>Use the canonical academic programme name and add common variations as aliases.</p></div><button class="modal-close" type="button" aria-label="Close form" onclick={() => (formOpen = false)}>×</button></div>
      {#if formError}<div class="message error" role="alert">{formError}</div>{/if}
      <form class="course-form" onsubmit={saveCourse}>
        <label><span>Canonical course name *</span><input bind:value={form.name} minlength="2" maxlength="200" placeholder="e.g. Computer Science" required /></label>
        <label><span>Discipline category *</span><select bind:value={form.disciplineCategory} required>{#each categories as category}<option value={category.code}>{category.label}</option>{/each}</select></label>
        <label><span>Aliases / alternate names</span><input bind:value={form.aliasesText} placeholder="Computing, Computer Studies" /><small>Separate aliases with commas. They help resolve variations in institution records.</small></label>
        {#if editingCourse}<label class="active-toggle"><input type="checkbox" bind:checked={form.isActive} /><span><strong>Course is active</strong><small>Inactive courses are hidden from new CDS group course selection.</small></span></label>{/if}
        <div class="modal-actions"><button class="secondary-button" type="button" onclick={() => (formOpen = false)} disabled={saving}>Cancel</button><button class="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : editingCourse ? 'Save changes' : 'Add course'}</button></div>
      </form>
    </section>
  </div>
{/if}

<style>
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
  nav { display: grid; gap: 6px; }
  .nav-item { min-height: 44px; display: flex; align-items: center; gap: 11px; padding: 0 11px; border-radius: 7px; color: #d1e0d7; font-size: 12px; text-decoration: none; }
  .nav-item > span:first-child { width: 20px; text-align: center; }
  .nav-item.active { background: #0e6440; color: #fff; font-weight: 700; }
  .sidebar-footer { margin-top: 24px; padding: 17px 9px 5px; border-top: 1px solid #ffffff1f; color: #a6c6b3; font-size: 10px; }
  .status-dot { display: inline-block; width: 7px; height: 7px; margin-right: 7px; border-radius: 50%; background: #55d58a; }
  .sidebar-logout { width: 100%; min-height: 42px; margin-top: 15px; padding: 10px 12px; border: 1px solid #ffffff3d; border-radius: 8px; background: #ffffff14; color: #fff; text-align: left; font-size: 12px; cursor: pointer; }
  .main-area { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .topbar { position: sticky; top: 0; z-index: 15; min-height: 84px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 14px 32px; border-bottom: 1px solid #e8ece8; background: #fff; }
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
  .intro p { max-width: 710px; margin: 0; color: #718078; font-size: 12px; line-height: 1.7; }
  .primary-button, .secondary-button, .filter-button, .upload-button { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; padding: 10px 15px; border-radius: 8px; font-size: 11px; font-weight: 700; text-decoration: none; cursor: pointer; }
  .primary-button { border: 1px solid #0a5c37; background: #0a5c37; color: #fff; }
  .primary-button:hover:not(:disabled) { background: #064526; }
  .primary-button:disabled { opacity: .6; cursor: not-allowed; }
  .secondary-button { border: 1px solid #dce5de; background: #fff; color: #405448; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 13px; margin-bottom: 20px; }
  .stat-card { min-width: 0; padding: 17px 19px; border: 1px solid #e8ece8; border-radius: 10px; background: #fff; }
  .stat-card span, .stat-card small { display: block; }
  .stat-card span { color: #718078; font-size: 10px; }
  .stat-card strong { display: block; margin: 8px 0 4px; color: #183d29; font-size: 24px; }
  .stat-card small { color: #89948c; font-size: 9px; }
  .catalogue-panel { padding: 20px; border: 1px solid #e8ece8; border-radius: 12px; background: #fff; }
  .panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-bottom: 18px; }
  .panel-heading h3 { margin: 0 0 5px; font-size: 15px; }
  .panel-heading p { margin: 0; color: #819087; font-size: 10px; }
  .import-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .template-link { min-height: 38px; font-size: 10px; }
  .upload-button { min-height: 38px; position: relative; overflow: hidden; border: 1px solid #0a5c37; background: #eaf3ed; color: #0a5c37; font-size: 10px; }
  .upload-button input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
  .upload-button.busy { opacity: .6; cursor: wait; }
  .filters { display: grid; grid-template-columns: minmax(180px, 1.4fr) minmax(180px, 1fr) minmax(130px, .7fr) auto; align-items: end; gap: 11px; margin-bottom: 17px; }
  .filters label, .course-form > label { display: grid; gap: 7px; color: #4a5c50; font-size: 10px; font-weight: 700; }
  .filters input, .filters select, .course-form input:not([type="checkbox"]), .course-form select { width: 100%; min-width: 0; min-height: 41px; padding: 9px 11px; border: 1px solid #dce5de; border-radius: 8px; outline: 0; background: #fff; color: #26392d; font-size: 11px; }
  .filters input:focus, .filters select:focus, .course-form input:focus, .course-form select:focus { border-color: #0a8050; box-shadow: 0 0 0 3px #0a805014; }
  .filter-button { border: 1px solid #dce5de; background: #f8faf8; color: #405448; }
  .course-list { display: grid; }
  .course-row { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 14px 3px; border-top: 1px solid #edf0ed; }
  .course-main { min-width: 0; display: flex; align-items: flex-start; gap: 12px; }
  .course-mark { width: 35px; height: 35px; flex: 0 0 35px; display: grid; place-items: center; border-radius: 9px; background: #eaf3ed; color: #0a5c37; font-size: 13px; font-weight: 800; }
  .course-name { min-width: 0; }
  .course-name h4 { margin: 0 0 4px; color: #24382b; font-size: 12px; }
  .course-name p { margin: 0; color: #0a8050; font-size: 9px; }
  .aliases { margin-top: 6px; color: #8a958d; font-size: 9px; line-height: 1.5; overflow-wrap: anywhere; }
  .aliases span { color: #65746a; font-weight: 700; }
  .course-actions { flex: 0 0 auto; display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
  .status-badge { padding: 5px 8px; border-radius: 20px; background: #e8f5ec; color: #087443; font-size: 9px; font-weight: 700; white-space: nowrap; }
  .status-badge.inactive { background: #f1f3f2; color: #758078; }
  .text-button { padding: 5px 0; border: 0; background: transparent; color: #0a6841; font-size: 10px; font-weight: 700; cursor: pointer; white-space: nowrap; }
  .text-button:hover { text-decoration: underline; }
  .empty-state { display: grid; justify-items: center; padding: 50px 20px; text-align: center; }
  .empty-icon { width: 46px; height: 46px; display: grid; place-items: center; border-radius: 12px; background: #eaf3ed; color: #0a5c37; font-size: 22px; }
  .empty-state h3 { margin: 14px 0 6px; font-size: 14px; }
  .empty-state p { max-width: 410px; color: #819087; font-size: 11px; line-height: 1.6; }
  .message { padding: 11px 13px; margin-bottom: 14px; border-radius: 8px; font-size: 11px; line-height: 1.5; }
  .message.error { border: 1px solid #f2cccc; background: #fff0f0; color: #b42318; }
  .message.success { border: 1px solid #c8e6d1; background: #eaf7ee; color: #14683e; }
  .import-help { padding: 16px 18px; margin-top: 16px; border: 1px solid #e8ece8; border-radius: 10px; background: #f9fbf9; }
  .import-help h3 { margin: 0 0 7px; color: #304437; font-size: 11px; }
  .import-help p { margin: 5px 0; color: #78847c; font-size: 10px; line-height: 1.6; }
  .import-help code { padding: 2px 4px; border-radius: 3px; background: #edf2ee; color: #0a5c37; }
  .page-footer { margin-top: auto; padding: 17px 32px; border-top: 1px solid #e8ece8; color: #89948c; font-size: 10px; }
  .state-screen { min-height: 100vh; display: grid; align-content: center; justify-items: center; gap: 10px; padding: 24px; text-align: center; }
  .state-screen p { color: #718078; font-size: 12px; }
  .loader { width: 28px; height: 28px; border: 3px solid #dbe8de; border-top-color: #0a5c37; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .modal-layer { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; overflow-y: auto; padding: 22px; }
  .modal-scrim { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; background: #10251980; }
  .course-modal { position: relative; z-index: 1; width: min(100%, 560px); max-height: 92vh; overflow-y: auto; padding: 24px; border-radius: 14px; background: #fff; box-shadow: 0 22px 70px #071e1250; }
  .modal-header { display: flex; justify-content: space-between; gap: 15px; margin-bottom: 20px; }
  .modal-header h2 { margin: 8px 0 5px; font-size: 20px; }
  .modal-header p { margin: 0; color: #718078; font-size: 11px; line-height: 1.6; }
  .modal-close { width: 34px; height: 34px; flex: 0 0 34px; border: 1px solid #e0e8e1; border-radius: 8px; background: #fff; color: #44554a; font-size: 22px; cursor: pointer; }
  .course-form { display: grid; gap: 15px; }
  .course-form small { color: #819087; font-size: 9px; font-weight: 400; }
  .active-toggle { display: flex !important; align-items: center; gap: 10px !important; padding: 12px; border: 1px solid #e8ece8; border-radius: 8px; }
  .active-toggle input { width: 16px; height: 16px; accent-color: #0a5c37; }
  .active-toggle span, .active-toggle strong, .active-toggle small { display: block; }
  .active-toggle strong { font-size: 10px; }
  .active-toggle small { margin-top: 4px; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 9px; padding-top: 8px; border-top: 1px solid #edf0ed; }
  .modal-actions button { min-width: 110px; }

  @media (max-width: 1050px) {
    .sidebar { width: 220px; flex-basis: 220px; padding-inline: 14px; }
    .topbar, .page-footer { padding-inline: 22px; }
    .page-content { padding: 26px 22px; }
    .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 760px) {
    .sidebar { position: fixed; inset: 0 auto 0 0; z-index: 40; width: min(290px, 86vw); height: 100vh; height: 100dvh; overflow-y: auto; padding: 22px 16px; transform: translateX(-105%); visibility: hidden; pointer-events: none; box-shadow: 12px 0 32px #0822142e; transition: transform 180ms ease, visibility 180ms ease; }
    .sidebar.open { transform: translateX(0); visibility: visible; pointer-events: auto; }
    .drawer-backdrop { position: fixed; inset: 0; z-index: 30; width: 100%; height: 100%; border: 0; background: #0a19107a; }
    .brand { width: 100%; padding: 0 9px 26px; }
    .drawer-close { width: 36px; height: 36px; flex: 0 0 36px; display: grid; place-items: center; margin-left: auto; padding: 0 0 3px; border: 1px solid #ffffff47; border-radius: 9px; background: #ffffff14; color: #fff; font-size: 28px; cursor: pointer; }
    .topbar { min-height: 76px; padding: 12px 15px; gap: 10px; }
    .menu-button { width: 42px; height: 42px; flex: 0 0 42px; display: grid; place-content: center; gap: 5px; padding: 0; border: 1px solid #e1e9e2; border-radius: 9px; background: #fff; }
    .menu-button span { width: 18px; height: 2px; background: #0a5c37; }
    .topbar h1 { font-size: 18px; }
    .account-copy { display: none; }
    .page-content { padding: 22px 15px; }
    .intro { align-items: flex-start; flex-direction: column; }
    .intro .primary-button { width: 100%; }
    .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
    .stat-card { padding: 14px; }
    .stat-card strong { font-size: 21px; }
    .panel-heading { align-items: flex-start; flex-direction: column; }
    .filters { grid-template-columns: 1fr; }
    .filters button { width: 100%; }
    .course-row { align-items: flex-start; flex-direction: column; }
    .course-actions { width: 100%; justify-content: flex-start; flex-wrap: wrap; }
    .page-footer { padding: 15px; line-height: 1.5; }
  }
  @media (max-width: 480px) {
    .page-content { padding-inline: 12px; }
    .catalogue-panel { padding: 14px; }
    .import-actions { width: 100%; }
    .import-actions > * { flex: 1; }
    .course-modal { padding: 18px; }
    .modal-layer { padding: 10px; }
    .modal-actions { flex-direction: column-reverse; }
    .modal-actions button { width: 100%; }
  }
  @media (prefers-reduced-motion: reduce) { .sidebar { transition: none; } .loader { animation-duration: 1.8s; } }
</style>
