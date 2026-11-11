<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import LgiSidebar from '#lib/components/LgiSidebar.svelte';
  import {
    ApiError,
    getCurrentUser,
    getCdsGroupReferenceData,
    listLgiDocumentRequirements,
    createLgiDocumentRequirement,
    updateLgiDocumentRequirement,
    removeLgiDocumentRequirement,
    uploadDocumentReferenceSample,
    listLgiDocumentSubmissions,
    downloadLgiDocumentSubmission,
    decideLgiDocumentManualReview,
    logout
  } from '#lib/api/client.ts';
  import type {
    AuthUser,
    LgiDocumentRequirement,
    LgiDocumentSubmission
  } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let lgas = $state<Array<{ id: string; name: string; stateName: string }>>([]);
  let requirements = $state<LgiDocumentRequirement[]>([]);
  let exceptions = $state<LgiDocumentSubmission[]>([]);
  let selectedLga = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let uploadingId = $state('');
  let reviewingId = $state('');
  let signingOut = $state(false);
  let mobileNavOpen = $state(false);
  let formOpen = $state(false);
  let editingRequirement = $state<LgiDocumentRequirement | null>(null);
  let errorMessage = $state('');
  let noticeMessage = $state('');
  let formError = $state('');

  let form = $state({
    code: '',
    name: '',
    description: '',
    isRequired: true,
    allowPdf: true,
    allowJpeg: true,
    allowPng: true,
    maxSizeMb: 10
  });

  const activeCount = $derived(requirements.filter((item) => item.isActive).length);
  const requiredCount = $derived(requirements.filter((item) => item.isActive && item.isRequired).length);
  const draftCount = $derived(requirements.filter((item) => !item.isActive).length);
  const remainingSlots = $derived(Math.max(0, 5 - activeCount));

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
      const refs = await getCdsGroupReferenceData();
      lgas = refs.lgas;
      if (!selectedLga && lgas.length > 0) selectedLga = lgas[0].id;
      await loadLists();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load document requirements.';
    } finally {
      loading = false;
    }
  }

  async function loadLists() {
    const [allRequirements, reviewQueue] = await Promise.all([
      listLgiDocumentRequirements(),
      listLgiDocumentSubmissions('manual_review')
    ]);
    requirements = allRequirements.filter((item) => item.lgaId === selectedLga);
    exceptions = reviewQueue;
  }

  function resetForm() {
    editingRequirement = null;
    form = {
      code: '',
      name: '',
      description: '',
      isRequired: true,
      allowPdf: true,
      allowJpeg: true,
      allowPng: true,
      maxSizeMb: 10
    };
    formError = '';
  }

  function openEditForm(requirement: LgiDocumentRequirement) {
    editingRequirement = requirement;
    form = {
      code: requirement.code,
      name: requirement.name,
      description: requirement.description ?? '',
      isRequired: requirement.isRequired,
      allowPdf: requirement.allowedMimeTypes.includes('application/pdf'),
      allowJpeg: requirement.allowedMimeTypes.includes('image/jpeg'),
      allowPng: requirement.allowedMimeTypes.includes('image/png'),
      maxSizeMb: Math.round(requirement.maxFileSizeBytes / (1024 * 1024))
    };
    formError = '';
    formOpen = true;
  }

  async function saveRequirement(event: SubmitEvent) {
    event.preventDefault();
    formError = '';
    const allowedMimeTypes = [
      form.allowPdf ? 'application/pdf' : null,
      form.allowJpeg ? 'image/jpeg' : null,
      form.allowPng ? 'image/png' : null
    ].filter((value): value is string => Boolean(value));

    if (allowedMimeTypes.length === 0) {
      formError = 'Select at least one accepted document format.';
      return;
    }
    saving = true;
    try {
      const input = {
        code: form.code,
        name: form.name,
        description: form.description.trim() || null,
        isRequired: form.isRequired,
        allowedMimeTypes,
        maxFileSizeBytes: Math.round(form.maxSizeMb * 1024 * 1024)
      };
      if (editingRequirement) {
        await updateLgiDocumentRequirement(editingRequirement.id, input);
        noticeMessage = 'Document requirement updated. The published checklist will reflect the changes.';
      } else {
        await createLgiDocumentRequirement({
          lgaId: selectedLga,
          ...input,
          isActive: false
        });
        noticeMessage = 'Requirement saved as a draft. Upload its reference sample if mandatory, then enable it to publish the item to Corps Members and Coordinators.';
      }
      formOpen = false;
      resetForm();
      await loadLists();
    } catch (error) {
      formError = error instanceof ApiError || error instanceof Error ? error.message : 'Unable to create this document requirement.';
    } finally {
      saving = false;
    }
  }

  async function toggleRequirement(requirement: LgiDocumentRequirement) {
    errorMessage = '';
    noticeMessage = '';
    if (!requirement.isActive && activeCount >= 5) {
      errorMessage = 'You already have five enabled document requirements for this LGA. Disable one before enabling another.';
      return;
    }
    const next = !requirement.isActive;
    if (next && requirement.isRequired && !requirement.hasReferenceSample) {
      errorMessage = 'Upload a reference sample before enabling this mandatory requirement.';
      return;
    }
    try {
      await updateLgiDocumentRequirement(requirement.id, { isActive: next });
      noticeMessage = next
        ? `${requirement.name} is now enabled and visible to Corps Members and their assigned Coordinators.`
        : `${requirement.name} has been disabled and hidden from new Corps Member checklists.`;
      await loadLists();
    } catch (error) {
      errorMessage = error instanceof ApiError || error instanceof Error
        ? error.message
        : 'Unable to update this document requirement.';
    }
  }

  async function removeRequirement(requirement: LgiDocumentRequirement) {
    const confirmed = window.confirm(
      `Remove "${requirement.name}"? If submissions already exist, the requirement will be archived to preserve the submission history.`
    );
    if (!confirmed) return;
    errorMessage = '';
    noticeMessage = '';
    try {
      const result = await removeLgiDocumentRequirement(requirement.id);
      noticeMessage = result.archived
        ? `${requirement.name} was archived because submission history exists.`
        : `${requirement.name} was deleted.`;
      await loadLists();
    } catch (error) {
      errorMessage = error instanceof ApiError || error instanceof Error
        ? error.message
        : 'Unable to remove this document requirement.';
    }
  }

  async function handleReferenceUpload(requirementId: string, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploadingId = requirementId;
    errorMessage = '';
    noticeMessage = '';
    try {
      await uploadDocumentReferenceSample(requirementId, file);
      noticeMessage = 'Reference sample uploaded successfully.';
      await loadLists();
    } catch (error) {
      errorMessage = error instanceof ApiError || error instanceof Error ? error.message : 'Unable to upload reference sample.';
    } finally {
      uploadingId = '';
      input.value = '';
    }
  }

  async function openSubmissionFile(submissionId: string) {
    errorMessage = '';
    try {
      const blob = await downloadLgiDocumentSubmission(submissionId);
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) {
        const link = document.createElement('a');
        link.href = url;
        link.download = 'corps-member-document';
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      errorMessage = error instanceof ApiError || error instanceof Error
        ? error.message
        : 'Unable to open the submitted document.';
    }
  }

  async function resolveException(submission: LgiDocumentSubmission, decision: 'verified' | 'needs_resubmission') {
    const promptText = decision === 'verified'
      ? 'Explain why this document is accepted for the exception review (minimum 10 characters):'
      : 'Explain what the Corps Member must correct and resubmit (minimum 10 characters):';
    const reason = window.prompt(promptText);
    if (reason === null) return;
    if (reason.trim().length < 10) {
      errorMessage = 'Please enter a review note of at least 10 characters.';
      return;
    }
    reviewingId = submission.id;
    errorMessage = '';
    noticeMessage = '';
    try {
      await decideLgiDocumentManualReview(submission.id, decision, reason.trim());
      noticeMessage = decision === 'verified'
        ? 'Exception reviewed. The system will run matching once all mandatory documents are verified.'
        : 'Document returned for resubmission.';
      await loadLists();
    } catch (error) {
      errorMessage = error instanceof ApiError || error instanceof Error ? error.message : 'Unable to save the exception decision.';
    } finally {
      reviewingId = '';
    }
  }

  async function handleLogout() {
    signingOut = true;
    try { await logout(); } catch (error) { console.error('Logout failed:', error); }
    finally { await goto('/login'); }
  }
</script>

<svelte:head>
  <title>Document Requirements | NYSC CDS Platform</title>
  <meta name="description" content="Configure Corps Member document requirements and review verification exceptions." />
</svelte:head>

{#if loading}
  <main class="state-screen"><div class="loader"></div><p>Loading document requirements…</p></main>
{:else if errorMessage && !currentUser}
  <main class="state-screen"><h2>Unable to open Document Requirements</h2><p>{errorMessage}</p><button class="primary-button" onclick={() => goto('/login')}>Return to login</button></main>
{:else}
  <div class="admin-shell">
    <LgiSidebar activePath="/lgi/document-requirements" open={mobileNavOpen} signingOut={signingOut} onClose={() => (mobileNavOpen = false)} onSignOut={handleLogout} />
    <section class="main-area">
      <header class="topbar">
        <div class="heading">
          <button class="menu-button" type="button" aria-label="Open navigation menu" aria-expanded={mobileNavOpen} onclick={() => (mobileNavOpen = !mobileNavOpen)}><span></span><span></span><span></span></button>
          <div><span class="breadcrumb">Administration / Document Requirements</span><h1>Document Requirements</h1></div>
        </div>
        <div class="account"><div class="avatar">LG</div><div><strong>LGI Administrator</strong><span>{currentUser?.email}</span></div></div>
      </header>

      <main class="page-content">
        {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}
        {#if noticeMessage}<div class="message success" role="status">{noticeMessage}</div>{/if}

        <section class="intro">
          <div><span class="eyebrow">CORPS MEMBER DOCUMENTS</span><h2>Configure required documents</h2><p>Create up to five enabled requirements for each LGA. Save items as drafts, edit them at any time, upload reference samples, and enable or disable publication. Only enabled items appear on Corps Member and Coordinator checklists.</p></div>
          <button class="primary-button" type="button" onclick={() => { resetForm(); formOpen = true; }} disabled={!selectedLga}>＋ Add requirement</button>
        </section>

        <section class="stats">
          <article><span>Enabled requirements</span><strong>{activeCount} / 5</strong></article>
          <article><span>Draft / disabled items</span><strong>{draftCount}</strong></article>
          <article><span>AI exception queue</span><strong>{exceptions.length}</strong></article>
        </section>

        <section class="panel">
          <div class="panel-heading"><div><h2>Document checklist</h2><p>Requirements are configured per LGA.</p></div></div>
          <label class="lga-filter"><span>Local Government Area</span><select bind:value={selectedLga} onchange={() => void loadLists()}>{#each lgas as lga}<option value={lga.id}>{lga.name}, {lga.stateName}</option>{/each}</select></label>

          {#if requirements.length === 0}
            <div class="empty"><h3>No document requirements configured</h3><p>Add the required documents for this LGA. Examples include NYSC Call-up Letter, Statement of Result, Degree/HND Certificate and NYSC ID.</p><button class="primary-button" type="button" onclick={() => { resetForm(); formOpen = true; }}>Create first requirement</button></div>
          {:else}
            <div class="requirement-list">
              {#each requirements as requirement (requirement.id)}
                <article class="requirement-row">
                  <div class="requirement-info">
                    <div class="doc-icon">▤</div>
                    <div><div class="title-line"><h3>{requirement.name}</h3><span class:optional={!requirement.isRequired} class="requirement-badge">{requirement.isRequired ? 'Mandatory' : 'Optional'}</span></div><p>{requirement.code}{requirement.description ? ` · ${requirement.description}` : ''}</p><small>Accepts {requirement.allowedMimeTypes.replaceAll('application/pdf', 'PDF').replaceAll('image/jpeg', 'JPEG').replaceAll('image/png', 'PNG')} · Max {Math.round(requirement.maxFileSizeBytes / (1024 * 1024))} MB</small></div>
                  </div>
                  <div class="reference-area">
                    {#if requirement.hasReferenceSample}
                      <span class="sample-status">✓ Reference sample: {requirement.referenceFileName ?? 'Uploaded'}</span>
                    {:else}
                      <span class="no-sample">No reference sample uploaded</span>
                    {/if}
                    <label class="upload-button">
                      {uploadingId === requirement.id ? 'Uploading…' : requirement.hasReferenceSample ? 'Replace sample' : 'Upload sample'}
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onchange={(event) => void handleReferenceUpload(requirement.id, event)} disabled={uploadingId === requirement.id} />
                    </label>
                    <span class:published-badge={requirement.isActive} class="publication-badge">{requirement.isActive ? 'Enabled · Published' : 'Draft / Disabled'}</span>
                    <div class="requirement-actions">
                      <button class="action-button" type="button" onclick={() => openEditForm(requirement)}>Edit</button>
                      <button class:turn-off={!requirement.isActive} class="action-button" type="button" onclick={() => void toggleRequirement(requirement)}>{requirement.isActive ? 'Disable' : 'Enable'}</button>
                      <button class="remove-button" type="button" onclick={() => void removeRequirement(requirement)}>Remove</button>
                    </div>
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </section>

        <section class="panel exceptions-panel">
          <div class="panel-heading"><div><h2>AI exception review</h2><p>Only unclear or low-confidence submissions need an LGI decision. High-confidence matches are approved automatically.</p></div><span class="queue-badge">{exceptions.length} awaiting review</span></div>
          {#if exceptions.length === 0}
            <div class="empty compact"><h3>No documents awaiting exception review</h3><p>Submissions that the AI cannot confidently assess will appear here.</p></div>
          {:else}
            <div class="exception-list">
              {#each exceptions as submission (submission.id)}
                <article class="exception-row">
                  <div><strong>{submission.lastName}, {submission.firstName} {submission.middleName ?? ''}</strong><span>{submission.stateCode} · {submission.requirementName}</span><small>{submission.fileName} · {new Date(submission.submittedAt).toLocaleString()}</small><p>{submission.reason ?? 'The verification service needs further review.'}</p></div>
                  <div class="exception-actions"><span>{submission.confidence === null ? 'No confidence score' : `Confidence: ${submission.confidence}%`}</span><div><button class="view-button" type="button" onclick={() => void openSubmissionFile(submission.id)}>View document</button><button class="approve-button" type="button" onclick={() => void resolveException(submission, 'verified')} disabled={reviewingId === submission.id}>{reviewingId === submission.id ? 'Saving…' : 'Mark verified'}</button><button class="reject-button" type="button" onclick={() => void resolveException(submission, 'needs_resubmission')} disabled={reviewingId === submission.id}>Request resubmission</button></div></div>
                </article>
              {/each}
            </div>
          {/if}
        </section>
      </main>
      <footer class="footer">NYSC CDS Management Platform · Document verification exceptions only.</footer>
    </section>
  </div>
{/if}

{#if formOpen}
  <div class="modal-layer">
    <button class="scrim" type="button" aria-label="Close form" onclick={() => (formOpen = false)}></button>
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="requirement-title">
      <header class="modal-header"><div><span class="eyebrow">DOCUMENT CONFIGURATION</span><h2 id="requirement-title">{editingRequirement ? 'Edit document requirement' : 'Create document requirement'}</h2><p>Configure the checklist item for {selectedLga ? lgas.find((lga) => lga.id === selectedLga)?.name : 'this LGA'}. New items are saved as drafts until enabled.</p></div><button class="close" type="button" aria-label="Close" onclick={() => (formOpen = false)}>×</button></header>
      {#if formError}<div class="message error" role="alert">{formError}</div>{/if}
      <form class="requirement-form" onsubmit={saveRequirement}>
        <label><span>Requirement code *</span><input bind:value={form.code} placeholder="e.g. CALL_UP_LETTER" minlength="2" maxlength="50" required /></label>
        <label><span>Document name *</span><input bind:value={form.name} placeholder="e.g. NYSC Call-up Letter" minlength="3" maxlength="160" required /></label>
        <label><span>Description</span><textarea bind:value={form.description} rows="3" maxlength="2000" placeholder="What should the Corps Member submit?"></textarea></label>
        <label class="check-line"><input type="checkbox" bind:checked={form.isRequired} /><span>Mandatory document (required before CDS matching)</span></label>
        <fieldset><legend>Accepted file formats *</legend><label class="check-line"><input type="checkbox" bind:checked={form.allowPdf} /><span>PDF</span></label><label class="check-line"><input type="checkbox" bind:checked={form.allowJpeg} /><span>JPEG</span></label><label class="check-line"><input type="checkbox" bind:checked={form.allowPng} /><span>PNG</span></label></fieldset>
        <label><span>Maximum file size (MB)</span><input type="number" bind:value={form.maxSizeMb} min="1" max="50" required /></label>
        <div class="info-note">New items are saved as drafts. Upload a reference sample, then enable the requirement to publish it to Corps Members and Coordinators. Mandatory items require a reference sample before they can be enabled. No more than five requirements can be enabled per LGA.</div>
        <div class="modal-actions"><button class="secondary-button" type="button" onclick={() => (formOpen = false)} disabled={saving}>Cancel</button><button class="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : editingRequirement ? 'Save changes' : 'Save as draft'}</button></div>
      </form>
    </section>
  </div>
{/if}

<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#f5f7f5;color:#19251e;font-family:Inter,Arial,sans-serif}:global(button),:global(input),:global(select),:global(textarea){font:inherit}
  .admin-shell{min-height:100vh;display:flex}.main-area{min-width:0;flex:1}.topbar{min-height:76px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 30px;border-bottom:1px solid #e5ebe6;background:#fff}.heading{display:flex;align-items:center;gap:12px}.breadcrumb{color:#819087;font-size:10px}.topbar h1{margin:7px 0 0;font-size:21px}.account{display:flex;align-items:center;gap:10px}.avatar{width:36px;height:36px;display:grid;place-items:center;border-radius:50%;background:#e7f3eb;color:#0a6841;font-weight:800}.account strong,.account span{display:block}.account strong{font-size:11px}.account span{margin-top:4px;color:#819087;font-size:9px}
  .page-content{max-width:1200px;padding:30px;margin:0 auto}.intro{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:26px 29px;border:1px solid #dcebe0;border-radius:12px;background:#eaf4ed}.eyebrow{color:#0a8050;font-size:9px;font-weight:800;letter-spacing:1.2px}.intro h2{margin:9px 0 7px;font-size:22px}.intro p{max-width:800px;margin:0;color:#718078;font-size:11px;line-height:1.7}.primary-button,.secondary-button{min-height:38px;padding:9px 13px;border-radius:7px;font-size:9px;font-weight:700;cursor:pointer;white-space:nowrap}.primary-button{border:1px solid #0a5c37;background:#0a5c37;color:#fff}.secondary-button{border:1px solid #dce5de;background:#fff;color:#355442}.primary-button:disabled,.secondary-button:disabled{opacity:.5;cursor:not-allowed}
  .stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}.stats article{display:grid;gap:7px;padding:15px;border:1px solid #e4ebe6;border-radius:9px;background:#fff}.stats span{color:#819087;font-size:10px}.stats strong{color:#0a5c37;font-size:21px}
  .panel{padding:20px;margin-bottom:16px;border:1px solid #e4ebe6;border-radius:10px;background:#fff}.panel-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.panel-heading h2{margin:0 0 5px;font-size:14px}.panel-heading p{margin:0;color:#819087;font-size:10px;line-height:1.5}.lga-filter{display:grid;grid-template-columns:minmax(230px,360px);gap:6px;margin-bottom:14px;color:#56685c;font-size:9px;font-weight:700}.lga-filter select{min-height:39px;padding:9px 11px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#26392d;font-size:10px}
  .publication-badge{display:inline-flex;align-items:center;padding:5px 8px;border-radius:14px;background:#f2f4f2;color:#6d7a70;font-size:8px;font-weight:800;white-space:nowrap}
  .publication-badge.published-badge{background:#e8f6ec;color:#147244}
  .requirement-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .action-button,.remove-button{min-height:31px;padding:7px 9px;border:1px solid #dce5de;border-radius:6px;background:#fff;color:#355442;font-size:8px;font-weight:700;cursor:pointer}
  .action-button.turn-off{background:#0a5c37;border-color:#0a5c37;color:#fff}
  .remove-button{border-color:#eed5d1;color:#a34238}
  .requirement-list,.exception-list{display:grid}.requirement-row,.exception-row{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px 3px;border-bottom:1px solid #edf1ed}.requirement-row:last-child,.exception-row:last-child{border-bottom:0}.requirement-info{display:flex;align-items:flex-start;gap:12px;min-width:0}.doc-icon{width:34px;height:34px;flex:0 0 34px;display:grid;place-items:center;border-radius:9px;background:#edf5ef;color:#0a6841}.title-line{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.title-line h3{margin:0;color:#263d30;font-size:11px}.requirement-info p{margin:5px 0;color:#718078;font-size:9px;line-height:1.5}.requirement-info small{color:#8a968e;font-size:8px}.requirement-badge,.queue-badge{padding:5px 8px;border-radius:15px;background:#e8f6ec;color:#147244;font-size:8px;font-weight:800}.requirement-badge.optional{background:#f0f3f1;color:#66756b}.reference-area{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:9px}.sample-status,.no-sample{color:#147244;font-size:9px}.no-sample{color:#a36a2d}.upload-button{position:relative;overflow:hidden;display:inline-flex;align-items:center;min-height:34px;padding:8px 10px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#355442;font-size:9px;font-weight:700;cursor:pointer}.upload-button input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
  .queue-badge{background:#fff3e5;color:#92571b}.exception-row>div:first-child{display:grid;gap:5px;min-width:0}.exception-row strong{color:#263d30;font-size:10px}.exception-row span,.exception-row small{color:#819087;font-size:9px}.exception-row p{margin:3px 0 0;color:#8b6135;font-size:9px;line-height:1.5}.exception-actions{display:grid;justify-items:end;gap:8px;min-width:225px}.exception-actions>span{color:#8b6135;font-size:9px}.exception-actions>div{display:flex;gap:6px}.view-button{min-height:32px;padding:7px 9px;border:1px solid #dce5de;border-radius:6px;background:#fff;color:#355442;font-size:8px;font-weight:700;cursor:pointer}.approve-button,.reject-button{min-height:32px;padding:7px 9px;border-radius:6px;font-size:8px;font-weight:700;cursor:pointer}.approve-button{border:1px solid #0a6841;background:#0a6841;color:#fff}.reject-button{border:1px solid #ead5d1;background:#fff;color:#a34238}.approve-button:disabled,.reject-button:disabled{opacity:.5;cursor:wait}
  .empty{padding:32px 14px;text-align:center;color:#819087;font-size:10px;line-height:1.6}.empty h3{margin:0 0 6px;color:#263d30;font-size:13px}.empty p{margin:0 auto 12px;max-width:560px}.empty.compact{padding:22px}.message{padding:10px 13px;margin:0 0 12px;border-radius:7px;font-size:10px}.message.error{border:1px solid #efceca;background:#fff3f2;color:#a32920}.message.success{border:1px solid #cce6d3;background:#eef8f0;color:#16633b}.footer{padding:17px 24px;border-top:1px solid #e5ebe6;color:#89948c;font-size:9px;text-align:center}
  .state-screen{min-height:100vh;display:grid;place-content:center;justify-items:center;gap:10px;color:#53665a;font-size:12px}.loader{width:27px;height:27px;border:3px solid #dce8df;border-top-color:#0a8050;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.menu-button{display:none}
  .modal-layer{position:fixed;inset:0;z-index:70;display:grid;place-items:center;overflow-y:auto;padding:20px}.scrim{position:fixed;inset:0;border:0;background:#071b10a8}.modal{position:relative;width:min(100%,620px);max-height:92vh;overflow-y:auto;padding:23px;border-radius:12px;background:#fff;box-shadow:0 22px 70px #071e1250}.modal-header{display:flex;justify-content:space-between;gap:14px;padding-bottom:15px;border-bottom:1px solid #edf1ed;margin-bottom:14px}.modal-header h2{margin:7px 0 4px;font-size:17px}.modal-header p{margin:0;color:#819087;font-size:10px}.close{width:32px;height:32px;border:1px solid #e0e8e1;border-radius:7px;background:#fff;color:#44554a;font-size:20px;cursor:pointer}.requirement-form{display:grid;gap:12px}.requirement-form>label:not(.check-line){display:grid;gap:6px;color:#56685c;font-size:9px;font-weight:700}.requirement-form input:not([type=checkbox]),.requirement-form textarea{width:100%;min-height:38px;padding:9px 11px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#26392d;font-size:10px}.requirement-form textarea{resize:vertical}.requirement-form fieldset{display:flex;flex-wrap:wrap;gap:12px;border:1px solid #e6ede7;border-radius:8px;padding:10px}.requirement-form legend{color:#56685c;font-size:9px;font-weight:700}.check-line{display:flex;align-items:center;gap:8px;color:#56685c;font-size:9px}.check-line input{accent-color:#0a6841}.info-note{padding:10px;border-radius:7px;background:#f0f6f1;color:#52705d;font-size:9px;line-height:1.5}.modal-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:13px;border-top:1px solid #edf1ed}
  @media(max-width:950px){.requirement-row,.exception-row{align-items:flex-start;flex-direction:column}.reference-area,.exception-actions{width:100%;justify-items:start;justify-content:flex-start}.exception-actions>div{flex-wrap:wrap}}
  @media(max-width:760px){.menu-button{width:39px;height:39px;display:grid;place-content:center;gap:5px;border:1px solid #e1e9e2;border-radius:8px;background:#fff}.menu-button span{width:17px;height:2px;background:#0a5c37}.topbar{min-height:68px;padding:10px 14px}.account>div:last-child{display:none}.page-content{padding:20px 14px}.intro{align-items:flex-start;flex-direction:column;padding:21px}.intro>.primary-button{width:100%}.stats{grid-template-columns:1fr}.panel{padding:14px}.modal-layer{padding:10px}.modal{max-height:96vh;padding:17px}.modal-actions{flex-direction:column-reverse}.modal-actions button{width:100%}}
</style>
