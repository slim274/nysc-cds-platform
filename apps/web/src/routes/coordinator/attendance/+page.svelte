<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import CoordinatorLayout from '#lib/components/CoordinatorLayout.svelte';
  import {
    ApiError, getCurrentUser, getMyCoordinatorGroups,
    listCoordinatorAttendanceMeetings, createCdsMeeting,
    getCoordinatorAttendanceMeeting, reviewCdsMeetingAttendance,
    cancelCdsMeeting, logout
  } from '#lib/api/client.ts';
  import type {
    AuthUser, CoordinatorWorkspaceGroup, CdsMeetingSummary, CdsMeetingDetails
  } from '#lib/api/client.ts';

  let user = $state<AuthUser | null>(null);
  let groups = $state<CoordinatorWorkspaceGroup[]>([]);
  let meetings = $state<CdsMeetingSummary[]>([]);
  let selected = $state<CdsMeetingDetails | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');
  let notice = $state('');
  let groupId = $state('');
  let title = $state('');
  let description = $state('');
  let venue = $state('');
  let startsAt = $state('');
  let endsAt = $state('');
  let reviewNotes = $state('');

  onMount(() => { void load(); });

  async function load() {
    loading = true; error = '';
    try {
      const session = await getCurrentUser();
      if (!session.roles.some((role) => role.code === 'CDS_COORDINATOR')) { await goto('/login'); return; }
      user = session.user;
      const [groupRows, meetingRows] = await Promise.all([
        getMyCoordinatorGroups(), listCoordinatorAttendanceMeetings()
      ]);
      groups = groupRows;
      meetings = meetingRows;
      if (!groupId && groupRows.length) groupId = groupRows[0].id;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { await goto('/login'); return; }
      error = e instanceof Error ? e.message : 'Unable to load attendance workspace.';
    } finally { loading = false; }
  }

  async function createMeeting(event: SubmitEvent) {
    event.preventDefault();
    if (!groupId || !title.trim() || !startsAt || !endsAt) { error = 'Complete the group, title, start and end time.'; return; }
    if (new Date(endsAt) <= new Date(startsAt)) { error = 'Meeting end must be after the start.'; return; }
    saving = true; error = ''; notice = '';
    try {
      const created = await createCdsMeeting({
        groupId, title: title.trim(), description: description.trim() || undefined,
        venue: venue.trim() || undefined,
        startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString()
      });
      title = ''; description = ''; venue = ''; startsAt = ''; endsAt = '';
      notice = 'CDS meeting scheduled successfully.';
      await load();
      selected = await getCoordinatorAttendanceMeeting(created.id);
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to schedule meeting.'; }
    finally { saving = false; }
  }

  async function viewMeeting(id: string) {
    error = ''; notice = '';
    try { selected = await getCoordinatorAttendanceMeeting(id); reviewNotes = selected.reviewNotes ?? ''; }
    catch (e) { error = e instanceof Error ? e.message : 'Unable to load attendance details.'; }
  }

  async function review(decision: 'approved' | 'returned') {
    if (!selected) return;
    if (decision === 'returned' && !reviewNotes.trim()) { error = 'Provide a correction reason before returning attendance.'; return; }
    if (!confirm(decision === 'approved' ? 'Approve this attendance record?' : 'Return this attendance record to the President for correction?')) return;
    saving = true; error = ''; notice = '';
    try {
      await reviewCdsMeetingAttendance(selected.id, decision, reviewNotes.trim() || undefined);
      notice = decision === 'approved' ? 'Attendance approved and locked.' : 'Attendance returned to the President for correction.';
      await load();
      await viewMeeting(selected.id);
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to review attendance.'; }
    finally { saving = false; }
  }

  async function cancelMeeting(id: string) {
    if (!confirm('Cancel this CDS meeting? This action will be recorded in the audit history.')) return;
    saving = true; error = ''; notice = '';
    try {
      await cancelCdsMeeting(id);
      notice = 'Meeting cancelled.';
      selected = null;
      await load();
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to cancel meeting.'; }
    finally { saving = false; }
  }

  function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (s) => s.toUpperCase()); }
  function dateTime(value: string) { return new Date(value).toLocaleString(); }
  async function signOut() { try { await logout(); } finally { await goto('/login'); } }
</script>

<svelte:head>
  <title>CDS Attendance | NYSC CDS Platform</title>
  <meta name="description" content="Schedule CDS meetings and review group attendance." />
</svelte:head>

{#if loading}
  <main class="state"><div class="loader"></div><p>Loading attendance workspace…</p></main>
{:else if user}
  <CoordinatorLayout activePath="/coordinator/attendance" pageTitle="CDS Attendance" userEmail={user.email} onSignOut={signOut}>
    <div class="page">
      <div class="intro"><span class="eyebrow">GROUP OPERATIONS</span><h2>Meeting attendance</h2><p>Schedule meetings for your assigned groups, monitor submitted registers and review attendance recorded by each CDS President.</p></div>
      {#if error}<div class="message error" role="alert">{error}</div>{/if}
      {#if notice}<div class="message success" role="status">{notice}</div>{/if}

      <section class="panel">
        <div class="panel-title"><div><span class="eyebrow">NEW MEETING</span><h3>Schedule a CDS meeting</h3></div></div>
        {#if groups.length === 0}
          <p class="muted">You do not currently have an active CDS group assignment.</p>
        {:else}
          <form class="form-grid" onsubmit={createMeeting}>
            <label>CDS group<select bind:value={groupId} required>{#each groups.filter((g) => g.isActive) as group}<option value={group.id}>{group.code} · {group.name}</option>{/each}</select></label>
            <label>Meeting title<input bind:value={title} maxlength="160" placeholder="e.g. Weekly CDS meeting" required /></label>
            <label>Start date and time<input type="datetime-local" bind:value={startsAt} required /></label>
            <label>End date and time<input type="datetime-local" bind:value={endsAt} required /></label>
            <label>Venue<input bind:value={venue} maxlength="240" placeholder="Meeting venue (optional)" /></label>
            <label class="wide">Description<textarea bind:value={description} rows="2" maxlength="4000" placeholder="Meeting agenda or instructions (optional)"></textarea></label>
            <button class="primary" type="submit" disabled={saving || !groups.length}>{saving ? 'Saving…' : 'Schedule meeting'}</button>
          </form>
        {/if}
      </section>

      <section class="layout">
        <div class="panel">
          <div class="panel-title"><div><span class="eyebrow">MEETING REGISTER</span><h3>Your assigned groups</h3></div><span class="count">{meetings.length}</span></div>
          {#if meetings.length === 0}
            <div class="empty">No CDS meetings have been scheduled for your groups yet.</div>
          {:else}
            <div class="meeting-list">
              {#each meetings as meeting}
                <button class:chosen={selected?.id === meeting.id} class="meeting" type="button" onclick={() => void viewMeeting(meeting.id)}>
                  <div class="row"><strong>{meeting.title}</strong><span class:submitted={meeting.status === 'submitted'} class:approved={meeting.status === 'reviewed'} class:cancelled={meeting.status === 'cancelled'} class="status">{label(meeting.status)}</span></div>
                  <span class="group">{meeting.groupCode} · {meeting.groupName}</span>
                  <small>{dateTime(meeting.startsAt)}</small>
                  <span class="numbers">{meeting.attendanceSummary.total} rostered · {meeting.attendanceSummary.present} present · {meeting.attendanceSummary.unmarked} unmarked</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <div class="panel detail">
          {#if !selected}
            <div class="empty">Select a meeting to inspect its attendance register and review history.</div>
          {:else}
            <div class="panel-title"><div><span class="eyebrow">{selected.groupCode} · {selected.groupName}</span><h3>{selected.title}</h3><p class="muted">{dateTime(selected.startsAt)} · {selected.venue ?? 'Venue not specified'}</p></div><span class="status">{label(selected.status)}</span></div>
            {#if selected.reviewDecision === 'returned'}<div class="message warning">Returned for correction: {selected.reviewNotes ?? 'See review notes.'}</div>{/if}
            <div class="summary">
              <div><small>Present</small><strong>{selected.attendance.filter((r) => r.status === 'present').length}</strong></div>
              <div><small>Absent</small><strong>{selected.attendance.filter((r) => r.status === 'absent').length}</strong></div>
              <div><small>Late</small><strong>{selected.attendance.filter((r) => r.status === 'late').length}</strong></div>
              <div><small>Excused</small><strong>{selected.attendance.filter((r) => r.status === 'excused').length}</strong></div>
            </div>
            {#if selected.attendance.length === 0}
              <p class="muted">The President has not opened attendance for this meeting yet.</p>
            {:else}
              <div class="roster">
                {#each selected.attendance as member}
                  <div class="member"><div><strong>{member.firstName} {member.middleName ?? ''} {member.lastName}</strong><small>{member.stateCode}</small></div><span class:unmarked={member.status === 'not_marked'} class="status">{label(member.status)}</span></div>
                {/each}
              </div>
            {/if}
            {#if selected.status === 'submitted'}
              <div class="review-box">
                <label>Review notes <textarea rows="3" bind:value={reviewNotes} placeholder="Required when returning for correction."></textarea></label>
                <div class="actions"><button class="secondary" type="button" onclick={() => void review('returned')} disabled={saving}>Return for correction</button><button class="primary" type="button" onclick={() => void review('approved')} disabled={saving}>Approve attendance</button></div>
              </div>
            {:else if selected.status === 'scheduled' || selected.status === 'attendance_open'}
              <p class="muted">Attendance is {selected.status === 'scheduled' ? 'waiting for the President to open the register.' : 'being recorded by the President.'}</p>
              <button class="secondary" type="button" onclick={() => void cancelMeeting(selected!.id)} disabled={saving}>Cancel meeting</button>
            {:else if selected.status === 'reviewed'}
              <div class="message success">Attendance approved on {selected.reviewedAt ? dateTime(selected.reviewedAt) : 'the recorded review date'}. The register is locked.</div>
            {:else}
              <div class="message warning">This meeting has been cancelled.</div>
            {/if}
            {#if selected.audit?.length}
              <details class="audit"><summary>Attendance audit history ({selected.audit.length})</summary>{#each selected.audit as event}<div class="audit-row"><strong>{label(event.eventType)}</strong><small>{dateTime(event.createdAt)}</small></div>{/each}</details>
            {/if}
          {/if}
        </div>
      </section>
    </div>
  </CoordinatorLayout>
{:else}
  <main class="state"><p>{error || 'Coordinator workspace unavailable.'}</p><a href="/login">Return to login</a></main>
{/if}

<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#f5f7f5;color:#19251e;font-family:Inter,Arial,sans-serif}button,input,select,textarea{font:inherit}.page{width:100%;min-width:0}.intro{margin-bottom:20px}.eyebrow{color:#0a8050;font-size:9px;font-weight:800;letter-spacing:1.3px}.intro h2{margin:8px 0;font-size:25px}.intro p{max-width:850px;margin:0;color:#718078;font-size:12px;line-height:1.7}.panel{min-width:0;padding:20px;border:1px solid #e5ebe6;border-radius:11px;background:#fff}.panel-title{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:15px}.panel-title h3{margin:6px 0;font-size:16px;color:#1c3c29}.panel-title p{margin:4px 0;font-size:10px}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}.form-grid label,.review-box label{display:grid;gap:6px;color:#405449;font-size:10px;font-weight:700}.form-grid input,.form-grid select,.form-grid textarea,.review-box textarea{width:100%;min-width:0;padding:10px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#243a2d;font-size:11px}.wide{grid-column:1/-1}.primary,.secondary{min-height:39px;padding:9px 13px;border-radius:7px;font-size:10px;font-weight:800;cursor:pointer}.primary{border:1px solid #0a5c37;background:#0a5c37;color:#fff}.secondary{border:1px solid #d5e1d8;background:#fff;color:#24583a}.primary:disabled,.secondary:disabled{opacity:.6;cursor:wait}.layout{display:grid;grid-template-columns:minmax(270px,.85fr) minmax(0,1.3fr);gap:15px;margin-top:16px}.count{padding:5px 9px;border-radius:15px;background:#e8f5ec;color:#0a6841;font-size:10px;font-weight:800}.meeting-list{display:grid;gap:8px}.meeting{width:100%;display:grid;gap:6px;padding:13px;border:1px solid #e8eee9;border-radius:8px;background:#fff;text-align:left;cursor:pointer}.meeting:hover,.meeting.chosen{border-color:#84bd98;background:#f5faf6}.row{display:flex;justify-content:space-between;gap:10px;align-items:center}.row strong{font-size:11px;color:#24442f}.group,.meeting small,.numbers{color:#718078;font-size:9px}.numbers{color:#0a6841}.status{padding:5px 7px;border-radius:14px;background:#f2f5f3;color:#627267;font-size:8px;font-weight:800;white-space:nowrap}.status.submitted{background:#fff4df;color:#9c6500}.status.approved{background:#e8f5ec;color:#087443}.status.cancelled{background:#fff0ef;color:#a32920}.status.unmarked{background:#fff4df;color:#9c6500}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:15px 0}.summary div{padding:10px;border-radius:7px;background:#f5f8f5}.summary small,.summary strong{display:block}.summary small{color:#819087;font-size:8px}.summary strong{margin-top:5px;color:#16452c;font-size:18px}.roster{display:grid;gap:5px;max-height:370px;overflow:auto}.member,.audit-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px;border-radius:6px;background:#f7f9f7}.member strong,.member small{display:block}.member strong{color:#355442;font-size:9px}.member small,.audit-row small{margin-top:3px;color:#819087;font-size:8px}.review-box{display:grid;gap:10px;margin-top:17px;padding-top:15px;border-top:1px solid #edf1ed}.actions{display:flex;gap:8px;flex-wrap:wrap}.audit{margin-top:16px;padding-top:12px;border-top:1px solid #edf1ed}.audit summary{color:#345540;font-size:10px;font-weight:800;cursor:pointer}.audit-row{margin-top:6px}.empty{padding:35px 12px;text-align:center;color:#819087;font-size:11px;line-height:1.6}.muted{color:#819087;font-size:10px;line-height:1.6}.message{padding:10px 12px;margin:10px 0;border-radius:7px;font-size:10px;line-height:1.5}.message.error{background:#fff3f2;color:#a32920;border:1px solid #efceca}.message.success{background:#eef8f0;color:#16633b;border:1px solid #cce6d3}.message.warning{background:#fff8e9;color:#8a5b00;border:1px solid #f1dfb5}.state{min-height:100vh;display:grid;place-content:center;justify-items:center;color:#53665a;font:12px Inter,Arial,sans-serif}.loader{width:28px;height:28px;border:3px solid #dce8df;border-top-color:#0a8050;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:900px){.layout{grid-template-columns:1fr}}@media(max-width:560px){.panel{padding:15px}.form-grid{grid-template-columns:1fr}.wide{grid-column:auto}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}.actions>*{width:100%}}
</style>
