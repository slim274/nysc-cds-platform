<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    ApiError,
    getCurrentUser,
    getMyCoordinatorCourseMappings,
    updateMyCoordinatorCourseMapping,
    logout
  } from '#lib/api/client.ts';
  import type {
    AuthUser,
    CoordinatorCourseMappingData,
    CoordinatorCourseMappingGroup,
    CdsGroupCourse
  } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let data = $state<CoordinatorCourseMappingData>({ groups: [], courses: [] });
  let loading = $state(true);
  let saving = $state(false);
  let errorMessage = $state('');
  let noticeMessage = $state('');
  let mobileNavOpen = $state(false);
  let mappingOpen = $state(false);
  let editingGroup = $state<CoordinatorCourseMappingGroup | null>(null);
  let selectedCourseIds = $state<string[]>([]);
  let courseSearch = $state('');
  let categoryFilter = $state('all');

  const categories = $derived([...new Set(data.courses.map((course) => course.disciplineCategory))].sort());
  const visibleCourses = $derived(data.courses.filter((course) => {
    const term = courseSearch.trim().toLocaleLowerCase();
    const matchesSearch = !term || course.name.toLocaleLowerCase().includes(term) ||
      (course.aliases ?? []).some((alias) => alias.toLocaleLowerCase().includes(term));
    return matchesSearch && (categoryFilter === 'all' || course.disciplineCategory === categoryFilter);
  }));

  onMount(() => { void loadPage(); });

  async function loadPage() {
    loading = true;
    errorMessage = '';
    try {
      const auth = await getCurrentUser();
      if (!auth.roles.some((role) => role.code === 'CDS_COORDINATOR')) {
        await goto('/login');
        return;
      }
      currentUser = auth.user;
      data = await getMyCoordinatorCourseMappings();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load your CDS group mappings.';
    } finally {
      loading = false;
    }
  }

  function openMapping(group: CoordinatorCourseMappingGroup) {
    editingGroup = group;
    selectedCourseIds = group.courses.map((course) => course.id);
    courseSearch = '';
    categoryFilter = 'all';
    errorMessage = '';
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
      errorMessage = 'Select at least one eligible academic course.';
      return;
    }
    saving = true;
    errorMessage = '';
    noticeMessage = '';
    try {
      await updateMyCoordinatorCourseMapping(editingGroup.id, selectedCourseIds);
      mappingOpen = false;
      noticeMessage = `Course mapping saved for ${editingGroup.name}.`;
      data = await getMyCoordinatorCourseMappings();
    } catch (error) {
      errorMessage = error instanceof ApiError || error instanceof Error ? error.message : 'Unable to save this course mapping.';
    } finally {
      saving = false;
    }
  }

  async function signOut() {
    try { await logout(); } finally { await goto('/login'); }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      mappingOpen = false;
      mobileNavOpen = false;
    }
  }
</script>

<svelte:head>
  <title>Course Mapping | Coordinator Workspace</title>
  <meta name="description" content="Configure academic course eligibility for your assigned CDS groups." />
</svelte:head>
<svelte:window onkeydown={handleWindowKeydown} />

{#if loading}
  <main class="state-screen"><div class="loader"></div><p>Loading your assigned CDS groups…</p></main>
{:else if !currentUser}
  <main class="state-screen"><h2>Coordinator workspace unavailable</h2><p>{errorMessage}</p><a href="/login">Return to sign in</a></main>
{:else}
  <div class="workspace">
    <header class="topbar">
      <div class="brand"><span class="brand-icon">N</span><div><strong>NYSC CDS</strong><small>Coordinator workspace</small></div></div>
      <div class="account"><a class="nav-link" href="/coordinator/handovers">Handover inbox</a><div><strong>{currentUser.email}</strong><small>CDS Coordinator</small></div><button class="secondary-button" type="button" onclick={signOut}>Sign out</button></div>
    </header>
    <main class="content">
      <div class="eyebrow">CDS GROUP OPERATIONS</div>
      <h1>Course Mapping</h1>
      <p class="intro">Configure which academic courses are eligible for the CDS Groups assigned to you. The matching algorithm uses these rules after each member's mandatory documents have been verified.</p>
      {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}
      {#if noticeMessage}<div class="message success" role="status">{noticeMessage}</div>{/if}

      {#if data.groups.length === 0}
        <section class="empty"><div class="empty-icon">⌘</div><h2>No CDS groups assigned</h2><p>Once the LGI assigns you to a CDS Group, you can configure its eligible academic courses here.</p></section>
      {:else}
        <section class="mapping-list">
          {#each data.groups as group (group.id)}
            <article class="mapping-card">
              <div class="card-top"><span class="group-code">{group.code}</span><span class:inactive={!group.isActive} class="status">{group.isActive ? 'Active' : 'Inactive'}</span></div>
              <h2>{group.name}</h2>
              <p>{group.lgaName}, {group.stateName}</p>
              <div class="course-list">
                {#if group.courses.length === 0}
                  <span class="unmapped">No eligible courses mapped yet.</span>
                {:else}
                  {#each group.courses as course (course.id)}<span class="course-chip">{course.name}</span>{/each}
                {/if}
              </div>
              <div class="card-footer"><span>{group.courses.length} eligible courses</span><button class="primary-button" type="button" onclick={() => openMapping(group)} disabled={!group.isActive}>Configure courses</button></div>
            </article>
          {/each}
        </section>
      {/if}
      <div class="notice"><strong>How automatic matching works</strong><span>Only active CDS Groups with a matching course and available capacity are considered. Each Corps Member is matched after all mandatory documents have been verified. Manual reassignment remains an LGI exception tool.</span></div>
    </main>
  </div>
{/if}

{#if mappingOpen && editingGroup}
  <div class="modal-layer">
    <button class="scrim" type="button" aria-label="Close mapping form" onclick={() => (mappingOpen = false)}></button>
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="mapping-title">
      <header class="modal-header"><div><span class="eyebrow">GROUP ELIGIBILITY</span><h2 id="mapping-title">{editingGroup.name}</h2><p>Select every academic course that should match this CDS group.</p></div><button class="close" type="button" aria-label="Close" onclick={() => (mappingOpen = false)}>×</button></header>
      {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}
      <form onsubmit={saveMapping}>
        <div class="summary"><strong>{selectedCourseIds.length} courses selected</strong><span>{editingGroup.lgaName}, {editingGroup.stateName}</span></div>
        <div class="tools"><input type="search" bind:value={courseSearch} placeholder="Search course or alias…" aria-label="Search courses" /><select bind:value={categoryFilter} aria-label="Filter discipline"><option value="all">All disciplines</option>{#each categories as category}<option value={category}>{category.replaceAll('_',' ')}</option>{/each}</select></div>
        <div class="quick-actions"><button type="button" onclick={() => (selectedCourseIds = [...new Set([...selectedCourseIds, ...visibleCourses.map((course) => course.id)])])} disabled={!visibleCourses.length}>Select visible</button><button type="button" onclick={() => (selectedCourseIds = selectedCourseIds.filter((id) => !visibleCourses.some((course) => course.id === id)))} disabled={!visibleCourses.some((course) => selectedCourseIds.includes(course.id))}>Clear visible</button></div>
        <div class="options">
          {#each visibleCourses as course (course.id)}
            <label><input type="checkbox" checked={selectedCourseIds.includes(course.id)} onchange={(event) => toggleCourse(course.id, event.currentTarget.checked)} /><span><strong>{course.name}</strong><small>{course.disciplineCategory.replaceAll('_',' ')}</small></span></label>
          {/each}
          {#if visibleCourses.length === 0}<div class="empty">No courses match your search.</div>{/if}
        </div>
        <div class="actions"><button class="secondary-button" type="button" onclick={() => (mappingOpen = false)} disabled={saving}>Cancel</button><button class="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save course mapping'}</button></div>
      </form>
    </section>
  </div>
{/if}

<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#f4f7f5;color:#17251c;font-family:Inter,Arial,sans-serif}:global(button),:global(input),:global(select){font:inherit}
  .workspace{min-height:100vh}.topbar{min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px clamp(16px,4vw,42px);background:#fff;border-bottom:1px solid #e5ebe6}.brand{display:flex;align-items:center;gap:10px}.brand-icon{width:36px;height:36px;display:grid;place-items:center;border-radius:8px;background:#0a5c37;color:#fff;font-size:18px;font-weight:800}.brand strong,.brand small{display:block}.brand strong{color:#0a5c37;font-size:12px}.brand small{margin-top:4px;color:#819087;font-size:9px}.account{display:flex;align-items:center;gap:14px}.account>div:nth-child(2) strong,.account>div:nth-child(2) small{display:block}.account>div:nth-child(2) strong{font-size:10px}.account>div:nth-child(2) small{margin-top:4px;color:#819087;font-size:9px}.nav-link{color:#0a6841;font-size:10px;font-weight:700;text-decoration:none}
  .content{max-width:1080px;margin:0 auto;padding:34px 24px}.eyebrow{color:#0a8050;font-size:9px;font-weight:800;letter-spacing:1.2px}h1{margin:8px 0;font-size:26px}.intro{max-width:750px;margin:0 0 24px;color:#718078;font-size:12px;line-height:1.7}
  .mapping-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.mapping-card{padding:20px;border:1px solid #e3ebe5;border-radius:11px;background:#fff}.card-top{display:flex;align-items:center;justify-content:space-between}.group-code{padding:6px 8px;border-radius:6px;background:#edf6ef;color:#0a6841;font-size:9px;font-weight:800}.status{padding:5px 8px;border-radius:14px;background:#e8f5ec;color:#0a6841;font-size:8px;font-weight:800}.status.inactive{background:#f0f2f0;color:#6a776e}.mapping-card h2{margin:14px 0 5px;font-size:15px;color:#1c3928}.mapping-card>p{margin:0;color:#819087;font-size:10px}.course-list{display:flex;flex-wrap:wrap;gap:6px;min-height:40px;margin:17px 0}.course-chip{padding:6px 8px;border:1px solid #e0ece2;border-radius:6px;background:#f7fbf7;color:#3d6048;font-size:9px}.unmapped{color:#9b6a38;font-size:10px;font-style:italic}.card-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:13px;border-top:1px solid #edf1ed}.card-footer>span{color:#819087;font-size:9px}.primary-button,.secondary-button{min-height:36px;padding:8px 12px;border-radius:7px;font-size:9px;font-weight:700;cursor:pointer}.primary-button{border:1px solid #0a5c37;background:#0a5c37;color:#fff}.primary-button:disabled{opacity:.45;cursor:not-allowed}.secondary-button{border:1px solid #dce5de;background:#fff;color:#355442}
  .notice{display:grid;gap:6px;padding:15px 17px;margin-top:18px;border-radius:9px;background:#eaf4ed}.notice strong{color:#245c3c;font-size:10px}.notice span{color:#718078;font-size:10px;line-height:1.6}.empty{padding:42px 18px;text-align:center;border:1px solid #e3ebe5;border-radius:11px;background:#fff}.empty h2{margin:8px 0;color:#203b2b;font-size:15px}.empty p{max-width:500px;margin:0 auto;color:#819087;font-size:11px;line-height:1.6}.empty-icon{color:#0a8050;font-size:26px}.message{padding:10px 13px;margin:0 0 12px;border-radius:7px;font-size:10px}.message.error{border:1px solid #efceca;background:#fff3f2;color:#a32920}.message.success{border:1px solid #cce6d3;background:#eef8f0;color:#16633b}
  .modal-layer{position:fixed;inset:0;z-index:80;display:grid;place-items:center;overflow-y:auto;padding:20px}.scrim{position:fixed;inset:0;border:0;background:#071b10a8}.modal{position:relative;width:min(100%,700px);max-height:92vh;overflow-y:auto;padding:22px;border-radius:12px;background:#fff;box-shadow:0 22px 70px #071e1250}.modal-header{display:flex;justify-content:space-between;gap:14px;padding-bottom:14px;border-bottom:1px solid #edf1ed}.modal-header h2{margin:7px 0 4px;font-size:17px}.modal-header p{margin:0;color:#819087;font-size:10px}.close{width:32px;height:32px;border:1px solid #e0e8e1;border-radius:7px;background:#fff;color:#44554a;font-size:20px;cursor:pointer}.summary{display:flex;justify-content:space-between;gap:12px;padding:13px 0;color:#53665a;font-size:10px}.summary span{color:#819087}.tools{display:grid;grid-template-columns:1.4fr 1fr;gap:9px}.tools input,.tools select{width:100%;min-height:38px;padding:8px 10px;border:1px solid #dce5de;border-radius:7px;background:#fff;font-size:10px}.quick-actions{display:flex;justify-content:space-between;padding:9px 0}.quick-actions button{border:0;background:transparent;color:#0a6841;font-size:9px;font-weight:700;cursor:pointer}.quick-actions button:disabled{opacity:.4;cursor:not-allowed}.options{max-height:390px;overflow:auto;border:1px solid #e6ede7;border-radius:8px}.options label{display:flex;align-items:flex-start;gap:10px;padding:11px;border-bottom:1px solid #edf1ed;cursor:pointer}.options label:last-child{border-bottom:0}.options input{margin-top:2px;accent-color:#0a6841}.options label span{display:grid;gap:4px}.options strong{color:#263d30;font-size:10px}.options small{color:#819087;font-size:8px}.actions{display:flex;justify-content:flex-end;gap:8px;padding-top:14px;margin-top:14px;border-top:1px solid #edf1ed}
  @media(max-width:760px){.content{padding:24px 14px}.mapping-list{grid-template-columns:1fr}.account>div:nth-child(2){display:none}.account{gap:8px}.nav-link{font-size:9px}.tools{grid-template-columns:1fr}.modal-layer{padding:10px}.modal{max-height:96vh;padding:17px}.actions{flex-direction:column-reverse}.actions button{width:100%}}
</style>