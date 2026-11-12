<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import LgiSidebar from '#lib/components/LgiSidebar.svelte';
  import {
    ApiError,
    getCurrentUser,
    listLgiMonthlyClearances,
    updateLgiMonthlyClearance,
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
  let signingOut = $state(false);
  let mobileOpen = $state(false);
  let error = $state('');
  let notice = $state('');
  let month = $state(currentLagosMonth());
  let searchInput = $state('');
  let search = $state('');
  let statusFilter = $state<StatusFilter>('all');
  let expandedId = $state('');
  let decisionTarget = $state<LgiMonthlyClearanceItem | null>(null);
  let decisionStatus = $state<MonthlyClearanceStatus>('cleared');
  let decisionNote = $state('');

  const filteredItems = $derived(data?.items ?? []);
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

  onMount(() => { void initialise(); });

  async function initialise() {
    loading = true;
    error = '';
    try {
      const session = await getCurrentUser();
      if (!session.roles.some((role) => role.code === 'LGI_ADMIN' && role.lgaId !== null)) {
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
      data = await listLgiMonthlyClearances({
        month,
        search: search.trim() || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await goto('/login');
        return;
      }
      error = e instanceof Error ? e.message : 'Unable to load monthly clearance records.';
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
    decisionTarget = item;
    decisionStatus = status;
    decisionNote = status === 'not_cleared' ? item.decisionNote ?? '' : '';
  }

  function closeDecision() {
    if (saving) return;
    decisionTarget = null;
    decisionNote = '';
  }

  async function saveDecision(event: SubmitEvent) {
    event.preventDefault();
    if (!decisionTarget) return;
    if (decisionStatus === 'not_cleared' && decisionNote.trim().length < 10) {
      error = 'Please provide a reason of at least 10 characters.';
      return;
    }

    saving = true;
    error = '';
    notice = '';
    try {
      await updateLgiMonthlyClearance(
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

  function csvCell(value: string | number | null) {
    const text = value === null ? '' : String(value);
    return '"' + text.replaceAll('"', '""') + '"';
  }

  function exportCsv() {
    if (!data || data.items.length === 0) return;
    const headers = [
      'Clearance Month', 'State Code', 'Corps Member', 'Call-up Number',
      'Email', 'LGA', 'CDS Group', 'Clearance Status', 'Decision Note',
      'Required Documents', 'Verified Documents', 'Outstanding Documents',
      'Approved CDS Meetings', 'Attendance Marks', 'Present', 'Late', 'Absent', 'Excused'
    ];
    const rows = data.items.map((item) => [
      month, item.member.stateCode, item.member.name, item.member.callUpNumber,
      item.member.email, item.member.lgaName,
      item.member.groupCode ? `${item.member.groupCode} - ${item.member.groupName}` : 'No active CDS group',
      statusLabel(item.status), item.decisionNote,
      item.indicators.requiredDocuments, item.indicators.verifiedDocuments,
      item.indicators.documentsOutstanding, item.indicators.approvedAttendanceMeetings,
      item.indicators.attendanceMarked, item.indicators.present, item.indicators.late,
      item.indicators.absent, item.indicators.excused
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => csvCell(cell as string | number | null)).join(','))
      .join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nysc-monthly-clearance-${month}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function signOut() {
    signingOut = true;
    try { await logout(); } finally { await goto('/login'); }
  }
</script>

<svelte:head>
  <title>Monthly Clearance | NYSC CDS Platform</title>
  <meta name="description" content="Review and record monthly Corps Member clearance decisions for your assigned LGA(s)." />
</svelte:head>

{#if loading}
  <main class="state"><div class="loader"></div><p>Loading monthly clearance…</p></main>
{:else if user}
  <div class="dashboard">
    <LgiSidebar
      activePath="/lgi/monthly-clearance"
      open={mobileOpen}
      signingOut={signingOut}
      onClose={() => (mobileOpen = false)}
      onSignOut={signOut}
    />
    <section class="main">
      <header class="topbar">
        <button class="menu" type="button" aria-label="Toggle navigation" aria-expanded={mobileOpen} onclick={() => (mobileOpen = !mobileOpen)}>☰</button>
        <div class="heading-copy"><small>Administration / Compliance</small><h1>Monthly Clearance</h1></div>
        <div class="account">
          <div class="avatar">LG</div>
          <div class="account-copy"><strong>LGI Administrator</strong><span>{user.email}</span></div>
        </div>
      </header>

      <main class="content">
        <section class="page-heading">
          <div><span class="eyebrow">MONTHLY CORPS MEMBER COMPLIANCE</span><h2>Clearance review</h2><p>Review monthly supporting records and record the LGI's clearance decision for each approved Corps Member in your assigned LGA(s).</p></div>
          <div class="heading-actions no-print">
            <button class="secondary-button" type="button" onclick={exportCsv} disabled={!data || data.items.length === 0}>↓ Export CSV</button>
            <button class="primary-button" type="button" onclick={() => window.print()} disabled={!data}>Save report as PDF</button>
          </div>
        </section>

        <section class="notice">
          <strong>LGI decision required</strong>
          <span>Attendance and document indicators are supporting information only. The platform does not automatically decide whether a Corps Member is cleared. Review the records and make the final decision.</span>
        </section>

        {#if error}<div class="message error" role="alert">{error}<button type="button" onclick={() => void loadData()}>Retry</button></div>{/if}
        {#if notice}<div class="message success" role="status">{notice}</div>{/if}
        {#if refreshing}<div class="refresh-note no-print" role="status">Updating clearance records…</div>{/if}

        <section class="filters panel no-print">
          <label>Clearance month
            <input type="month" max={currentLagosMonth()} value={month} onchange={(event) => void changeMonth(event.currentTarget.value)} />
          </label>
          <form class="search-form" onsubmit={applyFilters}>
            <label>Search Corps Members
              <input bind:value={searchInput} placeholder="Name, state code, call-up number or email" />
            </label>
            <button class="primary-button" type="submit">Search</button>
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
          <div class="period-row"><span>Showing approved Corps Members for <strong>{monthLabel(month)}</strong></span><span>{data.summary.totalMembers} matching records</span></div>
          <section class="summary-grid" aria-label="Clearance summary">
            <article class="summary-card"><span>Total members</span><strong>{data.summary.totalMembers}</strong><small>Approved member profiles</small></article>
            <article class="summary-card"><span>Pending review</span><strong class="pending-number">{data.summary.pending}</strong><small>Awaiting LGI decision</small></article>
            <article class="summary-card"><span>Cleared</span><strong class="cleared-number">{data.summary.cleared}</strong><small>Decision recorded for this month</small></article>
            <article class="summary-card"><span>Not cleared</span><strong class="not-cleared-number">{data.summary.notCleared}</strong><small>Requires follow-up</small></article>
          </section>

          {#if data.items.length === 0}
            <section class="panel empty">No approved Corps Member records match this month and the selected filters.</section>
          {:else}
            <section class="panel records-panel">
              <div class="records-heading"><div><span class="eyebrow">CLEARANCE REGISTER</span><h3>{monthLabel(month)} register</h3><p>Each decision is stored against the member and month with an audit trail.</p></div><span class="record-count">{data.items.length} records</span></div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr><th>Corps Member</th><th>CDS Group</th><th>Document readiness</th><th>Approved CDS attendance</th><th>Status</th><th class="no-print">Actions</th></tr>
                  </thead>
                  <tbody>
                    {#each data.items as item (item.clearanceId)}
                      <tr>
                        <td>
                          <strong>{item.member.name}</strong>
                          <small>{item.member.stateCode}{item.member.callUpNumber ? ` · ${item.member.callUpNumber}` : ''}</small>
                          <small>{item.member.lgaName}{item.member.email ? ` · ${item.member.email}` : ''}</small>
                        </td>
                        <td>{#if item.member.groupCode}<strong>{item.member.groupCode}</strong><small>{item.member.groupName}</small>{:else}<span class="muted">No active CDS group</span>{/if}</td>
                        <td>
                          {#if item.indicators.hasRequirementsConfigured}
                            <strong>{item.indicators.verifiedDocuments} / {item.indicators.requiredDocuments} verified</strong>
                            <small>{item.indicators.documentsOutstanding} outstanding</small>
                          {:else}
                            <strong>No mandatory requirements</strong>
                            <small>Not configured for this LGA</small>
                          {/if}
                        </td>
                        <td>
                          <strong>{item.indicators.approvedAttendanceMeetings} approved registers</strong>
                          <small>{item.indicators.attendanceMarked} marks · {item.indicators.present} present · {item.indicators.late} late</small>
                          <small>{item.indicators.absent} absent · {item.indicators.excused} excused</small>
                        </td>
                        <td><span class="status-pill" class:pending={item.status === 'pending'} class:cleared={item.status === 'cleared'} class:rejected={item.status === 'not_cleared'}>{statusLabel(item.status)}</span><small>{item.decidedAt ? formatDate(item.decidedAt) : 'Not yet decided'}</small></td>
                        <td class="actions no-print">
                          <button type="button" class="action-clear" onclick={() => openDecision(item, 'cleared')} disabled={item.status === 'cleared'}>Clear</button>
                          <button type="button" class="action-return" onclick={() => openDecision(item, 'not_cleared')} disabled={item.status === 'not_cleared'}>Not cleared</button>
                          {#if item.status !== 'pending'}<button type="button" class="action-reopen" onclick={() => openDecision(item, 'pending')}>Reopen</button>{/if}
                          <button type="button" class="history-toggle" onclick={() => (expandedId = expandedId === item.clearanceId ? '' : item.clearanceId)}>{expandedId === item.clearanceId ? 'Hide history' : `History (${item.auditHistory.length})`}</button>
                        </td>
                      </tr>
                      {#if expandedId === item.clearanceId}
                        <tr class="history-row"><td colspan="6">
                          <div class="history-content">
                            <div><strong>Current LGI note</strong><p>{item.decisionNote || 'No decision note recorded.'}</p></div>
                            <div><strong>Decision history</strong>
                              {#if item.auditHistory.length === 0}<p>No changes have been recorded yet.</p>
                              {:else}
                                {#each item.auditHistory as audit}
                                  <p><b>{statusLabel(audit.newStatus)}</b> · {formatDate(audit.createdAt)} · {audit.actorEmail ?? 'System'} · {audit.note || 'No note'}</p>
                                {/each}
                              {/if}
                            </div>
                          </div>
                        </td></tr>
                      {/if}
                    {/each}
                  </tbody>
                </table>
              </div>
              <p class="table-note">Document counts use the latest submission for each active mandatory requirement. Attendance evidence only includes registers reviewed and approved by the Coordinator during the selected month.</p>
            </section>

            <section class="mobile-records">
              {#each data.items as item (item.clearanceId)}
                <article class="panel member-card">
                  <div class="member-card-heading"><div><strong>{item.member.name}</strong><small>{item.member.stateCode} · {item.member.lgaName}</small></div><span class="status-pill" class:pending={item.status === 'pending'} class:cleared={item.status === 'cleared'} class:rejected={item.status === 'not_cleared'}>{statusLabel(item.status)}</span></div>
                  <div class="mobile-evidence">
                    <div><span>CDS group</span><strong>{item.member.groupCode ? `${item.member.groupCode} · ${item.member.groupName}` : 'No active CDS group'}</strong></div>
                    <div><span>Documents</span><strong>{item.indicators.hasRequirementsConfigured ? `${item.indicators.verifiedDocuments}/${item.indicators.requiredDocuments} verified · ${item.indicators.documentsOutstanding} outstanding` : 'No mandatory requirements configured for this LGA'}</strong></div>
                    <div><span>Approved attendance registers</span><strong>{item.indicators.approvedAttendanceMeetings} · {item.indicators.present} present · {item.indicators.late} late · {item.indicators.absent} absent</strong></div>
                  </div>
                  {#if item.decisionNote}<p class="decision-note">{item.decisionNote}</p>{/if}
                  <div class="mobile-actions no-print">
                    <button type="button" class="action-clear" onclick={() => openDecision(item, 'cleared')} disabled={item.status === 'cleared'}>Clear</button>
                    <button type="button" class="action-return" onclick={() => openDecision(item, 'not_cleared')} disabled={item.status === 'not_cleared'}>Not cleared</button>
                    {#if item.status !== 'pending'}<button type="button" class="action-reopen" onclick={() => openDecision(item, 'pending')}>Reopen</button>{/if}
                    <button type="button" class="history-toggle" onclick={() => (expandedId = expandedId === item.clearanceId ? '' : item.clearanceId)}>History ({item.auditHistory.length})</button>
                  </div>
                  {#if expandedId === item.clearanceId}
                    <div class="mobile-history">
                      {#each item.auditHistory as audit}
                        <p><b>{statusLabel(audit.newStatus)}</b> · {formatDate(audit.createdAt)} · {audit.actorEmail ?? 'System'}<br />{audit.note || 'No note'}</p>
                      {/each}
                      {#if item.auditHistory.length === 0}<p>No changes have been recorded yet.</p>{/if}
                    </div>
                  {/if}
                </article>
              {/each}
            </section>
          {/if}
        {/if}
      </main>
      <footer class="no-print">NYSC CDS Management Platform · LGI Monthly Clearance</footer>
    </section>
  </div>
{:else}
  <main class="state"><p>{error || 'Monthly clearance is unavailable.'}</p><a href="/login">Return to login</a></main>
{/if}

{#if decisionTarget}
  <div class="modal-layer no-print" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) closeDecision(); }}>
    <section class="decision-modal" role="dialog" aria-modal="true" aria-labelledby="decision-title">
      <header><div><span class="eyebrow">MONTHLY CLEARANCE DECISION</span><h2 id="decision-title">{decisionStatus === 'cleared' ? 'Mark as cleared' : decisionStatus === 'not_cleared' ? 'Mark as not cleared' : 'Reopen clearance'}</h2><p>{decisionTarget.member.name} · {monthLabel(month)}</p></div><button type="button" class="close-button" aria-label="Close" onclick={closeDecision}>×</button></header>
      <form onsubmit={saveDecision}>
        {#if decisionStatus === 'not_cleared'}
          <label>Reason for not clearing <span class="required">*</span>
            <textarea bind:value={decisionNote} rows="4" minlength="10" maxlength="2000" placeholder="Explain the outstanding issue or required follow-up (minimum 10 characters)." required></textarea>
            <small>{decisionNote.trim().length}/2000 characters · Minimum 10 characters</small>
          </label>
        {:else if decisionStatus === 'cleared'}
          <label>Decision note (optional)
            <textarea bind:value={decisionNote} rows="3" maxlength="2000" placeholder="Add any relevant clearance note…"></textarea>
          </label>
        {:else}
          <p class="reopen-copy">This will return the {monthLabel(month)} record to Pending. The previous decision remains in the audit history.</p>
          <label>Reopening note (optional)
            <textarea bind:value={decisionNote} rows="3" maxlength="2000" placeholder="Why is this clearance being reopened?"></textarea>
          </label>
        {/if}
        {#if error}<p class="modal-error" role="alert">{error}</p>{/if}
        <div class="modal-actions"><button type="button" class="secondary-button" onclick={closeDecision} disabled={saving}>Cancel</button><button type="submit" class="primary-button" disabled={saving || isNotClearedReasonMissing}>{saving ? 'Saving…' : 'Save decision'}</button></div>
      </form>
    </section>
  </div>
{/if}

<style>
  :global(*){box-sizing:border-box}
  :global(body){margin:0;background:#f5f7f5;color:#19251e;font-family:Inter,Arial,sans-serif}
  .dashboard{min-height:100vh;display:flex}
  .main{min-width:0;flex:1;display:flex;flex-direction:column}
  .topbar{min-height:78px;display:flex;align-items:center;gap:14px;padding:13px 26px;border-bottom:1px solid #e5ebe6;background:#fff}
  .heading-copy{min-width:0}
  .topbar small{color:#819087;font-size:9px}
  .topbar h1{margin:5px 0 0;font-size:19px}
  .account{display:flex;align-items:center;gap:10px;margin-left:auto}
  .avatar{width:36px;height:36px;flex:0 0 36px;display:grid;place-items:center;border-radius:50%;background:#e7f2ea;color:#0a5c37;font-size:10px;font-weight:800}
  .account-copy strong,.account-copy span{display:block}
  .account-copy strong{color:#294534;font-size:10px}
  .account-copy span{max-width:220px;margin-top:4px;overflow:hidden;color:#819087;font-size:9px;text-overflow:ellipsis;white-space:nowrap}
  .menu{display:none;padding:8px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#24583a}
  .content{width:100%;max-width:1600px;flex:1;margin:0 auto;padding:26px clamp(13px,2.2vw,32px) 38px}
  .page-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;margin-bottom:16px}
  .eyebrow{color:#0a8050;font-size:9px;font-weight:800;letter-spacing:1.3px}
  .page-heading h2{margin:7px 0;color:#193d2a;font-size:24px}
  .page-heading p{max-width:760px;margin:0;color:#718078;font-size:11px;line-height:1.65}
  .heading-actions{display:flex;gap:7px;flex-wrap:wrap}
  .primary-button,.secondary-button{min-height:36px;padding:9px 12px;border:1px solid #0a5c37;border-radius:7px;background:#0a5c37;color:#fff;font-size:9px;font-weight:800;cursor:pointer}
  .secondary-button{border-color:#d7e4da;background:#fff;color:#0a6841}
  button:disabled{opacity:.45;cursor:default}
  .notice{display:grid;gap:4px;padding:12px 14px;margin-bottom:14px;border:1px solid #d5e8da;border-radius:8px;background:#f0f8f2;color:#54715d;font-size:9px;line-height:1.55}
  .notice strong{color:#16613b;font-size:10px}
  .filters{display:grid;grid-template-columns:180px minmax(260px,1fr) 170px;align-items:end;gap:12px;margin-bottom:11px;padding:13px}
  .panel{border:1px solid #e3ebe5;border-radius:10px;background:#fff}
  .filters label,.search-form label{display:grid;gap:6px;color:#56685c;font-size:9px;font-weight:700}
  .filters input,.filters select,.search-form input{width:100%;min-width:0;min-height:37px;padding:8px 10px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#26392d;font:inherit;font-size:10px}
  .search-form{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:7px;min-width:0}
  .search-form .primary-button{min-width:74px}
  .period-row{display:flex;justify-content:space-between;gap:10px;margin:14px 1px 9px;color:#819087;font-size:9px}
  .period-row strong{color:#395645}
  .summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:13px}
  .summary-card{padding:14px 15px;border:1px solid #e2eae4;border-radius:9px;background:#fff}
  .summary-card span,.summary-card small{display:block;color:#718078;font-size:9px}
  .summary-card strong{display:block;margin:6px 0 4px;color:#19452d;font-size:24px}
  .summary-card small{font-size:8px}
  .summary-card .pending-number{color:#a66a12}
  .summary-card .cleared-number{color:#0c7543}
  .summary-card .not-cleared-number{color:#b44738}
  .records-panel{padding:17px 17px 13px}
  .records-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px}
  .records-heading h3{margin:5px 0;color:#264431;font-size:15px}
  .records-heading p{margin:0;color:#819087;font-size:9px}
  .record-count{padding:6px 9px;border-radius:15px;background:#e8f5ec;color:#0a6841;font-size:8px;font-weight:800;white-space:nowrap}
  .table-wrap{width:100%;overflow:auto}
  table{width:100%;min-width:1060px;border-collapse:collapse}
  th{padding:10px 9px;border-bottom:1px solid #e8eee9;background:#f8faf8;color:#738278;font-size:8px;text-align:left;white-space:nowrap}
  td{padding:11px 9px;border-bottom:1px solid #edf2ee;color:#425b4b;font-size:9px;vertical-align:top}
  tr:last-child td{border-bottom:0}
  td strong,td small{display:block}
  td strong{color:#294834;font-size:9px}
  td small{margin-top:4px;color:#89968e;font-size:8px;line-height:1.4}
  .muted{color:#89968e;font-size:9px}
  .status-pill{display:inline-flex;padding:5px 8px;border-radius:14px;font-size:8px;font-weight:800;white-space:nowrap}
  .status-pill.pending{background:#fff3df;color:#9a6412}
  .status-pill.cleared{background:#e7f5eb;color:#0c7543}
  .status-pill.rejected{background:#fff0ed;color:#ae4436}
  .actions{min-width:205px}
  .actions button,.mobile-actions button{margin:0 3px 4px 0;padding:6px 8px;border:1px solid #dce7df;border-radius:6px;background:#fff;color:#355442;font-size:8px;font-weight:800;cursor:pointer}
  .actions .action-clear,.mobile-actions .action-clear{border-color:#0a6841;background:#0a6841;color:#fff}
  .actions .action-return,.mobile-actions .action-return{border-color:#ead2cd;background:#fff8f6;color:#a34b3d}
  .actions .action-reopen,.mobile-actions .action-reopen{background:#f5f7f5}
  .actions .history-toggle,.mobile-actions .history-toggle{color:#0a6841}
  .actions button:disabled,.mobile-actions button:disabled{opacity:.4;cursor:default}
  .history-row td{padding:0 12px 12px;background:#fbfdfb}
  .history-content{display:grid;grid-template-columns:1fr 1.5fr;gap:14px;padding:12px;border:1px solid #edf2ee;border-radius:8px;background:#fff}
  .history-content strong{color:#375844;font-size:9px}
  .history-content p{margin:5px 0;color:#718078;font-size:8px;line-height:1.6;overflow-wrap:anywhere}
  .table-note{margin:12px 0 0;color:#849188;font-size:8px;line-height:1.5}
  .mobile-records{display:none}
  .empty{padding:40px 14px;color:#819087;text-align:center;font-size:10px}
  .message{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;margin:10px 0;border-radius:7px;font-size:10px}
  .message.error{border:1px solid #efceca;background:#fff3f2;color:#a32920}
  .message.success{border:1px solid #cce6d3;background:#eef8f0;color:#16633b}
  .message button{padding:5px 8px;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;font-size:8px}
  .refresh-note{margin:8px 0;color:#87948b;font-size:9px}
  footer{padding:15px 24px;border-top:1px solid #e8ece8;color:#89948c;font-size:9px}
  .state{min-height:100vh;display:grid;place-content:center;justify-items:center;color:#53665a;font:12px Inter,Arial,sans-serif}
  .loader{width:28px;height:28px;border:3px solid #dce8df;border-top-color:#0a8050;border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
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
  @media(max-width:1050px){.filters{grid-template-columns:160px minmax(220px,1fr)}.filters>label:last-child{grid-column:1/-1}.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:760px){
    .menu{display:block}.topbar{padding:12px 14px}.account-copy{display:none}
    .content{padding:20px 12px 28px}.page-heading{align-items:flex-start;flex-direction:column}
    .heading-actions{width:100%}.heading-actions button{flex:1}
    .filters{grid-template-columns:minmax(0,1fr);gap:10px;padding:11px}
    .filters>label:last-child{grid-column:auto}
    .search-form{grid-template-columns:minmax(0,1fr) auto}
    .summary-grid{gap:8px}.summary-card{padding:12px}.summary-card strong{font-size:22px}
    .table-wrap{display:none}.mobile-records{display:grid;gap:10px}
    .member-card{padding:13px}.member-card-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
    .member-card-heading strong,.member-card-heading small{display:block}
    .member-card-heading strong{color:#294834;font-size:10px}.member-card-heading small{margin-top:4px;color:#819087;font-size:8px}
    .mobile-evidence{display:grid;gap:8px;margin-top:13px;padding-top:11px;border-top:1px solid #edf1ed}
    .mobile-evidence span,.mobile-evidence strong{display:block}
    .mobile-evidence span{margin-bottom:3px;color:#819087;font-size:8px}
    .mobile-evidence strong{color:#3c5a47;font-size:9px;font-weight:600;line-height:1.5}
    .mobile-actions{display:flex;flex-wrap:wrap;gap:5px;margin-top:12px}
    .decision-note{padding:8px;margin:10px 0 0;border-radius:6px;background:#fff8e9;color:#8a5b00;font-size:8px;line-height:1.5}
    .mobile-history{padding:8px;margin-top:9px;border-radius:6px;background:#f7faf7}
    .mobile-history p{margin:4px 0;color:#718078;font-size:8px;line-height:1.6}
  }
  @media print{
    :global(body){background:#fff!important}
    .no-print,.menu,.sidebar,.notification-bell,.modal-layer,footer{display:none!important}
    .dashboard,.main{display:block!important;min-height:0!important}
    .content{max-width:none!important;padding:0!important}
    .topbar{display:none!important}
    .summary-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
    .table-wrap{display:block!important;overflow:visible}
    .mobile-records{display:none!important}
    table{min-width:0!important}
    th,td{padding:6px 4px;font-size:7px}
    .records-panel,.summary-card{break-inside:avoid;box-shadow:none}
  }
</style>
