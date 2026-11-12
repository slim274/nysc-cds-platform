<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { listNotifications, markAllNotificationsRead, markNotificationRead, type UserNotification } from '#lib/api/notifications.ts';

  let items = $state<UserNotification[]>([]);
  let unreadCount = $state(0);
  let loading = $state(true);
  let updating = $state(false);
  let errorMessage = $state('');

  onMount(() => { void load(); });

  async function load() {
    loading = true;
    errorMessage = '';
    try {
      const result = await listNotifications(50);
      items = result.items;
      unreadCount = result.unreadCount;
    } catch (error) {
      if ((error as Error & { status?: number })?.status === 401) {
        await goto('/login');
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Unable to load notifications.';
    } finally {
      loading = false;
    }
  }

  async function openItem(item: UserNotification) {
    if (!item.readAt) {
      try {
        await markNotificationRead(item.id);
        items = items.map((row) => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row);
        unreadCount = Math.max(0, unreadCount - 1);
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : 'Unable to update this notification.';
        return;
      }
    }
    await goto(item.href);
  }

  async function markAllRead() {
    if (!unreadCount || updating) return;
    updating = true;
    try {
      await markAllNotificationsRead();
      const readAt = new Date().toISOString();
      items = items.map((row) => ({ ...row, readAt: row.readAt ?? readAt }));
      unreadCount = 0;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to update notifications.';
    } finally {
      updating = false;
    }
  }

  function formatTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
</script>

<svelte:head>
  <title>Notifications | NYSC CDS Platform</title>
  <meta name="description" content="View announcements, meetings and CDS activity notifications." />
</svelte:head>

<main class="page">
  <header class="page-header">
    <div><span class="eyebrow">UPDATES CENTRE</span><h1>Notifications</h1><p>Announcements, meetings and attendance updates for your CDS responsibilities.</p></div>
    <div class="header-actions"><span class="unread-count">{unreadCount} unread</span><button type="button" onclick={markAllRead} disabled={unreadCount === 0 || updating}>{updating ? 'Updating…' : 'Mark all as read'}</button></div>
  </header>

  {#if errorMessage}<div class="error" role="alert">{errorMessage}</div>{/if}
  {#if loading}
    <section class="state">Loading notifications…</section>
  {:else if items.length === 0}
    <section class="state empty"><span class="empty-icon">♧</span><h2>You're all caught up</h2><p>New announcements and CDS updates will appear here.</p></section>
  {:else}
    <section class="notification-list" aria-label="All recent notifications">
      {#each items as item (item.id)}
        <button type="button" class:unread={!item.readAt} class="notification" onclick={() => void openItem(item)}>
          <span class="dot"></span><span class="copy"><strong>{item.title}</strong><span>{item.message}</span><time datetime={item.createdAt}>{formatTime(item.createdAt)}</time></span><span class="arrow">→</span>
        </button>
      {/each}
    </section>
    <p class="note">Showing your 50 most recent notifications.</p>
  {/if}
</main>

<style>
  :global(body) { background: #f5f7f5; color: #19251e; font-family: Inter, Arial, sans-serif; }
  .page { width: min(100%, 1000px); margin: 0 auto; padding: 32px 22px 50px; }
  .page-header { display:flex;justify-content:space-between;align-items:flex-end;gap:18px;margin-bottom:22px; }
  .eyebrow { color:#0a8050;font-size:9px;font-weight:800;letter-spacing:1.4px; }
  h1 { margin:8px 0 6px;color:#183c28;font-size:28px; }
  .page-header p { margin:0;color:#718078;font-size:12px; }
  .header-actions { display:flex;align-items:center;gap:10px; }
  .unread-count { color:#0b6840;font-size:11px;font-weight:700;white-space:nowrap; }
  button { font:inherit; }
  .header-actions button { padding:9px 12px;border:1px solid #d7e4da;border-radius:8px;background:#fff;color:#0b6840;font-size:10px;font-weight:700;cursor:pointer;white-space:nowrap; }
  .header-actions button:disabled { cursor:default;opacity:.45; }
  .notification-list { overflow:hidden;border:1px solid #e1e9e2;border-radius:12px;background:#fff; }
  .notification { width:100%;display:flex;align-items:flex-start;gap:12px;padding:17px 18px;border:0;border-bottom:1px solid #eef2ee;background:#fff;text-align:left;cursor:pointer; }
  .notification:last-child { border-bottom:0; }.notification:hover { background:#f8fbf8; }.notification.unread { background:#f1f8f3; }
  .dot { width:8px;height:8px;flex:0 0 8px;margin-top:5px;border-radius:50%;background:transparent; }
  .notification.unread .dot { background:#16804c;box-shadow:0 0 0 3px #16804c16; }
  .copy { min-width:0;display:block;flex:1; }.copy strong,.copy span,.copy time { display:block; }
  .copy strong { color:#20392b;font-size:12px; }.copy span { margin-top:5px;color:#66776c;font-size:11px;line-height:1.55;overflow-wrap:anywhere; }
  .copy time { margin-top:8px;color:#98a29b;font-size:9px; }.arrow { color:#0a6841;font-size:16px; }
  .state { padding:46px 20px;border:1px solid #e1e9e2;border-radius:12px;background:#fff;color:#829087;text-align:center;font-size:12px; }
  .empty { display:grid;justify-items:center;gap:8px; }.empty-icon { display:grid;place-items:center;width:42px;height:42px;border-radius:50%;background:#eef6f0;color:#0a6841;font-size:19px; }
  .empty h2 { margin:4px 0 0;color:#294534;font-size:16px; }.empty p { margin:0; }
  .error { margin-bottom:14px;padding:11px 13px;border-radius:8px;background:#fff3f2;color:#a32920;font-size:11px; }.note { margin:12px 2px;color:#89968e;font-size:9px; }
  @media(max-width:620px) { .page{padding:25px 13px 36px}.page-header{align-items:flex-start;flex-direction:column}.header-actions{width:100%;justify-content:space-between} }
</style>
