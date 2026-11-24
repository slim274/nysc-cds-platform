<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import CoordinatorLayout from '#lib/components/CoordinatorLayout.svelte';
  import {
    ApiError,
    getCurrentUser,
    listCoordinatorMonthlyClearances,
    updateCoordinatorMonthlyClearance,
    logout,
    type AuthUser,
    type LgiMonthlyClearanceData,
    type LgiMonthlyClearanceItem,
    type MonthlyClearanceStatus
  } from '#lib/api/client.ts';

  type StatusFilter = 'all' | MonthlyClearanceStatus;

  let user = $state<AuthUser | null>(null);
  let data = $state<LgiMonthlyClearanceData | null>(null);
  let loading = $state(true);
  let refreshing = $state(false);
  let saving = $state(false);
  let error = $state('');
  let notice = $state('');
  let decisionTarget = $state<LgiMonthlyClearanceItem | null>(null);
  let decisionStatus = $state<MonthlyClearanceStatus>('cleared');
  let decisionNote = $state('');
  let month = $state(currentLagosMonth());
  let searchInput = $state('');
  let search = $state('');
  let statusFilter = $state<StatusFilter>('all');
  let expandedId = $state('');

  const isNotClearedReasonMissing = $derived(
    decisionStatus === 'not_cleared' && decisionNote.trim().length < 10
  );

  function currentLagosMonth() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit'
    }).formatToParts(new Date());
    return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
  }

  onMount(() => {
    void initialise();
    const interval = window.setInterval(() => {
      if (user && !saving && !refreshing && document.visibilityState === 'visible') {
        void loadData();
      }
    }, 5000);
    const handleFocus = () => {
      if (user && !saving && !refreshing) void loadData();
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  });

  async function initialise() {
    loading = true;
    error = '';
    try {
      const session = await getCurrentUser();
      if (!session.roles.some((role) => role.code === 'CDS_COORDINATOR' && role.cdsGroupId !== null)) {
        await goto('/login');
        return;
      }
      user = session.user;
      await loadData();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await goto('/login');
        return;
      }
      error = e instanceof Error ? e.message : 'Unable to load monthly clearance.';
    } finally {
      loading = false;
    }
  }

  async function loadData() {
    refreshing = true;
    error = '';
    try {
      data = await listCoordinatorMonthlyClearances({
        month,
        search: search.trim() || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await goto('/login');
        return;
      }
      error = e instanceof Error ? e.message : 'Unable to load monthly clearance for your groups.';
    } finally {
      refreshing = false;
    }
  }

  async function applyFilters(event?: SubmitEvent) {
    event?.preventDefault();
    search = searchInput.trim();
    await loadData();
  }

  async function changeMonth(value: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || value > currentLagosMonth()) return;
    month = value;
    await loadData();
  }

  async function changeStatus(value: string) {
    if (!['all', 'pending', 'cleared', 'not_cleared'].includes(value)) return;
    statusFilter = value as StatusFilter;
    await loadData();
  }

  function openDecision(item: LgiMonthlyClearanceItem, status: MonthlyClearanceStatus) {
    if (!item.clearanceId) {
      error = 'This monthly record is not available yet. Refresh the register and try again.';
      return;
    }
    decisionTarget = item;
    decisionStatus = status;
    decisionNote = status === 'not_cleared' ? item.decisionNote ?? '' : '';
    error = '';
  }

  function closeDecision() {
    if (saving) return;
    decisionTarget = null;
    decisionNote = '';
  }

  async function saveDecision(event: SubmitEvent) {
    event.preventDefault();
    if (!decisionTarget?.clearanceId) return;
    if (decisionStatus === 'not_cleared' && decisionNote.trim().length < 10) {
      error = 'Please provide a reason of at least 10 characters.';
      return;
    }

    saving = true;
    error = '';
    notice = '';
    try {
      await updateCoordinatorMonthlyClearance(
        decisionTarget.clearanceId,
        decisionStatus,
        decisionNote.trim() || undefined
      );
      notice = decisionStatus === 'cleared'
        ? `${decisionTarget.member.name} marked as cleared for ${month}.`
        : decisionStatus === 'not_cleared'
          ? `${decisionTarget.member.name} marked as not cleared for ${month}.`
          : `${decisionTarget.member.name}'s clearance returned to pending.`;
      decisionTarget = null;
      decisionNote = '';
      await loadData();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unable to save the clearance decision.';
    } finally {
      saving = false;
    }
  }

  function statusLabel(status: MonthlyClearanceStatus) {
    if (status === 'not_cleared') return 'Not cleared';
    return status === 'cleared' ? 'Cleared' : 'Pending';
  }

  function formatDate(value: string | null) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('en-NG', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  function monthLabel(value: string) {
    return new Intl.DateTimeFormat('en-NG', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Lagos'
    }).format(new Date(`${value}-01T12:00:00+01:00`));
  }

  async function signOut() {
    try { await logout(); } finally { await goto('/login'); }
  }
</script>

<svelte:head>
  <title>Monthly Clearance | CDS Coordinator</title>
  <meta name="description" content="View monthly clearance decisions and supporting evidence for your assigned CDS groups." />
</svelte:head>

{#if loading}
  <main class="state"><div class="loader"></div><p>Loading monthly clearance…</p></main>
{:else if user}
  <CoordinatorLayout activePath="/coordinator/monthly-clearance" pageTitle="Monthly Clearance" userEmail={user.email} onSignOut={signOut}>
    <div class="page">
      <section class="intro">
        <div><span class="eyebrow">GROUP COMPLIANCE</span><h2>Monthly clearance status</h2><p>View LGI clearance decisions and supporting document and attendance information for Corps Members in your currently assigned CDS groups.</p></div>
      </section>

      <section class="notice">
        <strong>Shared clearance decisions</strong>
        <span>You can decide clearance for Corps Members in your assigned groups. The same status is immediately shared with the LGI Administrator. All decisions are recorded with the acting role in the audit history.</span>
      </section>

      {#if error}<div class="message error" role="alert">{error}<button type="button" onclick={() => void loadData()}>Retry</button></div>{/if}
      {#if notice}<div class="message success" role="status">{notice}</div>{/if}
      {#if refreshing}<div class="refresh-note" role="status">Updating clearance records…</div>{/if}

      <section class="filters panel">
        <label>Clearance month
          <input type="month" max={currentLagosMonth()} value={month} onchange={(event) => void changeMonth(event.currentTarget.value)} />
        </label>
        <form class="search-form" onsubmit={applyFilters}>
          <label>Search Corps Members
            <input bind:value={searchInput} placeholder="Name, state code, call-up number or email" />
          </label>
          <button class="primary" type="submit">Search</button>
        </form>
        <label>Status
          <select value={statusFilter} onchange={(event) => void changeStatus(event.currentTarget.value)}>
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="cleared">Cleared</option>
            <option value="not_cleared">Not cleared</option>
          </select>
        </label>
      </section>

      {#if data}
        <div class="period-row"><span>Assigned groups · <strong>{monthLabel(month)}</strong></span><span>{data.summary.totalMembers} matching members</span></div>
        <section class="summary-grid" aria-label="Monthly clearance summary">
          <article class="summary-card"><span>Total members</span><strong>{data.summary.totalMembers}</strong><small>Across your assigned active CDS groups</small></article>
          <article class="summary-card"><span>Pending</span><strong class="pending-number">{data.summary.pending}</strong><small>Awaiting LGI decision</small></article>
          <article class="summary-card"><span>Cleared</span><strong class="cleared-number">{data.summary.cleared}</strong><small>Decision recorded this month</small></article>
          <article class="summary-card"><span>Not cleared</span><strong class="not-cleared-number">{data.summary.notCleared}</strong><small>Requires member follow-up</small></article>
        </section>

        {#if data.items.length === 0}
          <section class="panel empty">No Corps Members from your assigned active CDS groups match this month and the selected filters.</section>
        {:else}
          <section class="panel records-panel">
            <div class="panel-heading"><div><span class="eyebrow">CLEARANCE REGISTER</span><h3>{monthLabel(month)}</h3><p>Clearance decisions are shared between the LGI Administrator and assigned CDS Coordinators.</p></div><span class="count">{data.items.length} records</span></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Corps Member</th><th>CDS Group</th><th>Documents</th><th>Approved attendance</th><th>Clearance status</th><th>Actions</th><th>Decision history</th></tr></thead>
                <tbody>
                  {#each data.items as item (item.member.id)}
                    <tr>
                      <td><strong>{item.member.name}</strong><small>{item.member.stateCode}{item.member.callUpNumber ? ` · ${item.member.callUpNumber}` : ''}</small><small>{item.member.email ?? 'No email on record'}</small></td>
                      <td><strong>{item.member.groupCode}</strong><small>{item.member.groupName}</small></td>
                      <td>
                        {#if item.indicators.hasRequirementsConfigured}
                          <strong>{item.indicators.verifiedDocuments}/{item.indicators.requiredDocuments} verified</strong>
                          <small>{item.indicators.documentsOutstanding} outstanding</small>
                        {:else}
                          <strong>No mandatory requirements</strong><small>Not configured for this LGA</small>
                        {/if}
                      </td>
                      <td><strong>{item.indicators.approvedAttendanceMeetings} approved registers</strong><small>{item.indicators.attendanceMarked} marks · {item.indicators.present} present · {item.indicators.late} late</small><small>{item.indicators.absent} absent · {item.indicators.excused} excused</small></td>
                      <td><span class="status-pill" class:pending={item.status === 'pending'} class:cleared={item.status === 'cleared'} class:rejected={item.status === 'not_cleared'}>{statusLabel(item.status)}</span><small>{item.decidedAt ? formatDate(item.decidedAt) : 'Not yet decided'}</small>{#if item.decisionNote}<small class="decision-note">{item.decisionNote}</small>{/if}</td>
                      <td class="decision-actions">
                        <button type="button" class="action-clear" onclick={() => openDecision(item, 'cleared')} disabled={item.status === 'cleared'}>Clear</button>
                        <button type="button" class="action-return" onclick={() => openDecision(item, 'not_cleared')} disabled={item.status === 'not_cleared'}>Not cleared</button>
                        {#if item.status !== 'pending'}<button type="button" class="action-reopen" onclick={() => openDecision(item, 'pending')}>Reopen</button>{/if}
                      </td>
                      <td><button type="button" class="history-button" onclick={() => (expandedId = expandedId === item.member.id ? '' : item.member.id)}>{expandedId === item.member.id ? 'Hide history' : `History (${item.auditHistory.length})`}</button></td>
                    </tr>
                    {#if expandedId === item.member.id}
                      <tr class="history-row"><td colspan="7">
                        {#if item.auditHistory.length === 0}<p>No decision history recorded yet. The LGI must open this month's register first.</p>
                        {:else}
                          {#each item.auditHistory as audit (audit.id)}
                            <p><strong>{statusLabel(audit.newStatus)}</strong> · {formatDate(audit.createdAt)} · {audit.actorRole === 'CDS_COORDINATOR' ? 'CDS Coordinator' : audit.actorRole === 'LGI_ADMIN' ? 'LGI Administrator' : 'System'} ({audit.actorEmail ?? 'system'}) · {audit.note ?? 'No note'}</p>
                          {/each}
                        {/if}
                      </td></tr>
                    {/if}
                  {/each}
                </tbody>
              </table>
            </div>
            <p class="table-note">The indicators are supporting information only. They do not automatically determine a Corps Member's clearance status.</p>
          </section>

          <section class="mobile-records">
            {#each data.items as item (item.member.id)}
              <article class="panel member-card">
                <div class="member-heading"><div><strong>{item.member.name}</strong><small>{item.member.stateCode} · {item.member.groupCode}</small></div><span class="status-pill" class:pending={item.status === 'pending'} class:cleared={item.status === 'cleared'} class:rejected={item.status === 'not_cleared'}>{statusLabel(item.status)}</span></div>
                <div class="evidence">
                  <div><span>CDS group</span><strong>{item.member.groupName}</strong></div>
                  <div><span>Documents</span><strong>{item.indicators.hasRequirementsConfigured ? `${item.indicators.verifiedDocuments}/${item.indicators.requiredDocuments} verified · ${item.indicators.documentsOutstanding} outstanding` : 'No mandatory requirements configured'}</strong></div>
                  <div><span>Approved attendance</span><strong>{item.indicators.approvedAttendanceMeetings} registers · {item.indicators.present} present · {item.indicators.late} late · {item.indicators.absent} absent</strong></div>
                  {#if item.decisionNote}<div><span>Decision note</span><strong>{item.decisionNote}</strong></div>{/if}
                </div>
                <div class="mobile-actions">
                  <button type="button" class="action-clear" onclick={() => openDecision(item, 'cleared')} disabled={item.status === 'cleared'}>Clear</button>
                  <button type="button" class="action-return" onclick={() => openDecision(item, 'not_cleared')} disabled={item.status === 'not_cleared'}>Not cleared</button>
                  {#if item.status !== 'pending'}<button type="button" class="action-reopen" onclick={() => openDecision(item, 'pending')}>Reopen</button>{/if}
                </div>
                <button type="button" class="history-button" onclick={() => (expandedId = expandedId === item.member.id ? '' : item.member.id)}>{expandedId === item.member.id ? 'Hide history' : `View history (${item.auditHistory.length})`}</button>
                {#if expandedId === item.member.id}
                  <div class="mobile-history">
                    {#if item.auditHistory.length === 0}<p>No decision history recorded yet. The LGI must open this month's register first.</p>
                    {:else}
                      {#each item.auditHistory as audit (audit.id)}
                        <p><strong>{statusLabel(audit.newStatus)}</strong> · {formatDate(audit.createdAt)} · {audit.actorRole === 'CDS_COORDINATOR' ? 'CDS Coordinator' : audit.actorRole === 'LGI_ADMIN' ? 'LGI Administrator' : 'System'} ({audit.actorEmail ?? 'system'})<br />{audit.note ?? 'No note'}</p>
                      {/each}
                    {/if}
                  </div>
                {/if}
              </article>
            {/each}
          </section>
        {/if}
      {/if}
    </div>
  </CoordinatorLayout>
{:else}
  <main class="state"><p>{error || 'Coordinator workspace unavailable.'}</p><a href="/login">Return to login</a></main>
{/if}

{#if decisionTarget}
  <div class="modal-layer" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) closeDecision(); }}>
    <section class="decision-modal" role="dialog" aria-modal="true" aria-labelledby="coordinator-decision-title">
      <header><div><span class="eyebrow">MONTHLY CLEARANCE DECISION</span><h2 id="coordinator-decision-title">{decisionStatus === 'cleared' ? 'Mark as cleared' : decisionStatus === 'not_cleared' ? 'Mark as not cleared' : 'Return to pending'}</h2><p>{decisionTarget.member.name} · {monthLabel(month)}</p></div><button type="button" class="close-button" aria-label="Close" onclick={closeDecision}>×</button></header>
      <form onsubmit={saveDecision}>
        {#if decisionStatus === 'not_cleared'}
          <label>Reason for not clearing <span class="required">*</span>
            <textarea bind:value={decisionNote} rows="4" minlength="10" maxlength="2000" placeholder="Explain the outstanding issue or required follow-up (minimum 10 characters)." required></textarea>
            <small>{decisionNote.trim().length}/2000 characters · Minimum 10 characters</small>
          </label>
        {:else if decisionStatus === 'cleared'}
          <label>Decision note (optional)<textarea bind:value={decisionNote} rows="3" maxlength="2000" placeholder="Add any relevant clearance note…"></textarea></label>
        {:else}
          <p class="reopen-copy">This will return the {monthLabel(month)} record to Pending. The previous decision remains in the audit history.</p>
          <label>Reopening note (optional)<textarea bind:value={decisionNote} rows="3" maxlength="2000" placeholder="Why is this clearance being reopened?"></textarea></label>
        {/if}
        {#if error}<p class="modal-error" role="alert">{error}</p>{/if}
        <div class="modal-actions"><button type="button" class="secondary" onclick={closeDecision} disabled={saving}>Cancel</button><button type="submit" class="primary" disabled={saving || isNotClearedReasonMissing}>{saving ? 'Saving…' : 'Save decision'}</button></div>
      </form>
    </section>
  </div>
{/if}

<style>
  :global(*){box-sizing:border-box}
  .page{display:grid;gap:14px}
  .intro h2{margin:7px 0;color:#193d2a;font-size:24px}
  .intro p{max-width:850px;margin:0;color:#718078;font-size:11px;line-height:1.65}
  .eyebrow{color:#0a8050;font-size:9px;font-weight:800;letter-spacing:1.3px}
  .notice{display:grid;gap:4px;padding:12px 14px;border:1px solid #d5e8da;border-radius:8px;background:#f0f8f2;color:#54715d;font-size:9px;line-height:1.55}
  .notice strong{color:#16613b;font-size:10px}
  .filters{display:grid;grid-template-columns:180px minmax(260px,1fr) 170px;align-items:end;gap:12px;padding:13px}
  .panel{border:1px solid #e3ebe5;border-radius:10px;background:#fff}
  .filters label,.search-form label{display:grid;gap:6px;color:#56685c;font-size:9px;font-weight:700}
  .filters input,.filters select,.search-form input{width:100%;min-width:0;min-height:37px;padding:8px 10px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#26392d;font:inherit;font-size:10px}
  .search-form{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:7px;min-width:0}
  .primary{min-height:37px;padding:9px 13px;border:1px solid #0a5c37;border-radius:7px;background:#0a5c37;color:#fff;font-size:9px;font-weight:800}
  .period-row{display:flex;justify-content:space-between;gap:10px;color:#819087;font-size:9px}
  .period-row strong{color:#395645}
  .summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
  .summary-card{padding:14px 15px;border:1px solid #e2eae4;border-radius:9px;background:#fff}
  .summary-card span,.summary-card small{display:block;color:#718078;font-size:9px}
  .summary-card strong{display:block;margin:6px 0 4px;color:#19452d;font-size:24px}
  .summary-card small{font-size:8px}
  .pending-number{color:#a66a12!important}.cleared-number{color:#0c7543!important}.not-cleared-number{color:#b44738!important}
  .records-panel{padding:17px}
  .panel-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px}
  .panel-heading h3{margin:5px 0;color:#264431;font-size:15px}
  .panel-heading p{margin:0;color:#819087;font-size:9px}
  .count{padding:6px 9px;border-radius:15px;background:#e8f5ec;color:#0a6841;font-size:8px;font-weight:800;white-space:nowrap}
  .table-wrap{width:100%;overflow:auto}
  table{width:100%;min-width:980px;border-collapse:collapse}
  th{padding:10px 9px;border-bottom:1px solid #e8eee9;background:#f8faf8;color:#738278;font-size:8px;text-align:left;white-space:nowrap}
  td{padding:11px 9px;border-bottom:1px solid #edf2ee;color:#425b4b;font-size:9px;vertical-align:top}
  td strong,td small{display:block}
  td strong{color:#294834;font-size:9px}
  td small{margin-top:4px;color:#89968e;font-size:8px;line-height:1.4;overflow-wrap:anywhere}
  .status-pill{display:inline-flex;padding:5px 8px;border-radius:14px;font-size:8px;font-weight:800;white-space:nowrap}
  .status-pill.pending{background:#fff3df;color:#9a6412}
  .status-pill.cleared{background:#e7f5eb;color:#0c7543}
  .status-pill.rejected{background:#fff0ed;color:#ae4436}
  .decision-note{max-width:190px;white-space:normal}
  .history-button{padding:6px 8px;border:1px solid #dce7df;border-radius:6px;background:#fff;color:#0a6841;font-size:8px;font-weight:800}
  .decision-actions{min-width:145px}
  .decision-actions button,.mobile-actions button{display:inline-block;margin:0 3px 4px 0;padding:6px 8px;border:1px solid #dce7df;border-radius:6px;background:#fff;color:#355442;font-size:8px;font-weight:800;cursor:pointer}
  .decision-actions .action-clear,.mobile-actions .action-clear{border-color:#0a6841;background:#0a6841;color:#fff}
  .decision-actions .action-return,.mobile-actions .action-return{border-color:#ead2cd;background:#fff8f6;color:#a34b3d}
  .decision-actions .action-reopen,.mobile-actions .action-reopen{background:#f5f7f5}
  .decision-actions button:disabled,.mobile-actions button:disabled{opacity:.4;cursor:default}
  .mobile-actions{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}
  .modal-layer{position:fixed;inset:0;z-index:3000;display:grid;place-items:center;overflow-y:auto;padding:18px;background:#071b1090}
  .decision-modal{width:min(100%,520px);padding:20px;border:1px solid #e2eae4;border-radius:12px;background:#fff;box-shadow:0 22px 70px #071e1250}
  .decision-modal header{display:flex;justify-content:space-between;gap:12px;margin-bottom:17px}
  .decision-modal h2{margin:6px 0;color:#1d3f2b;font-size:19px}
  .decision-modal header p{margin:0;color:#7b897f;font-size:9px}
  .close-button{width:32px;height:32px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#435849;font-size:20px}
  .decision-modal form{display:grid;gap:12px}
  .decision-modal label{display:grid;gap:7px;color:#53665a;font-size:10px;font-weight:700}
  .decision-modal textarea{width:100%;resize:vertical;padding:10px;border:1px solid #dce5de;border-radius:7px;color:#26392d;font:inherit;font-size:10px;line-height:1.5}
  .decision-modal label small{color:#89968e;font-size:8px;font-weight:400}
  .required{color:#b44738}
  .reopen-copy{margin:0;padding:11px;border-radius:7px;background:#f2f7f3;color:#607468;font-size:9px;line-height:1.6}
  .modal-error{margin:0;color:#a32920;font-size:9px}
  .modal-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:12px;border-top:1px solid #edf1ed}
  .history-row td{padding:10px 14px;background:#fbfdfb;line-height:1.6}
  .history-row p{margin:5px 0;color:#627468;font-size:9px}
  .table-note{margin:12px 0 0;color:#849188;font-size:8px;line-height:1.5}
  .mobile-records{display:none}
  .empty{padding:38px 12px;text-align:center;color:#819087;font-size:10px}
  .message{display:flex;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:7px;font-size:10px}
  .message.error{border:1px solid #efceca;background:#fff3f2;color:#a32920}
  .message button{border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;font-size:8px}
  .refresh-note{color:#87948b;font-size:9px}
  .state{min-height:100vh;display:grid;place-content:center;justify-items:center;color:#53665a;font:12px Inter,Arial,sans-serif}
  .loader{width:28px;height:28px;border:3px solid #dce8df;border-top-color:#0a8050;border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  @media(max-width:1050px){.filters{grid-template-columns:160px minmax(220px,1fr)}.filters>label:last-child{grid-column:1/-1}.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:760px){
    .filters{grid-template-columns:minmax(0,1fr);gap:10px;padding:11px}
    .filters>label:last-child{grid-column:auto}
    .summary-grid{gap:8px}.summary-card{padding:12px}.summary-card strong{font-size:22px}
    .table-wrap{display:none}.mobile-records{display:grid;gap:10px}
    .member-card{padding:13px}
    .member-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
    .member-heading strong,.member-heading small{display:block}
    .member-heading strong{color:#294834;font-size:10px}.member-heading small{margin-top:4px;color:#819087;font-size:8px}
    .evidence{display:grid;gap:8px;margin:12px 0;padding-top:11px;border-top:1px solid #edf1ed}
    .evidence span,.evidence strong{display:block}
    .evidence span{margin-bottom:3px;color:#819087;font-size:8px}
    .evidence strong{color:#3c5a47;font-size:9px;line-height:1.5;font-weight:600}
    .mobile-history{padding:9px;margin-top:9px;border-radius:6px;background:#f7faf7}
    .mobile-history p{margin:4px 0;color:#718078;font-size:8px;line-height:1.6}
    .period-row{align-items:flex-start;flex-direction:column}
  }
</style>
