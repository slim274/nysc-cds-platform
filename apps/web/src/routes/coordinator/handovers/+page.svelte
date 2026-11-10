<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    ApiError,
    getCurrentUser,
    listMyCoordinatorHandovers,
    acceptMyCoordinatorHandover,
    logout
  } from '#lib/api/client.ts';
  import type {
    AuthUser,
    CoordinatorHandover
  } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let handovers = $state<CoordinatorHandover[]>([]);
  let loading = $state(true);
  let savingId = $state('');
  let acceptanceNotes = $state<Record<string, string>>({});
  let errorMessage = $state('');
  let noticeMessage = $state('');

  const pendingHandovers = $derived(
    handovers.filter((handover) => handover.status === 'pending_acceptance')
  );

  onMount(() => {
    void loadPage();
  });

  async function loadPage() {
    loading = true;
    errorMessage = '';
    try {
      const session = await getCurrentUser();
      if (!session.roles.some((role) => role.code === 'CDS_COORDINATOR')) {
        await goto('/login');
        return;
      }
      currentUser = session.user;
      handovers = await listMyCoordinatorHandovers();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load handover records.';
    } finally {
      loading = false;
    }
  }

  async function acceptHandover(handover: CoordinatorHandover) {
    if (!confirm(`Acknowledge the handover for ${handover.groupCode} — ${handover.groupName}?`)) return;
    savingId = handover.id;
    errorMessage = '';
    noticeMessage = '';
    try {
      await acceptMyCoordinatorHandover(
        handover.id,
        acceptanceNotes[handover.id] ?? ''
      );
      noticeMessage = `You have acknowledged responsibility for ${handover.groupCode} — ${handover.groupName}.`;
      await loadPage();
    } catch (error) {
      errorMessage = error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unable to accept this handover.';
    } finally {
      savingId = '';
    }
  }

  async function signOut() {
    try {
      await logout();
    } finally {
      await goto('/login');
    }
  }

  function label(value: string) {
    return value.replaceAll('_', ' ').replace(/\\b\\w/g, (letter) => letter.toUpperCase());
  }
</script>

<svelte:head>
  <title>CDS Handover Inbox | NYSC CDS Platform</title>
  <meta name="description" content="Review and acknowledge handovers for your assigned CDS groups." />
</svelte:head>

{#if loading}
  <main class="state-screen"><div class="loader"></div><p>Loading your CDS handovers...</p></main>
{:else if !currentUser}
  <main class="state-screen"><h2>Coordinator workspace unavailable</h2><p>{errorMessage}</p><a href="/login">Return to sign in</a></main>
{:else}
  <div class="workspace">
    <header class="topbar">
      <div class="brand"><span class="brand-icon">N</span><div><strong>NYSC CDS</strong><small>Coordinator workspace</small></div></div>
      <div class="account"><div><strong>{currentUser.email}</strong><small>CDS Coordinator</small></div><button class="secondary-button" type="button" onclick={signOut}>Sign out</button></div>
    </header>

    <main class="content">
      <div class="eyebrow">CDS GROUP OPERATIONS</div>
      <h1>Handover inbox</h1>
      <p class="intro">Review the information provided by the outgoing Coordinator or LGI, understand outstanding responsibilities, and acknowledge the transfer.</p>

      {#if errorMessage}<div class="message error" role="alert">{errorMessage}</div>{/if}
      {#if noticeMessage}<div class="message success" role="status">{noticeMessage}</div>{/if}

      <section class="summary">
        <div><small>Handover records</small><strong>{handovers.length}</strong></div>
        <div><small>Awaiting your acknowledgement</small><strong>{pendingHandovers.length}</strong></div>
      </section>

      {#if handovers.length === 0}
        <section class="empty"><div class="empty-icon">↔</div><h2>No handovers yet</h2><p>When an LGI transfers a CDS group to you, the handover details will appear here.</p></section>
      {:else}
        <section class="handover-list">
          {#each handovers as handover (handover.id)}
            <article class="handover-card">
              <div class="card-heading">
                <div><span class="eyebrow">CDS GROUP</span><h2>{handover.groupCode} · {handover.groupName}</h2><small>From {handover.outgoingCoordinatorEmail ?? 'Previous Coordinator'} · {new Date(handover.createdAt).toLocaleString()}</small></div>
                <span class:accepted={handover.status === 'accepted'} class="status">{label(handover.status)}</span>
              </div>

              <section class="detail-block"><h3>Handover notes</h3><p class="notes">{handover.handoverNotes}</p></section>

              <div class="detail-grid">
                <section class="detail-block"><h3>Pending activities</h3>
                  {#if handover.pendingActivities.length}<ul>{#each handover.pendingActivities as item}<li>{item}</li>{/each}</ul>{:else}<p class="muted">No pending activities listed.</p>{/if}
                </section>
                <section class="detail-block"><h3>Upcoming events</h3>
                  {#if handover.upcomingEvents.length}<ul>{#each handover.upcomingEvents as item}<li>{item}</li>{/each}</ul>{:else}<p class="muted">No upcoming events listed.</p>{/if}
                </section>
                <section class="detail-block"><h3>Outstanding tasks</h3>
                  {#if handover.outstandingTasks.length}<ul>{#each handover.outstandingTasks as item}<li>{item}</li>{/each}</ul>{:else}<p class="muted">No outstanding tasks listed.</p>{/if}
                </section>
              </div>

              {#if handover.status === 'pending_acceptance'}
                <div class="acceptance">
                  <label for="acceptance-{handover.id}">Acknowledgement notes (optional)</label>
                  <textarea id="acceptance-{handover.id}" rows="3" bind:value={acceptanceNotes[handover.id]} placeholder="Add any clarification or note you want recorded with your acknowledgement."></textarea>
                  <button class="primary-button" type="button" onclick={() => void acceptHandover(handover)} disabled={savingId === handover.id}>{savingId === handover.id ? 'Submitting...' : 'Review complete — accept handover'}</button>
                </div>
              {:else if handover.status === 'accepted'}
                <div class="accepted-note">You acknowledged this handover on {handover.acceptedAt ? new Date(handover.acceptedAt).toLocaleString() : 'a recorded date'}.</div>
                {#if handover.acceptanceNotes}<p class="muted">Your note: {handover.acceptanceNotes}</p>{/if}
              {/if}
            </article>
          {/each}
        </section>
      {/if}
    </main>
    <footer>NYSC CDS Management Platform · Coordinator Workspace</footer>
  </div>
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #f5f7f5; color: #19251e; font-family: Inter, Arial, sans-serif; }
  button, textarea { font: inherit; }
  .workspace { min-height: 100vh; display: flex; flex-direction: column; }
  .topbar { min-height: 82px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 14px clamp(18px, 5vw, 64px); border-bottom: 1px solid #e5ebe6; background: #fff; }
  .brand, .account { display: flex; align-items: center; gap: 12px; }
  .brand-icon { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 9px; background: #0a5c37; color: #fff; font-weight: 800; font-size: 21px; }
  .brand strong, .brand small, .account strong, .account small { display: block; }
  .brand strong { color: #0a5c37; font-size: 14px; }
  .brand small, .account small { margin-top: 4px; color: #819087; font-size: 10px; }
  .account { gap: 16px; }
  .account strong { font-size: 11px; }
  .content { width: min(100%, 1040px); margin: 0 auto; padding: 42px 22px; flex: 1; }
  .eyebrow { color: #0a8050; font-size: 9px; font-weight: 700; letter-spacing: 1.4px; }
  h1 { margin: 9px 0; font-size: clamp(25px, 4vw, 34px); }
  .intro { max-width: 760px; margin: 0 0 25px; color: #718078; font-size: 13px; line-height: 1.7; }
  .summary { display: flex; gap: 12px; margin: 22px 0; }
  .summary > div { min-width: 170px; padding: 15px 18px; border: 1px solid #e5ebe6; border-radius: 10px; background: #fff; }
  .summary small, .summary strong { display: block; }
  .summary small { color: #819087; font-size: 10px; }
  .summary strong { margin-top: 6px; color: #123d27; font-size: 23px; }
  .handover-list { display: grid; gap: 16px; }
  .handover-card, .empty { padding: clamp(18px, 3vw, 25px); border: 1px solid #e5ebe6; border-radius: 12px; background: #fff; }
  .card-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; padding-bottom: 18px; border-bottom: 1px solid #edf1ed; }
  .card-heading h2 { margin: 7px 0 5px; font-size: 18px; }
  .card-heading small { color: #819087; font-size: 10px; }
  .status { padding: 6px 9px; border-radius: 20px; background: #fff4df; color: #9c6500; font-size: 9px; font-weight: 700; white-space: nowrap; }
  .status.accepted { background: #e7f4eb; color: #087443; }
  .detail-block { margin-top: 18px; }
  .detail-block h3 { margin: 0 0 8px; color: #254631; font-size: 12px; }
  .detail-block p, .detail-block li { color: #607267; font-size: 11px; line-height: 1.7; }
  .detail-block ul { margin: 0; padding-left: 18px; }
  .notes { padding: 12px; border-radius: 8px; background: #f3f7f4; white-space: pre-wrap; }
  .detail-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 15px; }
  .muted { color: #89948c !important; }
  .acceptance { display: grid; gap: 10px; margin-top: 22px; padding-top: 18px; border-top: 1px solid #edf1ed; }
  .acceptance label { color: #344b3d; font-size: 11px; font-weight: 700; }
  textarea { width: 100%; padding: 11px; border: 1px solid #dce5de; border-radius: 8px; resize: vertical; font-size: 12px; }
  textarea:focus { outline: 3px solid #0a80501a; border-color: #0a8050; }
  .primary-button, .secondary-button { min-height: 40px; padding: 9px 14px; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; }
  .primary-button { justify-self: start; border: 1px solid #0a5c37; background: #0a5c37; color: #fff; }
  .primary-button:disabled { opacity: .6; cursor: wait; }
  .secondary-button { border: 1px solid #d7e2da; background: #fff; color: #27553b; }
  .accepted-note { margin-top: 20px; padding: 11px 13px; border-radius: 8px; background: #eef8f0; color: #16633b; font-size: 11px; }
  .empty { margin-top: 20px; padding: 48px 20px; text-align: center; }
  .empty-icon { font-size: 30px; color: #0a8050; }
  .empty h2 { margin: 12px 0 7px; font-size: 17px; }
  .empty p { color: #819087; font-size: 11px; }
  .message { margin: 15px 0; padding: 11px 13px; border-radius: 8px; font-size: 11px; }
  .message.error { border: 1px solid #efceca; background: #fff3f2; color: #a32920; }
  .message.success { border: 1px solid #cce6d3; background: #eef8f0; color: #16633b; }
  footer { padding: 20px; border-top: 1px solid #e5ebe6; color: #89948c; font-size: 10px; text-align: center; }
  .state-screen { min-height: 100vh; display: grid; place-content: center; justify-items: center; gap: 10px; color: #53665a; font: 13px Inter, Arial, sans-serif; }
  .loader { width: 28px; height: 28px; border: 3px solid #dce8df; border-top-color: #0a8050; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 700px) { .detail-grid { grid-template-columns: 1fr; gap: 0; } .account { align-items: flex-end; gap: 9px; } .account > div { max-width: 180px; overflow-wrap: anywhere; } .summary { flex-wrap: wrap; } }
</style>
