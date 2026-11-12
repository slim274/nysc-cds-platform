<script lang="ts">
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';

  type Props = {
    activePath: string;
    userEmail: string | null;
    onSignOut: () => void | Promise<void>;
    children: Snippet;
  };

  let { activePath, userEmail, onSignOut, children }: Props = $props();
  let menuOpen = $state(false);
  let signingOut = $state(false);

  async function signOut() {
    signingOut = true;
    try {
      await onSignOut();
    } finally {
      signingOut = false;
    }
  }
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') menuOpen = false; }} />

<div class="dashboard">
  {#if menuOpen}<button class="backdrop" aria-label="Close menu" onclick={() => (menuOpen = false)}></button>{/if}
  <aside class:open={menuOpen} class="sidebar" aria-label="CLO workspace">
    <div class="brand">
      <div class="brand-icon">N</div>
      <div><strong>NYSC CDS</strong><span>CLO Workspace</span></div>
      <button class="close-menu" aria-label="Close navigation" onclick={() => (menuOpen = false)}>×</button>
    </div>
    <div class="nav-label">DOCUMENT OPERATIONS</div>
    <a class:active={activePath === '/clo/documents'} href="/clo/documents" onclick={() => (menuOpen = false)}>
      <span>▣</span> Document Handling
    </a>
    <div class="sidebar-note">
      <strong>Assigned access</strong>
      <p>You can review documents for your assigned LGA(s). Document requirements are managed by the LGI.</p>
    </div>
    <div class="sidebar-footer">
      <div><span class="dot"></span>CLO access active</div>
      <button type="button" onclick={signOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
    </div>
  </aside>

  <section class="main-content">
    <header class="topbar">
      <div class="heading">
        <button class="menu-button" type="button" aria-label="Open navigation" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
          <span></span><span></span><span></span>
        </button>
        <div><span class="breadcrumb">CLO Workspace / Document Operations</span><h1>Document Handling</h1></div>
      </div>
      <div class="account"><div class="avatar">CLO</div><div><strong>Corps Liaison Officer</strong><span>{userEmail}</span></div></div>
    </header>
    <main class="page-content">{@render children()}</main>
    <footer>NYSC CDS Management Platform · Corps Liaison Officer Workspace</footer>
  </section>
</div>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; overflow-x: hidden; background: #f5f7f5; color: #19251e; font-family: Inter, Arial, sans-serif; }
  :global(button), :global(input), :global(select) { font: inherit; }
  .dashboard { min-height: 100vh; display: flex; }
  .sidebar { position: sticky; top: 0; width: 255px; height: 100vh; height: 100dvh; flex: 0 0 255px; display: flex; flex-direction: column; padding: 25px 16px; background: #073d27; color: #fff; }
  .brand { display: flex; align-items: center; gap: 11px; padding: 0 8px 30px; }
  .brand-icon { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 9px; background: #fff; color: #0a5c37; font-size: 21px; font-weight: 800; }
  .brand strong, .brand span { display: block; }
  .brand strong { font-size: 14px; }
  .brand span { margin-top: 4px; color: #b7d4c3; font-size: 10px; }
  .close-menu { display: none; }
  .nav-label { padding: 0 10px 12px; color: #a6c6b3; font-size: 9px; font-weight: 700; letter-spacing: 1.4px; }
  .sidebar > a { min-height: 46px; display: flex; align-items: center; gap: 11px; padding: 0 11px; border-radius: 7px; color: #d1e0d7; font-size: 12px; text-decoration: none; }
  .sidebar > a span { width: 20px; text-align: center; font-size: 16px; }
  .sidebar > a:hover { background: #ffffff14; color: #fff; }
  .sidebar > a.active { background: #0e6440; color: #fff; font-weight: 700; }
  .sidebar-note { margin-top: 22px; padding: 14px; border: 1px solid #ffffff24; border-radius: 9px; background: #ffffff0d; }
  .sidebar-note strong { font-size: 11px; }
  .sidebar-note p { margin: 7px 0 0; color: #bdd1c4; font-size: 10px; line-height: 1.7; }
  .sidebar-footer { margin-top: auto; padding: 18px 9px 5px; border-top: 1px solid #ffffff1f; color: #a6c6b3; font-size: 10px; }
  .sidebar-footer > div { display: flex; align-items: center; gap: 8px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #65d391; }
  .sidebar-footer button { width: 100%; min-height: 42px; margin-top: 15px; padding: 10px 12px; border: 1px solid #ffffff3d; border-radius: 8px; background: #ffffff14; color: #fff; text-align: left; font-size: 12px; font-weight: 600; cursor: pointer; }
  .sidebar-footer button:disabled { opacity: .6; }
  .main-content { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .topbar { position: sticky; top: 0; z-index: 15; min-height: 88px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 15px 34px; border-bottom: 1px solid #e8ece8; background: #fff; }
  .heading { display: flex; align-items: center; gap: 12px; }
  .breadcrumb { color: #819087; font-size: 10px; }
  .topbar h1 { margin: 5px 0 0; font-size: 21px; }
  .account { display: flex; align-items: center; gap: 10px; }
  .avatar { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; background: #e6f1e9; color: #0a5c37; font-size: 10px; font-weight: 800; }
  .account strong, .account span { display: block; }
  .account strong { font-size: 11px; }
  .account span { margin-top: 4px; color: #819087; font-size: 10px; }
  .menu-button, .backdrop { display: none; }
  .page-content { width: 100%; flex: 1; padding: 30px clamp(18px, 2.4vw, 36px); }
  footer { padding: 17px 34px; border-top: 1px solid #e8ece8; color: #89948c; font-size: 10px; }
  @media (max-width: 760px) {
    .sidebar { position: fixed; inset: 0 auto 0 0; z-index: 50; width: min(300px, 88vw); height: 100vh; height: 100dvh; transform: translateX(-105%); visibility: hidden; pointer-events: none; transition: transform 180ms ease, visibility 180ms ease; }
    .sidebar.open { transform: translateX(0); visibility: visible; pointer-events: auto; }
    .backdrop { display: block; position: fixed; inset: 0; z-index: 40; width: 100%; border: 0; background: #0a19107a; }
    .close-menu { display: grid; width: 34px; height: 34px; place-items: center; margin-left: auto; border: 1px solid #ffffff47; border-radius: 8px; background: #ffffff14; color: #fff; font-size: 24px; }
    .topbar { min-height: 76px; padding: 12px 15px; }
    .menu-button { display: grid; width: 38px; height: 38px; place-content: center; gap: 4px; border: 1px solid #dce5de; border-radius: 8px; background: #fff; }
    .menu-button span { width: 16px; height: 2px; background: #24543a; }
    .topbar h1 { font-size: 18px; }
    .account > div:last-child { display: none; }
    .page-content { padding: 22px 15px 28px; }
    footer { padding: 15px; line-height: 1.5; }
  }
  @media (prefers-reduced-motion: reduce) { .sidebar { transition: none; } }
</style>