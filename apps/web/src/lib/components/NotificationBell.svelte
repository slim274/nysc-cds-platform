<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    listNotifications,
    markAllNotificationsRead,
    markNotificationRead,
    type UserNotification
  } from '#lib/api/notifications.ts';

  let notifications = $state<UserNotification[]>([]);
  let unreadCount = $state(0);
  let open = $state(false);
  let enabled = $state(false);
  let loading = $state(true);
  let updating = $state(false);
  let errorMessage = $state('');
  let refreshing = false;
  let mutationCount = 0;
  let refreshGeneration = 0;
  let refreshPending = false;
  const REFRESH_INTERVAL_MS = 5000;

  async function refresh() {
    // Don't let a polling response overwrite a newer read/unread action.
    if (refreshing || mutationCount > 0) return;
    refreshing = true;
    const generation = refreshGeneration;

    try {
      const result = await listNotifications(25);
      if (generation !== refreshGeneration || mutationCount > 0) return;

      notifications = result.items;
      unreadCount = result.unreadCount;
      enabled = true;
      errorMessage = '';
    } catch (error) {
      if (generation !== refreshGeneration || mutationCount > 0) return;

      const status = (error as Error & { status?: number })?.status;
      if (status === 401 || status === 403) {
        enabled = false;
      } else {
        enabled = true;
        errorMessage = error instanceof Error ? error.message : 'Unable to load notifications.';
      }
    } finally {
      loading = false;
      refreshing = false;

      // A refresh that started before a mutation is stale. Fetch again after
      // the mutation has completed so the UI reflects the committed database state.
      if (refreshPending && mutationCount === 0) {
        refreshPending = false;
        void refresh();
      }
    }
  }

  function beginNotificationMutation() {
    mutationCount += 1;
    refreshGeneration += 1;
    refreshPending = true;
  }

  function finishNotificationMutation() {
    mutationCount = Math.max(0, mutationCount - 1);
    if (mutationCount === 0 && refreshPending && !refreshing) {
      refreshPending = false;
      void refresh();
    }
  }

  async function openNotification(item: UserNotification) {
    if (!item.readAt) {
      beginNotificationMutation();
      try {
        await markNotificationRead(item.id);
        const readAt = new Date().toISOString();
        notifications = notifications.map((notification) =>
          notification.id === item.id ? { ...notification, readAt } : notification
        );
        unreadCount = Math.max(0, unreadCount - 1);
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : 'Unable to update this notification.';
      } finally {
        finishNotificationMutation();
      }
    }

    open = false;
    if (item.href) await goto(item.href);
  }

  async function markEverythingRead() {
    if (unreadCount === 0 || updating) return;
    updating = true;
    beginNotificationMutation();
    errorMessage = '';
    try {
      await markAllNotificationsRead();
      const readAt = new Date().toISOString();
      notifications = notifications.map((item) => ({ ...item, readAt: item.readAt ?? readAt }));
      unreadCount = 0;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to update notifications.';
    } finally {
      updating = false;
      finishNotificationMutation();
    }
  }

  function formatTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') open = false;
  }

  // Keep the CLO notification control inside its own header so it aligns
  // with the CLO badge. Other workspaces continue using the viewport overlay,
  // which protects the bell from legacy page overflow and stacking contexts.
  function portalToOverlay(node: HTMLElement) {
    const host = document.getElementById('global-overlay-root');

    function moveToGlobalOverlay() {
      if (host) {
        // Avoid moving an already-mounted host: doing so emits another
        // childList mutation and can cause the observer to loop forever.
        if (host.parentElement !== document.documentElement) {
          document.documentElement.appendChild(host);
        }
        host.style.setProperty('position', 'fixed', 'important');
        host.style.setProperty('inset', '0', 'important');
        host.style.setProperty('width', '100vw', 'important');
        host.style.setProperty('height', '100vh', 'important');
        host.style.setProperty('height', '100dvh', 'important');
        host.style.setProperty('overflow', 'visible', 'important');
        host.style.setProperty('pointer-events', 'none', 'important');
        host.style.setProperty('z-index', '2147483647', 'important');
        host.style.setProperty('isolation', 'isolate', 'important');
        if (node.parentElement !== host) host.appendChild(node);
      } else if (node.parentElement !== document.documentElement) {
        // Defensive fallback for deployments that have not yet received app.html.
        document.documentElement.appendChild(node);
      }
    }

    function placeNotificationBell() {
      const isCorpsMemberHome = window.location.pathname === '/corps-member';
      if (isCorpsMemberHome) {
        const isMobileMember = window.matchMedia('(max-width: 980px)').matches;
        const memberHeaderTarget = isMobileMember
          ? document.querySelector<HTMLElement>('.member-portal-tools')
          : document.querySelector<HTMLElement>('.member-portal-nav');
        if (memberHeaderTarget) {
          if (node.parentElement !== memberHeaderTarget) memberHeaderTarget.appendChild(node);
          return;
        }
      }

      const isMobileClo = window.location.pathname.startsWith('/clo') &&
        window.matchMedia('(max-width: 760px)').matches;
      const cloHeader = isMobileClo
        ? document.querySelector<HTMLElement>('.clo-topbar')
        : null;

      if (cloHeader) {
        if (node.parentElement !== cloHeader) cloHeader.appendChild(node);
      } else {
        moveToGlobalOverlay();
      }
    }

    placeNotificationBell();

    // The app layout persists during client-side navigation. Observe route
    // content changes so the bell moves into/out of the CLO header as needed.
    const observer = new MutationObserver(placeNotificationBell);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', placeNotificationBell);

    return {
      destroy() {
        observer.disconnect();
        window.removeEventListener('resize', placeNotificationBell);
        node.remove();
      }
    };
  }

  onMount(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, REFRESH_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const handleNotificationsChanged = () => {
      // A read action may come from the full notifications page rather than
      // this bell. Invalidate any older poll before synchronizing the badge.
      refreshGeneration += 1;
      refreshPending = true;
      if (mutationCount === 0 && !refreshing) {
        refreshPending = false;
        void refresh();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    window.addEventListener('nysc:notifications-changed', handleNotificationsChanged);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      window.removeEventListener('nysc:notifications-changed', handleNotificationsChanged);
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if enabled}
  <div class="notification-bell" class:clo-header={page.url.pathname.startsWith('/clo')} class:member-header={page.url.pathname === '/corps-member'} use:portalToOverlay>
    {#if page.url.pathname.startsWith('/lgi')}
      <div class="lgi-mobile-identity" aria-label="LGI Administrator" title="LGI Administrator">LG</div>
    {/if}
    <button
      class:active={open}
      class="bell-button"
      type="button"
      aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      aria-haspopup="dialog"
      aria-expanded={open}
      onclick={() => {
        open = !open;
        if (open) void refresh();
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </svg>
      {#if unreadCount > 0}
        <span class="unread-badge">{unreadCount > 99 ? '99+' : unreadCount > 9 ? '9+' : unreadCount}</span>
      {/if}
    </button>

    {#if open}
      <section class="notification-panel" role="dialog" aria-label="Notifications">
        <header class="panel-header">
          <div><strong>Notifications</strong><span>{unreadCount} unread</span></div>
          <button type="button" class="mark-all" onclick={markEverythingRead} disabled={unreadCount === 0 || updating}>
            {updating ? 'Updating…' : 'Mark all read'}
          </button>
        </header>

        {#if errorMessage}
          <p class="panel-error" role="alert">{errorMessage}</p>
        {/if}

        {#if loading}
          <div class="panel-state">Loading notifications…</div>
        {:else if notifications.length === 0}
          <div class="panel-state empty-state">
            <span class="empty-bell">♧</span>
            <strong>You're all caught up</strong>
            <span>New announcements and CDS updates will appear here.</span>
          </div>
        {:else}
          <div class="notification-list">
            {#each notifications as item (item.id)}
              <button
                type="button"
                class:unread={!item.readAt}
                class="notification-item"
                onclick={() => void openNotification(item)}
              >
                <span class="item-indicator"></span>
                <span class="item-copy">
                  <strong>{item.title}</strong>
                  <span class="item-message">{item.message}</span>
                  <time datetime={item.createdAt}>{formatTime(item.createdAt)}</time>
                </span>
              </button>
            {/each}
          </div>
        {/if}
        <a class="view-all" href="/notifications" onclick={() => (open = false)}>View all notifications <span>→</span></a>
        <footer class="panel-footer">Updates refresh automatically every 5 seconds while this tab is active.</footer>
      </section>
    {/if}
  </div>
{/if}

<style>
  .notification-bell {
    position: absolute !important;
    top: 12px !important;
    right: 20px !important;
    bottom: auto !important;
    left: auto !important;
    inset: 12px 20px auto auto !important;
    width: fit-content !important;
    height: fit-content !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    overflow: visible !important;
    background: transparent !important;
    color: inherit;
    z-index: 1 !important;
    pointer-events: none !important;
  }
  .notification-bell {
    display: flex !important;
    align-items: center;
    gap: 8px;
  }
  .notification-bell.member-header {
    position: relative !important;
    top: auto !important;
    right: auto !important;
    bottom: auto !important;
    left: auto !important;
    inset: auto !important;
    width: auto !important;
    height: auto !important;
    flex: 0 0 auto;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    overflow: visible !important;
    background: transparent !important;
    transform: none !important;
    z-index: 1510 !important;
    pointer-events: none !important;
  }
  .notification-bell.member-header .bell-button {
    width: 36px;
    height: 36px;
  }
  .notification-bell.member-header .bell-button svg {
    width: 18px;
    height: 18px;
  }
  .notification-bell.member-header .notification-panel {
    top: calc(100% + 9px);
    right: 0;
    width: min(360px, calc(100vw - 24px));
    max-height: min(560px, calc(100dvh - 90px));
  }
  .lgi-mobile-identity {
    display: none;
    width: 36px;
    height: 36px;
    flex: 0 0 36px;
    place-items: center;
    border: 1px solid #dce9df;
    border-radius: 50%;
    background: #e6f1e9;
    color: #0a5c37;
    font-size: 11px;
    font-weight: 800;
    box-shadow: 0 3px 10px #163b2815;
  }
  .bell-button, .notification-panel { pointer-events: auto; }
  .bell-button {
    position: relative; width: 44px; height: 44px; display: grid; place-items: center;
    border: 1px solid #dce7df; border-radius: 50%; background: #fff; color: #0a5c37;
    box-shadow: 0 4px 14px #163b281a; cursor: pointer; transition: background 140ms ease, border-color 140ms ease;
  }
  .bell-button:hover, .bell-button.active { border-color: #a9cdb7; background: #f1f8f3; }
  .bell-button:focus-visible { outline: 3px solid #8dcaa5; outline-offset: 3px; }
  .bell-button svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .unread-badge {
    position: absolute; top: -4px; right: -5px; min-width: 19px; height: 19px; display: grid; place-items: center;
    padding: 0 4px; border: 2px solid #fff; border-radius: 12px; background: #d92f36; color: #fff;
    font-size: 9px; font-weight: 800; line-height: 1;
  }
  .notification-panel {
    position: absolute; top: 54px; right: 0; width: min(390px, calc(100vw - 24px)); max-height: min(560px, calc(100vh - 82px));
    display: flex; flex-direction: column; overflow: hidden; border: 1px solid #e0e9e2; border-radius: 13px;
    background: #fff; box-shadow: 0 18px 54px #142b1e26;
  }
  .panel-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px 17px; border-bottom: 1px solid #edf1ed; }
  .panel-header strong, .panel-header span { display: block; }
  .panel-header strong { color: #1e3427; font-size: 14px; }
  .panel-header span { margin-top: 4px; color: #89968e; font-size: 10px; }
  .mark-all { padding: 7px 9px; border: 1px solid #dce8df; border-radius: 7px; background: #fff; color: #0b6840; font-size: 10px; font-weight: 700; cursor: pointer; white-space: nowrap; }
  .mark-all:disabled { opacity: .45; cursor: default; }
  .notification-list { overflow-y: auto; }
  .notification-item { width: 100%; display: flex; align-items: flex-start; gap: 10px; padding: 13px 16px; border: 0; border-bottom: 1px solid #f0f3f0; background: #fff; text-align: left; cursor: pointer; }
  .notification-item:hover { background: #f8fbf8; }
  .notification-item.unread { background: #f1f8f3; }
  .item-indicator { width: 7px; height: 7px; flex: 0 0 7px; margin-top: 5px; border-radius: 50%; background: transparent; }
  .notification-item.unread .item-indicator { background: #16804c; box-shadow: 0 0 0 3px #16804c16; }
  .item-copy { min-width: 0; display: block; flex: 1; }
  .item-copy strong, .item-message, .item-copy time { display: block; }
  .item-copy strong { color: #20392b; font-size: 11px; line-height: 1.4; }
  .item-message { margin-top: 4px; color: #66776c; font-size: 10px; line-height: 1.5; overflow-wrap: anywhere; }
  .item-copy time { margin-top: 7px; color: #98a29b; font-size: 9px; }
  .panel-state { padding: 28px 18px; color: #829087; font-size: 11px; text-align: center; }
  .empty-state { display: grid; justify-items: center; gap: 7px; }
  .empty-bell { display: grid; place-items: center; width: 38px; height: 38px; margin-bottom: 4px; border-radius: 50%; background: #eef6f0; color: #0a6841; font-size: 18px; }
  .empty-state strong { color: #294534; font-size: 12px; }
  .empty-state span:last-child { max-width: 240px; line-height: 1.55; }
  .panel-error { margin: 0; padding: 8px 16px; border-bottom: 1px solid #f4d6d4; background: #fff7f6; color: #a42e26; font-size: 10px; }
  .view-all { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-top: 1px solid #edf1ed; color: #0a6841; font-size: 10px; font-weight: 700; text-decoration: none; }
  .view-all:hover { background: #f6faf7; }
  .panel-footer { padding: 10px 15px; border-top: 1px solid #edf1ed; background: #fbfcfb; color: #9aa49d; font-size: 9px; text-align: center; }
  @media (max-width: 760px) {
    .lgi-mobile-identity { display: grid; }
    .bell-button {
      width: 36px;
      height: 36px;
    }
    .bell-button svg {
      width: 18px;
      height: 18px;
    }
    .notification-bell.clo-header {
      top: 50% !important;
      right: 10px !important;
      bottom: auto !important;
      left: auto !important;
      inset: 50% 10px auto auto !important;
      transform: translateY(-50%);
    }
  }
  @media (max-width: 480px) {
    .notification-bell:not(.member-header) {
      inset: 10px 12px auto auto !important;
    }
    .bell-button {
      width: 34px;
      height: 34px;
    }
    .bell-button svg {
      width: 17px;
      height: 17px;
    }
    .notification-panel { right: 0; width: min(390px, calc(100vw - 24px)); }
    .notification-bell.member-header .bell-button {
      width: 34px;
      height: 34px;
    }
    .notification-bell.member-header .bell-button svg {
      width: 17px;
      height: 17px;
    }
  }
  @media (prefers-reduced-motion: reduce) { .bell-button { transition: none; } }
</style>
