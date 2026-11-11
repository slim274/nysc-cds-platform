<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { ApiError, getCurrentUser, logout, listPresidentAttendanceMeetings, getPresidentAttendanceMeeting, openCdsMeetingAttendance, markCdsMeetingAttendance, submitCdsMeetingAttendance } from '#lib/api/client.ts';
  import type { AuthUser, CdsMeetingSummary, CdsMeetingDetails, CdsAttendanceStatus } from '#lib/api/client.ts';

  let user = $state<AuthUser | null>(null);
  let meetings = $state<CdsMeetingSummary[]>([]);
  let selected = $state<CdsMeetingDetails | null>(null);
  let loading = $state(true);
  let savingMember = $state('');
  let saving = $state(false);
  let error = $state('');
  let notice = $state('');

  onMount(() => { void load(); });
  async function load() {
    loading = true; error = '';
    try {
      const session = await getCurrentUser();
      if (!session.roles.some((role) => role.code === 'CDS_PRESIDENT')) { await goto('/login'); return; }
      user = session.user;
      meetings = await listPresidentAttendanceMeetings();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { await goto('/login'); return; }
      error = e instanceof Error ? e.message : 'Unable to load attendance.';
    } finally { loading = false; }
  }
  async function viewMeeting(id: string) {
    error = ''; notice = '';
    try { selected = await getPresidentAttendanceMeeting(id); }
    catch (e) { error = e instanceof Error ? e.message : 'Unable to open meeting.'; }
  }
  async function openRegister() {
    if (!selected) return;
    saving = true; error = ''; notice = '';
    try {
      await openCdsMeetingAttendance(selected.id);
      await viewMeeting(selected.id);
      await loadMeetingsOnly();
      notice = 'Attendance register opened. Mark every member before submitting.';
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to open attendance register.'; }
    finally { saving = false; }
  }
  async function loadMeetingsOnly() { meetings = await listPresidentAttendanceMeetings(); }
  async function mark(memberId: string, value: string) {
    if (!selected || !['present','absent','late','excused'].includes(value)) return;
    savingMember = memberId; error = ''; notice = '';
    try {
      await markCdsMeetingAttendance(selected.id, memberId, value as Exclude<CdsAttendanceStatus,'not_marked'>);
      selected = await getPresidentAttendanceMeeting(selected.id);
      await loadMeetingsOnly();
      notice = 'Attendance updated.';
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to update this attendance record.'; }
    finally { savingMember = ''; }
  }
  async function submit() {
    if (!selected) return;
    const remaining = selected.attendance.filter((row) => row.status === 'not_marked').length;
    if (remaining) { error = `Mark all members first. ${remaining} remain unmarked.`; return; }
    if (!confirm('Submit this register to your CDS Coordinator? You cannot edit it unless it is returned for correction.')) return;
    saving = true; error = ''; notice = '';
    try {
      await submitCdsMeetingAttendance(selected.id);
      await viewMeeting(selected.id);
      await loadMeetingsOnly();
      notice = 'Attendance submitted to your CDS Coordinator.';
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to submit attendance.'; }
    finally { saving = false; }
  }
  function label(value: string) { return value.replaceAll('_',' ').replace(/\b\w/g,(s)=>s.toUpperCase()); }
  function dateTime(value: string) { return new Date(value).toLocaleString(); }
  async function signOut() { try { await logout(); } finally { await goto('/login'); } }
</script>

<svelte:head><title>Record CDS Attendance | NYSC CDS Platform</title><meta name="description" content="Record attendance for your assigned CDS meetings." /></svelte:head>

{#if loading}
  <main class="state"><div class="loader"></div><p>Loading your CDS meetings…</p></main>
{:else if user}
  <div class="workspace">
    <header class="topbar">
      <a class="brand" href="/cds-president"><span class="brand-icon">N</span><span><strong>NYSC CDS</strong><small>President workspace</small></span></a>
      <nav><a href="/cds-president">Dashboard</a><a class="active" href="/cds-president/attendance">Attendance</a><span>{user.email}</span><button onclick={signOut}>Sign out</button></nav>
    </header>
    <main class="content">
      <div class="hero"><div><span class="eyebrow">CDS GROUP OPERATIONS</span><h1>Meeting attendance</h1><p>Open a scheduled meeting, record each active member as Present, Absent, Late or Excused, then submit the register to your Coordinator.</p></div><span class="role">President access active</span></div>
      {#if error}<div class="message error" role="alert">{error}</div>{/if}
      {#if notice}<div class="message success" role="status">{notice}</div>{/if}
      <section class="layout">
        <div class="panel">
          <div class="panel-heading"><div><span class="eyebrow">YOUR GROUP MEETINGS</span><h2>Meeting list</h2></div><strong>{meetings.length}</strong></div>
          {#if meetings.length === 0}<div class="empty">Your Coordinator has not scheduled any CDS meetings yet.</div>
          {:else}
            <div class="meeting-list">
              {#each meetings as meeting}
                <button class:chosen={selected?.id === meeting.id} type="button" class="meeting" onclick={() => void viewMeeting(meeting.id)}>
                  <div class="meeting-title"><strong>{meeting.title}</strong><span class:submitted={meeting.status === 'submitted'} class:reviewed={meeting.status === 'reviewed'} class="status">{label(meeting.status)}</span></div>
                  <small>{meeting.groupCode} · {meeting.groupName}</small>
                  <small>{dateTime(meeting.startsAt)}</small>
                  <small>{meeting.attendanceSummary.total} members · {meeting.attendanceSummary.unmarked} unmarked</small>
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <div class="panel">
          {#if !selected}<div class="empty">Select a scheduled meeting to open and record attendance.</div>
          {:else}
            <div class="panel-heading"><div><span class="eyebrow">{selected.groupCode} · {selected.groupName}</span><h2>{selected.title}</h2><p>{dateTime(selected.startsAt)} · {selected.venue ?? 'Venue not specified'}</p></div><span class="status">{label(selected.status)}</span></div>
            {#if selected.reviewDecision === 'returned'}<div class="message warning"><strong>Returned by Coordinator:</strong> {selected.reviewNotes}</div>{/if}
            {#if selected.status === 'scheduled'}
              <div class="callout">Open the attendance register to take a snapshot of the active group roster.</div>
              <button class="primary" type="button" onclick={openRegister} disabled={saving}>{saving ? 'Opening…' : 'Open attendance register'}</button>
            {:else if selected.status === 'attendance_open'}
              <div class="completion"><span>{selected.attendance.filter((r) => r.status !== 'not_marked').length} of {selected.attendance.length} marked</span><span>{selected.attendance.filter((r) => r.status === 'not_marked').length} remaining</span></div>
              <div class="roster">
                {#each selected.attendance as member}
                  <div class="member-row">
                    <div class="member-name"><strong>{member.firstName} {member.middleName ?? ''} {member.lastName}</strong><small>{member.stateCode}</small></div>
                    <select aria-label="Attendance for {member.firstName} {member.lastName}" value={member.status === 'not_marked' ? '' : member.status} onchange={(event) => void mark(member.memberId, (event.currentTarget as HTMLSelectElement).value)} disabled={savingMember === member.memberId}>
                      <option value="">Select status</option><option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option><option value="excused">Excused</option>
                    </select>
                  </div>
                {/each}
              </div>
              <button class="primary submit" type="button" onclick={submit} disabled={saving || selected.attendance.some((r) => r.status === 'not_marked')}>{saving ? 'Submitting…' : 'Submit attendance to Coordinator'}</button>
            {:else if selected.status === 'submitted'}
              <div class="message success">Attendance submitted. It is locked while awaiting Coordinator review.</div>
              {@render AttendanceSummary(selected)}
            {:else if selected.status === 'reviewed'}
              <div class="message success">Your Coordinator approved this attendance register. It is now locked.</div>
              <AttendanceSummary {selected} />
            {:else}
              <div class="message warning">This meeting was cancelled. Attendance cannot be recorded.</div>
            {/if}
          {/if}
        </div>
      </section>
    </main>
    <footer>NYSC CDS Management Platform · President Workspace</footer>
  </div>
{:else}
  <main class="state"><p>{error || 'President workspace unavailable.'}</p><a href="/login">Return to sign in</a></main>
{/if}

{#snippet AttendanceSummary(selected: CdsMeetingDetails)}
  <div class="summary">
    {#each ['present','absent','late','excused'] as status}
      <div><small>{label(status)}</small><strong>{selected.attendance.filter((r) => r.status === status).length}</strong></div>
    {/each}
  </div>
  {#each selected.attendance as member}
    <div class="read-only-row"><span>{member.firstName} {member.lastName}</span><strong>{label(member.status)}</strong></div>
  {/each}
{/snippet}

<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#f4f7f5;color:#17251c;font-family:Inter,Arial,sans-serif}button,input,select{font:inherit}.workspace{min-height:100vh;display:flex;flex-direction:column}.topbar{min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:15px;padding:12px clamp(14px,4vw,45px);border-bottom:1px solid #e5ebe6;background:#fff}.brand{display:flex;align-items:center;gap:10px;text-decoration:none}.brand-icon{width:39px;height:39px;display:grid;place-items:center;border-radius:9px;background:#0a5c37;color:#fff;font-size:20px;font-weight:800}.brand strong,.brand small{display:block}.brand strong{color:#0a5c37;font-size:12px}.brand small{margin-top:3px;color:#819087;font-size:9px}.topbar nav{display:flex;align-items:center;gap:15px}.topbar nav a,.topbar nav span{color:#718078;font-size:10px;text-decoration:none}.topbar nav a.active{color:#0a6841;font-weight:800}.topbar nav button{padding:8px 11px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#355442;font-size:9px;font-weight:700}.content{width:min(1180px,100%);margin:0 auto;padding:30px 20px;flex:1}.hero{display:flex;justify-content:space-between;gap:15px;align-items:flex-start;margin-bottom:20px}.eyebrow{color:#0a8050;font-size:9px;font-weight:800;letter-spacing:1.3px}.hero h1{margin:8px 0;font-size:27px}.hero p{max-width:740px;margin:0;color:#718078;font-size:11px;line-height:1.7}.role{padding:8px 10px;border-radius:20px;background:#e8f5ec;color:#1c6840;font-size:9px;font-weight:800;white-space:nowrap}.layout{display:grid;grid-template-columns:minmax(270px,.8fr) minmax(0,1.4fr);gap:14px}.panel{min-width:0;padding:18px;border:1px solid #e3ebe5;border-radius:10px;background:#fff}.panel-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:15px}.panel-heading h2{margin:6px 0;font-size:15px}.panel-heading p{margin:0;color:#819087;font-size:9px}.panel-heading>strong{padding:5px 9px;border-radius:15px;background:#e8f5ec;color:#0a6841;font-size:10px}.meeting-list{display:grid;gap:8px}.meeting{display:grid;gap:6px;width:100%;padding:12px;border:1px solid #e8eee9;border-radius:8px;background:#fff;text-align:left;cursor:pointer}.meeting.chosen,.meeting:hover{border-color:#84bd98;background:#f5faf6}.meeting-title{display:flex;align-items:center;justify-content:space-between;gap:8px}.meeting-title strong{font-size:10px;color:#24442f}.meeting small{color:#819087;font-size:8px}.status{padding:5px 7px;border-radius:14px;background:#f2f5f3;color:#627267;font-size:8px;font-weight:800;white-space:nowrap}.status.submitted{background:#fff4df;color:#9c6500}.status.reviewed{background:#e8f5ec;color:#087443}.empty{padding:38px 12px;text-align:center;color:#819087;font-size:10px;line-height:1.6}.callout{padding:12px;margin-bottom:12px;border-radius:8px;background:#eef7f0;color:#466650;font-size:10px;line-height:1.6}.primary{min-height:40px;padding:10px 14px;border:1px solid #0a5c37;border-radius:8px;background:#0a5c37;color:#fff;font-size:10px;font-weight:800;cursor:pointer}.primary:disabled{opacity:.55;cursor:wait}.completion{display:flex;justify-content:space-between;gap:10px;padding:10px 12px;margin-bottom:10px;border-radius:7px;background:#f2f7f3;color:#42634b;font-size:9px;font-weight:700}.roster{display:grid;gap:6px;max-height:560px;overflow:auto}.member-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px;border-radius:7px;background:#f7f9f7}.member-name{min-width:0}.member-name strong,.member-name small{display:block}.member-name strong{color:#344b3b;font-size:9px}.member-name small{margin-top:3px;color:#819087;font-size:8px}.member-row select{width:135px;min-height:35px;padding:7px;border:1px solid #dce5de;border-radius:6px;background:#fff;color:#355442;font-size:9px}.submit{width:100%;margin-top:13px}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:12px 0}.summary>div{padding:10px;border-radius:7px;background:#f4f8f5}.summary small,.summary strong{display:block}.summary small{color:#819087;font-size:8px}.summary strong{margin-top:4px;color:#16452c;font-size:18px}.read-only-row{display:flex;justify-content:space-between;padding:8px;border-bottom:1px solid #edf1ed;color:#607267;font-size:9px}.read-only-row strong{color:#355442}.message{padding:10px 12px;margin:10px 0;border-radius:7px;font-size:10px;line-height:1.5}.message.error{background:#fff3f2;color:#a32920;border:1px solid #efceca}.message.success{background:#eef8f0;color:#16633b;border:1px solid #cce6d3}.message.warning{background:#fff8e9;color:#8a5b00;border:1px solid #f1dfb5}.state{min-height:100vh;display:grid;place-content:center;justify-items:center;color:#53665a;font:12px Inter,Arial,sans-serif}.loader{width:28px;height:28px;border:3px solid #dce8df;border-top-color:#0a8050;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}footer{padding:15px;text-align:center;color:#819087;font-size:9px}@media(max-width:850px){.layout{grid-template-columns:1fr}.hero{flex-direction:column}}@media(max-width:560px){.content{padding:22px 12px}.topbar{flex-wrap:wrap}.topbar nav{width:100%;justify-content:space-between;gap:7px}.topbar nav span{display:none}.member-row{align-items:flex-start;flex-direction:column}.member-row select{width:100%}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
