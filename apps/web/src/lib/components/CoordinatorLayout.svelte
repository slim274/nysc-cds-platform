<script lang="ts">
  import type { Snippet } from 'svelte';
  import CoordinatorSidebar from '#lib/components/CoordinatorSidebar.svelte';

  type Props = {
    activePath: string;
    pageTitle: string;
    userEmail: string | null;
    onSignOut: () => void | Promise<void>;
    children: Snippet;
  };

  let {
    activePath,
    pageTitle,
    userEmail,
    onSignOut,
    children
  }: Props = $props();

  let mobileNavOpen = $state(false);
  let signingOut = $state(false);

  function closeMobileNavigation() {
    mobileNavOpen = false;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeMobileNavigation();
  }

  async function signOut() {
    signingOut = true;
    try {
      await onSignOut();
    } finally {
      signingOut = false;
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="dashboard">
  <CoordinatorSidebar
    {activePath}
    open={mobileNavOpen}
    {signingOut}
    onClose={closeMobileNavigation}
    onSignOut={signOut}
  />

  <section class="main-content">
    <header class="topbar">
      <div class="topbar-heading">
        <button
          class="mobile-menu-button"
          type="button"
          aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileNavOpen}
          aria-controls="coordinator-sidebar"
          onclick={() => (mobileNavOpen = !mobileNavOpen)}
        >
          <span></span><span></span><span></span>
        </button>
        <div class="page-heading">
          <span class="breadcrumb">CDS Operations / {pageTitle}</span>
          <h1>{pageTitle}</h1>
        </div>
      </div>
      <div class="account coordinator-header-controls">
        <div class="avatar">CD</div>
        <div class="account-details">
          <strong>CDS Coordinator</strong>
          <span>{userEmail}</span>
        </div>
      </div>
    </header>

    <main class="page-content">
      {@render children()}
    </main>

    <footer>NYSC CDS Management Platform · Coordinator Workspace</footer>
  </section>
</div>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; overflow-x: hidden; background: #f5f7f5; color: #19251e; font-family: Inter, Arial, sans-serif; }
  :global(button), :global(input), :global(select), :global(textarea) { font: inherit; }
  .dashboard { min-height: 100vh; display: flex; }
  .main-content { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .topbar { position: sticky; top: 0; z-index: 15; min-height: 88px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 15px 34px; border-bottom: 1px solid #e8ece8; background: #fff; }
  .topbar-heading { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .page-heading { min-width: 0; }
  .breadcrumb { color: #819087; font-size: 10px; }
  .topbar h1 { margin: 5px 0 0; color: #19251e; font-size: 21px; }
  .account { display: flex; align-items: center; gap: 10px; }
  .avatar { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; background: #e6f1e9; color: #0a5c37; font-size: 12px; font-weight: 700; }
  .account-details strong, .account-details span { display: block; }
  .account-details strong { color: #19251e; font-size: 11px; }
  .account-details span { max-width: 260px; overflow: hidden; margin-top: 4px; color: #819087; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .mobile-menu-button { display: none; }
  .page-content { width: 100%; max-width: none; flex: 1; margin: 0; padding: 32px clamp(20px, 2.2vw, 36px); }
  footer { margin-top: auto; padding: 17px 34px; border-top: 1px solid #e8ece8; color: #89948c; font-size: 10px; }
  @media (max-width: 1050px) {
    .topbar { padding-inline: 24px; }
    .page-content { padding-inline: 24px; }
  }
  @media (max-width: 760px) {
    .topbar { min-height: 76px; padding: 13px 16px; gap: 12px; }
    .topbar-heading { gap: 10px; }
    .mobile-menu-button { display: grid; flex: 0 0 42px; width: 42px; height: 42px; place-content: center; gap: 5px; padding: 0; border: 1px solid #e1e9e2; border-radius: 9px; background: #fff; cursor: pointer; }
    .mobile-menu-button span { display: block; width: 18px; height: 2px; border-radius: 2px; background: #0a5c37; }
    .mobile-menu-button:focus-visible { outline: 3px solid #7ac69b; outline-offset: 3px; }
    .account-details { display: none; }
    .page-heading h1 { font-size: 19px; }
    .breadcrumb { font-size: 9px; }
    .page-content { padding: 22px 16px 28px; }
    footer { padding: 15px 16px; line-height: 1.5; }
  }
  @media (max-width: 380px) {
    .topbar { padding-inline: 12px; }
    .page-content { padding-inline: 13px; }
  }
</style>
