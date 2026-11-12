<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    ApiError, getCurrentUser, listAnnouncements, listAnnouncementGroups,
    createAnnouncement, reviewAnnouncement, resubmitAnnouncement, markAnnouncementRead,
    markAllAnnouncementsRead, logout
  } from '#lib/api/client.ts';
  import type { AuthUser, AnnouncementRecord, AnnouncementTargetGroup, AnnouncementRole } from '#lib/api/client.ts';

  type Props = { role: AnnouncementRole };
  let { role }: Props = $props();
  let user = $state<AuthUser | null>(null);
  let groups = $state<AnnouncementTargetGroup[]>([]);
  let announcements = $state<AnnouncementRecord[]>([]);
  let selectedGroupIds = $state<string[]>([]);
  let title = $state('');
  let body = $state('');
  let priority = $state<'normal' | 'important' | 'urgent'>('normal');
  let expiresAt = $state('');
  let saving = $state(false);
  let markingAllRead = $state(false);
  let loading = $state(true);
  let error = $state('');
  let notice = $state('');
  let reviewNotes = $state<Record<string, string>>({});
  let editingReturnedId = $state('');
  let correctionTitle = $state('');
  let correctionBody = $state('');
  let correctionPriority = $state<'normal' | 'important' | 'urgent'>('normal');
  let mobileMenuOpen = $state(false);

  const publishRole = $derived(role === 'CORPS_MEMBER' ? null : role);
  const isPublisher = $derived(publishRole !== null);
  const isCoordinator = $derived(role === 'CDS_COORDINATOR');
  const isPresident = $derived(role === 'CDS_PRESIDENT');
  const unreadCount = $derived(announcements.filter((item) => item.status === 'published' && !item.isRead).length);
  const allGroupsSelected = $derived(groups.length > 0 && selectedGroupIds.length === groups.length);
  const roleLabel = $derived(role === 'LGI_ADMIN' ? 'LGI Administration' : role === 'CDS_COORDINATOR' ? 'Coordinator workspace' : role === 'CDS_PRESIDENT' ? 'President workspace' : 'Corps Member portal');
  const pageTitle = $derived(role === 'CORPS_MEMBER' ? 'CDS Announcements' : 'Announcements Management');

  onMount(() => {
    void load();
    const syncReadState = () => {
      void loadAnnouncementsOnly().catch((e) => {
        error = e instanceof Error ? e.message : 'Unable to refresh announcement read status.';
      });
    };
    window.addEventListener('nysc:notifications-changed', syncReadState);
    window.addEventListener('nysc:announcements-changed', syncReadState);
    return () => {
      window.removeEventListener('nysc:notifications-changed', syncReadState);
      window.removeEventListener('nysc:announcements-changed', syncReadState);
    };
  });

  async function load() {
    loading = true;
    error = '';
    try {
      const session = await getCurrentUser();
      if (!session.roles.some((item) => item.code === role)) {
        await goto('/login');
        return;
      }
      user = session.user;
      const results = await Promise.all([
        listAnnouncements(role),
        publishRole ? listAnnouncementGroups(publishRole) : Promise.resolve([])
      ]);
      announcements = results[0];
      groups = results[1];
      if (groups.length > 0 && selectedGroupIds.length === 0) selectedGroupIds = [groups[0].id];
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await goto('/login');
        return;
      }
      error = e instanceof Error ? e.message : 'Unable to load announcements.';
    } finally {
      loading = false;
    }
  }

  function toggleGroup(groupId: string) {
    if (isPresident) {
      selectedGroupIds = [groupId];
      return;
    }
    selectedGroupIds = selectedGroupIds.includes(groupId)
      ? selectedGroupIds.filter((id) => id !== groupId)
      : [...selectedGroupIds, groupId];
  }

  function selectAllGroups() {
    selectedGroupIds = groups.map((group) => group.id);
  }

  function clearSelectedGroups() {
    selectedGroupIds = [];
  }

  async function publish(event: SubmitEvent) {
    event.preventDefault();
    if (!publishRole) return;
    if (!title.trim() || title.trim().length < 3) { error = 'Enter an announcement title of at least 3 characters.'; return; }
    if (!body.trim() || body.trim().length < 5) { error = 'Enter an announcement message of at least 5 characters.'; return; }
    if (!selectedGroupIds.length) { error = 'Select at least one CDS group.'; return; }
    saving = true; error = ''; notice = '';
    try {
      const result = await createAnnouncement(publishRole, {
        title: title.trim(), body: body.trim(), priority, groupIds: selectedGroupIds,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined
      });
      notice = result.status === 'pending_review'
        ? 'Your announcement has been submitted to the Coordinator for approval.'
        : 'Announcement published successfully.';
      title = ''; body = ''; priority = 'normal'; expiresAt = '';
      await loadAnnouncementsOnly();
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to publish this announcement.'; }
    finally { saving = false; }
  }

  async function loadAnnouncementsOnly() { announcements = await listAnnouncements(role); }

  async function markRead(item: AnnouncementRecord) {
    if (item.isRead || item.status !== 'published') return;
    try {
      await markAnnouncementRead(role, item.id);
      announcements = announcements.map((row) => row.id === item.id ? { ...row, isRead: true } : row);
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to update the read status.'; }
  }

  async function markAllRead() {
    if (unreadCount === 0 || markingAllRead) return;
    markingAllRead = true;
    error = '';
    notice = '';
    try {
      const result = await markAllAnnouncementsRead(role);
      announcements = announcements.map((row) =>
        row.status === 'published' ? { ...row, isRead: true } : row
      );
      notice = `Marked ${result.readCount} announcement${result.readCount === 1 ? '' : 's'} as read.`;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unable to mark announcements as read.';
    } finally {
      markingAllRead = false;
    }
  }

  function beginCorrection(item: AnnouncementRecord) {
    editingReturnedId = item.id;
    correctionTitle = item.title;
    correctionBody = item.body;
    correctionPriority = item.priority;
    error = '';
    notice = '';
  }

  async function resubmit(item: AnnouncementRecord, event: SubmitEvent) {
    event.preventDefault();
    if (correctionTitle.trim().length < 3 || correctionBody.trim().length < 5) {
      error = 'Enter a title of at least 3 characters and a message of at least 5 characters.';
      return;
    }
    saving = true;
    error = '';
    notice = '';
    try {
      await resubmitAnnouncement(item.id, {
        title: correctionTitle.trim(),
        body: correctionBody.trim(),
        priority: correctionPriority
      });
      editingReturnedId = '';
      notice = 'Your corrected announcement has been resubmitted to the Coordinator.';
      await loadAnnouncementsOnly();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unable to resubmit this announcement.';
    } finally {
      saving = false;
    }
  }

  async function review(item: AnnouncementRecord, decision: 'approved' | 'returned') {
    const notes = (reviewNotes[item.id] ?? '').trim();
    if (decision === 'returned' && !notes) { error = 'Add a reason before returning the announcement.'; return; }
    const promptText = decision === 'approved'
      ? 'Approve and publish this announcement to the selected CDS group?'
      : 'Return this announcement to the President with your correction note?';
    if (!confirm(promptText)) return;
    saving = true; error = ''; notice = '';
    try {
      await reviewAnnouncement(item.id, decision, notes || undefined);
      notice = decision === 'approved' ? 'Announcement approved and published.' : 'Announcement returned to the President for changes.';
      await loadAnnouncementsOnly();
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to review this announcement.'; }
    finally { saving = false; }
  }

  function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  function groupLabel(item: AnnouncementRecord) {
    return item.targetGroups.map((group) => group.code + ' · ' + group.name).join(', ');
  }
  async function signOut() { try { await logout(); } finally { await goto('/login'); } }
</script>

<svelte:head>
  <title>{pageTitle} | NYSC CDS Platform</title>
  <meta name="description" content="Publish, review and read CDS group announcements." />
</svelte:head>

{#if loading}
  <main class="state"><div class="loader"></div><p>Loading announcements…</p></main>
{:else if user}
  <div class="workspace">
    {#if role === 'CORPS_MEMBER'}
      <header class="simple-header">
        <a href="/corps-member" class="brand"><span class="brand-icon">N</span><span><strong>NYSC CDS</strong><small>{roleLabel}</small></span></a>
        <nav><a href="/corps-member">Dashboard</a><a class="active" href="/corps-member/announcements">Announcements</a><span>{user.email}</span><button type="button" onclick={signOut}>Sign out</button></nav>
      </header>
    {:else if role === 'CDS_PRESIDENT'}
      <header class="simple-header">
        <a href="/cds-president" class="brand"><span class="brand-icon">N</span><span><strong>NYSC CDS</strong><small>{roleLabel}</small></span></a>
        <button class="mobile-menu" type="button" aria-label="Toggle navigation" onclick={() => (mobileMenuOpen = !mobileMenuOpen)}>☰</button>
        <nav class:open={mobileMenuOpen}><a href="/cds-president">Dashboard</a><a href="/cds-president/attendance">Attendance</a><a class="active" href="/cds-president/announcements">Announcements</a><span>{user.email}</span><button type="button" onclick={signOut}>Sign out</button></nav>
      </header>
    {:else}
      <header class="simple-header"><a class="brand" href={role === 'LGI_ADMIN' ? '/lgi' : '/coordinator'}><span class="brand-icon">N</span><span><strong>NYSC CDS</strong><small>{roleLabel}</small></span></a><span class="account">{user.email}</span><button type="button" onclick={signOut}>Sign out</button></header>
    {/if}

    <main class="content">
      <section class="page-heading">
        <div><span class="eyebrow">CDS GROUP OPERATIONS</span><h1>{pageTitle}</h1><p>{role === 'LGI_ADMIN' ? 'Publish official notices to selected CDS groups in your assigned LGA(s).' : role === 'CDS_COORDINATOR' ? 'Publish group updates and review announcements submitted by your CDS Presidents.' : role === 'CDS_PRESIDENT' ? 'Submit important group updates to your Coordinator for approval and read published notices.' : 'Read important updates published by your LGI and CDS Coordinator.'}</p></div>
        <div class="heading-actions">
          <div class="unread-badge"><strong>{unreadCount}</strong><span>unread</span></div>
          {#if unreadCount > 0}
            <button class="mark-announcements-read" type="button" onclick={markAllRead} disabled={markingAllRead}>
              {markingAllRead ? 'Marking…' : 'Mark all announcements read'}
            </button>
          {/if}
        </div>
      </section>
      {#if error}<div class="message error" role="alert">{error}</div>{/if}
      {#if notice}<div class="message success" role="status">{notice}</div>{/if}

      {#if isPublisher}
        <section class="panel composer">
          <div class="panel-heading"><div><span class="eyebrow">{isPresident ? 'SUBMIT FOR APPROVAL' : 'NEW ANNOUNCEMENT'}</span><h2>{isPresident ? 'Submit a group announcement' : 'Create announcement'}</h2><p>{isPresident ? 'Your Coordinator must approve this announcement before members can see it.' : 'This announcement will be published immediately to the groups you select.'}</p></div></div>
          <form onsubmit={publish}>
            <label>Announcement title<input bind:value={title} maxlength="180" placeholder="e.g. Upcoming CDS sanitation exercise" required /></label>
            <label>Message<textarea bind:value={body} rows="5" maxlength="10000" placeholder="Write the announcement details…" required></textarea></label>
            <div class="form-grid">
              <label>Priority<select bind:value={priority}><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></select></label>
              <label>Expiry date and time (optional)<input type="datetime-local" bind:value={expiresAt} /></label>
            </div>
            <fieldset>
              <legend>Target CDS groups</legend>
              <p class="field-help">{role === 'LGI_ADMIN' ? 'Only active CDS groups in your assigned LGA(s) are available.' : role === 'CDS_COORDINATOR' ? 'Only the active CDS groups assigned to your Coordinator account are available.' : 'You can only submit announcements for your active President group.'}</p>
              {#if role === 'LGI_ADMIN' && groups.length > 0}
                <div class="group-selection-actions">
                  <span>{selectedGroupIds.length} of {groups.length} groups selected</span>
                  <div>
                    <button type="button" onclick={selectAllGroups} disabled={allGroupsSelected}>Select all groups</button>
                    <button type="button" onclick={clearSelectedGroups} disabled={selectedGroupIds.length === 0}>Clear selection</button>
                  </div>
                </div>
              {/if}
              {#if groups.length === 0}
                <div class="empty compact">No eligible CDS groups are available for your account.</div>
              {:else}
                <div class="group-options">
                  {#each groups as group}
                    <label class:chosen={selectedGroupIds.includes(group.id)} class="group-option">
                      <input type={isPresident ? 'radio' : 'checkbox'} name="announcement-groups" checked={selectedGroupIds.includes(group.id)} onchange={() => toggleGroup(group.id)} />
                      <span><strong>{group.code} · {group.name}</strong><small>{group.lgaName}, {group.stateName}</small></span>
                    </label>
                  {/each}
                </div>
              {/if}
            </fieldset>
            <button class="primary" type="submit" disabled={saving || groups.length === 0}>{saving ? 'Submitting…' : isPresident ? 'Submit to Coordinator for approval' : 'Publish announcement'}</button>
          </form>
        </section>
      {/if}

      {#if isCoordinator && announcements.some((item) => item.status === 'pending_review' && item.createdByRole === 'CDS_PRESIDENT')}
        <section class="queue-note"><strong>Presidential review queue</strong><span>President-submitted announcements remain hidden from members until you approve and publish them.</span></section>
      {/if}

      <section class="feed">
        <div class="feed-heading"><div><span class="eyebrow">ANNOUNCEMENT FEED</span><h2>{isCoordinator ? 'Group notices and review queue' : 'Published announcements'}</h2></div><span class="count">{announcements.length} records</span></div>
        {#if announcements.length === 0}
          <div class="empty">No announcements are available for your CDS group(s) yet.</div>
        {:else}
          <div class="announcement-list">
            {#each announcements as item (item.id)}
              <article class="announcement-card" class:unread={!item.isRead && item.status === 'published'}>
                <div class="card-top">
                  <div class="badges"><span class="priority" class:important={item.priority === 'important'} class:urgent={item.priority === 'urgent'}>{label(item.priority)}</span><span class="status" class:pending={item.status === 'pending_review'} class:returned={item.status === 'returned'}>{label(item.status)}</span>{#if item.status === 'published' && !item.isRead}<span class="new-badge">NEW</span>{/if}</div>
                  <small>{new Date(item.publishedAt ?? item.submittedAt ?? item.createdAt).toLocaleString()}</small>
                </div>
                <h3>{item.title}</h3>
                <p class="announcement-body">{item.body}</p>
                <div class="target-info"><strong>Target:</strong> {groupLabel(item)}</div>
                <div class="card-bottom"><span>Posted by {label(item.createdByRole)}</span>{#if item.expiresAt}<span>Expires {new Date(item.expiresAt).toLocaleString()}</span>{/if}</div>
                {#if item.status === 'returned' && isPresident}
                  <div class="review-note"><strong>Coordinator's correction note:</strong> {item.reviewNotes}</div>
                  {#if editingReturnedId === item.id}
                    <form class="correction-form" onsubmit={(event) => resubmit(item, event)}>
                      <label>Corrected title<input bind:value={correctionTitle} maxlength="180" required /></label>
                      <label>Corrected message<textarea bind:value={correctionBody} rows="4" maxlength="10000" required></textarea></label>
                      <label>Priority<select bind:value={correctionPriority}><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></select></label>
                      <div class="review-actions"><button type="button" class="secondary" onclick={() => (editingReturnedId = '')}>Cancel</button><button type="submit" class="primary small" disabled={saving}>{saving ? 'Resubmitting…' : 'Resubmit for approval'}</button></div>
                    </form>
                  {:else}
                    <button type="button" class="read-button" onclick={() => beginCorrection(item)}>Edit and resubmit</button>
                  {/if}
                {/if}
                {#if isCoordinator && item.status === 'pending_review' && item.createdByRole === 'CDS_PRESIDENT'}
                  <label class="review-field">Review note (required when returning)<textarea rows="2" bind:value={reviewNotes[item.id]} placeholder="Explain what needs to be corrected…"></textarea></label>
                  <div class="review-actions"><button type="button" class="secondary" onclick={() => review(item, 'returned')} disabled={saving}>Return for correction</button><button type="button" class="primary small" onclick={() => review(item, 'approved')} disabled={saving}>Approve and publish</button></div>
                {:else if item.status === 'published'}
                  <button class="read-button" type="button" onclick={() => markRead(item)} disabled={item.isRead}>{item.isRead ? 'Read' : 'Mark as read'}</button>
                {/if}
              </article>
            {/each}
          </div>
        {/if}
      </section>
    </main>
    <footer>NYSC CDS Management Platform · {roleLabel}</footer>
  </div>
{:else}
  <main class="state"><p>{error || 'Announcements workspace unavailable.'}</p><a href="/login">Return to sign in</a></main>
{/if}

<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;background:#f4f7f5;color:#17251c;font-family:Inter,Arial,sans-serif}button,input,select,textarea{font:inherit}.workspace{min-height:100vh;display:flex;flex-direction:column}.simple-header{min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:15px;padding:12px clamp(14px,4vw,45px);border-bottom:1px solid #e5ebe6;background:#fff}.brand{display:flex;align-items:center;gap:10px;text-decoration:none}.brand-icon{width:39px;height:39px;display:grid;place-items:center;border-radius:9px;background:#0a5c37;color:#fff;font-size:20px;font-weight:800}.brand strong,.brand small{display:block}.brand strong{color:#0a5c37;font-size:12px}.brand small{margin-top:3px;color:#819087;font-size:9px}.simple-header nav{display:flex;align-items:center;gap:15px}.simple-header nav a{color:#718078;font-size:10px;text-decoration:none}.simple-header nav a.active{color:#0a6841;font-weight:800}.simple-header nav span,.account{color:#819087;font-size:9px}.simple-header button:not(.mobile-menu){padding:8px 11px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#355442;font-size:9px;font-weight:700;cursor:pointer}.mobile-menu{display:none}.content{width:min(1180px,100%);margin:0 auto;padding:30px 20px;flex:1}.page-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}.eyebrow{color:#0a8050;font-size:9px;font-weight:800;letter-spacing:1.3px}.page-heading h1{margin:8px 0;font-size:27px}.page-heading p{max-width:760px;margin:0;color:#718078;font-size:11px;line-height:1.7}.heading-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap;justify-content:flex-end}.unread-badge{display:grid;justify-items:center;min-width:68px;padding:8px;border-radius:9px;background:#e8f5ec;color:#0a6841}.unread-badge strong{font-size:19px}.unread-badge span{font-size:8px;font-weight:700}.mark-announcements-read,.group-selection-actions button{padding:8px 10px;border:1px solid #cfe0d3;border-radius:7px;background:#fff;color:#0a6841;font-size:9px;font-weight:800;cursor:pointer}.mark-announcements-read:disabled,.group-selection-actions button:disabled{opacity:.45;cursor:default}.panel,.feed{padding:19px;margin-top:15px;border:1px solid #e3ebe5;border-radius:10px;background:#fff}.panel-heading,.feed-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}.panel-heading h2,.feed-heading h2{margin:6px 0;font-size:15px}.panel-heading p{margin:0;color:#819087;font-size:9px;line-height:1.6}.composer form{display:grid;gap:12px}.composer label,.review-field{display:grid;gap:6px;color:#385342;font-size:9px;font-weight:800}.composer input,.composer select,.composer textarea,.review-field textarea{width:100%;min-width:0;padding:10px 11px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#263c2d;font-size:10px;font-weight:400}.composer textarea,.review-field textarea{resize:vertical;line-height:1.6}.composer input:focus,.composer select:focus,.composer textarea:focus,.review-field textarea:focus{outline:2px solid #b8dec5;border-color:#6fb48a}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}fieldset{min-width:0;padding:13px;margin:0;border:1px solid #e6ece7;border-radius:8px}legend{padding:0 5px;color:#355442;font-size:10px;font-weight:800}.field-help{margin:0 0 9px;color:#819087;font-size:9px}.group-selection-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 10px;padding:9px 10px;border:1px solid #e7eee8;border-radius:7px;background:#fbfdfb;color:#718078;font-size:9px}.group-selection-actions>div{display:flex;gap:6px;flex-wrap:wrap}.group-selection-actions button{padding:6px 9px;font-size:8px}.group-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.group-option{display:flex!important;align-items:flex-start;gap:8px;padding:10px;border:1px solid #e6ece7;border-radius:7px;background:#fbfcfb;cursor:pointer}.group-option.chosen{border-color:#84bd98;background:#f1f8f3}.group-option input{width:14px;min-width:14px;margin:1px 0 0;accent-color:#0a8050}.group-option span,.group-option strong,.group-option small{display:block}.group-option strong{color:#355442;font-size:9px}.group-option small{margin-top:4px;color:#819087;font-size:8px;font-weight:400}.primary,.secondary{min-height:38px;padding:9px 13px;border:1px solid #0a5c37;border-radius:7px;background:#0a5c37;color:#fff;font-size:9px;font-weight:800;cursor:pointer}.primary:disabled,.secondary:disabled{opacity:.55;cursor:wait}.primary.small{min-height:33px}.secondary{border-color:#d9e4dc;background:#fff;color:#3d604a}.feed{margin-top:18px}.feed-heading{align-items:center}.feed-heading h2{font-size:16px}.count{padding:6px 9px;border-radius:15px;background:#e8f5ec;color:#0a6841;font-size:9px;font-weight:800;white-space:nowrap}.announcement-list{display:grid;gap:10px}.announcement-card{padding:15px;border:1px solid #e6ece7;border-radius:9px;background:#fff}.announcement-card.unread{border-left:3px solid #0a8050;background:#fbfefb}.card-top,.card-bottom{display:flex;align-items:center;justify-content:space-between;gap:10px}.card-top small,.card-bottom{color:#819087;font-size:8px}.badges{display:flex;flex-wrap:wrap;gap:5px}.priority,.status,.new-badge{padding:4px 7px;border-radius:12px;background:#edf5ef;color:#42634b;font-size:8px;font-weight:800;text-transform:uppercase}.priority.important{background:#fff4df;color:#9c6500}.priority.urgent{background:#fff0ef;color:#a32920}.status.pending{background:#fff4df;color:#9c6500}.status.returned{background:#fff0ef;color:#a32920}.new-badge{background:#0a8050;color:white}.announcement-card h3{margin:12px 0 7px;color:#233d2d;font-size:13px}.announcement-body{margin:0;color:#5f7165;font-size:10px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere}.target-info{padding:8px 9px;margin-top:11px;border-radius:6px;background:#f5f8f5;color:#718078;font-size:8px;line-height:1.6}.target-info strong{color:#47604f}.card-bottom{justify-content:flex-start;flex-wrap:wrap;margin-top:10px}.read-button{padding:7px 10px;margin-top:11px;border:1px solid #d9e4dc;border-radius:6px;background:#fff;color:#0a6841;font-size:8px;font-weight:800;cursor:pointer}.read-button:disabled{background:#edf6ef;color:#6e8876;cursor:default}.review-field{margin-top:12px}.review-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:9px}.review-note{padding:10px;margin-top:10px;border-radius:7px;background:#fff8e9;color:#8a5b00;font-size:9px;line-height:1.6}.correction-form{display:grid;gap:9px;padding:12px;margin-top:10px;border:1px solid #e6ece7;border-radius:8px;background:#f8fbf8}.correction-form label{display:grid;gap:5px;color:#385342;font-size:9px;font-weight:800}.correction-form input,.correction-form textarea,.correction-form select{width:100%;padding:9px;border:1px solid #dce5de;border-radius:6px;background:#fff;color:#263c2d;font:10px Inter,Arial,sans-serif}.queue-note{display:grid;gap:4px;padding:12px 14px;margin:12px 0;border-radius:8px;background:#fff8e9;color:#815600}.queue-note strong{font-size:10px}.queue-note span{font-size:9px;line-height:1.5}.empty{padding:30px 13px;text-align:center;color:#819087;font-size:10px;line-height:1.65}.empty.compact{padding:14px}.message{padding:10px 12px;margin:10px 0;border-radius:7px;font-size:10px;line-height:1.5}.message.error{background:#fff3f2;color:#a32920;border:1px solid #efceca}.message.success{background:#eef8f0;color:#16633b;border:1px solid #cce6d3}.state{min-height:100vh;display:grid;place-content:center;justify-items:center;color:#53665a;font:12px Inter,Arial,sans-serif}.loader{width:28px;height:28px;border:3px solid #dce8df;border-top-color:#0a8050;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}footer{padding:15px;text-align:center;color:#819087;font-size:9px}@media(max-width:760px){.simple-header{flex-wrap:wrap}.simple-header nav{display:none;width:100%;align-items:flex-start;flex-direction:column;padding:10px 0}.simple-header nav.open{display:flex}.mobile-menu{display:block;margin-left:auto;padding:8px 10px;border:1px solid #dce5de;border-radius:7px;background:#fff;color:#355442}.content{padding:22px 13px}.form-grid,.group-options{grid-template-columns:1fr}.page-heading{align-items:center}.page-heading h1{font-size:22px}.heading-actions{justify-content:flex-start}}@media(max-width:420px){.page-heading{flex-direction:column}.unread-badge{display:flex;align-items:center;gap:6px}.unread-badge strong{font-size:15px}}
</style>
