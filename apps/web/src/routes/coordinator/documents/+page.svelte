<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import CoordinatorLayout from '#lib/components/CoordinatorLayout.svelte';
  import { ApiError, getCurrentUser, getMyCoordinatorDocuments, logout } from '#lib/api/client.ts';
  import type { AuthUser, CoordinatorDocumentChecklist } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let data = $state<CoordinatorDocumentChecklist | null>(null);
  let loading = $state(true);
  let errorMessage = $state('');
  let selectedGroupId = $state('all');

  const visibleGroups = $derived((data?.groups ?? []).filter((group) => selectedGroupId === 'all' || group.groupId === selectedGroupId));
  const visibleRequirements = $derived((data?.requirements ?? []).filter((item) => visibleGroups.some((group) => group.lgaId === item.lgaId)));
  const visibleGroupIds = $derived(new Set(visibleGroups.map((group) => group.groupId)));
  const visibleSubmissions = $derived((data?.memberSubmissions ?? []).filter((item) => visibleGroupIds.has(item.groupId)));

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
      data = await getMyCoordinatorDocuments();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load document checklist information.';
    } finally {
      loading = false;
    }
  }

  function statusLabel(status: string | null) {
    if (!status) return 'Not submitted';
    if (status === 'verified') return 'Verified';
    if (status === 'needs_resubmission') return 'Resubmission required';
    if (status === 'manual_review') return 'LGI exception review';
    return 'Pending verification';
  }

  async function signOut() {
    try { await logout(); } finally { await goto('/login'); }
  }
</script>

<svelte:head>
  <title>Document Checklist | Coordinator Workspace</title>
  <meta name="description" content="View published document requirements and submission status for your assigned CDS groups." />
</svelte:head>

{#if loading}
  <main class="state-screen"><div class="loader"></div><p>Loading published document checklist…</p></main>
{:else if !currentUser || !data}
  <main class="state-screen"><h2>Coordinator workspace unavailable</h2><p>{errorMessage}</p><a href="/login">Return to sign in</a></main>
{:else}
  <CoordinatorLayout activePath="/coordinator/documents" pageTitle="Documents" userEmail={currentUser.email} onSignOut={signOut}>
    <div class="module-content">
      <div class="eyebrow">MEMBER DOCUMENT COMPLIANCE</div>
      <h1>Published Document Checklist</h1>
      <p class="intro">View the live checklist published by your LGI and track submissions for Corps Members in your assigned CDS Groups. Only the LGI can create, edit, enable or remove requirements.</p>
      {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}

      <section class="stats">
        <article><span>Assigned CDS Groups</span><strong>{data.groups.length}</strong></article>
        <article><span>Published requirements</span><strong>{visibleRequirements.length}</strong></article>
        <article><span>Member document records</span><strong>{visibleSubmissions.length}</strong></article>
      </section>

      <section class="panel">
        <div class="panel-heading"><div><h2>Your assigned CDS Groups</h2><p>Document visibility follows the LGA of each assigned group.</p></div></div>
        {#if data.groups.length === 0}
          <div class="empty"><h3>No CDS Groups assigned</h3><p>Your assigned groups and their document checklist will appear here.</p></div>
        {:else}
          <label class="group-filter"><span>Filter by group</span>
            <select bind:value={selectedGroupId}>
              <option value="all">All assigned groups</option>
              {#each data.groups as group (group.groupId)}
                <option value={group.groupId}>{group.groupCode} — {group.groupName}</option>
              {/each}
            </select>
          </label>
          <div class="group-list">
            {#each visibleGroups as group (group.groupId)}
              <article class="group-chip"><strong>{group.groupCode} · {group.groupName}</strong><span>{group.lgaName}, {group.stateName}</span></article>
            {/each}
          </div>
        {/if}
      </section>

      <section class="panel">
        <div class="panel-heading"><div><h2>Requirements published by LGI</h2><p>Only enabled items appear here and on Corps Member checklists.</p></div><span class="count">{visibleRequirements.length} published</span></div>
        {#if visibleGroups.length === 0}
          <div class="empty">No assigned group is available.</div>
        {:else if visibleRequirements.length === 0}
          <div class="empty"><h3>No active document requirements</h3><p>Your LGI has not published a document checklist for your assigned group LGA(s).</p></div>
        {:else}
          <div class="requirements">
            {#each visibleRequirements as requirement (requirement.id)}
              <article class="requirement-row">
                <div><strong>{requirement.name}</strong><span>{requirement.lgaName}, {requirement.stateName} · {requirement.code}</span>
                  {#if requirement.description}<p>{requirement.description}</p>{/if}
                  <small>{requirement.isRequired ? 'Mandatory before automatic CDS matching' : 'Optional'} · {requirement.allowedMimeTypes.replaceAll('application/pdf','PDF').replaceAll('image/jpeg','JPEG').replaceAll('image/png','PNG')} · Max {Math.round(requirement.maxFileSizeBytes / (1024 * 1024))} MB</small>
                </div>
                <span class="enabled">Enabled</span>
              </article>
            {/each}
          </div>
        {/if}
      </section>

      <section class="panel">
        <div class="panel-heading"><div><h2>Corps Member submission status</h2><p>Latest status for each member/document requirement pair in your assigned groups.</p></div><span class="count">{visibleSubmissions.length} records</span></div>
        {#if visibleSubmissions.length === 0}
          <div class="empty"><h3>No member submissions yet</h3><p>When Corps Members in your assigned groups upload requested documents, their verification progress will appear here.</p></div>
        {:else}
          <div class="table-wrap">
            <table>
              <thead><tr><th>CDS Group</th><th>Corps Member</th><th>Document</th><th>Status</th><th>Last submitted</th></tr></thead>
              <tbody>
                {#each visibleSubmissions as item (item.memberId + '-' + item.requirementId)}
                  <tr>
                    <td><strong>{item.groupCode}</strong><small>{item.groupName}</small></td>
                    <td><strong>{item.lastName}, {item.firstName} {item.middleName ?? ''}</strong><small>{item.stateCode}</small></td>
                    <td><strong>{item.requirementName}</strong><small>{item.isRequired ? 'Mandatory' : 'Optional'}</small></td>
                    <td><span class:verified={item.status === 'verified'} class:attention={item.status === 'manual_review' || item.status === 'needs_resubmission'} class="status">{statusLabel(item.status)}</span>{#if item.reason}<small class="reason">{item.reason}</small>{/if}</td>
                    <td>{item.submittedAt ? new Date(item.submittedAt).toLocaleString() : '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
      <div class="read-only-note"><strong>Coordinator access is read-only.</strong><span>Contact your LGI to request a checklist change or resolve a document exception. The LGI retains control over requirements and verification decisions.</span></div>
    </div>
  </CoordinatorLayout>
{/if}

<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#f4f7f5;color:#17251c;font-family:Inter,Arial,sans-serif}:global(button),:global(input),:global(select){font:inherit}
  .workspace{min-height:100vh}.topbar{min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px clamp(16px,4vw,42px);background:#fff;border-bottom:1px solid #e5ebe6}.brand{display:flex;align-items:center;gap:10px}.brand-icon{width:36px;height:36px;display:grid;place-items:center;border-radius:8px;background:#0a5c37;color:#fff;font-size:18px;font-weight:800}.brand strong,.brand small{display:block}.brand strong{color:#0a5c37;font-size:12px}.brand small{margin-top:4px;color:#819087;font-size:9px}.account{display:flex;align-items:center;gap:14px}.account>div strong,.account>div small{display:block}.account>div strong{font-size:10px}.account>div small{margin-top:4px;color:#819087;font-size:9px}.nav-link{color:#0a6841;font-size:10px;font-weight:700;text-decoration:none;white-space:nowrap}.secondary-button{min-height:36px;padding:8px 12px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#355442;font-size:9px;font-weight:700;cursor:pointer}
.module-content{width:100%;min-width:0}.eyebrow{color:#0a8050;font-size:9px;font-weight:800;letter-spacing:1.2px}h1{margin:8px 0;font-size:26px}.intro{max-width:800px;margin:0 0 22px;color:#718078;font-size:12px;line-height:1.7}
  .stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0}.stats article{display:grid;gap:7px;padding:16px;border:1px solid #e4ebe6;border-radius:9px;background:#fff}.stats span{color:#819087;font-size:10px}.stats strong{color:#0a5c37;font-size:22px}
  .panel{padding:20px;margin:0 0 16px;border:1px solid #e4ebe6;border-radius:11px;background:#fff}.panel-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:15px}.panel-heading h2{margin:0 0 5px;font-size:14px}.panel-heading p{margin:0;color:#819087;font-size:10px;line-height:1.5}.count{padding:6px 9px;border-radius:15px;background:#e8f6ec;color:#147244;font-size:8px;font-weight:800;white-space:nowrap}
  .group-filter{display:grid;max-width:430px;gap:6px;margin-bottom:13px;color:#56685c;font-size:9px;font-weight:700}.group-filter select{min-height:39px;padding:8px 10px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#26392d;font-size:10px}.group-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.group-chip{display:grid;gap:5px;padding:12px;border:1px solid #e4ebe6;border-radius:8px;background:#fafcfa}.group-chip strong{color:#263d30;font-size:10px}.group-chip span{color:#819087;font-size:9px}
  .requirements{display:grid}.requirement-row{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:13px 2px;border-bottom:1px solid #edf1ed}.requirement-row:last-child{border-bottom:0}.requirement-row>div{display:grid;gap:5px;min-width:0}.requirement-row strong{color:#263d30;font-size:11px}.requirement-row span,.requirement-row small{color:#819087;font-size:9px}.requirement-row p{margin:0;color:#718078;font-size:10px;line-height:1.5}.enabled{padding:5px 8px;border-radius:14px;background:#e8f6ec;color:#147244!important;font-size:8px!important;font-weight:800;white-space:nowrap}
  .table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:800px}th,td{padding:11px 10px;border-bottom:1px solid #edf1ed;text-align:left;vertical-align:top}th{color:#819087;font-size:9px;font-weight:700}td strong,td small{display:block}td strong{color:#31473a;font-size:10px}td small{margin-top:4px;color:#819087;font-size:8px;line-height:1.5}.status{display:inline-block;padding:5px 8px;border-radius:14px;background:#f0f3f1;color:#65736a;font-size:8px;font-weight:800;white-space:nowrap}.status.verified{background:#e8f6ec;color:#147244}.status.attention{background:#fff2e6;color:#9b5a1c}.reason{max-width:220px;color:#9b5a1c!important}
  .empty{padding:28px 15px;text-align:center;color:#819087;font-size:10px;line-height:1.6}.empty h3{margin:0 0 6px;color:#263d30;font-size:12px}.empty p{max-width:540px;margin:0 auto}.read-only-note{display:grid;gap:5px;padding:14px 16px;border-radius:9px;background:#eaf4ed}.read-only-note strong{color:#245c3c;font-size:10px}.read-only-note span{color:#718078;font-size:10px;line-height:1.6}.message{padding:10px 13px;margin-bottom:12px;border-radius:7px;font-size:10px}.message.error{border:1px solid #efceca;background:#fff3f2;color:#a32920}
  .state-screen{min-height:100vh;display:grid;place-content:center;justify-items:center;gap:10px;color:#53665a;font-size:12px}.loader{width:27px;height:27px;border:3px solid #dce8df;border-top-color:#0a8050;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
  @media(max-width:760px){.topbar{align-items:flex-start;flex-direction:column;padding:14px}.account{width:100%;justify-content:space-between;gap:8px;flex-wrap:wrap}.account>div{display:none}.module-content{width:100%}.stats{grid-template-columns:1fr}.group-list{grid-template-columns:1fr}.panel{padding:15px}}
</style>
