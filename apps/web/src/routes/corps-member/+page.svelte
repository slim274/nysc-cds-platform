<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    ApiError,
    getCurrentUser,
    getCorpsMemberPortal,
    getCorpsMemberDocuments,
    uploadCorpsMemberDocument,
    declineAssignedCdsGroup,
    listMyApprovedAttendance,
    logout,
    type CurrentUserResponse,
    type CorpsMemberPortalData,
    type CorpsMemberDocumentDashboard,
    type CorpsMemberDocumentRequirement,
    type CorpsMemberApprovedAttendance
  } from '#lib/api/client.ts';

  type DeclineReason =
    | 'schedule_conflict'
    | 'accessibility'
    | 'location'
    | 'personal'
    | 'other';

  let session = $state<CurrentUserResponse | null>(null);
  let portal = $state<CorpsMemberPortalData | null>(null);
  let documentDashboard = $state<CorpsMemberDocumentDashboard | null>(null);
  let approvedAttendance = $state<CorpsMemberApprovedAttendance[]>([]);
  let uploadingRequirementId = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let declineOpen = $state(false);
  let errorMessage = $state('');
  let noticeMessage = $state('');
  let declineReason = $state<DeclineReason>('personal');
  let declineNotes = $state('');
  let menuOpen = $state(false);

  // This is true only when the active President assignment belongs to the
  // same group as this member's active Corps Member placement.
  const isPresidentForAssignedGroup = $derived(
    session?.roles.some((role) => role.code === 'CDS_PRESIDENT') === true &&
    portal?.president?.userId === session?.user.id
  );

  onMount(() => {
    void loadPortal();
  });

  async function loadPortal() {
    loading = true;
    errorMessage = '';
    try {
      const current = await getCurrentUser();
      if (!current.roles.some((role) => role.code === 'CORPS_MEMBER')) {
        await logout();
        await goto('/login');
        return;
      }
      session = current;
      await loadMemberData();
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401) {
        errorMessage = error.message;
      } else {
        await goto('/login');
      }
    } finally {
      loading = false;
    }
  }

  async function loadMemberData() {
    const [portalData, documentsData, attendanceData] = await Promise.all([
      getCorpsMemberPortal(),
      getCorpsMemberDocuments(),
      listMyApprovedAttendance()
    ]);
    portal = portalData;
    documentDashboard = documentsData;
    approvedAttendance = attendanceData;
  }

  async function uploadDocument(requirement: CorpsMemberDocumentRequirement, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploadingRequirementId = requirement.id;
    errorMessage = '';
    noticeMessage = '';
    try {
      const result = await uploadCorpsMemberDocument(requirement.id, file);
      if (result.matching?.assigned && result.matching.groupName) {
        noticeMessage = `Your document was verified and you have been automatically matched to ${result.matching.groupName}.`;
      } else if (result.status === 'verified') {
        noticeMessage = 'Document verified. The system will match your course after every mandatory document is verified.';
      } else if (result.status === 'needs_resubmission') {
        noticeMessage = 'This document did not pass verification. Read the verification note and upload a corrected copy.';
      } else {
        noticeMessage = 'Document received. It has been sent for exception review before CDS matching can continue.';
      }
      await loadMemberData();
    } catch (error) {
      errorMessage = error instanceof ApiError || error instanceof Error
        ? error.message
        : 'Unable to upload this document.';
    } finally {
      uploadingRequirementId = '';
      input.value = '';
    }
  }

  function documentStatusLabel(status: string | undefined) {
    if (!status) return 'Not submitted';
    if (status === 'verified') return 'AI verified';
    if (status === 'needs_resubmission') return 'Resubmission required';
    if (status === 'manual_review') return 'Exception review';
    return 'Verifying';
  }

  async function submitDecline(event: SubmitEvent) {
    event.preventDefault();
    if (!portal?.cdsGroup) return;

    saving = true;
    errorMessage = '';
    noticeMessage = '';
    try {
      const declinedGroupName = portal.cdsGroup.name;
      await declineAssignedCdsGroup({
        reason: declineReason,
        notes: declineNotes.trim() || undefined
      });
      declineOpen = false;
      declineNotes = '';
      noticeMessage = `Your assignment to ${declinedGroupName} has been declined. Your LGI can now place you in another suitable CDS group.`;
      await loadMemberData();
    } catch (error) {
      errorMessage = error instanceof ApiError || error instanceof Error
        ? error.message
        : 'Unable to decline this CDS group assignment.';
    } finally {
      saving = false;
    }
  }

  async function signOut() {
    await logout();
    await goto('/login');
  }

  function fullName(person: { firstName: string; middleName: string | null; lastName: string }) {
    return [person.firstName, person.middleName, person.lastName].filter(Boolean).join(' ');
  }
</script>

<svelte:head>
  <title>Corps Member Portal | NYSC CDS Platform</title>
  <meta name="description" content="View your assigned CDS group, Coordinator, President and member information." />
</svelte:head>

<main class="page">
  <header class="topbar">
    <a href="/corps-member" class="brand" aria-label="NYSC CDS Corps Member Portal">
      <span class="brand-icon">N</span>
      <span class="brand-copy"><strong>NYSC CDS</strong><small>Corps Member Portal</small></span>
    </a>
    <div class="topbar-tools">
      {#if portal}<span class="member-code">{portal.member.stateCode}</span>{/if}
      <span class="role-label">Corps Member</span>
      <button class="menu-toggle" type="button" aria-label="Toggle navigation" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>☰</button>
    </div>
    <nav class:open={menuOpen} class="member-nav" aria-label="Corps Member navigation">
      <a class="active" href="/corps-member" onclick={() => (menuOpen = false)}>My portal</a>
      <a href="/corps-member/announcements" onclick={() => (menuOpen = false)}>Announcements</a>
      {#if isPresidentForAssignedGroup}
        <a class="president-nav-link" href="/cds-president" onclick={() => (menuOpen = false)}>President workspace <span>Active</span></a>
      {/if}
      <button class="signout" type="button" onclick={signOut}>Sign out</button>
    </nav>
  </header>

  {#if loading}
    <section class="card state-card"><div class="loader"></div><p>Loading your CDS assignment…</p></section>
  {:else if errorMessage && !portal}
    <section class="card state-card">
      <div class="badge badge-warning">PORTAL UNAVAILABLE</div>
      <h1>We couldn't load your member information</h1>
      <p>{errorMessage}</p>
      <button class="primary" onclick={() => void loadPortal()}>Try again</button>
    </section>
  {:else if portal}
    <section class="welcome">
      <div>
        <span class="eyebrow">CORPS MEMBER DASHBOARD</span>
        <h1>Welcome, {fullName(portal.member)}</h1>
        <p>Your NYSC record is connected. Your CDS group assignment and group contacts are shown below.</p>
      </div>
      <div class="account-chip">
        <span>Signed in as</span>
        <strong>{session?.user.email ?? 'Phone-based account'}</strong>
      </div>
    </section>

    {#if isPresidentForAssignedGroup && portal.cdsGroup}
      <section class="president-appointment" aria-label="Active CDS President appointment">
        <div class="appointment-icon" aria-hidden="true">★</div>
        <div class="appointment-copy">
          <div class="appointment-kicker"><span>ADDITIONAL RESPONSIBILITY</span><strong>CDS PRESIDENT</strong></div>
          <h2>You are the CDS President for {portal.cdsGroup.name}</h2>
          <p>Your Corps Member account remains your personal portal. Your President appointment gives you a separate workspace for your assigned group's leadership tasks.</p>
        </div>
        <a class="appointment-action" href="/cds-president">Open President workspace <span aria-hidden="true">→</span></a>
      </section>
    {/if}

    {#if noticeMessage}
      <div class="message success" role="status">{noticeMessage}</div>
    {/if}
    {#if errorMessage}
      <div class="message error" role="alert">{errorMessage}</div>
    {/if}

    <section class="member-summary" aria-label="Member information">
      <article class="summary-item"><span>NYSC State Code</span><strong>{portal.member.stateCode}</strong></article>
      <article class="summary-item"><span>Local Government Area</span><strong>{portal.member.lgaName ?? 'Not available'}</strong></article>
      <article class="summary-item"><span>Academic Course</span><strong>{portal.member.courseName ?? 'Not recorded'}</strong></article>
    </section>

    {#if documentDashboard}
      <section class="documents-card">
        <div class="documents-heading">
          <div>
            <span class="eyebrow">DOCUMENT CHECKLIST</span>
            <h2>Required documents</h2>
            <p>{documentDashboard.message}</p>
          </div>
          {#if documentDashboard.requiredDocumentsVerified}
            <span class="documents-complete">REQUIREMENTS VERIFIED</span>
          {/if}
        </div>

        {#if documentDashboard.requirements.length === 0}
          <div class="documents-empty">Your LGI has not configured the required documents for this LGA yet. You can continue using your account while the checklist is prepared.</div>
        {:else}
          <div class="document-list">
            {#each documentDashboard.requirements as requirement (requirement.id)}
              <article class="document-row">
                <div class="document-copy">
                  <div class="document-title">
                    <strong>{requirement.name}</strong>
                    <span class:optional={!requirement.isRequired} class="required-badge">{requirement.isRequired ? 'Mandatory' : 'Optional'}</span>
                  </div>
                  {#if requirement.description}<p>{requirement.description}</p>{/if}
                  <small>Accepted: {requirement.allowedMimeTypes.replaceAll('application/pdf','PDF').replaceAll('image/jpeg','JPEG').replaceAll('image/png','PNG')} · Max {Math.round(requirement.maxFileSizeBytes / (1024 * 1024))} MB</small>
                  {#if requirement.submission}
                    <div class="submission-detail">
                      <span class:status-verified={requirement.submission.status === 'verified'} class:status-warning={requirement.submission.status === 'manual_review' || requirement.submission.status === 'needs_resubmission'} class="submission-status">{documentStatusLabel(requirement.submission.status)}</span>
                      <span>{requirement.submission.originalFileName} · {new Date(requirement.submission.submittedAt).toLocaleDateString()}</span>
                    </div>
                    {#if requirement.submission.verificationReason}
                      <p class="verification-note">{requirement.submission.verificationReason}</p>
                    {/if}
                  {:else}
                    <div class="submission-detail"><span class="submission-status status-missing">Not submitted</span></div>
                  {/if}
                </div>
                {#if requirement.canResubmit}
                  <label class="document-upload">
                    {uploadingRequirementId === requirement.id ? 'Uploading…' : requirement.submission ? 'Upload corrected copy' : 'Upload document'}
                    <input type="file" accept={requirement.allowedMimeTypes} onchange={(event) => void uploadDocument(requirement, event)} disabled={Boolean(uploadingRequirementId)} />
                  </label>
                {:else if requirement.submission?.status === 'verified'}
                  <span class="verified-mark">✓ AI verified</span>
                {:else if requirement.submission?.status === 'manual_review'}
                  <span class="review-mark">Awaiting LGI review</span>
                {:else if requirement.submission?.status === 'pending_verification'}
                  <span class="pending-mark">Verification pending</span>
                {:else}
                  <span class="pending-mark">Check document status</span>
                {/if}
              </article>
            {/each}
          </div>
        {/if}
        <div class="verification-disclosure">
          Your uploaded documents are processed by the platform's document-verification service. Depending on configuration, document content may be sent to an external AI provider to compare the document type, reference sample and visible details against your NYSC record. Do not upload documents that were not requested.
        </div>
        <div class="matching-note">
          <strong>Automatic CDS matching</strong>
          <span>Your academic course is matched to an eligible CDS group only after all mandatory documents have passed verification.</span>
        </div>
      </section>
    {/if}

    {#if portal.cdsGroup}
      <section class="group-card">
        <div class="group-card-header">
          <div>
            <span class="eyebrow">YOUR CDS PLACEMENT</span>
            <h2>{portal.cdsGroup.name}</h2>
            <p class="group-code">{portal.cdsGroup.code}</p>
          </div>
          <span class="status-pill">ASSIGNED</span>
        </div>
        {#if portal.cdsGroup.description}
          <p class="group-description">{portal.cdsGroup.description}</p>
        {/if}
        <div class="assignment-meta">
          <span>Assigned {new Date(portal.cdsGroup.assignedAt).toLocaleDateString()}</span>
          <span class:automatic={portal.cdsGroup.source === 'automatic'} class="source-pill">
            {portal.cdsGroup.source === 'automatic' ? 'Automatically matched' : 'LGI placement'}
          </span>
        </div>
        {#if portal.cdsGroup.whatsappGroupLink}
          <section class="whatsapp-card">
            <div><span class="eyebrow">CDS WHATSAPP GROUP</span><strong>Join your CDS group on WhatsApp</strong><p>Connect with verified members and receive group updates. This invitation is available to members assigned to this CDS group.</p></div>
            <a class="whatsapp-join" href={portal.cdsGroup.whatsappGroupLink} target="_blank" rel="noopener noreferrer">Join WhatsApp Group <span aria-hidden="true">↗</span></a>
          </section>
        {:else}
          <div class="whatsapp-pending"><strong>WhatsApp group link not available yet</strong><span>Your CDS Coordinator has not added an invitation link for this group.</span></div>
        {/if}
        <div class="contacts-grid">
          <article class="contact-card">
            <span class="contact-icon">C</span>
            <div>
              <span class="contact-label">CDS Coordinator</span>
              {#if portal.coordinator}
                <strong>{portal.coordinator.email ?? 'Coordinator account active'}</strong>
                <small>Responsible for coordinating your CDS group.</small>
              {:else}
                <strong>Not yet assigned</strong>
                <small>Your LGI has not assigned a Coordinator to this group yet.</small>
              {/if}
            </div>
          </article>
          <article class="contact-card">
            <span class="contact-icon">P</span>
            <div>
              <span class="contact-label">CDS President</span>
              {#if portal.president}
                <strong>{fullName(portal.president)}{isPresidentForAssignedGroup ? ' (You)' : ''}</strong>
                {#if isPresidentForAssignedGroup}
                  <small class="self-president-note">This is your active President appointment.</small>
                {:else}
                  <small>{portal.president.stateCode}{portal.president.email ? ` · ${portal.president.email}` : ''}</small>
                {/if}
              {:else}
                <strong>Not yet designated</strong>
                <small>Your LGI has not designated a CDS President for this group yet.</small>
              {/if}
            </div>
          </article>
        </div>
        <div class="decline-area">
          <div>
            <strong>Unable to participate in this group?</strong>
            <p>You can decline this assignment and your LGI can place you in another suitable CDS group.</p>
          </div>
          <button class="decline-button" type="button" onclick={() => (declineOpen = true)}>Decline assignment</button>
        </div>
      </section>
    {:else}
      <section class="unassigned-card">
        <div class="unassigned-icon">◎</div>
        <span class="eyebrow">CDS PLACEMENT PENDING</span>
        <h2>You haven't been assigned to a CDS group yet</h2>
        <p>{documentDashboard?.requiredDocumentsVerified
          ? 'Your mandatory documents are verified. The system could not find an eligible group with available capacity for your academic course. Your LGI can review the exception.'
          : 'Complete the required document checklist above. Once every mandatory document is verified, the system will match your academic course to an eligible CDS group automatically.'}</p>
        <div class="unassigned-detail">
          <span>What happens next?</span>
          <strong>{documentDashboard?.requiredDocumentsVerified
            ? 'Your LGI can review the unassigned case and use manual placement only if needed.'
            : 'Submit your required documents. You do not need to select a CDS group yourself.'}</strong>
        </div>
      </section>
    {/if}

    <section class="attendance-history">
      <div class="attendance-heading"><div><span class="eyebrow">PARTICIPATION RECORD</span><h2>My CDS attendance</h2><p>Only registers approved by your CDS Coordinator appear here.</p></div><span class="attendance-count">{approvedAttendance.length} records</span></div>
      {#if approvedAttendance.length === 0}
        <div class="attendance-empty">Your approved attendance records will appear here after your CDS President submits the register and your Coordinator reviews it.</div>
      {:else}
        <div class="attendance-list">
          {#each approvedAttendance as record}
            <article class="attendance-record">
              <div><strong>{record.meetingTitle}</strong><small>{record.groupCode} · {record.groupName}</small><small>{new Date(record.startsAt).toLocaleString()}{record.venue ? ' · ' + record.venue : ''}</small></div>
              <span class:present={record.attendanceStatus === 'present'} class:absent={record.attendanceStatus === 'absent'} class:late={record.attendanceStatus === 'late'} class:excused={record.attendanceStatus === 'excused'} class="attendance-status">{record.attendanceStatus.replaceAll('_', ' ').toUpperCase()}</span>
            </article>
          {/each}
        </div>
      {/if}
    </section>
    <section class="coming-grid">
      <a class="announcement-link" href="/corps-member/announcements"><span class="coming-icon">◉</span><div><strong>Announcements</strong><p>Receive updates from your LGI and Coordinator.</p><small>View announcements →</small></div></a>
    </section>
  {/if}
</main>

{#if declineOpen && portal?.cdsGroup}
  <div class="modal-layer">
    <button class="modal-scrim" type="button" aria-label="Close decline form" onclick={() => (declineOpen = false)}></button>
    <section class="decline-modal" role="dialog" aria-modal="true" aria-labelledby="decline-title">
      <div class="modal-heading">
        <div>
          <span class="eyebrow">CDS GROUP ASSIGNMENT</span>
          <h2 id="decline-title">Decline {portal.cdsGroup.name}?</h2>
          <p>Your current group seat will be released. Your LGI will be able to place you in another suitable group.</p>
        </div>
        <button class="close-button" type="button" aria-label="Close" onclick={() => (declineOpen = false)} disabled={saving}>×</button>
      </div>
      <form onsubmit={submitDecline}>
        <label for="declineReason">Reason for declining</label>
        <select id="declineReason" bind:value={declineReason} disabled={saving}>
          <option value="schedule_conflict">Schedule conflict</option>
          <option value="accessibility">Accessibility or mobility limitation</option>
          <option value="location">Group location is not suitable</option>
          <option value="personal">Personal circumstances</option>
          <option value="other">Other reason</option>
        </select>
        <label for="declineNotes">Additional information <span>(optional)</span></label>
        <textarea id="declineNotes" bind:value={declineNotes} maxlength="1000" rows="4" placeholder="Tell your LGI anything they should consider when assigning another group." disabled={saving}></textarea>
        <div class="warning-note">Declining removes your active membership from this group. It does not deactivate your Corps Member account.</div>
        <div class="modal-actions">
          <button class="cancel-button" type="button" onclick={() => (declineOpen = false)} disabled={saving}>Keep my assignment</button>
          <button class="confirm-decline" type="submit" disabled={saving}>{saving ? 'Submitting…' : 'Confirm decline'}</button>
        </div>
      </form>
    </section>
  </div>
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #f3f6f4; color: #17251c; font-family: Inter, Arial, sans-serif; }
  :global(button), :global(input), :global(select), :global(textarea) { font: inherit; }
  .page { min-height: 100vh; padding: 24px clamp(16px, 4vw, 48px) 50px; }
  .topbar { width: min(100%, 1120px); margin: 0 auto 34px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .brand { display: flex; flex-direction: column; gap: 3px; color: #0a5c37; text-decoration: none; font-weight: 800; }
  .brand span { color: #718078; font-size: 12px; font-weight: 400; }
  .topbar-actions { display: flex; align-items: center; gap: 12px; }
  .member-code { padding: 8px 11px; border-radius: 20px; background: #e7f3eb; color: #0a5c37; font-size: 11px; font-weight: 700; }
  .signout { border: 1px solid #dce5de; border-radius: 8px; background: #fff; color: #314238; padding: 10px 16px; font-weight: 600; cursor: pointer; }
  .welcome,.member-summary,.group-card,.unassigned-card,.coming-grid,.message,.state-card { width: min(100%, 1120px); margin-left: auto; margin-right: auto; }
  .welcome { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; padding: 28px 30px; margin-bottom: 18px; border: 1px solid #dcebe0; border-radius: 14px; background: #eaf4ed; }
  .eyebrow { color: #0a8050; font-size: 10px; font-weight: 800; letter-spacing: 1.3px; }
  h1 { margin: 9px 0 7px; font-size: clamp(24px, 4vw, 32px); }
  .welcome p,.unassigned-card > p { max-width: 630px; margin: 0; color: #718078; font-size: 13px; line-height: 1.7; }
  .account-chip { display: grid; gap: 5px; min-width: 220px; padding: 12px 14px; border: 1px solid #dce7df; border-radius: 9px; background: #fff; }
  .account-chip span,.summary-item span { color: #718078; font-size: 10px; }
  .account-chip strong { color: #263d30; font-size: 11px; overflow-wrap: anywhere; }
  .message { padding: 12px 14px; margin-bottom: 16px; border-radius: 8px; font-size: 12px; line-height: 1.5; }
  .message.success { border: 1px solid #cce6d3; background: #eff8f1; color: #155b37; }
  .message.error { border: 1px solid #efceca; background: #fff3f2; color: #a32920; }
  .member-summary { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; margin-bottom: 18px; }
  .summary-item { display: grid; gap: 7px; padding: 15px 17px; border: 1px solid #e4ebe6; border-radius: 10px; background: #fff; }
  .summary-item strong { font-size: 13px; color: #263d30; }
  .group-card { padding: 26px; margin-bottom: 18px; border: 1px solid #e0e9e2; border-radius: 14px; background: #fff; box-shadow: 0 10px 30px #1936240a; }
  .group-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
  .group-card h2,.unassigned-card h2 { margin: 8px 0 4px; font-size: 23px; color: #183d29; }
  .group-code { margin: 0; color: #718078; font-size: 11px; font-weight: 700; letter-spacing: .5px; }
  .status-pill,.source-pill { display: inline-flex; align-items: center; padding: 7px 10px; border-radius: 18px; background: #e8f5ec; color: #0a6841; font-size: 9px; font-weight: 800; white-space: nowrap; }
  .group-description { margin: 17px 0 0; color: #718078; font-size: 12px; line-height: 1.6; }
  .assignment-meta { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; padding: 14px 0 17px; margin-top: 12px; border-bottom: 1px solid #edf1ed; color: #819087; font-size: 10px; }
  .source-pill { background: #f2f5f3; color: #647268; font-size: 8px; }
  .source-pill.automatic { background: #e8f5ec; color: #0a6841; }
  .whatsapp-card { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 17px 18px; margin-top: 18px; border: 1px solid #cfe5d5; border-radius: 10px; background: #f1f8f3; }
  .whatsapp-card > div { display: grid; gap: 6px; min-width: 0; }
  .whatsapp-card strong { color: #245c3c; font-size: 12px; }
  .whatsapp-card p { max-width: 620px; margin: 0; color: #718078; font-size: 10px; line-height: 1.6; }
  .whatsapp-join { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 10px 14px; border-radius: 8px; background: #16834d; color: #fff; font-size: 10px; font-weight: 800; text-decoration: none; }
  .whatsapp-pending { display: grid; gap: 5px; padding: 14px 16px; margin-top: 18px; border: 1px dashed #dce7de; border-radius: 9px; background: #fafcfa; }
  .whatsapp-pending strong { color: #53665a; font-size: 10px; }
  .whatsapp-pending span { color: #819087; font-size: 9px; line-height: 1.5; }
  .contacts-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; padding-top: 18px; }
  .contact-card { display: flex; align-items: flex-start; gap: 12px; padding: 16px; border: 1px solid #e8eee9; border-radius: 10px; background: #fbfdfb; }
  .contact-icon { width: 32px; height: 32px; flex: 0 0 32px; display: grid; place-items: center; border-radius: 9px; background: #e8f4ec; color: #0a6841; font-size: 12px; font-weight: 800; }
  .contact-card > div { display: grid; min-width: 0; gap: 6px; }
  .contact-label { color: #718078; font-size: 10px; }
  .contact-card strong { color: #263d30; font-size: 12px; overflow-wrap: anywhere; }
  .contact-card small { color: #819087; font-size: 10px; line-height: 1.5; }
  .decline-area { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding-top: 18px; margin-top: 20px; border-top: 1px solid #edf1ed; }
  .decline-area strong { color: #34483b; font-size: 11px; }
  .decline-area p { margin: 5px 0 0; color: #819087; font-size: 10px; line-height: 1.5; }
  .decline-button { flex: 0 0 auto; min-height: 39px; padding: 9px 13px; border: 1px solid #ead5d1; border-radius: 8px; background: #fff; color: #a34238; font-size: 10px; font-weight: 700; cursor: pointer; }
  .decline-button:hover { background: #fff5f3; }
  .unassigned-card { padding: 30px; margin-bottom: 18px; border: 1px solid #e4ebe6; border-radius: 14px; background: #fff; text-align: center; }
  .unassigned-icon { width: 42px; height: 42px; display: grid; place-items: center; margin: 0 auto 15px; border-radius: 13px; background: #f0f5f1; color: #0a8050; font-size: 23px; }
  .unassigned-card h2 { margin-bottom: 9px; }
  .unassigned-card > p { margin: 0 auto; }
  .unassigned-detail { display: grid; gap: 5px; width: min(100%, 530px); padding: 14px; margin: 20px auto 0; border-radius: 9px; background: #f3f7f4; text-align: left; }
  .unassigned-detail span { color: #718078; font-size: 10px; }
  .unassigned-detail strong { color: #245c3c; font-size: 11px; }

  .documents-card { width: min(100%, 1120px); padding: 24px; margin: 0 auto 18px; border: 1px solid #e4ebe6; border-radius: 14px; background: #fff; }
  .documents-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 16px; }
  .documents-heading h2 { margin: 7px 0 5px; font-size: 18px; color: #183d29; }
  .documents-heading p { max-width: 700px; margin: 0; color: #718078; font-size: 11px; line-height: 1.6; }
  .documents-complete { padding: 7px 10px; border-radius: 18px; background: #e8f5ec; color: #0a6841; font-size: 8px; font-weight: 800; white-space: nowrap; }
  .document-list { display: grid; }
  .document-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 14px 2px; border-bottom: 1px solid #edf1ed; }
  .document-row:last-child { border-bottom: 0; }
  .document-copy { display: grid; gap: 6px; min-width: 0; }
  .document-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .document-title strong { color: #263d30; font-size: 11px; }
  .required-badge { padding: 4px 7px; border-radius: 14px; background: #fff1e9; color: #92521e; font-size: 8px; font-weight: 800; }
  .required-badge.optional { background: #f0f3f1; color: #66756b; }
  .document-copy p { margin: 0; color: #718078; font-size: 10px; line-height: 1.5; }
  .document-copy small { color: #89948c; font-size: 9px; }
  .submission-detail { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: #819087; font-size: 9px; }
  .submission-status { padding: 5px 8px; border-radius: 14px; background: #f0f3f1; color: #66756b; font-size: 8px; font-weight: 800; }
  .submission-status.status-verified { background: #e8f5ec; color: #0a6841; }
  .submission-status.status-warning { background: #fff3e5; color: #92571b; }
  .submission-status.status-missing { background: #fff1e9; color: #92521e; }
  .verification-note { max-width: 760px; color: #96622e !important; font-size: 9px !important; }
  .document-upload { position: relative; flex: 0 0 auto; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 8px 11px; border: 1px solid #dce5de; border-radius: 7px; background: #fff; color: #355442; font-size: 9px; font-weight: 700; cursor: pointer; }
  .document-upload input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
  .document-upload:has(input:disabled) { opacity: .55; cursor: wait; }
  .verified-mark { padding: 8px 10px; color: #0a6841; font-size: 9px; font-weight: 800; white-space: nowrap; }
  .review-mark,.pending-mark { display:inline-flex; align-items:center; padding:7px 9px; border-radius:14px; background:#fff3e5; color:#92571b; font-size:8px; font-weight:800; white-space:nowrap; }
  .pending-mark { background:#f0f3f1; color:#66756b; }
  .documents-empty { padding: 18px; border: 1px dashed #dce7de; border-radius: 8px; background: #fafcfa; color: #718078; font-size: 10px; line-height: 1.6; }
  .verification-disclosure { padding: 11px 13px; margin-top: 14px; border: 1px solid #e9e5d7; border-radius: 8px; background: #fffaf0; color: #75684c; font-size: 9px; line-height: 1.6; }
  .matching-note { display: grid; gap: 5px; padding: 13px 15px; margin-top: 14px; border-radius: 9px; background: #f3f7f4; }
  .matching-note strong { color: #245c3c; font-size: 10px; }
  .matching-note span { color: #718078; font-size: 9px; line-height: 1.5; }
  .coming-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; }
  .coming-grid article { display: flex; align-items: flex-start; gap: 12px; padding: 16px; border: 1px solid #e4ebe6; border-radius: 10px; background: #fff; }
  .coming-icon { width: 32px; height: 32px; flex: 0 0 32px; display: grid; place-items: center; border-radius: 9px; background: #edf5ef; color: #0a6841; font-size: 14px; }
  .coming-grid strong { color: #34483b; font-size: 11px; }
  .coming-grid p { margin: 5px 0 8px; color: #819087; font-size: 10px; line-height: 1.5; }
  .coming-grid small { color: #0a8050; font-size: 9px; font-weight: 700; }
  .state-card { display: grid; justify-items: center; padding: 45px 20px; text-align: center; }
  .state-card h1 { font-size: 24px; }
  .state-card p { color: #718078; font-size: 13px; }
  .badge-warning { padding: 7px 11px; border-radius: 20px; background: #fff3e5; color: #92571b; font-size: 9px; font-weight: 800; }
  .primary { border: 0; border-radius: 8px; background: #0a5c37; color: white; padding: 11px 17px; font-size: 11px; font-weight: 700; cursor: pointer; }
  .loader { width: 27px; height: 27px; border: 3px solid #dce8df; border-top-color: #0a8050; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .modal-layer { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; overflow-y: auto; padding: 18px; }
  .modal-scrim { position: fixed; inset: 0; border: 0; background: #071b10a8; cursor: default; }
  .decline-modal { position: relative; width: min(100%, 520px); padding: 25px; border-radius: 14px; background: #fff; box-shadow: 0 22px 70px #071e1250; }
  .modal-heading { display: flex; justify-content: space-between; gap: 14px; padding-bottom: 16px; border-bottom: 1px solid #edf1ed; }
  .modal-heading h2 { margin: 8px 0 5px; font-size: 19px; }
  .modal-heading p { margin: 0; color: #718078; font-size: 11px; line-height: 1.6; }
  .close-button { width: 32px; height: 32px; flex: 0 0 32px; border: 1px solid #e0e8e1; border-radius: 8px; background: #fff; color: #44554a; font-size: 21px; cursor: pointer; }
  .decline-modal form { display: grid; gap: 9px; padding-top: 16px; }
  .decline-modal label { margin-top: 8px; color: #44554a; font-size: 11px; font-weight: 700; }
  .decline-modal label span { color: #819087; font-weight: 400; }
  .decline-modal select,.decline-modal textarea { width: 100%; min-height: 42px; padding: 10px 12px; border: 1px solid #dce5de; border-radius: 8px; background: #fff; color: #223328; font-size: 11px; }
  .decline-modal textarea { resize: vertical; }
  .warning-note { padding: 11px; border-radius: 8px; background: #fff8ed; color: #895c20; font-size: 10px; line-height: 1.5; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 12px; }
  .cancel-button,.confirm-decline { min-height: 39px; padding: 9px 13px; border-radius: 8px; font-size: 10px; font-weight: 700; cursor: pointer; }
  .cancel-button { border: 1px solid #dce5de; background: #fff; color: #44554a; }
  .confirm-decline { border: 1px solid #a34238; background: #a34238; color: #fff; }
  button:disabled { opacity: .6; cursor: not-allowed; }
  @media (max-width: 760px) {
    .welcome { align-items: flex-start; flex-direction: column; padding: 22px; }
    .account-chip { width: 100%; }
    .member-summary { grid-template-columns: 1fr; }
    .contacts-grid { grid-template-columns: 1fr; }
    .coming-grid { grid-template-columns: 1fr; }
    .group-card { padding: 20px; }
    .decline-area { align-items: flex-start; flex-direction: column; }
    .decline-button { width: 100%; }
  }
  @media (max-width: 480px) {
    .page { padding-inline: 12px; }
    .topbar { margin-bottom: 20px; }
    .topbar-actions { gap: 7px; }
    .member-code { font-size: 9px; }
    .signout { padding: 9px 11px; font-size: 10px; }
    .group-card-header { flex-direction: column; }
    .assignment-meta { align-items: flex-start; flex-direction: column; }
    .modal-layer { padding: 10px; }
    .decline-modal { padding: 19px; }
    .modal-actions { flex-direction: column-reverse; }
    .modal-actions button { width: 100%; }
  }
  @media (prefers-reduced-motion: reduce) { .loader { animation-duration: 1.8s; } }
  @media (max-width: 560px) { .whatsapp-card { align-items: stretch; flex-direction: column; } .whatsapp-join { width: 100%; } }

  /* Corps Member portal shell and dual-role appointment presentation. */
  .topbar {
    min-height: 70px;
    margin-bottom: 28px;
    padding: 10px 0;
    border-bottom: 1px solid #e1e9e3;
  }
  .brand {
    flex-direction: row;
    align-items: center;
    gap: 10px;
    flex: 0 0 auto;
  }
  .brand-icon {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: #0a5c37;
    color: #fff;
    font-size: 21px;
    font-weight: 800;
  }
  .brand-copy strong, .brand-copy small { display: block; }
  .brand-copy strong { color: #0a5c37; font-size: 13px; }
  .brand-copy small { margin-top: 3px; color: #819087; font-size: 9px; font-weight: 400; }
  .topbar-tools { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .role-label { padding: 7px 9px; border: 1px solid #dce9df; border-radius: 18px; background: #f4f8f5; color: #496652; font-size: 9px; font-weight: 700; white-space: nowrap; }
  .member-code { font-variant-numeric: tabular-nums; }
  .member-nav { display: flex; align-items: center; gap: 17px; margin-left: 20px; }
  .member-nav > a { color: #65776b; font-size: 10px; font-weight: 700; text-decoration: none; white-space: nowrap; }
  .member-nav > a:hover, .member-nav > a.active { color: #0a6841; }
  .member-nav .president-nav-link { display: inline-flex; align-items: center; gap: 7px; color: #0a6841; }
  .president-nav-link span { padding: 3px 6px; border-radius: 10px; background: #e8f5ec; color: #0a6841; font-size: 8px; font-weight: 800; }
  .menu-toggle { display: none; min-width: 38px; min-height: 38px; border: 1px solid #dce5de; border-radius: 8px; background: #fff; color: #24543a; cursor: pointer; }
  .signout { min-height: 36px; padding: 8px 12px; font-size: 10px; }
  .welcome { position: relative; overflow: hidden; align-items: center; padding: 30px 32px; background: linear-gradient(112deg, #eaf4ed 0%, #f5faf6 75%, #e7f3ea 100%); }
  .welcome:after { content: ""; position: absolute; width: 220px; height: 220px; right: 26%; top: -145px; border: 1px solid #cfe3d3; border-radius: 50%; pointer-events: none; }
  .welcome > div:first-child { position: relative; z-index: 1; }
  .welcome h1 { letter-spacing: -.5px; }
  .account-chip { position: relative; z-index: 1; }
  .president-appointment {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    width: min(100%, 1120px);
    padding: 18px 20px;
    margin: 0 auto 18px;
    border: 1px solid #cfe4d4;
    border-radius: 12px;
    background: linear-gradient(105deg, #f0f8f2, #fff 78%);
    box-shadow: 0 8px 22px #19362408;
  }
  .appointment-icon { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 12px; background: #0a5c37; color: #fff; font-size: 18px; }
  .appointment-copy { min-width: 0; }
  .appointment-kicker { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .appointment-kicker span { color: #718078; font-size: 8px; font-weight: 800; letter-spacing: 1px; }
  .appointment-kicker strong { padding: 4px 7px; border-radius: 12px; background: #e1f1e6; color: #0a6841; font-size: 8px; letter-spacing: .4px; }
  .appointment-copy h2 { margin: 6px 0 4px; color: #183d29; font-size: 15px; }
  .appointment-copy p { max-width: 700px; margin: 0; color: #718078; font-size: 10px; line-height: 1.6; }
  .appointment-action { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 40px; padding: 10px 13px; border: 1px solid #0a5c37; border-radius: 8px; background: #0a5c37; color: #fff; font-size: 10px; font-weight: 800; text-decoration: none; white-space: nowrap; }
  .appointment-action:hover { background: #064526; }
  .self-president-note { color: #0a6841 !important; font-weight: 700; }
  .summary-item { min-height: 78px; }
  .documents-card, .group-card, .attendance-history, .unassigned-card { box-shadow: 0 8px 24px #19362407; }
  .documents-card { padding: 26px; }
  .documents-heading h2, .attendance-heading h2 { letter-spacing: -.2px; }
  .document-row { padding: 17px 3px; }
  .contact-card { min-height: 84px; }
  .attendance-history{padding:20px;margin-top:18px;border:1px solid #e5ebe6;border-radius:11px;background:#fff}.attendance-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px}.attendance-heading h2{margin:7px 0 5px;font-size:16px}.attendance-heading p{margin:0;color:#819087;font-size:10px;line-height:1.5}.attendance-count{padding:6px 9px;border-radius:16px;background:#e8f5ec;color:#0a6841;font-size:9px;font-weight:800;white-space:nowrap}.attendance-list{display:grid;gap:7px}.attendance-record{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px;border-radius:8px;background:#f7f9f7}.attendance-record strong,.attendance-record small{display:block}.attendance-record strong{color:#344b3b;font-size:10px}.attendance-record small{margin-top:4px;color:#819087;font-size:9px}.attendance-status{padding:6px 9px;border-radius:18px;background:#f0f3f1;color:#52675a;font-size:8px;font-weight:800;white-space:nowrap}.attendance-status.present{background:#e8f5ec;color:#087443}.attendance-status.absent{background:#fff0ef;color:#a32920}.attendance-status.late{background:#fff4df;color:#9c6500}.attendance-status.excused{background:#eaf2ff;color:#315d9a}.attendance-empty{padding:22px 14px;border-radius:8px;background:#f7f9f7;color:#819087;font-size:10px;line-height:1.7}@media(max-width:560px){.attendance-history{padding:15px}.attendance-record{align-items:flex-start;flex-direction:column}.attendance-heading{flex-direction:column}}

  @media (max-width: 980px) {
    .topbar { flex-wrap: wrap; gap: 10px; }
    .topbar-tools { margin-left: auto; }
    .menu-toggle { display: inline-grid; place-items: center; }
    .member-nav { display: none; width: 100%; margin: 6px 0 0; padding: 12px; border: 1px solid #e3ebe5; border-radius: 10px; background: #fff; }
    .member-nav.open { display: flex; flex-wrap: wrap; align-items: center; gap: 13px 18px; }
    .member-nav .signout { margin-left: auto; }
    .president-appointment { grid-template-columns: auto minmax(0, 1fr); }
    .appointment-action { grid-column: 2; justify-self: start; }
  }
  @media (max-width: 620px) {
    .page { padding: 14px 12px 34px; }
    .topbar { margin-bottom: 18px; padding: 8px 0 12px; }
    .topbar-tools { gap: 6px; }
    .member-code { padding: 7px 8px; font-size: 8px; }
    .role-label { display: none; }
    .member-nav.open { align-items: stretch; flex-direction: column; }
    .member-nav .signout { width: 100%; margin-left: 0; }
    .welcome { padding: 21px 18px; }
    .welcome h1 { font-size: 25px; }
    .president-appointment { grid-template-columns: auto minmax(0, 1fr); gap: 11px; padding: 14px; }
    .appointment-icon { width: 36px; height: 36px; font-size: 15px; }
    .appointment-copy h2 { font-size: 13px; line-height: 1.35; }
    .appointment-copy p { font-size: 9px; }
    .appointment-action { grid-column: 1 / -1; width: 100%; }
    .documents-card, .group-card { padding: 18px 15px; }
    .documents-heading { flex-direction: column; }
    .document-row { align-items: stretch; flex-direction: column; gap: 11px; }
    .document-upload, .verified-mark, .review-mark, .pending-mark { align-self: flex-start; }
    .contacts-grid { grid-template-columns: 1fr; }
    .attendance-history { padding: 15px; }
    .attendance-record { align-items: flex-start; flex-direction: column; }
  }
</style>
