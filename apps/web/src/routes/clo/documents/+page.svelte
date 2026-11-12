<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import CloLayout from '#lib/components/CloLayout.svelte';
  import {
    ApiError,
    getCurrentUser,
    listCloDocumentRequirements,
    listCloDocumentSubmissions,
    downloadCloDocumentSubmission,
    decideCloDocumentSubmission,
    logout
  } from '#lib/api/client.ts';
  import type { AuthUser, LgiDocumentRequirement, LgiDocumentSubmission } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let requirements = $state<LgiDocumentRequirement[]>([]);
  let submissions = $state<LgiDocumentSubmission[]>([]);
  let loading = $state(true);
  let savingId = $state('');
  let fileLoadingId = $state('');
  let search = $state('');
  let errorMessage = $state('');
  let noticeMessage = $state('');
  let signOutPending = $state(false);

  const visibleSubmissions = $derived(submissions.filter((submission) => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return true;
    return [
      submission.firstName,
      submission.middleName ?? '',
      submission.lastName,
      submission.stateCode,
      submission.requirementName
    ].join(' ').toLocaleLowerCase().includes(term);
  }));

  onMount(() => { void loadPage(); });

  async function loadPage() {
    loading = true;
    errorMessage = '';
    try {
      const auth = await getCurrentUser();
      if (!auth.roles.some((role) => role.code === 'CLO')) {
        await goto('/login');
        return;
      }
      currentUser = auth.user;
      const [requirementRows, submissionRows] = await Promise.all([
        listCloDocumentRequirements(),
        listCloDocumentSubmissions()
      ]);
      requirements = requirementRows;
      submissions = submissionRows;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load document handling workspace.';
    } finally {
      loading = false;
    }
  }

  async function openSubmissionFile(submission: LgiDocumentSubmission) {
    fileLoadingId = submission.id;
    errorMessage = '';
    try {
      const blob = await downloadCloDocumentSubmission(submission.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.download = submission.fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      errorMessage = error instanceof ApiError || error instanceof Error
        ? error.message
        : 'Unable to open the submitted document.';
    } finally {
      fileLoadingId = '';
    }
  }

  async function reviewSubmission(
    submission: LgiDocumentSubmission,
    decision: 'verified' | 'needs_resubmission'
  ) {
    const promptText = decision === 'verified'
      ? 'Explain why this document is accepted (minimum 10 characters):'
      : 'Explain what the Corps Member must correct and resubmit (minimum 10 characters):';
    const reason = window.prompt(promptText);
    if (reason === null) return;
    if (reason.trim().length < 10) {
      errorMessage = 'Please enter a review note of at least 10 characters.';
      return;
    }

    savingId = submission.id;
    errorMessage = '';
    noticeMessage = '';
    try {
      await decideCloDocumentSubmission(submission.id, decision, reason.trim());
      noticeMessage = decision === 'verified'
        ? 'Document verified. The platform will continue CDS matching when all mandatory documents are verified.'
        : 'Document returned to the Corps Member for resubmission.';
      submissions = await listCloDocumentSubmissions();
    } catch (error) {
      errorMessage = error instanceof ApiError || error instanceof Error
        ? error.message
        : 'Unable to save the document review.';
    } finally {
      savingId = '';
    }
  }

  function statusLabel(status: string) {
    if (status === 'verified') return 'Verified';
    if (status === 'needs_resubmission') return 'Resubmission required';
    if (status === 'manual_review') return 'Awaiting review';
    return 'Pending verification';
  }

  async function signOut() {
    signOutPending = true;
    try { await logout(); } finally { await goto('/login'); }
  }
</script>

<svelte:head>
  <title>Document Handling | CLO Workspace</title>
  <meta name="description" content="Review Corps Member document submissions across all LGAs." />
</svelte:head>

{#if loading}
  <main class="state-screen"><div class="loader"></div><p>Loading your document workspace…</p></main>
{:else if !currentUser}
  <main class="state-screen"><h2>Document workspace unavailable</h2><p>{errorMessage}</p><a href="/login">Return to sign in</a></main>
{:else}
  <CloLayout activePath="/clo/documents" userEmail={currentUser.email} onSignOut={signOut}>
    <section class="page-intro">
      <div><span class="eyebrow">CORPS MEMBER DOCUMENTS</span><h2>Document handling</h2><p>Handle document submissions for every Corps Member across all LGAs. Review files, verify valid records or return incorrect documents for resubmission. LGIs retain control of the document checklist and requirements.</p></div>
      <button class="refresh-button" type="button" onclick={() => void loadPage()} disabled={loading}>↻ Refresh</button>
    </section>

    {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}
    {#if noticeMessage}<div class="message success" role="status">{noticeMessage}</div>{/if}

    <section class="stats">
      <article><span>Active document requirements</span><strong>{requirements.length}</strong><small>Published by your LGI</small></article>
      <article><span>Awaiting document review</span><strong>{submissions.length}</strong><small>Across every LGA</small></article>
      <article><span>Document coverage</span><strong>All LGAs</strong><small>Every Corps Member on the platform</small></article>
    </section>

    <section class="panel">
      <div class="panel-heading"><div><h3>Active document requirements</h3><p>These are the requirements currently published by your LGI. You cannot add, edit, enable or remove items.</p></div><span class="count">{requirements.length} published</span></div>
      {#if requirements.length === 0}
        <div class="empty"><div class="empty-icon">▤</div><h4>No active requirements</h4><p>No active document requirements have been published for any LGA yet.</p></div>
      {:else}
        <div class="requirements">
          {#each requirements as requirement (requirement.id)}
            <article class="requirement">
              <div class="doc-icon">▤</div>
              <div class="requirement-copy"><strong>{requirement.name}</strong><span>{requirement.lgaName}, {requirement.stateName} · {requirement.code}</span>
                {#if requirement.description}<p>{requirement.description}</p>{/if}
                <small>{requirement.isRequired ? 'Mandatory' : 'Optional'} · {requirement.allowedMimeTypes.replaceAll('application/pdf','PDF').replaceAll('image/jpeg','JPEG').replaceAll('image/png','PNG')} · Max {Math.round(requirement.maxFileSizeBytes / (1024 * 1024))} MB</small>
              </div>
              <span class="published">Published</span>
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section class="panel">
      <div class="panel-heading"><div><h3>Document review queue</h3><p>Manual-only, AI-assisted and uncertain verification results appear here for review.</p></div><span class="queue-count">{submissions.length} awaiting</span></div>
      <label class="search"><span>Search submissions</span><input bind:value={search} placeholder="Search by name, State Code or document…" /></label>
      {#if visibleSubmissions.length === 0}
        <div class="empty compact"><div class="empty-icon">✓</div><h4>{submissions.length === 0 ? 'No documents awaiting review' : 'No matching submissions'}</h4><p>{submissions.length === 0 ? 'New submissions requiring a manual decision will appear here.' : 'Try another search term.'}</p></div>
      {:else}
        <div class="review-list">
          {#each visibleSubmissions as submission (submission.id)}
            <article class="review-card">
              <div class="member">
                <div class="member-avatar">{submission.firstName.slice(0,1)}{submission.lastName.slice(0,1)}</div>
                <div><strong>{submission.lastName}, {submission.firstName} {submission.middleName ?? ''}</strong><span>{submission.stateCode} · {submission.lgaName}, {submission.stateName} · {submission.requirementName}</span><small>{submission.fileName} · {new Date(submission.submittedAt).toLocaleString()}</small></div>
              </div>
              <div class="review-meta">
                <span class="status">{statusLabel(submission.status)}</span>
                <span>{submission.confidence === null ? 'No confidence score' : `Confidence: ${submission.confidence}%`}</span>
                <p>{submission.reason ?? 'The verification process needs a human review.'}</p>
              </div>
              <div class="actions">
                <button class="view-button" type="button" onclick={() => void openSubmissionFile(submission)} disabled={fileLoadingId === submission.id}>{fileLoadingId === submission.id ? 'Opening…' : 'View document'}</button>
                <button class="approve-button" type="button" onclick={() => void reviewSubmission(submission, 'verified')} disabled={savingId === submission.id}>{savingId === submission.id ? 'Saving…' : 'Mark verified'}</button>
                <button class="return-button" type="button" onclick={() => void reviewSubmission(submission, 'needs_resubmission')} disabled={savingId === submission.id}>Request resubmission</button>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>
    <div class="permission-note"><strong>Platform-wide document access.</strong> You can review submissions from Corps Members across all LGAs. Only LGI Administrators can create, change, publish or remove document requirements and manage CLO accounts.</div>
  </CloLayout>
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  .page-intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
  .eyebrow { color: #0a8050; font-size: 9px; font-weight: 800; letter-spacing: 1.5px; }
  .page-intro h2 { margin: 8px 0 6px; color: #143c27; font-size: 25px; }
  .page-intro p { max-width: 800px; margin: 0; color: #718078; font-size: 12px; line-height: 1.7; }
  .refresh-button, .view-button { min-height: 38px; padding: 0 13px; border: 1px solid #dce8df; border-radius: 8px; background: #fff; color: #28563b; font-size: 11px; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: .58; cursor: wait; }
  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 13px; margin-bottom: 20px; }
  .stats article { min-height: 104px; padding: 17px 19px; border: 1px solid #e5ebe6; border-radius: 11px; background: #fff; }
  .stats span, .stats small { display: block; color: #819087; font-size: 10px; }
  .stats strong { display: block; margin: 8px 0 5px; color: #123d27; font-size: 23px; }
  .panel { margin-bottom: 18px; padding: 20px; border: 1px solid #e5ebe6; border-radius: 12px; background: #fff; }
  .panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 17px; }
  .panel-heading h3 { margin: 0; color: #193b28; font-size: 15px; }
  .panel-heading p { margin: 5px 0 0; color: #819087; font-size: 10px; line-height: 1.6; }
  .count, .queue-count { padding: 6px 9px; border-radius: 20px; background: #edf6ef; color: #267045; font-size: 9px; font-weight: 700; white-space: nowrap; }
  .requirements { display: grid; }
  .requirement { display: flex; align-items: flex-start; gap: 12px; padding: 15px 0; border-top: 1px solid #edf1ed; }
  .doc-icon { width: 36px; height: 36px; flex: 0 0 36px; display: grid; place-items: center; border-radius: 9px; background: #eaf3ed; color: #0a5c37; font-size: 17px; }
  .requirement-copy { min-width: 0; flex: 1; }
  .requirement-copy strong, .requirement-copy span, .requirement-copy small { display: block; }
  .requirement-copy strong { color: #263d30; font-size: 12px; }
  .requirement-copy span { margin-top: 4px; color: #819087; font-size: 10px; }
  .requirement-copy p { margin: 8px 0; color: #65736a; font-size: 10px; line-height: 1.6; }
  .requirement-copy small { margin-top: 7px; color: #78877d; font-size: 9px; }
  .published { padding: 5px 8px; border-radius: 20px; background: #e7f4eb; color: #087443; font-size: 9px; font-weight: 700; white-space: nowrap; }
  .search { display: grid; gap: 7px; max-width: 480px; margin-bottom: 15px; color: #344b3d; font-size: 10px; font-weight: 700; }
  .search input { width: 100%; min-height: 40px; padding: 0 12px; border: 1px solid #dce5de; border-radius: 8px; color: #253c2e; font-size: 11px; }
  .review-list { display: grid; gap: 11px; }
  .review-card { display: grid; grid-template-columns: minmax(220px, 1.2fr) minmax(210px, 1fr) minmax(170px, .75fr); gap: 15px; align-items: center; padding: 15px; border: 1px solid #e8eee9; border-radius: 10px; }
  .member { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
  .member-avatar { width: 35px; height: 35px; flex: 0 0 35px; display: grid; place-items: center; border-radius: 50%; background: #eaf3ed; color: #0a5c37; font-size: 10px; font-weight: 800; }
  .member > div:last-child { min-width: 0; }
  .member strong, .member span, .member small { display: block; overflow-wrap: anywhere; }
  .member strong { color: #263d30; font-size: 11px; }
  .member span { margin-top: 5px; color: #6f7e74; font-size: 9px; }
  .member small { margin-top: 6px; color: #8a968e; font-size: 9px; }
  .review-meta { min-width: 0; }
  .review-meta > span { display: inline-block; margin: 2px 6px 5px 0; color: #7b8980; font-size: 9px; }
  .review-meta .status { padding: 5px 8px; border-radius: 20px; background: #fff4df; color: #946000; font-weight: 700; }
  .review-meta p { margin: 5px 0 0; color: #65736a; font-size: 10px; line-height: 1.6; overflow-wrap: anywhere; }
  .actions { display: grid; gap: 7px; }
  .approve-button, .return-button { min-height: 34px; padding: 0 10px; border: 1px solid transparent; border-radius: 7px; font-size: 10px; font-weight: 700; cursor: pointer; }
  .approve-button { background: #e8f5ed; border-color: #cae5d2; color: #14643a; }
  .return-button { background: #fff2ef; border-color: #f0d1ca; color: #a33a2c; }
  .empty { padding: 35px 15px; text-align: center; }
  .empty.compact { padding: 28px 15px; }
  .empty-icon { color: #0a8050; font-size: 24px; }
  .empty h4 { margin: 9px 0 5px; color: #254532; font-size: 13px; }
  .empty p { margin: 0; color: #819087; font-size: 10px; line-height: 1.6; }
  .permission-note { margin: 5px 0 0; padding: 14px 16px; border: 1px solid #dcebe0; border-radius: 9px; background: #f0f7f2; color: #607267; font-size: 10px; line-height: 1.7; }
  .permission-note strong { color: #17472d; }
  .message { margin-bottom: 14px; padding: 11px 13px; border-radius: 8px; font-size: 11px; line-height: 1.6; }
  .message.error { border: 1px solid #efceca; background: #fff3f2; color: #a32920; }
  .message.success { border: 1px solid #cce6d3; background: #eef8f0; color: #16633b; }
  .state-screen { min-height: 100vh; display: grid; align-content: center; justify-items: center; gap: 12px; color: #53665a; font: 13px Inter, Arial, sans-serif; }
  .loader { width: 28px; height: 28px; border: 3px solid #dce8df; border-top-color: #0a8050; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 980px) { .review-card { grid-template-columns: 1fr 1fr; } .actions { grid-column: 1 / -1; grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @media (max-width: 650px) {
    .page-intro { align-items: flex-start; flex-direction: column; }
    .page-intro h2 { font-size: 21px; }
    .stats { grid-template-columns: 1fr 1fr; gap: 9px; }
    .stats article { padding: 13px; }
    .stats article:last-child { grid-column: 1 / -1; }
    .stats strong { font-size: 20px; }
    .panel { padding: 15px; }
    .requirement { flex-wrap: wrap; }
    .published { margin-left: 48px; }
    .review-card { grid-template-columns: 1fr; gap: 12px; }
    .actions { grid-column: auto; grid-template-columns: 1fr; }
    .panel-heading { flex-direction: column; }
  }
</style>