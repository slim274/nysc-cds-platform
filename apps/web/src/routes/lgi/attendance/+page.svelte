<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import LgiSidebar from '#lib/components/LgiSidebar.svelte';
  import { ApiError, getCurrentUser, logout, listLgiAttendanceMeetings, getLgiAttendanceMeeting } from '#lib/api/client.ts';
  import type { AuthUser, CdsMeetingSummary, CdsMeetingDetails } from '#lib/api/client.ts';

  let user = $state<AuthUser | null>(null);
  let meetings = $state<CdsMeetingSummary[]>([]);
  let selected = $state<CdsMeetingDetails | null>(null);
  let loading = $state(true);
  let error = $state('');
  let mobileOpen = $state(false);

  onMount(() => { void load(); });
  async function load() {
    loading = true; error = '';
    try {
      const session = await getCurrentUser();
      if (!session.roles.some((role) => role.code === 'LGI_ADMIN')) { await goto('/login'); return; }
      user = session.user;
      meetings = await listLgiAttendanceMeetings();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { await goto('/login'); return; }
      error = e instanceof Error ? e.message : 'Unable to load LGA attendance reports.';
    } finally { loading = false; }
  }
  async function view(id: string) {
    error = '';
    try { selected = await getLgiAttendanceMeeting(id); }
    catch (e) { error = e instanceof Error ? e.message : 'Unable to load the attendance report.'; }
  }
  function label(v: string) { return v.replaceAll('_',' ').replace(/\b\w/g,(s)=>s.toUpperCase()); }
  function dateTime(v: string) { return new Date(v).toLocaleString(); }
  async function signOut() { try { await logout(); } finally { await goto('/login'); } }
</script>

<svelte:head><title>CDS Attendance Reports | NYSC CDS Platform</title><meta name="description" content="View attendance reports for CDS groups in your assigned LGA." /></svelte:head>

{#if loading}
  <main class="state"><div class="loader"></div><p>Loading LGA attendance reports…</p></main>
{:else if user}
  <div class="dashboard">
    <LgiSidebar activePath="/lgi/attendance" open={mobileOpen} onClose={() => (mobileOpen = false)} onSignOut={signOut} />
    <section class="main">
      <header class="topbar">
        <button class="menu" type="button" aria-label="Toggle navigation" aria-expanded={mobileOpen} onclick={() => (mobileOpen = !mobileOpen)}>☰</button>
        <div><small>Administration / CDS Attendance</small><h1>CDS Attendance Reports</h1></div>
        <div class="account">
          <div class="avatar">LG</div>
          <div class="account-copy">
            <strong>LGI Administrator</strong>
            <span>{user.email}</span>
          </div>
        </div>
      </header>
      <main class="content">
        <div class="intro"><span class="eyebrow">LGA MONITORING</span><h2>Group attendance overview</h2><p>Read-only attendance reports from CDS groups in your assigned Local Government Area(s). The attendance register is maintained by the CDS President and reviewed by the Coordinator.</p></div>
        {#if error}<div class="message error" role="alert">{error}</div>{/if}
        <section class="layout">
          <div class="panel">
            <div class="heading"><div><span class="eyebrow">MEETING REPORTS</span><h3>Attendance register</h3></div><strong>{meetings.length}</strong></div>
            {#if meetings.length === 0}<div class="empty">No CDS meetings have been scheduled in your assigned LGA(s).</div>
            {:else}
              <div class="list">
                {#each meetings as meeting}
                  <button type="button" class:chosen={selected?.id === meeting.id} class="item" onclick={() => void view(meeting.id)}>
                    <div class="item-title"><strong>{meeting.title}</strong><span class="status">{label(meeting.status)}</span></div>
                    <small>{meeting.groupCode} · {meeting.groupName}</small>
                    <small>{meeting.lgaName} · {dateTime(meeting.startsAt)}</small>
                    <small>{meeting.attendanceSummary.present} present · {meeting.attendanceSummary.absent} absent · {meeting.attendanceSummary.late} late · {meeting.attendanceSummary.excused} excused</small>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
          <div class="panel">
            {#if !selected}<div class="empty">Select a meeting to inspect the submitted or pending attendance register.</div>
            {:else}
              <div class="heading"><div><span class="eyebrow">{selected.lgaName} · {selected.groupCode}</span><h3>{selected.title}</h3><p>{selected.groupName} · {dateTime(selected.startsAt)}</p></div><span class="status">{label(selected.status)}</span></div>
              <div class="stats">
                <div><small>Present</small><strong>{selected.attendance.filter((r) => r.status === 'present').length}</strong></div>
                <div><small>Absent</small><strong>{selected.attendance.filter((r) => r.status === 'absent').length}</strong></div>
                <div><small>Late</small><strong>{selected.attendance.filter((r) => r.status === 'late').length}</strong></div>
                <div><small>Excused</small><strong>{selected.attendance.filter((r) => r.status === 'excused').length}</strong></div>
              </div>
              {#if selected.reviewDecision === 'returned'}<div class="message warning">Returned by Coordinator: {selected.reviewNotes}</div>{:else if selected.reviewDecision === 'approved'}<div class="message success">Approved by Coordinator on {selected.reviewedAt ? dateTime(selected.reviewedAt) : 'the recorded date'}.</div>{/if}
              {#if selected.attendance.length === 0}<p class="muted">The President has not opened the register yet.</p>
              {:else}
                <div class="roster">
                  {#each selected.attendance as member}
                    <div class="member"><div><strong>{member.firstName} {member.middleName ?? ''} {member.lastName}</strong><small>{member.stateCode}</small></div><span class="status">{label(member.status)}</span></div>
                  {/each}
                </div>
              {/if}
              {#if selected.audit?.length}
                <details class="audit"><summary>Audit history ({selected.audit.length})</summary>{#each selected.audit as event}<div class="audit-row"><strong>{label(event.eventType)}</strong><small>{dateTime(event.createdAt)}</small></div>{/each}</details>
              {/if}
              <p class="readonly">LGI reports are read-only. Raise corrections with the responsible Coordinator; the LGI account does not directly alter attendance marks.</p>
            {/if}
          </div>
        </section>
      </main>
      <footer>NYSC CDS Management Platform · LGI Administration</footer>
    </section>
  </div>
{:else}
  <main class="state"><p>{error || 'LGI workspace unavailable.'}</p><a href="/login">Return to login</a></main>
{/if}

<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#f5f7f5;color:#19251e;font-family:Inter,Arial,sans-serif}.dashboard{min-height:100vh;display:flex}.main{min-width:0;flex:1;display:flex;flex-direction:column}.topbar{min-height:80px;display:flex;align-items:center;gap:14px;padding:15px 28px;border-bottom:1px solid #e8ece8;background:#fff}.topbar small{color:#819087;font-size:9px}.topbar h1{margin:5px 0 0;font-size:19px}.account{display:flex;align-items:center;gap:10px;margin-left:auto}.avatar{width:36px;height:36px;flex:0 0 36px;display:grid;place-items:center;border-radius:50%;background:#e7f2ea;color:#0a5c37;font-size:10px;font-weight:800}.account-copy strong,.account-copy span{display:block}.account-copy strong{color:#294534;font-size:10px}.account-copy span{max-width:220px;margin-top:4px;overflow:hidden;color:#819087;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.menu{display:none;padding:8px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#24583a}.content{width:100%;max-width:1450px;flex:1;margin:0;padding:30px clamp(16px,2.4vw,35px)}.intro{margin-bottom:18px}.eyebrow{color:#0a8050;font-size:9px;font-weight:800;letter-spacing:1.3px}.intro h2{margin:8px 0;font-size:24px}.intro p{max-width:850px;margin:0;color:#718078;font-size:11px;line-height:1.7}.layout{display:grid;grid-template-columns:minmax(280px,.85fr) minmax(0,1.35fr);gap:14px}.panel{min-width:0;padding:18px;border:1px solid #e5ebe6;border-radius:10px;background:#fff}.heading{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:15px}.heading h3{margin:6px 0;font-size:15px}.heading p{margin:0;color:#819087;font-size:9px}.heading>strong{padding:5px 9px;border-radius:15px;background:#e8f5ec;color:#0a6841;font-size:10px}.list{display:grid;gap:8px}.item{display:grid;gap:6px;width:100%;padding:12px;border:1px solid #e8eee9;border-radius:8px;background:#fff;text-align:left;cursor:pointer}.item:hover,.item.chosen{border-color:#84bd98;background:#f5faf6}.item-title{display:flex;justify-content:space-between;align-items:center;gap:8px}.item-title strong{color:#24442f;font-size:10px}.item small{color:#819087;font-size:8px}.status{padding:5px 7px;border-radius:14px;background:#f2f5f3;color:#627267;font-size:8px;font-weight:800;white-space:nowrap}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:12px 0}.stats>div{padding:10px;border-radius:7px;background:#f4f8f5}.stats small,.stats strong{display:block}.stats small{color:#819087;font-size:8px}.stats strong{margin-top:4px;color:#16452c;font-size:18px}.roster{display:grid;gap:5px;max-height:440px;overflow:auto}.member,.audit-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px;border-radius:6px;background:#f7f9f7}.member strong,.member small{display:block}.member strong{font-size:9px;color:#355442}.member small,.audit-row small{margin-top:3px;color:#819087;font-size:8px}.audit{padding-top:12px;margin-top:14px;border-top:1px solid #edf1ed}.audit summary{color:#355442;font-size:10px;font-weight:800;cursor:pointer}.audit-row{margin-top:6px}.readonly{padding:11px;margin-top:15px;border-radius:7px;background:#f2f7f3;color:#6b7f70;font-size:9px;line-height:1.6}.muted{color:#819087;font-size:10px}.empty{padding:36px 12px;text-align:center;color:#819087;font-size:10px;line-height:1.6}.message{padding:10px 12px;margin:10px 0;border-radius:7px;font-size:10px;line-height:1.5}.message.error{background:#fff3f2;color:#a32920;border:1px solid #efceca}.message.success{background:#eef8f0;color:#16633b;border:1px solid #cce6d3}.message.warning{background:#fff8e9;color:#8a5b00;border:1px solid #f1dfb5}.state{min-height:100vh;display:grid;place-content:center;justify-items:center;color:#53665a;font:12px Inter,Arial,sans-serif}.loader{width:28px;height:28px;border:3px solid #dce8df;border-top-color:#0a8050;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}footer{padding:16px 26px;border-top:1px solid #e8ece8;color:#89948c;font-size:9px}@media(max-width:900px){.layout{grid-template-columns:1fr}}@media(max-width:760px){.menu{display:block}.topbar{padding:12px 14px}.account-copy{display:none}.content{padding:22px 13px}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
