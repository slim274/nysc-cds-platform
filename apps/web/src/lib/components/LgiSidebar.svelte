<script lang="ts">
  type Props = {
    activePath: string;
    open: boolean;
    signingOut?: boolean;
    onClose: () => void;
    onSignOut: () => void;
  };

  let {
    activePath,
    open,
    signingOut = false,
    onClose,
    onSignOut
  }: Props = $props();

  const navigation = [
    { label: 'Dashboard', href: '/lgi', icon: '▦' },
    { label: 'Corps Members', href: '/lgi/corps-members', icon: '♙' },
    { label: 'Document Requirements', href: '/lgi/document-requirements', icon: '▣' },
    { label: 'Batches & Streams', href: '/lgi/batches-streams', icon: '▤' },
    { label: 'CDS Groups', href: '/lgi/cds-groups', icon: '◎' },
    { label: 'Course Catalogue', href: '/lgi/course-catalogue', icon: '▤' },
    { label: 'Course Mapping', href: '/lgi/course-mapping', icon: '⌘' },
    { label: 'CDS Coordinators', href: '/lgi/coordinators', icon: '♧' },
    { label: 'Attendance', href: '/lgi/attendance', icon: '✓' },
    { label: 'Monthly Clearance', href: null, icon: '▣' },
    { label: 'Reports', href: null, icon: '▥' }
  ];
</script>

{#if open}
  <button class="drawer-backdrop" type="button" aria-label="Close navigation menu" onclick={onClose}></button>
{/if}

<aside id="lgi-sidebar" class:open class="sidebar" aria-label="LGI administration">
  <div class="brand">
    <div class="brand-icon">N</div>
    <div class="brand-copy"><strong>NYSC CDS</strong><span>LGI Administration</span></div>
    <button class="drawer-close" type="button" aria-label="Close navigation menu" onclick={onClose}>×</button>
  </div>

  <div class="nav-label">ADMINISTRATION</div>
  <nav aria-label="Primary navigation">
    {#each navigation as item (item.label)}
      {#if item.href}
        <a
          class:active={activePath === item.href}
          class="nav-item"
          href={item.href}
          aria-current={activePath === item.href ? 'page' : undefined}
          onclick={onClose}
        >
          <span class="nav-icon">{item.icon}</span><span>{item.label}</span>
        </a>
      {:else}
        <div class="nav-item muted" aria-disabled="true">
          <span class="nav-icon">{item.icon}</span><span>{item.label}</span><small>Coming soon</small>
        </div>
      {/if}
    {/each}
  </nav>

  <div class="sidebar-footer">
    <div class="environment-status"><span class="status-indicator"></span>Development Environment</div>
    <button class="sidebar-logout" type="button" onclick={onSignOut} disabled={signingOut}>
      {signingOut ? 'Signing out...' : 'Sign out'}
    </button>
  </div>
</aside>

<style>
  :global(body:has(.sidebar.open)) { overflow: hidden; }
  .sidebar {
    position: sticky;
    top: 0;
    width: 255px;
    height: 100vh;
    height: 100dvh;
    flex: 0 0 255px;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 25px 16px;
    background: #073d27;
    color: #fff;
    scrollbar-width: thin;
    scrollbar-color: #ffffff42 transparent;
  }
  .brand { display: flex; align-items: center; gap: 11px; padding: 0 8px 29px; }
  .brand-icon { width: 40px; height: 40px; flex: 0 0 40px; display: grid; place-items: center; border-radius: 9px; background: #fff; color: #0a5c37; font-size: 21px; font-weight: 800; }
  .brand-copy { min-width: 0; }
  .brand-copy strong, .brand-copy span { display: block; }
  .brand-copy strong { font-size: 14px; }
  .brand-copy span { margin-top: 4px; color: #b7d4c3; font-size: 10px; }
  .drawer-close { display: none; }
  .nav-label { padding: 0 10px 12px; color: #a6c6b3; font-size: 9px; font-weight: 700; letter-spacing: 1.5px; }
  nav { display: grid; gap: 5px; }
  .nav-item { min-height: 44px; display: flex; align-items: center; gap: 11px; padding: 0 11px; border-radius: 7px; color: #d1e0d7; font-size: 12px; text-decoration: none; }
  a.nav-item:hover { background: #ffffff14; color: #fff; }
  .nav-item.active { background: #0e6440; color: #fff; font-weight: 700; }
  .nav-icon { width: 20px; flex: 0 0 20px; font-size: 16px; text-align: center; }
  .nav-item small { margin-left: auto; color: #a6c6b3; font-size: 8px; white-space: nowrap; }
  .nav-item.muted { color: #aabfb2; cursor: default; }
  .sidebar-footer { margin-top: auto; padding: 18px 9px 5px; border-top: 1px solid #ffffff1f; color: #a6c6b3; font-size: 10px; }
  .environment-status { display: flex; align-items: center; gap: 8px; }
  .status-indicator { width: 7px; height: 7px; border-radius: 50%; background: #65d391; box-shadow: 0 0 0 3px #65d3911c; }
  .sidebar-logout { width: 100%; min-height: 42px; margin-top: 15px; padding: 10px 12px; border: 1px solid #ffffff3d; border-radius: 8px; background: #ffffff14; color: #fff; text-align: left; font-size: 12px; font-weight: 600; cursor: pointer; }
  .sidebar-logout:hover:not(:disabled) { background: #ffffff24; }
  .sidebar-logout:disabled { cursor: wait; opacity: .65; }
  .drawer-backdrop { display: none; }
  @media (max-width: 1050px) and (min-width: 761px) {
    .sidebar { width: 225px; flex-basis: 225px; padding-inline: 13px; }
    .nav-item { gap: 9px; padding-inline: 9px; font-size: 11px; }
  }
  @media (max-width: 760px) {
    .sidebar {
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 50;
      width: min(300px, 88vw);
      height: 100vh;
      height: 100dvh;
      padding: 22px 16px;
      transform: translateX(-105%);
      visibility: hidden;
      pointer-events: none;
      box-shadow: 12px 0 32px #0822143d;
      transition: transform 180ms ease, visibility 180ms ease;
    }
    .sidebar.open { transform: translateX(0); visibility: visible; pointer-events: auto; }
    .drawer-backdrop { display: block; position: fixed; inset: 0; z-index: 40; width: 100%; height: 100%; padding: 0; border: 0; background: #0a19107a; }
    .brand { width: 100%; padding: 0 8px 25px; }
    .drawer-close { display: grid; width: 36px; height: 36px; flex: 0 0 36px; place-items: center; margin-left: auto; padding: 0 0 3px; border: 1px solid #ffffff47; border-radius: 9px; background: #ffffff14; color: #fff; font-size: 28px; cursor: pointer; }
    .nav-item { min-height: 46px; width: 100%; }
    .sidebar-footer { display: block; margin-top: auto; }
  }
  @media (prefers-reduced-motion: reduce) { .sidebar { transition: none; } }
</style>
