<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import LgiSidebar from '#lib/components/LgiSidebar.svelte';
  import {
    ApiError,
    getCurrentUser,
    getCdsGroupReferenceData,
    listCloOfficers,
    createCloOfficer,
    updateCloOfficer,
    logout
  } from '#lib/api/client.ts';
  import type { AuthUser, CloOfficerRecord } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let lgaOptions = $state<Array<{ id: string; name: string; stateName: string }>>([]);
  let officers = $state<CloOfficerRecord[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let signingOut = $state(false);
  let formOpen = $state(false);
  let editingOfficer = $state<CloOfficerRecord | null>(null);
  let email = $state('');
  let selectedLgaIds = $state<string[]>([]);
  let formError = $state('');
  let errorMessage = $state('');
  let noticeMessage = $state('');
  let activationToken = $state('');
  let activationEmail = $state('');
  let search = $state('');
  let statusFilter = $state('all');
  let mobileNavOpen = $state(false);

  const visibleOfficers = $derived(officers.filter((officer) => {
    const matchesSearch = !search.trim() || (officer.email ?? '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'enabled' && officer.isEnabled) ||
      (statusFilter === 'paused' && !officer.isEnabled) ||
      (statusFilter === 'pending_activation' && officer.accountStatus === 'pending_activation');
    return matchesSearch && matchesStatus;
  }));

  onMount(() => { void loadPage(); });

  async function loadPage() {
    loading = true;
    errorMessage = '';
    try {
      const auth = await getCurrentUser();
      const assignedLgaIds = [...new Set(auth.roles.filter((role) => role.code === 'LGI_ADMIN' && role.lgaId).map((role) => role.lgaId as string))];
      if (assignedLgaIds.length === 0) {
        errorMessage = 'Your account needs an active LGA administrator assignment.';
        return;
      }
      currentUser = auth.user;
      const [referenceData, officerRows] = await Promise.all([
        getCdsGroupReferenceData(),
        listCloOfficers()
      ]);
      lgaOptions = referenceData.lgas.filter((lga) => assignedLgaIds.includes(lga.id));
      officers = officerRows;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load CLO management.';
    } finally {
      loading = false;
    }
  }

  function resetForm() {
    editingOfficer = null;
    email = '';
    selectedLgaIds = lgaOptions[0] ? [lgaOptions[0].id] : [];
    formError = '';
  }

  function openCreateForm() {
    resetForm();
    formOpen = true;
  }

  function openEditForm(officer: CloOfficerRecord) {
    editingOfficer = officer;
    email = officer.email ?? '';
    selectedLgaIds = officer.assignments.map((assignment) => assignment.lgaId);
    formError = '';
    formOpen = true;
  }

  function toggleLga(lgaId: string, checked: boolean) {
    selectedLgaIds = checked
      ? [...new Set([...selectedLgaIds, lgaId])]
      : selectedLgaIds.filter((id) => id !== lgaId);
  }

  async function saveOfficer(event: SubmitEvent) {
    event.preventDefault();
    formError = '';
    if (selectedLgaIds.length === 0) {
      formError = 'Select at least one LGA for this CLO.';
      return;
    }
    saving = true;
    try {
      if (editingOfficer) {
        await updateCloOfficer(editingOfficer.userId, { lgaIds: selectedLgaIds });
        noticeMessage = 'CLO LGA access updated.';
      } else {
        const created = await createCloOfficer({ email: email.trim(), lgaIds: selectedLgaIds });
        if (created.activationToken) {
          activationToken = created.activationToken;
          activationEmail = created.email ?? email.trim();
          noticeMessage = 'CLO account created. Copy the development activation token below and share it securely.';
        } else {
          noticeMessage = 'CLO account and LGA assignments saved.';
        }
      }
      formOpen = false;
      resetForm();
      await loadPage();
    } catch (error) {
      formError = error instanceof ApiError || error instanceof Error
        ? error.message
        : 'Unable to save CLO details.';
    } finally {
      saving = false;
    }
  }

  async function toggleAccess(officer: CloOfficerRecord) {
    const action = officer.isEnabled ? 'pause' : 'restore';
    if (!window.confirm(`Are you sure you want to ${action} CLO access for ${officer.email ?? 'this officer'}?`)) return;
    errorMessage = '';
    noticeMessage = '';
    try {
      await updateCloOfficer(officer.userId, { isEnabled: !officer.isEnabled });
      noticeMessage = officer.isEnabled
        ? 'CLO access paused. The account and assignment history have been preserved.'
        : 'CLO access restored for the assigned LGA(s).';
      await loadPage();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to update CLO access.';
    }
  }

  async function copyActivationToken() {
    try {
      await navigator.clipboard.writeText(activationToken);
      noticeMessage = 'Activation token copied.';
    } catch {
      noticeMessage = 'Select and copy the activation token manually.';
    }
  }

  async function signOut() {
    signingOut = true;
    try { await logout(); } finally { await goto('/login'); }
  }
</script>

<svelte:head>
  <title>CLO Officers | NYSC CDS Platform</title>
  <meta name="description" content="Create and manage Corps Liaison Officer access within your assigned LGA(s)." />
</svelte:head>

{#if loading}
  <main class="state-screen"><div class="loader"></div><p>Loading CLO accounts…</p></main>
{:else if !currentUser}
  <main class="state-screen"><h2>Unable to open CLO Management</h2><p>{errorMessage}</p><a href="/login">Return to login</a></main>
{:else}
  <div class="admin-shell">
    <LgiSidebar activePath="/lgi/clos" open={mobileNavOpen} signingOut={signingOut} onClose={() => (mobileNavOpen = false)} onSignOut={signOut} />
    <section class="main-area">
      <header class="topbar">
        <div class="heading"><button class="menu-button" type="button" aria-label="Open navigation menu" aria-expanded={mobileNavOpen} onclick={() => (mobileNavOpen = !mobileNavOpen)}><span></span><span></span><span></span></button><div><span class="breadcrumb">Administration / CLO Officers</span><h1>CLO Officers</h1></div></div>
        <div class="account"><div class="avatar">LG</div><div><strong>LGI Administrator</strong><span>{currentUser.email}</span></div></div>
      </header>
      <main class="page-content">
        {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}
        {#if noticeMessage}<div class="message success" role="status">{noticeMessage}</div>{/if}
        <section class="intro">
          <div><span class="eyebrow">DOCUMENT OPERATIONS</span><h2>Manage Corps Liaison Officers</h2><p>Create CLO accounts, assign the LGAs they are responsible for, update their access and pause or restore their assignments. CLOs can process submitted documents but cannot create or change document requirements.</p></div>
          <button class="primary-button" type="button" onclick={openCreateForm}>＋ Add CLO</button>
        </section>
        <section class="stats">
          <article><span>Total CLO accounts</span><strong>{officers.length}</strong></article>
          <article><span>Access enabled</span><strong>{officers.filter((officer) => officer.isEnabled).length}</strong></article>
          <article><span>Pending activation</span><strong>{officers.filter((officer) => officer.accountStatus === 'pending_activation').length}</strong></article>
        </section>
        {#if activationToken}
          <section class="token-panel"><div><h3>Development activation token</h3><p>For {activationEmail}. Share this token securely with the CLO so they can activate their account. It expires after 24 hours.</p></div><code>{activationToken}</code><button type="button" class="secondary-button" onclick={copyActivationToken}>Copy token</button></section>
        {/if}
        <section class="panel">
          <div class="panel-heading"><div><h3>CLO account directory</h3><p>Only assignments within your own LGI scope are displayed and can be controlled.</p></div></div>
          <div class="filters">
            <label>Search by email<input bind:value={search} placeholder="Enter email address…" /></label>
            <label>Access status<select bind:value={statusFilter}><option value="all">All accounts</option><option value="enabled">Access enabled</option><option value="paused">Access paused</option><option value="pending_activation">Pending activation</option></select></label>
          </div>
          {#if visibleOfficers.length === 0}
            <div class="empty"><div class="empty-icon">♙</div><h3>No CLO accounts found</h3><p>{officers.length === 0 ? 'Create a CLO account and assign the LGA(s) where the officer will handle document submissions.' : 'Try a different search or filter.'}</p></div>
          {:else}
            <div class="officer-list">
              {#each visibleOfficers as officer (officer.userId)}
                <article class="officer-card">
                  <div class="officer-heading"><div class="avatar person">CLO</div><div class="identity"><strong>{officer.email ?? 'No email address'}</strong><span class:paused={!officer.isEnabled} class="status">{officer.isEnabled ? 'Access enabled' : 'Access paused'}</span><small>Account: {officer.accountStatus.replaceAll('_', ' ')}</small></div>
                    <div class="actions"><button class="secondary-button" type="button" onclick={() => openEditForm(officer)}>Edit LGA access</button><button class:restore={!officer.isEnabled} class="toggle-button" type="button" onclick={() => void toggleAccess(officer)}>{officer.isEnabled ? 'Pause access' : 'Restore access'}</button></div>
                  </div>
                  <div class="assignments"><span class="label">Assigned LGA(s)</span><div class="chips">{#each officer.assignments as assignment (assignment.assignmentId)}<span class:inactive={!assignment.isActive} class="chip">{assignment.lgaName}, {assignment.stateName}{assignment.isActive ? '' : ' · paused'}</span>{/each}</div></div>
                </article>
              {/each}
            </div>
          {/if}
        </section>
        <section class="permission-note"><strong>Permission boundary:</strong> CLOs can view published document requirements, view submitted files and make manual verification decisions within their assigned LGA(s). They cannot add, edit, publish, disable or delete requirements, manage Coordinators, or access LGI administration.</section>
      </main>
      <footer>NYSC CDS Management Platform · LGI Administration</footer>
    </section>
  </div>
{/if}

{#if formOpen}
  <div class="modal-layer">
    <button class="scrim" type="button" aria-label="Close CLO form" onclick={() => (formOpen = false)}></button>
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="clo-title">
      <header class="modal-header"><div><span class="eyebrow">CLO ACCESS CONTROL</span><h2 id="clo-title">{editingOfficer ? 'Edit CLO assignments' : 'Create CLO account'}</h2><p>{editingOfficer ? 'Change the LGA(s) this officer can handle.' : 'Invite a new CLO and assign the LGA(s) where they will process documents.'}</p></div><button type="button" class="close" aria-label="Close" onclick={() => (formOpen = false)}>×</button></header>
      {#if formError}<div class="message error">{formError}</div>{/if}
      <form class="form" onsubmit={saveOfficer}>
        {#if !editingOfficer}<label>Email address<input type="email" bind:value={email} placeholder="clo@example.com" required maxlength="320" /></label>{:else}<div class="email-view"><span>Account email</span><strong>{editingOfficer.email}</strong></div>{/if}
        <fieldset><legend>Assign LGA(s)</legend><p>The CLO will only see document requirements and submissions from the selected LGA(s).</p>
          <div class="lga-options">
            {#each lgaOptions as lga (lga.id)}
              <label class="lga-option"><input type="checkbox" checked={selectedLgaIds.includes(lga.id)} onchange={(event) => toggleLga(lga.id, event.currentTarget.checked)} /><span><strong>{lga.name}</strong><small>{lga.stateName}</small></span></label>
            {/each}
          </div>
          {#if lgaOptions.length === 0}<div class="empty-small">No LGA assignments are available in your account scope.</div>{/if}
        </fieldset>
        <div class="role-note"><strong>CLO permissions</strong><span>View published requirements · Review submitted documents · Verify or request resubmission</span><span class="denied">Cannot create or modify document requirements</span></div>
        <div class="modal-actions"><button class="secondary-button" type="button" onclick={() => (formOpen = false)} disabled={saving}>Cancel</button><button class="primary-button" type="submit" disabled={saving || lgaOptions.length === 0}>{saving ? 'Saving…' : editingOfficer ? 'Save assignments' : 'Create CLO'}</button></div>
      </form>
    </section>
  </div>
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; overflow-x: hidden; background: #f5f7f5; color: #19251e; font-family: Inter, Arial, sans-serif; }
  :global(button), :global(input), :global(select) { font: inherit; }
  .admin-shell { min-height: 100vh; display: flex; }
  .main-area { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .topbar { position: sticky; top: 0; z-index: 15; min-height: 82px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 30px; border-bottom: 1px solid #e8ece8; background: #fff; }
  .heading { display: flex; align-items: center; gap: 11px; }
  .breadcrumb { color: #819087; font-size: 10px; }
  .topbar h1 { margin: 5px 0 0; font-size: 20px; }
  .account { display: flex; align-items: center; gap: 10px; }
  .avatar { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; background: #e6f1e9; color: #0a5c37; font-size: 12px; font-weight: 700; }
  .account strong, .account span { display: block; }
  .account strong { font-size: 11px; }
  .account span { margin-top: 4px; color: #819087; font-size: 10px; }
  .menu-button { display: none; }
  .page-content { width: 100%; max-width: 1500px; flex: 1; margin: 0 auto; padding: 28px clamp(16px, 2.2vw, 32px); }
  .intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
  .eyebrow { color: #0a8050; font-size: 9px; font-weight: 800; letter-spacing: 1.4px; }
  .intro h2 { margin: 7px 0 6px; color: #143c27; font-size: 23px; }
  .intro p { max-width: 850px; margin: 0; color: #718078; font-size: 11px; line-height: 1.7; }
  .primary-button, .secondary-button, .toggle-button { min-height: 38px; padding: 0 13px; border: 1px solid transparent; border-radius: 8px; font-size: 10px; font-weight: 700; cursor: pointer; white-space: nowrap; }
  .primary-button { background: #0a5c37; color: #fff; }
  .primary-button:hover { background: #07492c; }
  .secondary-button { border-color: #dce8df; background: #fff; color: #28563b; }
  .toggle-button { border-color: #f0d1ca; background: #fff5f3; color: #a33a2c; }
  .toggle-button.restore { border-color: #cae5d2; background: #eaf6ee; color: #14643a; }
  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
  .stats article { min-height: 92px; padding: 15px 17px; border: 1px solid #e5ebe6; border-radius: 10px; background: #fff; }
  .stats span { color: #819087; font-size: 10px; }
  .stats strong { display: block; margin-top: 7px; color: #123d27; font-size: 22px; }
  .panel { padding: 20px; border: 1px solid #e5ebe6; border-radius: 12px; background: #fff; }
  .panel-heading h3 { margin: 0; color: #193b28; font-size: 15px; }
  .panel-heading p { margin: 5px 0 0; color: #819087; font-size: 10px; }
  .filters { display: grid; grid-template-columns: minmax(220px,1fr) minmax(160px,220px); gap: 12px; margin: 18px 0; }
  .filters label, .form > label { display: grid; gap: 7px; color: #344b3d; font-size: 10px; font-weight: 700; }
  input, select { width: 100%; min-height: 40px; padding: 0 11px; border: 1px solid #dce5de; border-radius: 8px; background: #fff; color: #253c2e; font-size: 11px; }
  .officer-list { display: grid; gap: 10px; }
  .officer-card { padding: 15px; border: 1px solid #e8eee9; border-radius: 10px; }
  .officer-heading { display: flex; align-items: center; gap: 11px; }
  .avatar.person { flex: 0 0 36px; font-size: 9px; }
  .identity { min-width: 0; flex: 1; }
  .identity strong, .identity small { display: block; overflow-wrap: anywhere; }
  .identity strong { color: #263d30; font-size: 12px; }
  .identity small { margin-top: 5px; color: #819087; font-size: 9px; }
  .status { display: inline-flex; margin-top: 6px; padding: 4px 8px; border-radius: 20px; background: #e7f4eb; color: #087443; font-size: 9px; font-weight: 700; }
  .status.paused { background: #fff0ed; color: #a33a2c; }
  .actions { display: flex; flex-wrap: wrap; gap: 7px; }
  .assignments { display: grid; gap: 8px; margin: 13px 0 0 47px; padding-top: 12px; border-top: 1px solid #edf1ed; }
  .label { color: #819087; font-size: 9px; font-weight: 700; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { padding: 6px 8px; border-radius: 6px; background: #eff6f1; color: #28563b; font-size: 9px; }
  .chip.inactive { background: #f3f4f3; color: #879189; }
  .empty { padding: 40px 15px; text-align: center; }
  .empty-icon { color: #0a8050; font-size: 25px; }
  .empty h3 { margin: 10px 0 5px; font-size: 13px; }
  .empty p { max-width: 450px; margin: 0 auto; color: #819087; font-size: 10px; line-height: 1.6; }
  .token-panel, .permission-note { margin-bottom: 17px; padding: 16px 18px; border: 1px solid #dcebe0; border-radius: 10px; background: #f0f7f2; }
  .token-panel h3 { margin: 0 0 5px; color: #17472d; font-size: 13px; }
  .token-panel p { margin: 0 0 10px; color: #607267; font-size: 10px; line-height: 1.6; }
  .token-panel code { display: block; padding: 11px; margin-bottom: 9px; border: 1px solid #dce5de; border-radius: 8px; background: #fff; color: #123d27; overflow-wrap: anywhere; font-size: 11px; }
  .permission-note { margin-top: 16px; margin-bottom: 0; color: #607267; font-size: 10px; line-height: 1.7; }
  .permission-note strong { color: #17472d; }
  .message { margin-bottom: 14px; padding: 11px 13px; border-radius: 8px; font-size: 11px; line-height: 1.6; }
  .message.error { border: 1px solid #efceca; background: #fff3f2; color: #a32920; }
  .message.success { border: 1px solid #cce6d3; background: #eef8f0; color: #16633b; }
  footer { margin-top: auto; padding: 16px 30px; border-top: 1px solid #e8ece8; color: #89948c; font-size: 10px; }
  .state-screen { min-height: 100vh; display: grid; align-content: center; justify-items: center; gap: 12px; color: #53665a; font: 13px Inter, Arial, sans-serif; }
  .loader { width: 28px; height: 28px; border: 3px solid #dce8df; border-top-color: #0a8050; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .modal-layer { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 18px; }
  .scrim { position: absolute; inset: 0; width: 100%; border: 0; background: #071b10a8; }
  .modal { position: relative; width: min(100%, 560px); max-height: min(90vh, 780px); overflow: auto; padding: 22px; border: 1px solid #e5ebe6; border-radius: 14px; background: #fff; box-shadow: 0 24px 80px #0003; }
  .modal-header { display: flex; justify-content: space-between; gap: 15px; margin-bottom: 18px; }
  .modal-header h2 { margin: 7px 0 5px; color: #193b28; font-size: 19px; }
  .modal-header p { margin: 0; color: #819087; font-size: 10px; line-height: 1.6; }
  .close { width: 32px; height: 32px; border: 0; border-radius: 7px; background: #f1f5f2; color: #355b43; font-size: 21px; cursor: pointer; }
  .form { display: grid; gap: 15px; }
  .email-view { display: grid; gap: 5px; padding: 11px; border-radius: 8px; background: #f5f8f5; }
  .email-view span { color: #819087; font-size: 9px; }
  .email-view strong { color: #193b28; font-size: 11px; }
  fieldset { margin: 0; padding: 13px; border: 1px solid #e2eae3; border-radius: 9px; }
  legend { padding: 0 5px; color: #2c4937; font-size: 10px; font-weight: 700; }
  fieldset p { margin: 0 0 10px; color: #819087; font-size: 9px; line-height: 1.6; }
  .lga-options { display: grid; gap: 7px; max-height: 230px; overflow-y: auto; }
  .lga-option { display: flex; align-items: flex-start; gap: 9px; padding: 9px; border: 1px solid #e7ede8; border-radius: 8px; cursor: pointer; }
  .lga-option input { width: 15px; min-height: 15px; height: 15px; flex: 0 0 15px; margin-top: 2px; accent-color: #0a5c37; }
  .lga-option span { display: grid; gap: 4px; }
  .lga-option strong { color: #253c2e; font-size: 10px; }
  .lga-option small { color: #819087; font-size: 9px; }
  .role-note { display: grid; gap: 5px; padding: 12px; border-radius: 8px; background: #f0f7f2; color: #607267; font-size: 9px; line-height: 1.6; }
  .role-note strong { color: #17472d; font-size: 10px; }
  .role-note .denied { color: #9b3f35; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }
  .empty-small { padding: 12px; color: #9b3f35; font-size: 10px; }
  @media (max-width: 760px) {
    .topbar { min-height: 72px; padding: 11px 14px; }
    .menu-button { display: grid; width: 36px; height: 36px; place-content: center; gap: 4px; border: 1px solid #dce5de; border-radius: 8px; background: #fff; }
    .menu-button span { width: 15px; height: 2px; background: #24543a; }
    .account > div:last-child { display: none; }
    .page-content { padding: 20px 14px 25px; }
    .intro { align-items: flex-start; flex-direction: column; }
    .stats { grid-template-columns: 1fr 1fr; gap: 8px; }
    .stats article { padding: 12px; }
    .stats strong { font-size: 19px; }
    .filters { grid-template-columns: 1fr; }
    .officer-heading { flex-wrap: wrap; }
    .identity { flex: 1 1 calc(100% - 50px); }
    .actions { width: 100%; margin-left: 47px; }
    .assignments { margin-left: 0; }
    .panel { padding: 14px; }
    footer { padding: 14px; }
  }
</style>