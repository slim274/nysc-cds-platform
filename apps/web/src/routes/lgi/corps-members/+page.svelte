<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import LgiSidebar from '#lib/components/LgiSidebar.svelte';
  import {
    ApiError,
    getCurrentUser,
    getCorpsMember,
    getCorpsMemberReferenceData,
    listCorpsMembers,
    createCorpsMember,
    updateCorpsMember,
    importCorpsMemberCsv,
    downloadCorpsMembersCsv,
    uploadCorpsMemberPhoto,
    logout
  } from '#lib/api/client.ts';
  import type {
    AuthUser,
    CorpsMemberDetail,
    CorpsMemberInput,
    CorpsMemberRecord,
    CorpsMemberReferenceData,
    CorpsProfileStatus
  } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let references = $state<CorpsMemberReferenceData | null>(null);
  let members = $state<CorpsMemberRecord[]>([]);
  let pagination = $state({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  let loading = $state(true);
  let loadingList = $state(false);
  let saving = $state(false);
  let importing = $state(false);
  let exporting = $state(false);
  let selectedPhotoFile = $state<File | null>(null);
  let photoPreviewUrl = $state('');
  let signingOut = $state(false);
  let mobileNavOpen = $state(false);
  let formOpen = $state(false);
  let editingMember = $state<CorpsMemberDetail | null>(null);
  let search = $state('');
  let lgaFilter = $state('all');
  let serviceYearFilter = $state('all');
  let batchFilter = $state('all');
  let streamFilter = $state('all');
  let statusFilter = $state('all');
  let errorMessage = $state('');
  let formError = $state('');
  let noticeMessage = $state('');

  let form = $state({
    stateCode: '',
    callUpNumber: '',
    email: '',
    phone: '',
    firstName: '',
    middleName: '',
    lastName: '',
    dateOfBirth: '',
    gender: '',
    lgaId: '',
    streamId: '',
    institutionId: '',
    courseId: '',
    qualification: '',
    graduationYear: '',
    profileStatus: 'preloaded' as CorpsProfileStatus
  });

  const availableStreamOptions = $derived((references?.streams ?? []).filter((stream) =>
    stream.isActive && stream.batchIsActive && stream.serviceYearIsActive
  ));
  const serviceYearOptions = $derived(
    [...new Set((references?.streams ?? []).map((stream) => stream.serviceYear))].sort((a, b) => b - a)
  );
  const batchOptions = $derived(
    (references?.streams ?? [])
      .filter((stream) => serviceYearFilter === 'all' || stream.serviceYear === Number(serviceYearFilter))
      .filter((stream, index, rows) => rows.findIndex((candidate) => candidate.batchId === stream.batchId) === index)
  );
  const formStreamOptions = $derived([
    ...availableStreamOptions,
    ...((editingMember && references?.streams.some((stream) =>
      stream.id === form.streamId && !(stream.isActive && stream.batchIsActive && stream.serviceYearIsActive)
    ))
      ? [references.streams.find((stream) => stream.id === form.streamId)!]
      : [])
  ]);

  const pageStart = $derived(pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1);
  const pageEnd = $derived(Math.min(pagination.page * pagination.pageSize, pagination.total));

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
      references = await getCorpsMemberReferenceData();
      form.lgaId = references.lgas[0]?.id ?? '';
      await loadMembers(1);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load corps member records.';
    } finally {
      loading = false;
    }
  }

  async function loadMembers(page = pagination.page) {
    loadingList = true;
    errorMessage = '';
    try {
      const result = await listCorpsMembers({
        search: search.trim() || undefined,
        lgaId: lgaFilter === 'all' ? undefined : lgaFilter,
        serviceYear: serviceYearFilter === 'all' ? undefined : Number(serviceYearFilter),
        batchId: batchFilter === 'all' ? undefined : batchFilter,
        streamId: streamFilter === 'all' ? undefined : streamFilter,
        profileStatus: statusFilter === 'all' ? undefined : statusFilter as CorpsProfileStatus,
        page,
        pageSize: pagination.pageSize
      });
      members = result.data;
      pagination = result.pagination;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load corps members.';
    } finally {
      loadingList = false;
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

  function clearSelectedPhoto() {
    if (photoPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(photoPreviewUrl);
    photoPreviewUrl = '';
    selectedPhotoFile = null;
  }

  function selectPhoto(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      formError = 'Choose a JPEG, PNG or WebP image.';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      formError = 'Profile photos must not exceed 5 MB.';
      return;
    }
    clearSelectedPhoto();
    selectedPhotoFile = file;
    photoPreviewUrl = URL.createObjectURL(file);
    formError = '';
  }

  function resetForm() {
    clearSelectedPhoto();
    editingMember = null;
    form = {
      stateCode: '',
      callUpNumber: '',
      email: '',
      phone: '',
      firstName: '',
      middleName: '',
      lastName: '',
      dateOfBirth: '',
      gender: '',
      lgaId: references?.lgas[0]?.id ?? '',
      streamId: availableStreamOptions[0]?.id ?? '',
      institutionId: '',
      courseId: '',
      qualification: '',
      graduationYear: '',
      profileStatus: 'preloaded'
    };
    formError = '';
  }

  function openCreateForm() {
    resetForm();
    formOpen = true;
  }

  async function openEditForm(member: CorpsMemberRecord) {
    formError = '';
    errorMessage = '';
    try {
      const detail = await getCorpsMember(member.id);
      clearSelectedPhoto();
      photoPreviewUrl = detail.hasPassportPhoto ? `/api/lgi/corps-members/${encodeURIComponent(detail.id)}/photo` : '';
      editingMember = detail;
      form = {
        stateCode: detail.stateCode,
        callUpNumber: detail.callUpNumber ?? '',
        email: detail.email ?? '',
        phone: detail.phone ?? '',
        firstName: detail.firstName,
        middleName: detail.middleName ?? '',
        lastName: detail.lastName,
        dateOfBirth: detail.dateOfBirth ?? '',
        gender: detail.gender ?? '',
        lgaId: detail.lgaId,
        streamId: detail.streamId,
        institutionId: detail.institutionId ?? '',
        courseId: detail.courseId ?? '',
        qualification: detail.qualification ?? '',
        graduationYear: detail.graduationYear === null ? '' : String(detail.graduationYear),
        profileStatus: detail.profileStatus
      };
      formOpen = true;
    } catch (error) {
      errorMessage = error instanceof ApiError ? error.message : 'Unable to load this member record.';
    }
  }

  function buildInput(): CorpsMemberInput {
    return {
      stateCode: form.stateCode.trim(),
      callUpNumber: form.callUpNumber.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      firstName: form.firstName.trim(),
      middleName: form.middleName.trim() || null,
      lastName: form.lastName.trim(),
      dateOfBirth: form.dateOfBirth || null,
      gender: form.gender || null,
      lgaId: form.lgaId,
      streamId: form.streamId,
      institutionId: form.institutionId || null,
      courseId: form.courseId || null,
      qualification: form.qualification.trim() || null,
      graduationYear: form.graduationYear ? Number(form.graduationYear) : null,
      profileStatus: form.profileStatus
    };
  }

  async function saveMember(event: SubmitEvent) {
    event.preventDefault();
    formError = '';
    saving = true;
    try {
      const input = buildInput();
      const wasEditing = Boolean(editingMember);
      const savedMember = editingMember
        ? await updateCorpsMember(editingMember.id, input)
        : await createCorpsMember(input);

      noticeMessage = wasEditing
        ? 'Corps member record updated successfully.'
        : 'Corps member record created successfully.';

      if (selectedPhotoFile) {
        try {
          await uploadCorpsMemberPhoto(savedMember.id, selectedPhotoFile);
          noticeMessage += ' Profile photo uploaded.';
        } catch (photoError) {
          const reason = photoError instanceof Error ? photoError.message : 'Photo upload failed.';
          errorMessage = `The member record was saved, but the profile photo could not be uploaded: ${reason}`;
        }
      }

      formOpen = false;
      await loadMembers(wasEditing ? pagination.page : 1);
      resetForm();
    } catch (error) {
      formError = error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unable to save this corps member.';
    } finally {
      saving = false;
    }
  }

  async function handleCsvImport(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      errorMessage = 'Select a CSV file.';
      return;
    }
    if (file.size > 2_000_000) {
      errorMessage = 'CSV files must not exceed 2 MB.';
      return;
    }
    const approved = confirm(
      'Import these corps member records? Rows with a state code already in your assigned LGA(s) will update that member. The entire import will be rejected if any row is invalid.'
    );
    if (!approved) return;

    importing = true;
    errorMessage = '';
    noticeMessage = '';
    try {
      const result = await importCorpsMemberCsv(await file.text());
      noticeMessage = `Import completed: ${result.created} created, ${result.updated} updated (${result.totalProcessed} total).`;
      await loadMembers(1);
    } catch (error) {
      errorMessage = error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Unable to import this CSV file.';
    } finally {
      importing = false;
    }
  }

  async function exportCsv() {
    exporting = true;
    errorMessage = '';
    noticeMessage = '';
    try {
      const blob = await downloadCorpsMembersCsv({
        search: search.trim() || undefined,
        lgaId: lgaFilter === 'all' ? undefined : lgaFilter,
        streamId: streamFilter === 'all' ? undefined : streamFilter,
        profileStatus: statusFilter === 'all' ? undefined : statusFilter as CorpsProfileStatus
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'nysc-corps-members.csv';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      noticeMessage = 'CSV export downloaded.';
    } catch (error) {
      errorMessage = error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Unable to export corps members.';
    } finally {
      exporting = false;
    }
  }

  async function applyFilters(event: SubmitEvent) {
    event.preventDefault();
    noticeMessage = '';
    await loadMembers(1);
  }

  async function clearFilters() {
    search = '';
    lgaFilter = 'all';
    serviceYearFilter = 'all';
    batchFilter = 'all';
    streamFilter = 'all';
    statusFilter = 'all';
    await loadMembers(1);
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

  function fullName(member: CorpsMemberRecord) {
    return [member.firstName, member.middleName, member.lastName].filter(Boolean).join(' ');
  }

  function statusLabel(status: string) {
    return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function streamLabel(stream: CorpsMemberReferenceData['streams'][number]) {
    const available = stream.isActive && stream.batchIsActive && stream.serviceYearIsActive;
    return `${stream.serviceYear} · ${stream.batchName} · ${stream.name}${available ? '' : ' (historical / inactive)'}`;
  }
</script>

<svelte:head>
  <title>Corps Members | NYSC CDS Platform</title>
  <meta name="description" content="Manage corps member records within your assigned LGA(s)." />
</svelte:head>

<svelte:window onkeydown={handleWindowKeydown} />

{#if loading}
  <main class="state-screen"><div class="loader"></div><p>Loading corps member management...</p></main>
{:else if !currentUser}
  <main class="state-screen"><h2>Corps member management unavailable</h2><p>{errorMessage}</p><button class="primary-button" onclick={() => goto('/login')}>Return to login</button></main>
{:else}
  <div class="admin-shell">
    <LgiSidebar activePath="/lgi/corps-members" open={mobileNavOpen} signingOut={signingOut} onClose={closeMobileNavigation} onSignOut={handleLogout} />

    <section class="main-area">
      <header class="topbar">
        <div class="topbar-heading">
          <button class="menu-button" type="button" aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileNavOpen} aria-controls="lgi-sidebar" onclick={() => (mobileNavOpen = !mobileNavOpen)}>
            <span></span><span></span><span></span>
          </button>
          <div><span class="breadcrumb">Administration / People</span><h1>Corps Members</h1></div>
        </div>
        <div class="account"><div class="avatar">LG</div><div class="account-copy"><strong>LGI Administrator</strong><span>{currentUser.email}</span></div></div>
      </header>

      <main class="page-content">
        {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}
        {#if noticeMessage}<div class="message success" role="status">{noticeMessage}</div>{/if}

        <section class="intro">
          <div><span class="eyebrow">CORPS MEMBER RECORDS</span><h2>Manage corps members</h2><p>Create, search and maintain member profiles for the LGA(s) assigned to your administrator account.</p></div>
          <div class="intro-actions">
            <label class="secondary-button upload-button" class:busy={importing}>
              {importing ? 'Importing...' : '↑ Bulk upload CSV'}
              <input type="file" accept=".csv,text/csv" onchange={handleCsvImport} disabled={importing} />
            </label>
            <a class="secondary-button" href="/api/lgi/corps-members/template">Download template</a>
            <button class="secondary-button" type="button" onclick={exportCsv} disabled={exporting || pagination.total === 0}>{exporting ? 'Exporting...' : '↓ Export CSV'}</button>
            <button class="primary-button" type="button" onclick={openCreateForm}>＋ Add corps member</button>
          </div>
        </section>

        <section class="summary-grid" aria-label="Corps member summary">
          <article class="summary-card"><span>Matching records</span><strong>{pagination.total}</strong><small>Based on current filters</small></article>
          <article class="summary-card"><span>Page</span><strong>{pagination.totalPages === 0 ? 0 : pagination.page} / {pagination.totalPages}</strong><small>{pagination.pageSize} records per page</small></article>
        </section>

        <section class="records-panel">
          <div class="panel-heading"><div><h3>Member directory</h3><p>Search by name, state code or call-up number.</p></div><span class="record-count">{pagination.total} records</span></div>

          <form class="filters" onsubmit={applyFilters}>
            <label class="search-field"><span>Search</span><input bind:value={search} placeholder="Name, state code or call-up number" /></label>
            <label><span>LGA</span><select bind:value={lgaFilter}><option value="all">All assigned LGAs</option>{#each (references?.lgas ?? []) as lga}<option value={lga.id}>{lga.name}, {lga.stateName}</option>{/each}</select></label>
            <label><span>Service year</span><select bind:value={serviceYearFilter} onchange={() => { batchFilter = 'all'; streamFilter = 'all'; }}><option value="all">All service years</option>{#each serviceYearOptions as year}<option value={String(year)}>{year}</option>{/each}</select></label>
            <label><span>Batch</span><select bind:value={batchFilter} onchange={() => (streamFilter = 'all')}><option value="all">All batches</option>{#each batchOptions as batch}<option value={batch.batchId}>{batch.serviceYear} · {batch.batchName}</option>{/each}</select></label>
            <label><span>Stream</span><select bind:value={streamFilter}><option value="all">All streams</option>{#each (references?.streams ?? []).filter((stream) => (serviceYearFilter === 'all' || stream.serviceYear === Number(serviceYearFilter)) && (batchFilter === 'all' || stream.batchId === batchFilter)) as stream}<option value={stream.id}>{streamLabel(stream)}</option>{/each}</select></label>
            <label><span>Profile status</span><select bind:value={statusFilter}><option value="all">All statuses</option><option value="preloaded">Preloaded</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>
            <div class="filter-actions"><button class="filter-button" type="submit" disabled={loadingList}>{loadingList ? 'Loading...' : 'Apply filters'}</button><button class="reset-button" type="button" onclick={clearFilters}>Reset</button></div>
          </form>

          {#if loadingList}
            <div class="list-state"><div class="loader"></div><p>Loading records...</p></div>
          {:else if members.length === 0}
            <div class="empty-state"><div class="empty-icon">♙</div><h3>No corps members found</h3><p>Try changing your search or filters, or add your first corps member record.</p><button class="primary-button" type="button" onclick={openCreateForm}>Add corps member</button></div>
          {:else}
            <div class="table-wrap">
              <table>
                <thead><tr><th>Corps member</th><th>State code</th><th>Call-up number</th><th>Contact</th><th>Batch / Stream</th><th>Institution</th><th>Profile status</th><th></th></tr></thead>
                <tbody>
                  {#each members as member (member.id)}
                    <tr>
                      <td><strong>{fullName(member)}</strong><small>{member.lgaName}</small></td>
                      <td>{member.stateCode}</td>
                      <td>{member.callUpNumber || '—'}</td>
                      <td>{#if member.email}<strong>{member.email}</strong>{/if}{#if member.phone}<small>{member.phone}</small>{/if}{#if !member.email && !member.phone}—{/if}</td>
                      <td>{member.serviceYear} · {member.batchCode} · {member.streamCode}</td>
                      <td>{member.institutionName || '—'}<small>{member.courseName || ''}</small></td>
                      <td><span class:approved={member.profileStatus === 'approved'} class:rejected={member.profileStatus === 'rejected'} class="status">{statusLabel(member.profileStatus)}</span></td>
                      <td><button class="text-button" type="button" onclick={() => void openEditForm(member)}>View / Edit</button></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <div class="mobile-member-list">
              {#each members as member (member.id)}
                <article class="member-card">
                  <div class="member-card-heading"><strong>{fullName(member)}</strong><span class:approved={member.profileStatus === 'approved'} class:rejected={member.profileStatus === 'rejected'} class="status">{statusLabel(member.profileStatus)}</span></div>
                  <p>{member.stateCode} · {member.callUpNumber || 'No call-up number'}</p>
                  <small>{member.serviceYear} · {member.batchName} · {member.streamName}</small>
                  {#if member.email}<small>{member.email}</small>{/if}
                  {#if member.phone}<small>{member.phone}</small>{/if}
                  <small>{member.lgaName}</small>
                  <button class="text-button" type="button" onclick={() => void openEditForm(member)}>View / Edit record →</button>
                </article>
              {/each}
            </div>
            <div class="pagination">
              <span>Showing {pageStart}–{pageEnd} of {pagination.total}</span>
              <div><button type="button" class="page-button" onclick={() => void loadMembers(pagination.page - 1)} disabled={pagination.page <= 1 || loadingList}>Previous</button><button type="button" class="page-button" onclick={() => void loadMembers(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages || loadingList}>Next</button></div>
            </div>
          {/if}
        </section>
      </main>
      <footer class="page-footer">NYSC CDS Management Platform · LGI Administration</footer>
    </section>
  </div>
{/if}

{#if formOpen}
  <div class="modal-layer" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) formOpen = false; }}>
    <section class="member-modal" role="dialog" aria-modal="true" aria-labelledby="member-form-title">
      <header class="modal-header"><div><span class="eyebrow">MEMBER RECORD</span><h2 id="member-form-title">{editingMember ? 'View / edit corps member' : 'Add corps member'}</h2><p>Fields marked with * are required.</p></div><button class="modal-close" type="button" aria-label="Close form" onclick={() => (formOpen = false)}>×</button></header>
      {#if formError}<div class="message error" role="alert">{formError}</div>{/if}
      <form class="member-form" onsubmit={saveMember}>
        <div class="form-section-title">NYSC identification</div>
        <div class="form-grid">
          <label><span>State code *</span><input bind:value={form.stateCode} required maxlength="50" placeholder="e.g. AB/26A/001" /></label>
          <label><span>Call-up number</span><input bind:value={form.callUpNumber} maxlength="100" /></label>
          <label><span>First name *</span><input bind:value={form.firstName} required maxlength="100" /></label>
          <label><span>Middle name</span><input bind:value={form.middleName} maxlength="100" /></label>
          <label><span>Last name *</span><input bind:value={form.lastName} required maxlength="100" /></label>
          <label><span>Date of birth</span><input type="date" bind:value={form.dateOfBirth} /></label>
          <label><span>Gender</span><select bind:value={form.gender}><option value="">Not specified</option><option value="Female">Female</option><option value="Male">Male</option><option value="Other">Other</option></select></label>
        </div>

        <div class="form-section-title">Contact details</div>
        <div class="form-grid">
          <label><span>Email address</span><input type="email" bind:value={form.email} maxlength="320" autocomplete="email" placeholder="member@example.com" /></label>
          <label><span>Phone number</span><input type="tel" bind:value={form.phone} maxlength="30" autocomplete="tel" placeholder="+234 801 234 5678" /></label>
        </div>
        <p class="contact-note">These details are managed by the LGI and will be used for OTP verification during account onboarding. Contact ownership is not verified yet.</p>

        <div class="form-section-title">Deployment details</div>
        <div class="form-grid">
          <label><span>Assigned LGA *</span><select bind:value={form.lgaId} required>{#each (references?.lgas ?? []) as lga}<option value={lga.id}>{lga.name}, {lga.stateName}</option>{/each}</select></label>
          <label><span>Service year / Batch / Stream *</span><select bind:value={form.streamId} required><option value="">Select active service year, batch and stream</option>{#each formStreamOptions as stream}<option value={stream.id}>{streamLabel(stream)}</option>{/each}</select>{#if editingMember && formStreamOptions.some((stream) => stream.id === form.streamId && !(stream.isActive && stream.batchIsActive && stream.serviceYearIsActive))}<small class="historical-stream-note">This is the member's existing historical cohort. It is retained for this record but cannot be selected for new intake.</small>{/if}</label>
          <label><span>Institution</span><select bind:value={form.institutionId}><option value="">Select institution</option>{#each (references?.institutions ?? []) as institution}<option value={institution.id}>{institution.name}{institution.abbreviation ? ` (${institution.abbreviation})` : ''}</option>{/each}</select></label>
          <label><span>Course of study</span><select bind:value={form.courseId}><option value="">Select course</option>{#each (references?.courses ?? []) as course}<option value={course.id}>{course.name}</option>{/each}</select></label>
          <label><span>Qualification</span><input bind:value={form.qualification} maxlength="100" placeholder="e.g. B.Sc." /></label>
          <label><span>Graduation year</span><input type="number" min="1950" max="2100" bind:value={form.graduationYear} /></label>
          <label><span>Profile status</span><select bind:value={form.profileStatus}><option value="preloaded">Preloaded</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>
        </div>
        <div class="form-section-title">Profile photograph</div>
        <div class="photo-upload-panel">
          <div class="photo-preview">
            {#if photoPreviewUrl}
              <img src={photoPreviewUrl} alt="Corps member profile photograph preview" />
            {:else}
              <span aria-hidden="true">♙</span>
            {/if}
          </div>
          <div class="photo-upload-copy">
            <label class="secondary-button photo-select-button">
              {selectedPhotoFile ? 'Choose a different photo' : 'Upload profile photo'}
              <input type="file" accept="image/jpeg,image/png,image/webp" onchange={selectPhoto} />
            </label>
            <small>JPEG, PNG or WebP · Maximum 5 MB.</small>
            <small>Profile photograph only. The platform does not perform facial recognition.</small>
            {#if selectedPhotoFile}<small class="selected-file">{selectedPhotoFile.name}</small>{/if}
          </div>
        </div>
        <div class="modal-actions"><button class="cancel-button" type="button" onclick={() => (formOpen = false)}>Cancel</button><button class="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : editingMember ? 'Save changes' : 'Create record'}</button></div>
      </form>
    </section>
  </div>
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #f5f7f5; color: #19251e; font-family: Inter, Arial, sans-serif; }
  button, input, select { font: inherit; }
  .admin-shell { min-height: 100vh; display: flex; }
  .main-area { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .topbar { min-height: 76px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 13px clamp(18px, 3vw, 38px); border-bottom: 1px solid #e5ebe6; background: #fff; }
  .topbar-heading { min-width: 0; display: flex; align-items: center; gap: 12px; }
  .menu-button { display: none; width: 42px; height: 42px; flex: 0 0 42px; place-content: center; gap: 5px; padding: 0; border: 1px solid #e1e9e2; border-radius: 9px; background: #fff; cursor: pointer; }
  .menu-button span { display: block; width: 18px; height: 2px; border-radius: 2px; background: #0a5c37; }
  .breadcrumb { color: #8b978e; font-size: 9px; }
  .topbar h1 { margin: 4px 0 0; font-size: 20px; }
  .account { display: flex; align-items: center; gap: 10px; }
  .avatar { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; background: #e7f2ea; color: #0a5c37; font-size: 10px; font-weight: 800; }
  .account-copy strong, .account-copy span { display: block; }
  .account-copy strong { font-size: 10px; }
  .account-copy span { margin-top: 4px; color: #819087; font-size: 9px; }
  .page-content { width: 100%; max-width: 1500px; margin: 0 auto; padding: 30px clamp(18px, 3vw, 38px); flex: 1; }
  .eyebrow { color: #0a8050; font-size: 9px; font-weight: 700; letter-spacing: 1.4px; }
  .intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 22px; }
  .intro h2 { margin: 8px 0 6px; font-size: clamp(21px, 2vw, 26px); }
  .intro p { max-width: 690px; margin: 0; color: #718078; font-size: 11px; line-height: 1.7; }
  .primary-button { min-height: 40px; padding: 10px 15px; border: 1px solid #0a5c37; border-radius: 8px; background: #0a5c37; color: #fff; font-size: 10px; font-weight: 700; cursor: pointer; }
  .primary-button:hover:not(:disabled) { background: #07482c; }
  .primary-button:disabled { opacity: .6; cursor: wait; }
  .summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; margin-bottom: 20px; }
  .summary-card { padding: 16px 18px; border: 1px solid #e5ebe6; border-radius: 10px; background: #fff; }
  .summary-card span, .summary-card strong, .summary-card small { display: block; }
  .summary-card span { color: #758379; font-size: 10px; }
  .summary-card strong { margin-top: 6px; color: #123d27; font-size: 23px; }
  .summary-card small { margin-top: 4px; color: #9aa49d; font-size: 9px; }
  .records-panel { padding: 20px; border: 1px solid #e5ebe6; border-radius: 12px; background: #fff; }
  .panel-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 17px; }
  .panel-heading h3 { margin: 0 0 5px; font-size: 15px; }
  .panel-heading p { margin: 0; color: #819087; font-size: 10px; }
  .record-count { padding: 6px 10px; border-radius: 18px; background: #edf6ef; color: #16633b; font-size: 9px; font-weight: 700; white-space: nowrap; }
  .filters { display: grid; grid-template-columns: minmax(220px, 1.5fr) repeat(3, minmax(140px, 1fr)) auto; align-items: end; gap: 10px; padding: 14px; margin-bottom: 16px; border: 1px solid #edf1ed; border-radius: 9px; background: #f9fbf9; }
  .filters label, .member-form label { display: grid; gap: 6px; min-width: 0; }
  .filters label span, .member-form label span { color: #56685c; font-size: 9px; font-weight: 700; }
  input, select { width: 100%; min-width: 0; height: 39px; padding: 0 10px; border: 1px solid #dce5de; border-radius: 7px; background: #fff; color: #26392d; font-size: 10px; }
  input:focus, select:focus { outline: 3px solid #0a80501a; border-color: #0a8050; }
  .filter-actions { display: flex; gap: 6px; }
  .filter-button, .reset-button, .page-button, .cancel-button { min-height: 39px; padding: 9px 12px; border: 1px solid #d7e2da; border-radius: 7px; background: #fff; color: #27553b; font-size: 9px; font-weight: 700; cursor: pointer; white-space: nowrap; }
  .filter-button { border-color: #0a5c37; background: #0a5c37; color: #fff; }
  .filter-button:disabled, .page-button:disabled { opacity: .45; cursor: not-allowed; }
  .reset-button:hover, .page-button:hover:not(:disabled) { background: #eff6f1; }
  .table-wrap { width: 100%; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; text-align: left; }
  th { padding: 11px 12px; border-bottom: 1px solid #e8eee9; background: #f8faf8; color: #819087; font-size: 8px; letter-spacing: .5px; text-transform: uppercase; white-space: nowrap; }
  td { padding: 13px 12px; border-bottom: 1px solid #edf1ed; color: #53665a; font-size: 9px; white-space: nowrap; }
  td strong, td small { display: block; }
  td strong { color: #263d30; font-size: 10px; }
  td small { margin-top: 4px; color: #8a968e; font-size: 8px; }
  .status { display: inline-block; padding: 5px 8px; border-radius: 14px; background: #eff3f0; color: #627267; font-size: 8px; font-weight: 700; }
  .status.approved { background: #e8f6ec; color: #147244; }
  .status.rejected { background: #fff0ef; color: #a33b32; }
  .text-button { border: 0; background: transparent; color: #0a6a41; font-size: 9px; font-weight: 700; cursor: pointer; }
  .text-button:hover { text-decoration: underline; }
  .mobile-member-list { display: none; }
  .pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 15px; color: #819087; font-size: 9px; }
  .pagination > div { display: flex; gap: 7px; }
  .page-button { min-height: 34px; }
  .empty-state, .list-state { display: grid; justify-items: center; padding: 42px 16px; text-align: center; }
  .empty-icon { color: #0a8050; font-size: 28px; }
  .empty-state h3 { margin: 9px 0 5px; font-size: 15px; }
  .empty-state p, .list-state p { max-width: 450px; margin: 0 0 15px; color: #819087; font-size: 10px; line-height: 1.7; }
  .message { padding: 11px 13px; margin: 0 0 14px; border-radius: 8px; font-size: 10px; }
  .message.error { border: 1px solid #efceca; background: #fff3f2; color: #a32920; }
  .message.success { border: 1px solid #cce6d3; background: #eef8f0; color: #16633b; }
  .page-footer { padding: 18px 25px; border-top: 1px solid #e5ebe6; color: #89948c; font-size: 9px; text-align: center; }
  .modal-layer { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; overflow-y: auto; padding: 20px; background: #071b10a8; }
  .member-modal { width: min(100%, 800px); max-height: calc(100dvh - 40px); overflow-y: auto; padding: 23px; border-radius: 13px; background: #fff; box-shadow: 0 22px 70px #071b1040; }
  .modal-header { display: flex; justify-content: space-between; gap: 14px; padding-bottom: 16px; border-bottom: 1px solid #edf1ed; }
  .modal-header h2 { margin: 7px 0 4px; font-size: 19px; }
  .modal-header p { margin: 0; color: #819087; font-size: 9px; }
  .modal-close { width: 34px; height: 34px; flex: 0 0 34px; border: 1px solid #e0e8e1; border-radius: 8px; background: #fff; color: #44554a; font-size: 22px; cursor: pointer; }
  .member-form { display: grid; gap: 15px; padding-top: 15px; }
  .form-section-title { padding-bottom: 7px; border-bottom: 1px solid #edf1ed; color: #0a6a41; font-size: 9px; font-weight: 800; letter-spacing: .8px; text-transform: uppercase; }
  .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; }
  .intro-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
  .secondary-button { min-height: 40px; display: inline-flex; align-items: center; justify-content: center; padding: 9px 13px; border: 1px solid #d7e2da; border-radius: 8px; background: #fff; color: #27553b; font-size: 9px; font-weight: 700; text-decoration: none; cursor: pointer; white-space: nowrap; }
  .secondary-button:hover:not(:disabled) { background: #eff6f1; }
  .secondary-button:disabled { opacity: .55; cursor: wait; }
  .upload-button { position: relative; overflow: hidden; }
  .upload-button input, .photo-select-button input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
  .contact-note { margin: -8px 0 0; color: #819087; font-size: 9px; line-height: 1.6; }
  .photo-upload-panel { display: flex; align-items: center; gap: 16px; padding: 14px; border: 1px solid #e6ede7; border-radius: 9px; background: #fafcfa; }
  .photo-preview { width: 92px; height: 92px; flex: 0 0 92px; display: grid; place-items: center; overflow: hidden; border: 1px dashed #cbd9ce; border-radius: 10px; background: #edf5ef; color: #0a8050; font-size: 33px; }
  .photo-preview img { width: 100%; height: 100%; object-fit: cover; }
  .photo-upload-copy { display: grid; justify-items: start; gap: 6px; }
  .photo-upload-copy small { color: #819087; font-size: 9px; line-height: 1.5; }
  .photo-upload-copy .selected-file { color: #17613c; font-weight: 700; }
  .photo-select-button { position: relative; overflow: hidden; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 14px; border-top: 1px solid #edf1ed; }
  .cancel-button { min-width: 100px; }
  .state-screen { min-height: 100vh; display: grid; place-content: center; justify-items: center; gap: 10px; padding: 20px; color: #53665a; font: 13px Inter, Arial, sans-serif; text-align: center; }
  .loader { width: 27px; height: 27px; border: 3px solid #dce8df; border-top-color: #0a8050; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 1150px) { .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .filter-actions { align-self: end; } }
  @media (max-width: 760px) {
    .topbar { min-height: 72px; padding: 11px 14px; }
    .menu-button { display: grid; }
    .topbar h1 { font-size: 18px; }
    .account-copy { display: none; }
    .page-content { padding: 22px 15px; }
    .intro { align-items: flex-start; flex-direction: column; }
    .intro-actions { width: 100%; justify-content: stretch; }\n    .intro-actions > * { flex: 1 1 calc(50% - 8px); }
    .filters { grid-template-columns: 1fr 1fr; }
    .filters .search-field { grid-column: 1 / -1; }
    .filter-actions { grid-column: 1 / -1; }
    .filter-actions button { flex: 1; }
    .records-panel { padding: 15px; }
    .table-wrap { display: none; }
    .mobile-member-list { display: grid; gap: 9px; }
    .member-card { display: grid; gap: 7px; padding: 14px; border: 1px solid #e6ede7; border-radius: 9px; background: #fff; }
    .member-card-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 9px; }
    .member-card-heading strong { color: #263d30; font-size: 11px; }
    .member-card p { margin: 0; color: #53665a; font-size: 9px; }
    .member-card small { color: #819087; font-size: 8px; }
    .member-card .text-button { justify-self: start; padding: 5px 0 0; }
    .modal-layer { place-items: end center; padding: 0; }
    .member-modal { width: 100%; max-height: 94dvh; padding: 19px 16px calc(20px + env(safe-area-inset-bottom)); border-radius: 15px 15px 0 0; }\n    .photo-upload-panel { align-items: flex-start; flex-direction: column; }
  }
  @media (max-width: 480px) {
    .page-content { padding-inline: 12px; }
    .summary-grid { gap: 8px; }
    .summary-card { padding: 13px; }
    .filters { grid-template-columns: 1fr; padding: 11px; }
    .filters .search-field, .filter-actions { grid-column: auto; }
    .panel-heading { align-items: flex-start; }
    .form-grid { grid-template-columns: 1fr; gap: 11px; }
    .modal-actions { flex-direction: column-reverse; }
    .modal-actions button { width: 100%; }
    .pagination { align-items: flex-start; flex-direction: column; }
    .pagination > div { width: 100%; }
    .pagination button { flex: 1; }
  }
  .historical-stream-note { color: #9a5a20; font-size: 9px; font-weight: 500; line-height: 1.5; }
  @media (prefers-reduced-motion: reduce) { .loader { animation-duration: 1.8s; } }
</style>
