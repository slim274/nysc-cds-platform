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
  let statusFilter = $state('all');
  let lgaFilter = $state('all');
  let expandedMemberIds = $state<string[]>([]);
  let errorMessage = $state('');
  let noticeMessage = $state('');
  let signOutPending = $state(false);

  type MemberSubmissionGroup = {
    memberId: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    stateCode: string;
    lgaName: string;
    stateName: string;
    documents: LgiDocumentSubmission[];
    verifiedCount: number;
    awaitingReviewCount: number;
    resubmissionCount: number;
    pendingCount: number;
    notVerifiedCount: number;
  };

  const memberCount = $derived(new Set(submissions.map((submission) => submission.memberId)).size);

  const lgaOptions = $derived(
    [...new Map(submissions.map((submission) => {
      const key = `${submission.lgaName}::${submission.stateName}`;
      return [key, { key, label: `${submission.lgaName}, ${submission.stateName}` }];
    })).values()].sort((a, b) => a.label.localeCompare(b.label))
  );

  // Apply the active filters first, then group matching submissions by their
  // stable Corps Member ID so each person's documents stay together.
  const visibleMemberGroups = $derived.by(() => {
    const term = search.trim().toLocaleLowerCase();
    const grouped = new Map<string, LgiDocumentSubmission[]>();

    for (const submission of submissions) {
      const matchesStatus = statusFilter === 'all' || submission.status === statusFilter;
      const submissionLgaKey = `${submission.lgaName}::${submission.stateName}`;
      const matchesLga = lgaFilter === 'all' || submissionLgaKey === lgaFilter;
      const matchesSearch = !term || [
        submission.firstName,
        submission.middleName ?? '',
        submission.lastName,
        submission.stateCode,
        submission.requirementName,
        submission.fileName,
        submission.lgaName,
        submission.stateName
      ].join(' ').toLocaleLowerCase().includes(term);

      if (!matchesStatus || !matchesLga || !matchesSearch) continue;
      const memberDocuments = grouped.get(submission.memberId) ?? [];
      memberDocuments.push(submission);
      grouped.set(submission.memberId, memberDocuments);
    }

    return [...grouped.entries()]
      .map(([memberId, documents]): MemberSubmissionGroup => {
        const member = documents[0];
        const verifiedCount = documents.filter((document) => document.status === 'verified').length;
        const awaitingReviewCount = documents.filter((document) => document.status === 'manual_review').length;
        const resubmissionCount = documents.filter((document) => document.status === 'needs_resubmission').length;
        const pendingCount = documents.filter((document) => document.status === 'pending_verification').length;

        return {
          memberId,
          firstName: member.firstName,
          middleName: member.middleName,
          lastName: member.lastName,
          stateCode: member.stateCode,
          lgaName: member.lgaName,
          stateName: member.stateName,
          documents,
          verifiedCount,
          awaitingReviewCount,
          resubmissionCount,
          pendingCount,
          notVerifiedCount: documents.length - verifiedCount
        };
      })
      .sort((a, b) =>
        b.awaitingReviewCount - a.awaitingReviewCount ||
        b.notVerifiedCount - a.notVerifiedCount ||
        `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
      );
  });

  function toggleMember(memberId: string) {
    expandedMemberIds = expandedMemberIds.includes(memberId)
      ? expandedMemberIds.filter((id) => id !== memberId)
      : [...expandedMemberIds, memberId];
  }

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
      <article><span>Corps Members with submissions</span><strong>{memberCount}</strong><small>Across every LGA</small></article>
      <article><span>Submitted documents</span><strong>{submissions.length}</strong><small>All statuses · All LGAs</small></article>
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
      <div class="panel-heading">
        <div><h3>All Corps Member document submissions</h3><p>Documents are grouped by Corps Member. Open a person's record to review each submitted document individually.</p></div>
        <span class="queue-count">{submissions.length} documents · {memberCount} Corps Members</span>
      </div>
      <div class="filters">
        <label class="search"><span>Search Corps Members or documents</span><input bind:value={search} placeholder="Name, State Code, LGA or document…" /></label>
        <label class="status-filter"><span>Document status</span>
          <select bind:value={statusFilter}>
            <option value="all">All statuses</option>
            <option value="manual_review">Awaiting review</option>
            <option value="pending_verification">Pending verification</option>
            <option value="verified">Verified</option>
            <option value="needs_resubmission">Resubmission required</option>
          </select>
        </label>
        <label class="lga-filter"><span>LGA / State</span>
          <select bind:value={lgaFilter}>
            <option value="all">All LGAs</option>
            {#each lgaOptions as option (option.key)}
              <option value={option.key}>{option.label}</option>
            {/each}
          </select>
        </label>
      </div>
      {#if visibleMemberGroups.length === 0}
        <div class="empty compact"><div class="empty-icon">✓</div><h4>{submissions.length === 0 ? 'No document submissions yet' : 'No matching Corps Members'}</h4><p>{submissions.length === 0 ? 'Submitted documents from Corps Members across all LGAs will appear here.' : 'Try another name, State Code, LGA or document status.'}</p></div>
      {:else}
        <div class="member-groups">
          {#each visibleMemberGroups as group (group.memberId)}
            <article class="member-group" class:has-review={group.awaitingReviewCount > 0}>
              <div class="member-group-heading">
                <div class="member-identity">
                  <div class="member-avatar">{group.firstName.slice(0,1)}{group.lastName.slice(0,1)}</div>
                  <div class="member-copy">
                    <strong>{group.lastName}, {group.firstName} {group.middleName ?? ''}</strong>
                    <span>{group.stateCode}</span>
                    <small>{group.lgaName}, {group.stateName}</small>
                  </div>
                </div>
                <div class="member-overview">
                  <strong>{group.verifiedCount} of {group.documents.length} verified</strong>
                  <div class="member-status-summary">
                    {#if group.awaitingReviewCount > 0}<span class="summary-review">{group.awaitingReviewCount} awaiting review</span>{/if}
                    {#if group.resubmissionCount > 0}<span class="summary-return">{group.resubmissionCount} resubmission</span>{/if}
                    {#if group.pendingCount > 0}<span class="summary-pending">{group.pendingCount} pending</span>{/if}
                    {#if group.notVerifiedCount === 0}<span class="summary-complete">All submitted documents verified</span>{/if}
                  </div>
                </div>
                <button
                  class="expand-button"
                  type="button"
                  aria-expanded={expandedMemberIds.includes(group.memberId)}
                  aria-controls={`member-documents-${group.memberId}`}
                  onclick={() => toggleMember(group.memberId)}
                >
                  {expandedMemberIds.includes(group.memberId) ? 'Hide documents' : `View ${group.documents.length} documents`}
                  <span aria-hidden="true">{expandedMemberIds.includes(group.memberId) ? '⌃' : '⌄'}</span>
                </button>
              </div>

              {#if expandedMemberIds.includes(group.memberId)}
                <div class="member-documents" id={`member-documents-${group.memberId}`}>
                  {#each group.documents as submission (submission.id)}
                    <article class="document-row">
                      <div class="document-copy">
                        <strong>{submission.requirementName}</strong>
                        <span>{submission.fileName}</span>
                        <small>Submitted {new Date(submission.submittedAt).toLocaleString()}</small>
                      </div>
                      <div class="document-review">
                        <span
                          class="document-status"
                          class:status-verified={submission.status === 'verified'}
                          class:status-review={submission.status === 'manual_review'}
                          class:status-return={submission.status === 'needs_resubmission'}
                          class:status-pending={submission.status === 'pending_verification'}
                        >{statusLabel(submission.status)}</span>
                        {#if submission.confidence !== null}<small>Confidence: {submission.confidence}%</small>{/if}
                        {#if submission.reason}<p>{submission.reason}</p>{/if}
                      </div>
                      <div class="document-actions">
                        <button class="view-button" type="button" onclick={() => void openSubmissionFile(submission)} disabled={fileLoadingId === submission.id}>{fileLoadingId === submission.id ? 'Opening…' : 'View document'}</button>
                        {#if submission.status === 'manual_review'}
                          <button class="approve-button" type="button" onclick={() => void reviewSubmission(submission, 'verified')} disabled={savingId === submission.id}>{savingId === submission.id ? 'Saving…' : 'Mark verified'}</button>
                          <button class="return-button" type="button" onclick={() => void reviewSubmission(submission, 'needs_resubmission')} disabled={savingId === submission.id}>Request resubmission</button>
                        {:else}
                          <span class="completed-label">No action pending</span>
                        {/if}
                      </div>
                    </article>
                  {/each}
                </div>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </section>
    <div class="permission-note"><strong>Platform-wide document access.</strong> You can view document submissions from Corps Members across all LGAs. You can approve or request resubmission only for records awaiting manual review. Only LGI Administrators can create, change, publish or remove document requirements and manage CLO accounts.</div>
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
  .filters { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(170px, 210px) minmax(180px, 220px); gap: 12px; align-items: end; margin-bottom: 15px; }
  .search, .status-filter, .lga-filter { display: grid; gap: 7px; margin-bottom: 0; color: #344b3d; font-size: 10px; font-weight: 700; }
  .filters input, .filters select { width: 100%; min-height: 40px; padding: 0 12px; border: 1px solid #dce5de; border-radius: 8px; color: #253c2e; font-size: 11px; }
  .completed-label { display: inline-flex; align-items: center; justify-content: center; min-height: 34px; padding: 0 10px; border-radius: 7px; background: #f2f5f2; color: #718078; font-size: 10px; }
  .member-groups { display: grid; gap: 12px; }
  .member-group { overflow: hidden; border: 1px solid #e4ebe5; border-radius: 11px; background: #fff; }
  .member-group.has-review { border-color: #ead8b3; }
  .member-group-heading { display: grid; grid-template-columns: minmax(220px, 1.1fr) minmax(220px, 1fr) auto; gap: 16px; align-items: center; padding: 16px; }
  .member-identity { min-width: 0; display: flex; align-items: center; gap: 11px; }
  .member-avatar { width: 40px; height: 40px; flex: 0 0 40px; display: grid; place-items: center; border-radius: 50%; background: #eaf3ed; color: #0a5c37; font-size: 11px; font-weight: 800; }
  .member-copy { min-width: 0; }
  .member-copy strong, .member-copy span, .member-copy small { display: block; overflow-wrap: anywhere; }
  .member-copy strong { color: #263d30; font-size: 12px; }
  .member-copy span { margin-top: 4px; color: #315d42; font-size: 10px; font-weight: 700; }
  .member-copy small { margin-top: 3px; color: #819087; font-size: 9px; }
  .member-overview { min-width: 0; }
  .member-overview > strong { display: block; color: #244a32; font-size: 11px; }
  .member-status-summary { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
  .member-status-summary span { display: inline-flex; align-items: center; padding: 4px 7px; border-radius: 20px; font-size: 9px; font-weight: 700; }
  .summary-review { background: #fff4df; color: #946000; }
  .summary-return { background: #fff0ed; color: #a33a2c; }
  .summary-pending { background: #edf3ff; color: #315c9a; }
  .summary-complete { background: #e8f5ed; color: #14643a; }
  .expand-button { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 9px; padding: 0 11px; border: 1px solid #dce8df; border-radius: 8px; background: #f8fbf8; color: #28563b; font-size: 10px; font-weight: 700; cursor: pointer; white-space: nowrap; }
  .expand-button span { font-size: 15px; line-height: 1; }
  .expand-button:hover { border-color: #a9cdb7; background: #f0f7f2; }
  .member-documents { padding: 0 16px 12px; border-top: 1px solid #edf1ed; background: #fbfdfb; }
  .document-row { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(170px, .8fr) minmax(170px, .85fr); gap: 14px; align-items: center; padding: 14px 0; border-bottom: 1px solid #edf1ed; }
  .document-row:last-child { border-bottom: 0; }
  .document-copy { min-width: 0; }
  .document-copy strong, .document-copy span, .document-copy small { display: block; overflow-wrap: anywhere; }
  .document-copy strong { color: #263d30; font-size: 11px; }
  .document-copy span { margin-top: 4px; color: #6f7e74; font-size: 9px; }
  .document-copy small { margin-top: 5px; color: #8a968e; font-size: 9px; }
  .document-review { min-width: 0; }
  .document-status { display: inline-flex; align-items: center; padding: 5px 8px; border-radius: 20px; font-size: 9px; font-weight: 700; }
  .status-verified { background: #e8f5ed; color: #14643a; }
  .status-review { background: #fff4df; color: #946000; }
  .status-return { background: #fff0ed; color: #a33a2c; }
  .status-pending { background: #edf3ff; color: #315c9a; }
  .document-review small { display: block; margin-top: 5px; color: #819087; font-size: 9px; }
  .document-review p { margin: 5px 0 0; color: #65736a; font-size: 9px; line-height: 1.5; overflow-wrap: anywhere; }
  .document-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: flex-end; }
  .document-actions .view-button, .document-actions .approve-button, .document-actions .return-button { min-height: 32px; padding: 0 9px; font-size: 9px; }
  .completed-label { display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 0 9px; border-radius: 7px; background: #f2f5f2; color: #718078; font-size: 9px; white-space: nowrap; }
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
  @media (max-width: 1100px) {
    .member-group-heading { grid-template-columns: minmax(190px, 1fr) minmax(180px, 1fr); }
    .expand-button { grid-column: 1 / -1; justify-self: start; }
    .document-row { grid-template-columns: minmax(0, 1fr) minmax(150px, .8fr); }
    .document-actions { grid-column: 1 / -1; justify-content: flex-start; }
    .filters { grid-template-columns: minmax(0, 1fr) minmax(160px, .7fr); }
    .lga-filter { grid-column: 1 / -1; }
  }
  @media (max-width: 650px) {
    .page-intro { align-items: flex-start; flex-direction: column; }
    .filters { grid-template-columns: 1fr; }\n    .lga-filter { grid-column: auto; }
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