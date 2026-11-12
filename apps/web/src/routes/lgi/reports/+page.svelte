<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import LgiSidebar from '#lib/components/LgiSidebar.svelte';
  import {
    ApiError,
    getCurrentUser,
    getLgiAnalytics,
    logout,
    type AuthUser,
    type LgiAnalyticsData,
    type LgiAnalyticsGroup
  } from '#lib/api/client.ts';

  let user = $state<AuthUser | null>(null);
  let data = $state<LgiAnalyticsData | null>(null);
  let loading = $state(true);
  let refreshing = $state(false);
  let error = $state('');
  let mobileOpen = $state(false);
  let months = $state<3 | 6 | 12>(6);
  let signingOut = $state(false);

  const approvalRate = $derived(
    data && data.summary.reviewedRegisters > 0
      ? Math.round((data.summary.approvedRegisters / data.summary.reviewedRegisters) * 1000) / 10
      : null
  );

  onMount(() => {
    void initialise();
  });

  async function initialise() {
    loading = true;
    error = '';
    try {
      const session = await getCurrentUser();
      if (!session.roles.some((role) => role.code === 'LGI_ADMIN')) {
        await goto('/login');
        return;
      }
      user = session.user;
      await loadAnalytics(months);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await goto('/login');
        return;
      }
      error = e instanceof Error ? e.message : 'Unable to load LGI reports.';
    } finally {
      loading = false;
    }
  }

  async function loadAnalytics(period: 3 | 6 | 12) {
    refreshing = true;
    error = '';
    try {
      data = await getLgiAnalytics(period);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unable to load analytics data.';
    } finally {
      refreshing = false;
    }
  }

  async function changePeriod(value: string) {
    const parsed = Number(value);
    if (parsed !== 3 && parsed !== 6 && parsed !== 12) return;
    months = parsed;
    await loadAnalytics(months);
  }

  function formatPercent(value: number | null) {
    return value === null ? '—' : `${value.toFixed(1)}%`;
  }

  function formatGeneratedAt(value: string) {
    return new Intl.DateTimeFormat('en-NG', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  function csvCell(value: string | number | null) {
    const text = value === null ? '' : String(value);
    return '"' + text.replaceAll('"', '""') + '"';
  }

  function downloadCsv() {
    if (!data) return;
    const headers = [
      'CDS Group Code',
      'CDS Group Name',
      'LGA',
      'State',
      'Active Members',
      'Meetings Held',
      'Present',
      'Late',
      'Absent',
      'Excused',
      'Unmarked',
      'Attendance Rate (%)',
      'Reviewed Registers',
      'Approved Registers',
      'Register Approval Rate (%)',
      'Coordinator Email',
      'CDS President',
      'Needs Attention'
    ];
    const rows = data.groups.map((group) => [
      group.code,
      group.name,
      group.lgaName,
      group.stateName,
      group.activeMembers,
      group.meetingsHeld,
      group.present,
      group.late,
      group.absent,
      group.excused,
      group.unmarked,
      group.attendanceRatePercent,
      group.reviewedRegisters,
      group.approvedRegisters,
      group.registerApprovalRatePercent,
      group.coordinatorEmail,
      group.presidentName,
      group.needsAttention ? 'Yes' : 'No'
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((value) => csvCell(value as string | number | null)).join(','))
      .join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nysc-cds-analytics-${months}-months.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function printReport() {
    window.print();
  }

  function groupStatus(group: LgiAnalyticsGroup) {
    if (group.attendanceRatePercent === null) return 'No attendance data';
    return group.needsAttention ? 'Needs attention' : 'On track';
  }

  async function signOut() {
    signingOut = true;
    try {
      await logout();
    } finally {
      await goto('/login');
    }
  }
</script>

<svelte:head>
  <title>LGI Analytics &amp; Reports | NYSC CDS Platform</title>
  <meta name="description" content="Attendance analytics and CDS group performance reports for your assigned LGA(s)." />
</svelte:head>

{#if loading}
  <main class="state"><div class="loader"></div><p>Loading LGI analytics…</p></main>
{:else if user}
  <div class="dashboard">
    <LgiSidebar activePath="/lgi/reports" open={mobileOpen} signingOut={signingOut} onClose={() => (mobileOpen = false)} onSignOut={signOut} />
    <section class="main">
      <header class="topbar no-print">
        <button class="menu" type="button" aria-label="Toggle navigation" aria-expanded={mobileOpen} onclick={() => (mobileOpen = !mobileOpen)}>☰</button>
        <div><small>Administration / Reports</small><h1>LGI Analytics &amp; Reporting</h1></div>
        <span class="email">{user.email}</span>
      </header>

      <main class="content">
        <section class="report-heading">
          <div>
            <span class="eyebrow">LGA PERFORMANCE OVERVIEW</span>
            <h2>CDS Analytics Dashboard</h2>
            <p>Monitor attendance, meeting reviews and leadership coverage across your assigned Local Government Area(s).</p>
          </div>
          <div class="report-controls no-print">
            <label for="period">Reporting period</label>
            <select id="period" value={months} onchange={(event) => void changePeriod(event.currentTarget.value)}>
              <option value="3">Last 3 months</option>
              <option value="6">Last 6 months</option>
              <option value="12">Last 12 months</option>
            </select>
            <button type="button" class="secondary" onclick={downloadCsv} disabled={!data || data.groups.length === 0}>Export Excel (CSV)</button>
            <button type="button" class="primary" onclick={printReport} disabled={!data}>Save as PDF</button>
          </div>
        </section>

        {#if error}
          <div class="message error no-print" role="alert">
            {error}
            <button type="button" onclick={() => void loadAnalytics(months)}>Retry</button>
          </div>
        {/if}

        {#if refreshing}
          <div class="refresh-note no-print" role="status">Updating report…</div>
        {/if}

        {#if data}
          <div class="report-meta">
            <span>Reporting window: last {data.periodMonths} months</span>
            <span>Generated {formatGeneratedAt(data.generatedAt)}</span>
          </div>

          <section class="kpi-grid" aria-label="CDS summary">
            <article class="kpi-card">
              <span class="kpi-label">Active CDS groups</span>
              <strong>{data.summary.activeGroups}</strong>
              <small>In assigned LGA(s)</small>
            </article>
            <article class="kpi-card">
              <span class="kpi-label">Active members</span>
              <strong>{data.summary.activeMembers.toLocaleString()}</strong>
              <small>Current active memberships</small>
            </article>
            <article class="kpi-card">
              <span class="kpi-label">Meetings held</span>
              <strong>{data.summary.meetingsHeld}</strong>
              <small>Non-cancelled meetings in period</small>
            </article>
            <article class="kpi-card">
              <span class="kpi-label">Overall attendance</span>
              <strong>{formatPercent(data.summary.attendanceRatePercent)}</strong>
              <small>Present and late ÷ marked eligible records</small>
            </article>
            <article class="kpi-card">
              <span class="kpi-label">Approved registers</span>
              <strong>{data.summary.approvedRegisters}</strong>
              <small>{data.summary.reviewedRegisters} reviewed registers</small>
            </article>
            <article class="kpi-card attention-card">
              <span class="kpi-label">Groups needing attention</span>
              <strong>{data.summary.groupsBelowThreshold}</strong>
              <small>Below 75% attendance</small>
            </article>
          </section>

          <section class="panel trend-panel">
            <div class="section-heading">
              <div><span class="eyebrow">ATTENDANCE TREND</span><h3>Monthly attendance performance</h3></div>
              <span class="legend"><i></i> Attendance rate</span>
            </div>
            {#if data.monthlyTrend.every((month) => month.attendanceRatePercent === null)}
              <div class="empty">There is no attendance data for this reporting period yet.</div>
            {:else}
              <div class="trend-chart">
                {#each data.monthlyTrend as month}
                  <div class="trend-column" title={month.attendanceRatePercent === null ? 'No marked attendance' : `${month.label}: ${formatPercent(month.attendanceRatePercent)}`}>
                    <strong>{formatPercent(month.attendanceRatePercent)}</strong>
                    <div class="bar-track"><div class="bar-fill" style:height={`${month.attendanceRatePercent ?? 0}%`}></div></div>
                    <span>{month.label}</span>
                    <small>{month.meetings} meetings</small>
                  </div>
                {/each}
              </div>
            {/if}
            <p class="chart-note">Attendance rate = (Present + Late) ÷ (Present + Late + Absent). Excused and unmarked entries are excluded.</p>
          </section>

          <section class="panel performance-panel">
            <div class="section-heading">
              <div><span class="eyebrow">GROUP COMPARISON</span><h3>CDS group performance</h3><p>Groups are ranked by attendance rate, with the lowest rates shown first.</p></div>
              <span class="record-count">{data.groups.length} groups</span>
            </div>

            {#if data.groups.length === 0}
              <div class="empty">No active CDS groups were found in your assigned LGA(s).</div>
            {:else}
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>CDS group</th>
                      <th>Members</th>
                      <th>Meetings</th>
                      <th>Attendance</th>
                      <th>Registers approved</th>
                      <th>Coordinator</th>
                      <th>CDS President</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each data.groups as group}
                      <tr class:needs-attention={group.needsAttention}>
                        <td><strong>{group.code}</strong><small>{group.name}</small><small>{group.lgaName}, {group.stateName}</small></td>
                        <td>{group.activeMembers}</td>
                        <td>{group.meetingsHeld}</td>
                        <td>
                          <strong class:low-rate={group.needsAttention}>{formatPercent(group.attendanceRatePercent)}</strong>
                          <div class="mini-track"><span style:width={`${group.attendanceRatePercent ?? 0}%`}></span></div>
                        </td>
                        <td>{group.approvedRegisters} / {group.reviewedRegisters}<small>{formatPercent(group.registerApprovalRatePercent)}</small></td>
                        <td>{group.coordinatorEmail ?? 'Not assigned'}</td>
                        <td>{group.presidentName ?? 'Not designated'}</td>
                        <td><span class="status-pill" class:warning={group.needsAttention} class:neutral={group.attendanceRatePercent === null}>{groupStatus(group)}</span></td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </section>

          <section class="insight-grid">
            <article class="panel insight">
              <span class="eyebrow">ATTENDANCE WATCHLIST</span>
              <h3>Groups requiring follow-up</h3>
              {#if data.groups.filter((group) => group.needsAttention).length === 0}
                <p class="positive">No groups are currently below the 75% attendance threshold.</p>
              {:else}
                {#each data.groups.filter((group) => group.needsAttention) as group}
                  <div class="watch-row"><div><strong>{group.code} · {group.name}</strong><small>{group.lgaName}</small></div><b>{formatPercent(group.attendanceRatePercent)}</b></div>
                {/each}
              {/if}
            </article>
            <article class="panel insight">
              <span class="eyebrow">LEADERSHIP COVERAGE</span>
              <h3>Coordinator and President assignments</h3>
              <div class="coverage-row"><span>Groups with Coordinator</span><strong>{data.groups.filter((group) => group.coordinatorEmail).length} / {data.groups.length}</strong></div>
              <div class="coverage-row"><span>Groups with active President</span><strong>{data.groups.filter((group) => group.presidentName).length} / {data.groups.length}</strong></div>
              <p class="muted">This section shows current role coverage, not a performance rating of individual leaders.</p>
            </article>
          </section>
        {/if}
      </main>

      <footer class="no-print">NYSC CDS Management Platform · LGI Analytics</footer>
    </section>
  </div>
{:else}
  <main class="state"><p>{error || 'LGI reports are unavailable.'}</p><a href="/login">Return to login</a></main>
{/if}

<style>
  :global(*){box-sizing:border-box}
  :global(body){margin:0;background:#f5f7f5;color:#19251e;font-family:Inter,Arial,sans-serif}
  .dashboard{min-height:100vh;display:flex}
  .main{min-width:0;flex:1;display:flex;flex-direction:column}
  .topbar{min-height:76px;display:flex;align-items:center;gap:14px;padding:13px 25px;border-bottom:1px solid #e5ebe6;background:#fff}
  .topbar small{color:#819087;font-size:9px}.topbar h1{margin:5px 0 0;font-size:18px}
  .email{margin-left:auto;color:#819087;font-size:9px}
  .menu{display:none;padding:8px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#24583a}
  .content{width:100%;max-width:1600px;flex:1;margin:0 auto;padding:27px clamp(14px,2.2vw,34px) 38px}
  .report-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-bottom:18px}
  .eyebrow{color:#0a8050;font-size:9px;font-weight:800;letter-spacing:1.3px}
  .report-heading h2{margin:7px 0;font-size:25px;color:#183c28}
  .report-heading p{max-width:720px;margin:0;color:#718078;font-size:11px;line-height:1.7}
  .report-controls{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end}
  .report-controls label{color:#607368;font-size:9px;font-weight:700}
  .report-controls select{min-height:35px;padding:7px 10px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#294534;font-size:10px}
  .primary,.secondary{min-height:35px;padding:8px 11px;border:1px solid #0a5c37;border-radius:7px;background:#0a5c37;color:#fff;font-size:9px;font-weight:800;cursor:pointer}
  .secondary{border-color:#d7e4da;background:#fff;color:#0a6841}
  button:disabled{opacity:.45;cursor:default}
  .report-meta{display:flex;justify-content:space-between;gap:12px;margin:0 1px 12px;color:#829087;font-size:9px}
  .kpi-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:13px}
  .kpi-card{min-width:0;padding:15px 16px;border:1px solid #e2eae4;border-radius:9px;background:#fff;box-shadow:0 2px 7px #183c2806}
  .kpi-label,.kpi-card small{display:block;color:#718078;font-size:9px}
  .kpi-card strong{display:block;margin:7px 0 5px;color:#16452c;font-size:25px;letter-spacing:-.5px}
  .kpi-card small{font-size:8px}
  .attention-card strong{color:#b66a12}
  .panel{min-width:0;padding:17px 18px;border:1px solid #e3ebe5;border-radius:10px;background:#fff}
  .trend-panel{margin-bottom:13px}
  .section-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:15px}
  .section-heading h3,.insight h3{margin:6px 0;color:#23432f;font-size:15px}
  .section-heading p{margin:4px 0 0;color:#819087;font-size:9px}
  .legend{display:flex;align-items:center;gap:6px;color:#819087;font-size:8px}
  .legend i{width:8px;height:8px;border-radius:2px;background:#16804c}
  .trend-chart{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:9px;align-items:end;min-height:190px;padding:9px 3px 0}
  .trend-column{min-width:0;display:flex;flex-direction:column;align-items:center;gap:5px}
  .trend-column strong{color:#355442;font-size:9px}
  .bar-track{width:min(100%,35px);height:116px;display:flex;align-items:flex-end;overflow:hidden;border-radius:5px 5px 2px 2px;background:#edf4ef}
  .bar-fill{width:100%;min-height:0;border-radius:5px 5px 2px 2px;background:linear-gradient(180deg,#36a36d,#0b6840)}
  .trend-column span{color:#607368;font-size:8px;text-align:center;white-space:nowrap}
  .trend-column small{color:#9aa49d;font-size:7px;white-space:nowrap}
  .chart-note{margin:13px 0 0;padding-top:10px;border-top:1px solid #eef2ee;color:#829087;font-size:8px;line-height:1.6}
  .record-count{padding:6px 9px;border-radius:15px;background:#e8f5ec;color:#0a6841;font-size:8px;font-weight:800;white-space:nowrap}
  .table-wrap{width:100%;overflow:auto}
  table{width:100%;border-collapse:collapse;min-width:1050px}
  th{padding:10px 9px;border-bottom:1px solid #e8eee9;background:#f8faf8;color:#738278;font-size:8px;text-align:left;white-space:nowrap}
  td{padding:11px 9px;border-bottom:1px solid #eef2ee;color:#405848;font-size:9px;vertical-align:middle}
  tr:last-child td{border-bottom:0}
  tr.needs-attention{background:#fffaf4}
  td strong,td small{display:block}
  td strong{color:#264532;font-size:9px}
  td small{margin-top:4px;color:#89968e;font-size:8px}
  td .low-rate{color:#b45328}
  .mini-track{width:74px;height:4px;margin-top:5px;overflow:hidden;border-radius:4px;background:#edf2ee}
  .mini-track span{display:block;height:100%;border-radius:4px;background:#16804c}
  .status-pill{display:inline-block;padding:5px 7px;border-radius:13px;background:#eaf5ed;color:#17663e;font-size:8px;font-weight:800;white-space:nowrap}
  .status-pill.warning{background:#fff2df;color:#9b5d0a}
  .status-pill.neutral{background:#f0f3f1;color:#738278}
  .insight-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-top:13px}
  .insight h3{margin-bottom:13px}
  .watch-row,.coverage-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:9px 0;border-top:1px solid #eff3ef}
  .watch-row strong,.watch-row small{display:block}
  .watch-row strong,.coverage-row span{color:#455f4d;font-size:9px}
  .watch-row small{margin-top:3px;color:#89968e;font-size:8px}
  .watch-row b,.coverage-row strong{color:#244c32;font-size:10px;white-space:nowrap}
  .positive,.muted{color:#718078;font-size:9px;line-height:1.6}
  .message{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;margin:12px 0;border-radius:7px;font-size:10px}
  .message.error{border:1px solid #efceca;background:#fff3f2;color:#a32920}
  .message button{padding:6px 9px;border:1px solid #efceca;border-radius:6px;background:#fff;color:#a32920;font-size:9px}
  .refresh-note{margin-bottom:8px;color:#89968e;font-size:9px}
  .empty{padding:30px 10px;color:#819087;text-align:center;font-size:10px}
  .state{min-height:100vh;display:grid;place-content:center;justify-items:center;color:#53665a;font:12px Inter,Arial,sans-serif}
  .loader{width:28px;height:28px;border:3px solid #dce8df;border-top-color:#0a8050;border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  footer{padding:15px 22px;border-top:1px solid #e8ece8;color:#89948c;font-size:9px}
  @media(max-width:1100px){.report-heading{align-items:flex-start;flex-direction:column}.report-controls{justify-content:flex-start}.kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:760px){.menu{display:block}.topbar{padding:12px 14px}.email{display:none}.content{padding:21px 12px 30px}.kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.insight-grid{grid-template-columns:1fr}.trend-chart{grid-template-columns:repeat(6,minmax(0,1fr));row-gap:15px}.report-meta{align-items:flex-start;flex-direction:column}}
  @media(max-width:420px){.report-controls{width:100%;display:grid;grid-template-columns:1fr 1fr}.report-controls label{grid-column:1/-1}.report-controls select{grid-column:1/-1;width:100%}.report-heading h2{font-size:21px}.kpi-card{padding:12px}.kpi-card strong{font-size:22px}.trend-column span{font-size:7px}}
  @media print{
    :global(body){background:#fff!important}
    .no-print,.menu{display:none!important}
    :global(.sidebar),:global(.notification-bell){display:none!important}
    .dashboard,.main{display:block!important;min-height:0!important}
    .content{max-width:none!important;padding:0!important}
    .report-heading{display:block;margin-bottom:14px}
    .report-heading h2{font-size:21px}
    .kpi-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
    .kpi-card,.panel{break-inside:avoid;box-shadow:none}
    .trend-chart{grid-template-columns:repeat(12,minmax(0,1fr))}
    .bar-track{height:85px}
    .table-wrap{overflow:visible}
    table{min-width:0;font-size:7px}
    th,td{padding:6px 4px;font-size:7px}
    .insight-grid{grid-template-columns:1fr 1fr}
    footer{display:none}
  }
</style>
