<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import LgiSidebar from '#lib/components/LgiSidebar.svelte';
  import {
    ApiError,
    getCurrentUser,
    getCdsGroupReferenceData,
    listCdsGroups,
    getCdsGroup,
    updateCdsGroup,
    getCourseDisciplineLabel,
    logout
  } from '#lib/api/client.ts';
  import type {
    AuthUser,
    CdsGroupReferenceData,
    CdsGroupSummary,
    CdsGroupDetail
  } from '#lib/api/client.ts';

  type MappingRow = CdsGroupSummary & { courses: CdsGroupDetail['courses'] };

  let currentUser = $state<AuthUser | null>(null);
  let referenceData = $state<CdsGroupReferenceData>({ lgas: [], courses: [] });
  let rows = $state<MappingRow[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let signingOut = $state(false);
  let mobileNavOpen = $state(false);
  let selectedLga = $state('');
  let search = $state('');
  let errorMessage = $state('');
  let noticeMessage = $state('');
  let mappingOpen = $state(false);
  let editingGroup = $state<MappingRow | null>(null);
  let selectedCourseIds = $state<string[]>([]);
  let courseSearch = $state('');
  let categoryFilter = $state('all');
  let formError = $state('');

  const categories = $derived([...new Set(referenceData.courses.map((course) => course.disciplineCategory))].sort());
  const visibleCourses = $derived(referenceData.courses.filter((course) => {
    const term = courseSearch.trim().toLocaleLowerCase();
    const matchesTerm = !term ||
      course.name.toLocaleLowerCase().includes(term) ||
      (course.aliases ?? []).some((alias) => alias.toLocaleLowerCase().includes(term));
    return matchesTerm && (categoryFilter === 'all' || course.disciplineCategory === categoryFilter);
  }));
  const filteredRows = $derived(rows.filter((row) =>
    !search.trim() ||
    row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) ||
    row.code.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) ||
    row.courses.some((course) => course.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  ));
  const mappedCount = $derived(rows.filter((row) => row.courses.length > 0).length);
  const mappingCount = $derived(rows.reduce((total, row) => total + row.courses.length, 0));

  onMount(() => { void loadPage(); });

  async function loadPage() {
    loading = true;
    errorMessage = '';
    try {
      const auth = await getCurrentUser();
      if (!auth.roles.some((role) => role.code === 'LGI_ADMIN')) {
        errorMessage = 'Your account does not have LGI administrator permissions.';
        return;
      }
      currentUser = auth.user;
      referenceData = await getCdsGroupReferenceData();
      if (!selectedLga && referenceData.lgas.length) selectedLga = referenceData.lgas[0].id;
      await loadMappings();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load course mappings.';
    } finally {
      loading = false;
    }
  }

  async function loadMappings() {
    const groups = await listCdsGroups({ lgaId: selectedLga || undefined });
    rows = await Promise.all(groups.map(async (group) => {
      const detail = await getCdsGroup(group.id);
      return { ...group, courses: detail.courses };
    }));
  }

  async function refreshMappings() {
    errorMessage = '';
    try { await loadMappings(); }
    catch (error) { errorMessage = error instanceof Error ? error.message : 'Unable to refresh course mappings.'; }
  }

  function openMapping(group: MappingRow) {
    editingGroup = group;
    selectedCourseIds = group.courses.map((course) => course.id);
    courseSearch = '';
    categoryFilter = 'all';
    formError = '';
    mappingOpen = true;
  }

  function toggleCourse(courseId: string, checked: boolean) {
    selectedCourseIds = checked
      ? [...selectedCourseIds, courseId]
      : selectedCourseIds.filter((id) => id !== courseId);
  }

  async function saveMapping(event: SubmitEvent) {
    event.preventDefault();
    if (!editingGroup) return;
    if (selectedCourseIds.length === 0) {
      formError = 'Map at least one academic course to this CDS group.';
      return;
    }
    saving = true;
    formError = '';
    errorMessage = '';
    noticeMessage = '';
    try {
      await updateCdsGroup(editingGroup.id, { courseIds: selectedCourseIds });
      mappingOpen = false;
      noticeMessage = `Course mapping saved for ${editingGroup.name}.`;
      await loadMappings();
    } catch (error) {
      formError = error instanceof ApiError || error instanceof Error
        ? error.message
        : 'Unable to save this course mapping.';
    } finally {
      saving = false;
    }
  }

  async function handleLogout() {
    signingOut = true;
    try { await logout(); } catch (error) { console.error('Logout failed:', error); }
    finally { await goto('/login'); }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      mappingOpen = false;
      mobileNavOpen = false;
    }
  }
</script>

<svelte:head>
  <title>Course Mapping | NYSC CDS Platform</title>
  <meta name="description" content="Map academic courses to CDS groups to power automatic Corps Member placement." />
</svelte:head>
<svelte:window onkeydown={handleKeydown} />

{#if loading}
  <main class="state-screen"><div class="loader"></div><p>Loading course mappings…</p></main>
{:else if errorMessage && !currentUser}
  <main class="state-screen"><h2>Unable to open Course Mapping</h2><p>{errorMessage}</p><button class="primary-button" onclick={() => goto('/login')}>Return to login</button></main>
{:else}
  <div class="admin-shell">
    <LgiSidebar activePath="/lgi/course-mapping" open={mobileNavOpen} signingOut={signingOut} onClose={() => (mobileNavOpen = false)} onSignOut={handleLogout} />
    <section class="main-area">
      <header class="topbar">
        <div class="heading">
          <button class="menu-button" type="button" aria-label="Open navigation menu" aria-expanded={mobileNavOpen} onclick={() => (mobileNavOpen = !mobileNavOpen)}><span></span><span></span><span></span></button>
          <div><span class="breadcrumb">Administration / Course Mapping</span><h1>Course Mapping</h1></div>
        </div>
        <div class="account"><div class="avatar">LG</div><div><strong>LGI Administrator</strong><span>{currentUser?.email}</span></div></div>
      </header>

      <main class="page-content">
        {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}
        {#if noticeMessage}<div class="message success" role="status">{noticeMessage}</div>{/if}

        <section class="intro">
          <div>
            <span class="eyebrow">AUTOMATIC CDS PLACEMENT</span>
            <h2>Map academic courses to CDS groups</h2>
            <p>Define which courses qualify for each group. After a Corps Member's required documents are verified, the matching algorithm uses these mappings and available group capacity to place them automatically.</p>
          </div>
        </section>

        <section class="stats">
          <article><span>CDS groups</span><strong>{rows.length}</strong></article>
          <article><span>Groups with course mappings</span><strong>{mappedCount}</strong></article>
          <article><span>Total course-to-group links</span><strong>{mappingCount}</strong></article>
        </section>

        <section class="panel">
          <div class="panel-heading">
            <div><h2>Group eligibility rules</h2><p>One academic course can qualify for more than one CDS group.</p></div>
            <span class="count-badge">{filteredRows.length} groups</span>
          </div>
          <div class="filters">
            <label><span>Local Government Area</span>
              <select bind:value={selectedLga} onchange={() => void refreshMappings()}>
                {#each referenceData.lgas as lga}<option value={lga.id}>{lga.name}, {lga.stateName}</option>{/each}
              </select>
            </label>
            <label class="search"><span>Search groups or mapped courses</span><input bind:value={search} placeholder="Search by group or course name…" /></label>
          </div>

          {#if referenceData.lgas.length === 0}
            <div class="empty"><h3>No LGA assignment found</h3><p>Your LGI account needs an active LGA assignment.</p></div>
          {:else if rows.length === 0}
            <div class="empty"><h3>No CDS groups found</h3><p>Create a CDS group first. You can then map eligible academic courses here.</p><a href="/lgi/cds-groups">Open CDS Groups →</a></div>
          {:else if filteredRows.length === 0}
            <div class="empty"><h3>No matching groups</h3><p>Try a different search term.</p></div>
          {:else}
            <div class="mapping-list">
              {#each filteredRows as group (group.id)}
                <article class="mapping-row">
                  <div class="group-summary">
                    <div class="code">{group.code}</div>
                    <div><h3>{group.name}</h3><p>{group.lgaName}, {group.stateName} · {group.currentMemberCount}/{group.maxCapacity} members</p></div>
                    <span class:inactive={!group.isActive} class="status">{group.isActive ? 'Active' : 'Inactive'}</span>
                  </div>
                  <div class="course-maps">
                    {#if group.courses.length === 0}
                      <span class="unmapped">No eligible courses mapped</span>
                    {:else}
                      {#each group.courses as course (course.id)}<span class="course-chip">{course.name}</span>{/each}
                    {/if}
                  </div>
                  <div class="row-action"><button class="secondary-button" type="button" onclick={() => openMapping(group)}>Configure mapping</button></div>
                </article>
              {/each}
            </div>
          {/if}
        </section>
      </main>
      <footer class="footer">NYSC CDS Management Platform · Course eligibility powers automatic group placement.</footer>
    </section>
  </div>
{/if}

{#if mappingOpen && editingGroup}
  <div class="modal-layer">
    <button class="scrim" type="button" aria-label="Close mapping form" onclick={() => (mappingOpen = false)}></button>
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="mapping-title">
      <header class="modal-header">
        <div><span class="eyebrow">ELIGIBILITY RULES</span><h2 id="mapping-title">{editingGroup.name}</h2><p>Choose the academic courses eligible for this CDS group.</p></div>
        <button class="close" type="button" aria-label="Close" onclick={() => (mappingOpen = false)}>×</button>
      </header>
      {#if formError}<div class="message error" role="alert">{formError}</div>{/if}
      <form onsubmit={saveMapping}>
        <div class="selection-summary"><strong>{selectedCourseIds.length} courses selected</strong><span>Group capacity: {editingGroup.maxCapacity}</span></div>
        <div class="picker-tools">
          <input type="search" bind:value={courseSearch} placeholder="Search academic course or alias…" aria-label="Search academic courses" />
          <select bind:value={categoryFilter} aria-label="Filter by discipline"><option value="all">All disciplines</option>{#each categories as category}<option value={category}>{getCourseDisciplineLabel(category)}</option>{/each}</select>
        </div>
        <div class="quick-actions">
          <button type="button" onclick={() => (selectedCourseIds = [...new Set([...selectedCourseIds, ...visibleCourses.map((course) => course.id)])])} disabled={!visibleCourses.length}>Select visible</button>
          <button type="button" onclick={() => (selectedCourseIds = selectedCourseIds.filter((id) => !visibleCourses.some((course) => course.id === id)))} disabled={!visibleCourses.some((course) => selectedCourseIds.includes(course.id))}>Clear visible</button>
        </div>
        <div class="course-list">
          {#each visibleCourses as course (course.id)}
            <label class="course-option">
              <input type="checkbox" checked={selectedCourseIds.includes(course.id)} onchange={(event) => toggleCourse(course.id, event.currentTarget.checked)} />
              <span><strong>{course.name}</strong><small>{getCourseDisciplineLabel(course.disciplineCategory)}</small>{#if course.aliases?.length}<small>Aliases: {course.aliases.join(', ')}</small>{/if}</span>
            </label>
          {/each}
          {#if visibleCourses.length === 0}<div class="empty">No matching courses.</div>{/if}
        </div>
        <div class="modal-actions"><button class="secondary-button" type="button" onclick={() => (mappingOpen = false)} disabled={saving}>Cancel</button><button class="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save course mapping'}</button></div>
      </form>
    </section>
  </div>
{/if}

<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#f5f7f5;color:#19251e;font-family:Inter,Arial,sans-serif}
  :global(button),:global(input),:global(select){font:inherit}
  .admin-shell{min-height:100vh;display:flex}.main-area{min-width:0;flex:1}.topbar{min-height:76px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 30px;border-bottom:1px solid #e5ebe6;background:#fff}
  .heading{display:flex;align-items:center;gap:12px}.breadcrumb{color:#819087;font-size:10px}.topbar h1{margin:7px 0 0;font-size:21px}.account{display:flex;align-items:center;gap:10px}.avatar{width:36px;height:36px;display:grid;place-items:center;border-radius:50%;background:#e7f3eb;color:#0a6841;font-weight:800}.account strong,.account span{display:block}.account strong{font-size:11px}.account span{margin-top:4px;color:#819087;font-size:9px}
  .page-content{max-width:1200px;padding:30px;margin:0 auto}.intro{padding:27px 30px;border:1px solid #dcebe0;border-radius:12px;background:#eaf4ed}.eyebrow{color:#0a8050;font-size:9px;font-weight:800;letter-spacing:1.2px}.intro h2{margin:9px 0 7px;font-size:23px}.intro p{max-width:800px;margin:0;color:#718078;font-size:12px;line-height:1.7}
  .stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0}.stats article{display:grid;gap:7px;padding:16px;border:1px solid #e4ebe6;border-radius:9px;background:#fff}.stats span{color:#819087;font-size:10px}.stats strong{color:#0a5c37;font-size:22px}
  .panel{padding:21px;border:1px solid #e4ebe6;border-radius:11px;background:#fff}.panel-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:16px}.panel-heading h2{margin:0 0 5px;font-size:15px}.panel-heading p{margin:0;color:#819087;font-size:10px}.count-badge{padding:6px 9px;border-radius:18px;background:#edf6ef;color:#16633b;font-size:9px;font-weight:700}
  .filters{display:grid;grid-template-columns:minmax(220px,1fr) minmax(220px,1.5fr);gap:12px;padding:13px;margin-bottom:14px;border:1px solid #edf1ed;border-radius:8px;background:#f9fbf9}.filters label{display:grid;gap:6px}.filters label span{color:#56685c;font-size:9px;font-weight:700}.filters input,.filters select,.picker-tools input,.picker-tools select{width:100%;min-height:39px;padding:9px 11px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#26392d;font-size:10px}
  .mapping-list{display:grid}.mapping-row{display:grid;grid-template-columns:minmax(220px,1fr) minmax(220px,1.5fr) auto;gap:15px;align-items:center;padding:17px 3px;border-bottom:1px solid #edf1ed}.mapping-row:last-child{border-bottom:0}.group-summary{display:flex;align-items:center;gap:10px;min-width:0}.code{flex:0 0 auto;padding:6px 8px;border-radius:6px;background:#edf6ef;color:#0a6841;font-size:9px;font-weight:800}.group-summary h3{margin:0 0 5px;color:#263d30;font-size:12px}.group-summary p{margin:0;color:#819087;font-size:9px}.status{padding:5px 8px;border-radius:15px;background:#e8f6ec;color:#147244;font-size:8px;font-weight:700}.status.inactive{background:#f0f2f0;color:#6a776e}.course-maps{display:flex;flex-wrap:wrap;gap:6px}.course-chip{padding:6px 8px;border:1px solid #e0ece2;border-radius:6px;background:#f7fbf7;color:#3d6048;font-size:9px}.unmapped{color:#ad682b;font-size:10px;font-style:italic}.row-action{display:flex;justify-content:flex-end}.secondary-button,.primary-button{min-height:37px;padding:8px 12px;border-radius:7px;font-size:9px;font-weight:700;cursor:pointer}.secondary-button{border:1px solid #dce5de;background:#fff;color:#355442}.secondary-button:hover{border-color:#0a8050;color:#0a6841}.primary-button{border:1px solid #0a5c37;background:#0a5c37;color:#fff}.primary-button:disabled,.secondary-button:disabled{opacity:.5;cursor:not-allowed}
  .empty{padding:35px 14px;text-align:center;color:#819087;font-size:10px;line-height:1.6}.empty h3{margin:0 0 6px;color:#263d30;font-size:13px}.empty p{margin:0 0 10px}.empty a{color:#0a6841;font-weight:700;text-decoration:none}.message{padding:10px 13px;margin:0 0 12px;border-radius:7px;font-size:10px}.message.error{border:1px solid #efceca;background:#fff3f2;color:#a32920}.message.success{border:1px solid #cce6d3;background:#eef8f0;color:#16633b}
  .footer{padding:17px 24px;border-top:1px solid #e5ebe6;color:#89948c;font-size:9px;text-align:center}.state-screen{min-height:100vh;display:grid;place-content:center;justify-items:center;gap:10px;color:#53665a;font-size:12px}.loader{width:27px;height:27px;border:3px solid #dce8df;border-top-color:#0a8050;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
  .menu-button{display:none}.modal-layer{position:fixed;inset:0;z-index:70;display:grid;place-items:center;overflow-y:auto;padding:20px}.scrim{position:fixed;inset:0;border:0;background:#071b10a8}.modal{position:relative;width:min(100%,720px);max-height:92vh;overflow-y:auto;padding:23px;border-radius:12px;background:#fff;box-shadow:0 22px 70px #071e1250}.modal-header{display:flex;justify-content:space-between;gap:14px;padding-bottom:15px;border-bottom:1px solid #edf1ed}.modal-header h2{margin:7px 0 4px;font-size:17px}.modal-header p{margin:0;color:#819087;font-size:10px}.close{width:32px;height:32px;border:1px solid #e0e8e1;border-radius:7px;background:#fff;color:#44554a;font-size:20px;cursor:pointer}.selection-summary{display:flex;justify-content:space-between;gap:12px;padding:13px 0;color:#53665a;font-size:10px}.selection-summary span{color:#819087}.picker-tools{display:grid;grid-template-columns:1.5fr 1fr;gap:9px}.quick-actions{display:flex;justify-content:space-between;padding:8px 0}.quick-actions button{border:0;background:transparent;color:#0a6841;font-size:9px;font-weight:700;cursor:pointer}.quick-actions button:disabled{opacity:.4;cursor:not-allowed}.course-list{max-height:390px;overflow:auto;border:1px solid #e6ede7;border-radius:8px}.course-option{display:flex;align-items:flex-start;gap:10px;padding:11px;border-bottom:1px solid #edf1ed;cursor:pointer}.course-option:last-child{border-bottom:0}.course-option input{margin-top:2px;accent-color:#0a6841}.course-option span{display:grid;gap:4px}.course-option strong{color:#263d30;font-size:10px}.course-option small{color:#819087;font-size:8px}.modal-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:15px;margin-top:14px;border-top:1px solid #edf1ed}
  @media(max-width:950px){.mapping-row{grid-template-columns:1fr;gap:10px}.row-action{justify-content:flex-start}.row-action button{width:100%}}
  @media(max-width:760px){.menu-button{width:39px;height:39px;display:grid;place-content:center;gap:5px;border:1px solid #e1e9e2;border-radius:8px;background:#fff}.menu-button span{width:17px;height:2px;background:#0a5c37}.topbar{min-height:68px;padding:10px 14px}.account>div:last-child{display:none}.page-content{padding:20px 14px}.intro{padding:21px}.stats{grid-template-columns:1fr}.filters{grid-template-columns:1fr}.panel{padding:14px}.mapping-row{padding:15px 2px}.picker-tools{grid-template-columns:1fr}.modal-layer{padding:10px}.modal{max-height:96vh;padding:17px}.modal-actions{flex-direction:column-reverse}.modal-actions button{width:100%}}
</style>