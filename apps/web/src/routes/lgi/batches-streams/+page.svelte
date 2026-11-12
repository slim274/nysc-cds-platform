<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import LgiSidebar from '#lib/components/LgiSidebar.svelte';

  import {
    ApiError,
    getCurrentUser,
    logout,
    listNyscCohorts,
    createServiceYear,
    updateServiceYear,
    createNyscBatch,
    updateNyscBatch,
    createNyscStream,
    updateNyscStream
  } from '#lib/api/client.ts';

  import type {
    AuthUser,
    NyscServiceYearRecord,
    NyscBatchRecord,
    NyscStreamRecord
  } from '#lib/api/client.ts';

  type FormMode = 'service-year' | 'batch' | 'stream';
  type FormRecord = NyscServiceYearRecord | NyscBatchRecord | NyscStreamRecord;

  let currentUser = $state<AuthUser | null>(null);
  let years = $state<NyscServiceYearRecord[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let signingOut = $state(false);
  let mobileNavOpen = $state(false);
  let formOpen = $state(false);
  let formMode = $state<FormMode>('service-year');
  let editingRecord = $state<FormRecord | null>(null);
  let parentServiceYearId = $state('');
  let parentBatchId = $state('');
  let errorMessage = $state('');
  let formError = $state('');
  let noticeMessage = $state('');
  let search = $state('');
  let statusFilter = $state<'all' | 'active' | 'inactive'>('all');

  let form = $state({
    year: new Date().getFullYear(),
    startDate: '',
    endDate: '',
    code: '',
    name: '',
    isActive: true
  });

  const totalBatches = $derived(years.reduce((sum, year) => sum + year.batches.length, 0));
  const totalStreams = $derived(years.reduce((sum, year) => sum + year.batches.reduce((batchSum, batch) => batchSum + batch.streams.length, 0), 0));
  const totalMembers = $derived(years.reduce((sum, year) => sum + year.memberCount, 0));
  const activeYears = $derived(years.filter((year) => year.isActive).length);
  const activeBatches = $derived(years.reduce((sum, year) => sum + year.batches.filter((batch) => year.isActive && batch.isActive).length, 0));
  const activeStreams = $derived(years.reduce((sum, year) => sum + year.batches.reduce((batchSum, batch) => batchSum + batch.streams.filter((stream) => year.isActive && batch.isActive && stream.isActive).length, 0), 0));

  const visibleYears = $derived(years.filter((year) => {
    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'active' ? year.isActive : !year.isActive);
    const query = search.trim().toLowerCase();
    const matchesSearch = !query ||
      String(year.year).includes(query) ||
      year.batches.some((batch) =>
        batch.code.toLowerCase().includes(query) ||
        batch.name.toLowerCase().includes(query) ||
        batch.streams.some((stream) =>
          stream.code.toLowerCase().includes(query) ||
          stream.name.toLowerCase().includes(query)
        )
      );
    return matchesStatus && matchesSearch;
  }));

  onMount(() => {
    void loadPage();
  });

  async function loadPage() {
    loading = true;
    errorMessage = '';
    try {
      const session = await getCurrentUser();
      if (!session.roles.some((role) => role.code === 'LGI_ADMIN' && role.lgaId !== null)) {
        errorMessage = 'An active LGA administrator assignment is required.';
        return;
      }
      currentUser = session.user;
      await loadCohorts();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load batches and streams.';
    } finally {
      loading = false;
    }
  }

  async function loadCohorts() {
    years = await listNyscCohorts();
  }

  function openCreateYear() {
    formMode = 'service-year';
    editingRecord = null;
    parentServiceYearId = '';
    parentBatchId = '';
    form = { year: new Date().getFullYear(), startDate: '', endDate: '', code: '', name: '', isActive: true };
    formError = '';
    formOpen = true;
  }

  function openEditYear(year: NyscServiceYearRecord) {
    formMode = 'service-year';
    editingRecord = year;
    parentServiceYearId = '';
    parentBatchId = '';
    form = { year: year.year, startDate: year.startDate ?? '', endDate: year.endDate ?? '', code: '', name: '', isActive: year.isActive };
    formError = '';
    formOpen = true;
  }

  function openCreateBatch(year: NyscServiceYearRecord) {
    formMode = 'batch';
    editingRecord = null;
    parentServiceYearId = year.id;
    parentBatchId = '';
    form = { year: year.year, startDate: '', endDate: '', code: '', name: '', isActive: true };
    formError = '';
    formOpen = true;
  }

  function openEditBatch(batch: NyscBatchRecord, year: NyscServiceYearRecord) {
    formMode = 'batch';
    editingRecord = batch;
    parentServiceYearId = year.id;
    parentBatchId = '';
    form = { year: year.year, startDate: '', endDate: '', code: batch.code, name: batch.name, isActive: batch.isActive };
    formError = '';
    formOpen = true;
  }

  function openCreateStream(batch: NyscBatchRecord) {
    formMode = 'stream';
    editingRecord = null;
    parentBatchId = batch.id;
    parentServiceYearId = batch.serviceYearId;
    form = { year: 0, startDate: '', endDate: '', code: '', name: '', isActive: true };
    formError = '';
    formOpen = true;
  }

  function openEditStream(stream: NyscStreamRecord, batch: NyscBatchRecord) {
    formMode = 'stream';
    editingRecord = stream;
    parentBatchId = batch.id;
    parentServiceYearId = batch.serviceYearId;
    form = { year: 0, startDate: '', endDate: '', code: stream.code, name: stream.name, isActive: stream.isActive };
    formError = '';
    formOpen = true;
  }

  async function saveRecord(event: SubmitEvent) {
    event.preventDefault();
    formError = '';
    saving = true;
    try {
      if (formMode === 'service-year') {
        if (editingRecord) {
          await updateServiceYear(editingRecord.id, {
            year: Number(form.year),
            startDate: form.startDate || null,
            endDate: form.endDate || null,
            isActive: form.isActive
          });
          noticeMessage = 'Service year updated.';
        } else {
          await createServiceYear({
            year: Number(form.year),
            startDate: form.startDate || null,
            endDate: form.endDate || null,
            isActive: form.isActive
          });
          noticeMessage = 'Service year created.';
        }
      } else if (formMode === 'batch') {
        if (editingRecord) {
          await updateNyscBatch(editingRecord.id, { code: form.code, name: form.name, isActive: form.isActive });
          noticeMessage = 'Batch updated.';
        } else {
          await createNyscBatch(parentServiceYearId, { code: form.code, name: form.name, isActive: form.isActive });
          noticeMessage = 'Batch created.';
        }
      } else {
        if (editingRecord) {
          await updateNyscStream(editingRecord.id, { code: form.code, name: form.name, isActive: form.isActive });
          noticeMessage = 'Stream updated.';
        } else {
          await createNyscStream(parentBatchId, { code: form.code, name: form.name, isActive: form.isActive });
          noticeMessage = 'Stream created.';
        }
      }
      formOpen = false;
      await loadCohorts();
    } catch (error) {
      formError = error instanceof Error ? error.message : 'Unable to save this record.';
    } finally {
      saving = false;
    }
  }

  async function toggleServiceYear(year: NyscServiceYearRecord) {
    const warning = year.isActive
      ? `Deactivating ${year.year} removes its active streams from new Corps Member intake. ${year.memberCount} existing member record(s) will remain intact. Continue?`
      : `Activating ${year.year} makes its active batches and streams available for new Corps Member intake. Continue?`;
    if (!window.confirm(warning)) return;
    try {
      await updateServiceYear(year.id, { isActive: !year.isActive });
      noticeMessage = `Service year ${year.year} ${year.isActive ? 'deactivated' : 'activated'}.`;
      await loadCohorts();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to update service year.';
    }
  }

  async function toggleBatch(batch: NyscBatchRecord) {
    const warning = batch.isActive
      ? `Deactivating ${batch.name} removes its active streams from new intake. ${batch.memberCount} existing member record(s) stay assigned. Continue?`
      : `Activating ${batch.name} makes its active streams available for new intake, provided the service year is active. Continue?`;
    if (!window.confirm(warning)) return;
    try {
      await updateNyscBatch(batch.id, { isActive: !batch.isActive });
      noticeMessage = `${batch.name} ${batch.isActive ? 'deactivated' : 'activated'}.`;
      await loadCohorts();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to update batch.';
    }
  }

  async function toggleStream(stream: NyscStreamRecord) {
    const warning = stream.isActive
      ? `Deactivating ${stream.name} prevents new Corps Members from being added to it. ${stream.memberCount} existing member record(s) remain intact. Continue?`
      : `Activating ${stream.name} makes it available for new Corps Member intake if its batch and service year are also active. Continue?`;
    if (!window.confirm(warning)) return;
    try {
      await updateNyscStream(stream.id, { isActive: !stream.isActive });
      noticeMessage = `${stream.name} ${stream.isActive ? 'deactivated' : 'activated'}.`;
      await loadCohorts();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to update stream.';
    }
  }

  async function handleLogout() {
    signingOut = true;
    try { await logout(); } catch (error) { console.error('Logout failed:', error); }
    finally { await goto('/login'); }
  }

  function closeMobileNavigation() { mobileNavOpen = false; }
  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { formOpen = false; closeMobileNavigation(); }
  }
</script>

<svelte:head>
  <title>Batches &amp; Streams | NYSC CDS Platform</title>
  <meta name="description" content="Manage NYSC service years, batches and streams." />
</svelte:head>
<svelte:window onkeydown={handleWindowKeydown} />

{#if loading}
  <main class="state-screen"><div class="loader"></div><p>Loading NYSC service years, batches and streams...</p></main>
{:else if !currentUser}
  <main class="state-screen"><h2>Batches &amp; Streams unavailable</h2><p>{errorMessage}</p><button class="primary-button" onclick={() => goto('/login')}>Return to login</button></main>
{:else}
  <div class="admin-shell">
    <LgiSidebar activePath="/lgi/batches-streams" open={mobileNavOpen} signingOut={signingOut} onClose={closeMobileNavigation} onSignOut={handleLogout} />
    <section class="main-area">
      <header class="topbar">
        <div class="topbar-heading">
          <button class="menu-button" type="button" aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileNavOpen} aria-controls="lgi-sidebar" onclick={() => (mobileNavOpen = !mobileNavOpen)}>
            <span></span><span></span><span></span>
          </button>
          <div><span class="breadcrumb">Administration / NYSC Structure</span><h1>Batches &amp; Streams</h1></div>
        </div>
        <div class="account"><div class="avatar">LG</div><div class="account-copy"><strong>LGI Administrator</strong><span>{currentUser.email}</span></div></div>
      </header>
      <main class="page-content">
        {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}
        {#if noticeMessage}<div class="message success" role="status">{noticeMessage}</div>{/if}
        <section class="intro">
          <div><span class="eyebrow">NYSC SERVICE STRUCTURE</span><h2>Manage service years, batches and streams</h2><p>Create the NYSC cohort structure used when preloading Corps Members and importing member records. These records are shared across LGAs. CDS groups can contain members from different batches and streams within the same LGA.</p></div>
          <button class="primary-button" type="button" onclick={openCreateYear}>＋ Add service year</button>
        </section>
        <section class="stats-grid" aria-label="Batch and stream summary">
          <article class="stat-card"><span>Service years</span><strong>{years.length}</strong><small>{activeYears} active for intake</small></article>
          <article class="stat-card"><span>Batches</span><strong>{totalBatches}</strong><small>{activeBatches} available for intake</small></article>
          <article class="stat-card"><span>Streams</span><strong>{totalStreams}</strong><small>{activeStreams} available for intake</small></article>
          <article class="stat-card"><span>Corps Members</span><strong>{totalMembers}</strong><small>Across all listed cohorts</small></article>
        </section>
        <section class="cohorts-panel">
          <div class="panel-heading"><div><h3>NYSC cohort records</h3><p>Deactivate records to close them for new intake. Existing Corps Member records are preserved.</p></div></div>
          <form class="filters" onsubmit={(event) => event.preventDefault()}>
            <label><span>Search</span><input bind:value={search} placeholder="Service year, batch or stream..." /></label>
            <label><span>Service year status</span><select bind:value={statusFilter}><option value="all">All years</option><option value="active">Active years</option><option value="inactive">Inactive years</option></select></label>
          </form>
          {#if visibleYears.length === 0}
            <div class="empty-state">No service years match your filters. Add a service year to begin.</div>
          {:else}
            <div class="year-list">
              {#each visibleYears as year (year.id)}
                <article class="year-card">
                  <header class="year-header">
                    <div class="year-title"><span class="year-mark">SY</span><div><h3>{year.year}</h3><p>{year.startDate ?? 'Start date not set'}{year.endDate ? ` – ${year.endDate}` : ''} · {year.memberCount} Corps Member(s)</p></div><span class:status-inactive={!year.isActive} class="status-badge">{year.isActive ? 'Active for intake' : 'Historical / inactive'}</span></div>
                    <div class="record-actions">
                      <button class="small-button" type="button" onclick={() => openCreateBatch(year)}>＋ Add batch</button>
                      <button class="small-button" type="button" onclick={() => openEditYear(year)}>Edit year</button>
                      <button class:deactivate-button={year.isActive} class="small-button" type="button" onclick={() => void toggleServiceYear(year)}>{year.isActive ? 'Deactivate' : 'Activate'}</button>
                    </div>
                  </header>
                  {#if year.batches.length === 0}
                    <div class="empty-nested">No batches created for this service year yet.</div>
                  {:else}
                    <div class="batch-list">
                      {#each year.batches as batch (batch.id)}
                        <section class="batch-card">
                          <header class="batch-header">
                            <div><strong>{batch.name}</strong><span class="code-pill">{batch.code}</span><span class:status-inactive={!batch.isActive || !year.isActive} class="status-badge">{!year.isActive ? 'Parent year inactive' : batch.isActive ? 'Active' : 'Inactive'}</span><small>{batch.memberCount} member(s) · {batch.streams.length} stream(s)</small></div>
                            <div class="record-actions">
                              <button class="small-button" type="button" onclick={() => openCreateStream(batch)}>＋ Add stream</button>
                              <button class="small-button" type="button" onclick={() => openEditBatch(batch, year)}>Edit batch</button>
                              <button class:deactivate-button={batch.isActive} class="small-button" type="button" onclick={() => void toggleBatch(batch)}>{batch.isActive ? 'Deactivate' : 'Activate'}</button>
                            </div>
                          </header>
                          {#if batch.streams.length === 0}
                            <div class="empty-nested">No streams created for this batch yet.</div>
                          {:else}
                            <div class="stream-list">
                              {#each batch.streams as stream (stream.id)}
                                <article class="stream-card">
                                  <div class="stream-info"><span class="stream-mark">S</span><div><strong>{stream.name}</strong><small>{stream.code} · {stream.memberCount} member(s)</small></div><span class:status-inactive={!stream.isActive || !batch.isActive || !year.isActive} class="status-badge">{!year.isActive || !batch.isActive ? 'Parent inactive' : stream.isActive ? 'Active' : 'Inactive'}</span></div>
                                  <div class="record-actions">
                                    <button class="small-button" type="button" onclick={() => openEditStream(stream, batch)}>Edit</button>
                                    <button class:deactivate-button={stream.isActive} class="small-button" type="button" onclick={() => void toggleStream(stream)}>{stream.isActive ? 'Deactivate' : 'Activate'}</button>
                                  </div>
                                </article>
                              {/each}
                            </div>
                          {/if}
                        </section>
                      {/each}
                    </div>
                  {/if}
                </article>
              {/each}
            </div>
          {/if}
        </section>
        <section class="info-note"><strong>Important:</strong> Service years, batches and streams are shared reference records. Deactivation only prevents new Corps Member intake through that record. Existing members keep their original cohort, CDS placement and historical records. Do not delete a cohort that has member history.</section>
      </main>
      <footer>NYSC CDS Management Platform · Version 0.1.0</footer>
    </section>
  </div>
{/if}

{#if formOpen}
  <div class="modal-layer">
    <button class="modal-scrim" type="button" aria-label="Close cohort form" onclick={() => (formOpen = false)}></button>
    <section class="form-modal" role="dialog" aria-modal="true" aria-labelledby="cohort-form-title">
      <header class="modal-header"><div><span class="eyebrow">NYSC STRUCTURE</span><h2 id="cohort-form-title">{editingRecord ? 'Update' : 'Create'} {formMode === 'service-year' ? 'service year' : formMode === 'batch' ? 'batch' : 'stream'}</h2><p>{formMode === 'service-year' ? 'Service years contain batches.' : formMode === 'batch' ? 'Batches belong to a service year.' : 'Streams belong to a batch.'}</p></div><button class="modal-close" type="button" aria-label="Close form" onclick={() => (formOpen = false)}>×</button></header>
      {#if formError}<div class="message error" role="alert">{formError}</div>{/if}
      <form class="form-grid" onsubmit={saveRecord}>
        {#if formMode === 'service-year'}
          <label><span>Service year *</span><input type="number" bind:value={form.year} min="2000" max="2200" required /></label>
          <div class="form-row"><label><span>Start date</span><input type="date" bind:value={form.startDate} /></label><label><span>End date</span><input type="date" bind:value={form.endDate} /></label></div>
        {:else}
          <label><span>{formMode === 'batch' ? 'Batch code *' : 'Stream code *'}</span><input bind:value={form.code} maxlength={formMode === 'batch' ? 5 : 10} placeholder={formMode === 'batch' ? 'A' : 'I'} required /></label>
          <label><span>{formMode === 'batch' ? 'Batch name *' : 'Stream name *'}</span><input bind:value={form.name} maxlength="30" placeholder={formMode === 'batch' ? 'Batch A' : 'Stream I'} required /></label>
        {/if}
        <label class="active-toggle"><input type="checkbox" bind:checked={form.isActive} /><span><strong>Available for new intake</strong><small>Deactivation preserves existing member records and their service history. A stream is only available when its batch and service year are also active.</small></span></label>
        <div class="modal-actions"><button class="secondary-button" type="button" onclick={() => (formOpen = false)} disabled={saving}>Cancel</button><button class="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></div>
      </form>
    </section>
  </div>
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; overflow-x: hidden; background: #f4f7f4; color: #1b2b20; font-family: Inter, Arial, sans-serif; }
  .admin-shell { display: flex; min-height: 100vh; }
  .main-area {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    padding-top: 82px;
  }
  /* This page's header is fixed to the viewport because its legacy flex shell
     does not keep sticky positioning consistent across browser scroll modes. */
  .topbar {
    position: fixed !important;
    top: 0 !important;
    left: 255px !important;
    right: 0 !important;
    z-index: 1501 !important;
    min-height: 82px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    padding: 14px 32px;
    border-bottom: 1px solid #e7ece8;
    background: #fff;
  }
  .topbar-heading { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .breadcrumb { color: #849188; font-size: 10px; }
  .topbar h1 { margin: 5px 0 0; font-size: 20px; }
  .menu-button { display: none; width: 40px; height: 40px; place-content: center; gap: 4px; border: 1px solid #e0e8e1; border-radius: 8px; background: #fff; cursor: pointer; }
  .menu-button span { display: block; width: 17px; height: 2px; border-radius: 2px; background: #0a5c37; }
  .account { display: flex; align-items: center; gap: 10px; }
  .avatar { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; background: #e6f1e9; color: #0a5c37; font-size: 11px; font-weight: 800; }
  .account-copy strong, .account-copy span { display: block; }
  .account-copy strong { font-size: 11px; }
  .account-copy span { margin-top: 4px; color: #849188; font-size: 10px; }
  .page-content { width: 100%; max-width: 1320px; margin: 0 auto; padding: 28px 32px 38px; }
  .intro { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 20px; padding: 25px; border: 1px solid #dcebe0; border-radius: 12px; background: #eaf4ed; }
  .eyebrow { color: #0a8050; font-size: 9px; font-weight: 800; letter-spacing: 1.5px; }
  .intro h2 { margin: 8px 0 7px; font-size: 22px; }
  .intro p { max-width: 820px; margin: 0; color: #66766b; font-size: 11px; line-height: 1.7; }
  .primary-button, .secondary-button { min-height: 40px; padding: 10px 14px; border-radius: 8px; font-size: 10px; font-weight: 700; cursor: pointer; }
  .primary-button { border: 1px solid #075d38; background: #075d38; color: #fff; }
  .primary-button:hover:not(:disabled) { background: #064c2e; }
  .secondary-button { border: 1px solid #d6e2d8; background: #fff; color: #315340; }
  button:disabled { opacity: .55; cursor: wait; }
  .message { padding: 11px 13px; margin-bottom: 13px; border-radius: 8px; font-size: 10px; line-height: 1.55; }
  .message.error { border: 1px solid #f0cccc; background: #fff3f3; color: #a02e2e; }
  .message.success { border: 1px solid #cfe7d5; background: #eef8f0; color: #17623b; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 13px; margin-bottom: 19px; }
  .stat-card { padding: 16px 18px; border: 1px solid #e5ebe6; border-radius: 10px; background: #fff; }
  .stat-card span, .stat-card small { display: block; color: #7d8a81; font-size: 9px; }
  .stat-card strong { display: block; margin: 8px 0 5px; color: #123c26; font-size: 23px; }
  .cohorts-panel { padding: 18px; border: 1px solid #e4eae5; border-radius: 12px; background: #fff; }
  .panel-heading { margin-bottom: 14px; }
  .panel-heading h3 { margin: 0 0 4px; font-size: 14px; }
  .panel-heading p { margin: 0; color: #879188; font-size: 10px; line-height: 1.5; }
  .filters { display: grid; grid-template-columns: minmax(240px,1fr) minmax(180px,.55fr); gap: 10px; padding: 12px; margin-bottom: 15px; border: 1px solid #e8eee9; border-radius: 9px; background: #f8faf8; }
  .filters label, .form-grid label { display: grid; gap: 6px; color: #53645a; font-size: 10px; font-weight: 700; }
  .filters input, .filters select, .form-grid input { width: 100%; min-width: 0; min-height: 40px; padding: 9px 11px; border: 1px solid #dce5de; border-radius: 7px; background: #fff; color: #263c2e; font: inherit; }
  .year-list { display: grid; gap: 14px; }
  .year-card { overflow: hidden; border: 1px solid #e3ebe5; border-radius: 11px; background: #fff; }
  .year-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px; background: #f8fbf8; border-bottom: 1px solid #edf1ed; }
  .year-title { display: flex; align-items: center; flex-wrap: wrap; gap: 11px; min-width: 0; }
  .year-mark, .stream-mark { width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; border-radius: 8px; background: #e8f3eb; color: #0a6841; font-size: 10px; font-weight: 900; }
  .year-title h3 { margin: 0 0 4px; color: #173e29; font-size: 15px; }
  .year-title p { margin: 0; color: #849188; font-size: 9px; }
  .status-badge { display: inline-flex; align-items: center; padding: 5px 8px; border-radius: 20px; background: #e8f5ec; color: #087443; font-size: 8px; font-weight: 800; white-space: nowrap; }
  .status-badge.status-inactive { background: #f0f2f0; color: #738078; }
  .record-actions { display: flex; flex-wrap: wrap; gap: 7px; }
  .small-button { min-height: 32px; padding: 7px 9px; border: 1px solid #d9e5dc; border-radius: 7px; background: #fff; color: #315540; font-size: 9px; font-weight: 700; cursor: pointer; }
  .small-button:hover { border-color: #8bb99b; background: #f4faf5; }
  .small-button.deactivate-button { border-color: #eed0cc; color: #9b4138; }
  .batch-list { display: grid; gap: 11px; padding: 14px; }
  .batch-card { overflow: hidden; border: 1px solid #e7ece8; border-radius: 9px; }
  .batch-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 13px; background: #fff; }
  .batch-header > div:first-child { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
  .batch-header > div:first-child > strong { color: #254b34; font-size: 11px; }
  .batch-header small { color: #89948c; font-size: 9px; }
  .code-pill { padding: 4px 7px; border-radius: 5px; background: #eef5ef; color: #0a6841; font-size: 8px; font-weight: 800; }
  .stream-list { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 9px; padding: 11px; border-top: 1px solid #edf1ed; background: #fbfcfb; }
  .stream-card { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid #e6ede7; border-radius: 8px; background: #fff; }
  .stream-info { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
  .stream-info > div { display: grid; gap: 3px; min-width: 0; }
  .stream-info strong { color: #284c36; font-size: 10px; }
  .stream-info small { color: #89948c; font-size: 8px; }
  .empty-nested, .empty-state { padding: 20px; color: #829087; font-size: 10px; text-align: center; }
  .info-note { margin-top: 15px; padding: 13px 15px; border: 1px solid #dcebe0; border-radius: 9px; background: #eef7f0; color: #536b5b; font-size: 9px; line-height: 1.6; }
  .info-note strong { color: #1f6840; }
  .modal-layer { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; overflow-y: auto; padding: 20px; }
  .modal-scrim { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; background: #10251980; cursor: pointer; }
  .form-modal { position: relative; z-index: 1; width: min(100%, 520px); max-height: min(92vh, 820px); overflow-y: auto; padding: 22px; border-radius: 13px; background: #fff; box-shadow: 0 22px 70px #071e1250; }
  .modal-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
  .modal-header h2 { margin: 6px 0 4px; color: #1d3426; font-size: 18px; }
  .modal-header p { margin: 0; color: #77847b; font-size: 10px; line-height: 1.5; }
  .modal-close { width: 32px; height: 32px; flex: 0 0 32px; border: 1px solid #e0e8e1; border-radius: 7px; background: #fff; color: #44554a; font-size: 22px; cursor: pointer; }
  .form-grid { display: grid; gap: 13px; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .active-toggle { display: flex !important; align-items: flex-start; gap: 9px !important; padding: 11px; border: 1px solid #dce9df; border-radius: 8px; background: #f7faf7; }
  .active-toggle input { width: 15px; min-height: 15px; margin: 2px 0 0; accent-color: #0a6841; }
  .active-toggle span { display: grid; gap: 4px; }
  .active-toggle strong { color: #274d36; font-size: 10px; }
  .active-toggle small { color: #819087; font-size: 9px; font-weight: 400; line-height: 1.4; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 9px; padding-top: 13px; border-top: 1px solid #edf1ed; }
  .state-screen { min-height: 100vh; display: grid; place-content: center; justify-items: center; padding: 24px; color: #253a2d; }
  .state-screen p { color: #758179; font-size: 12px; }
  .loader { width: 26px; height: 26px; border: 3px solid #dce9df; border-top-color: #0a6841; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  footer { padding: 16px 32px; border-top: 1px solid #e8ece8; color: #89948c; font-size: 10px; }
  @media(max-width:1150px) and (min-width:761px){
    .topbar { left: 225px !important; }
    .stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    .year-header,.batch-header{align-items:flex-start;flex-direction:column}
    .record-actions{width:100%}
  }
  @media(max-width:760px){
    .main-area { padding-top: 74px; }
    .topbar {
      left: 0 !important;
      right: 0 !important;
      min-height: 74px;
      padding: 12px 16px;
    }
    .menu-button{display:grid}
    .account-copy{display:none}
    .page-content{padding:22px 16px 30px}
    .intro{flex-direction:column;padding:20px}
    .intro>.primary-button{width:100%}
    .stream-list{grid-template-columns:1fr}
  }
  @media(max-width:480px){.stats-grid{gap:8px}.stat-card{padding:13px}.form-row{grid-template-columns:1fr}.stream-card{align-items:flex-start;flex-direction:column}.record-actions{justify-content:flex-start}}
</style>
