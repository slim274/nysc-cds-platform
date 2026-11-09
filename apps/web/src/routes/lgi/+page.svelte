<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  import {
    getCurrentUser,
    logout,
    ApiError
  } from '#lib/api/client.ts';

  import type {
    AuthUser
  } from '#lib/api/client.ts';

  let currentUser = $state<AuthUser | null>(null);
  let loading = $state(true);
  let errorMessage = $state('');
  let signingOut = $state(false);
  let mobileNavOpen = $state(false);

  function closeMobileNavigation() {
    mobileNavOpen = false;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeMobileNavigation();
    }
  }

  const navigation = [
    { label: 'Dashboard', icon: '▦', active: true },
    { label: 'Corps Members', icon: '♙', active: false },
    { label: 'Batches & Streams', icon: '▤', active: false },
    { label: 'CDS Groups', icon: '◎', active: false },
    { label: 'Course Mapping', icon: '⌘', active: false },
    { label: 'CDS Officials', icon: '♧', active: false },
    { label: 'Attendance', icon: '✓', active: false },
    { label: 'Monthly Clearance', icon: '▣', active: false },
    { label: 'Reports', icon: '▥', active: false }
  ];

  onMount(async () => {
    try {
      const response = await getCurrentUser();

      const isLGI = response.roles.some(
        (role) => role.code === 'LGI_ADMIN'
      );

      if (!isLGI) {
        errorMessage = 'Your account does not have LGI administrator permissions.';
        return;
      }

      currentUser = response.user;

    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await goto('/login');
        return;
      }

      errorMessage = error instanceof Error
        ? error.message
        : 'Unable to load your dashboard.';

    } finally {
      loading = false;
    }
  });

  async function handleLogout() {
    signingOut = true;

    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      await goto('/login');
    }
  }
</script>

<svelte:head>
  <title>LGI Dashboard | NYSC CDS Platform</title>
  <meta
    name="description"
    content="LGI administration dashboard"
  />
</svelte:head>

<svelte:window onkeydown={handleWindowKeydown} />

{#if loading}

  <main class="loading-screen">
    <div class="loader"></div>
    <p>Verifying your account...</p>
  </main>

{:else if errorMessage}

  <main class="error-screen">
    <h2>Access unavailable</h2>
    <p>{errorMessage}</p>
    <button onclick={() => goto('/login')}>Return to login</button>
  </main>

{:else if currentUser}

  <div class="dashboard">

    {#if mobileNavOpen}
      <button
        class="sidebar-backdrop"
        type="button"
        aria-label="Close navigation menu"
        onclick={closeMobileNavigation}
      ></button>
    {/if}

    <aside id="lgi-sidebar" class="sidebar" class:open={mobileNavOpen} aria-label="LGI administration">

      <div class="brand">
        <div class="brand-icon">N</div>

        <div>
          <h2>NYSC CDS</h2>
          <span>Management Platform</span>
        </div>
      </div>

      <div class="nav-label">ADMINISTRATION</div>

      <nav aria-label="Primary navigation">
        {#each navigation as item}
          <div class:active={item.active} class="nav-item">
            <span class="nav-icon">{item.icon}</span>
            <span>{item.label}</span>

            {#if !item.active}
              <small>Soon</small>
            {/if}
          </div>
        {/each}
      </nav>

      <div class="sidebar-footer">
        <span class="status-indicator"></span>
        Development Environment
      </div>

    </aside>

    <section class="main-content">

      <header class="topbar">
        <div class="topbar-heading">
          <button
            class="mobile-menu-button"
            type="button"
            aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileNavOpen}
            aria-controls="lgi-sidebar"
            onclick={() => (mobileNavOpen = !mobileNavOpen)}
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
          <div class="page-heading">
            <span class="breadcrumb">Administration / Dashboard</span>
            <h1>Dashboard</h1>
          </div>
        </div>

        <div class="account">
          <div class="avatar">LG</div>

          <div class="account-details">
            <strong>LGI Administrator</strong>
            <span>{currentUser.email}</span>
          </div>

          <button
            class="logout-button"
            onclick={handleLogout}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      </header>

      <main class="content">

        <section class="welcome">
          <div>
            <span class="eyebrow">LOCAL GOVERNMENT ADMINISTRATION</span>

            <h2>Welcome to your dashboard</h2>

            <p>
              Manage corps members, CDS groups, attendance
              and monthly compliance from one place.
            </p>
          </div>

          <div class="welcome-icon">✦</div>
        </section>

        <section class="section-heading">
          <div>
            <h2>System Overview</h2>
            <p>Your administrative workspace.</p>
          </div>
        </section>

        <section class="feature-grid">

          <article class="feature-card">
            <div class="feature-icon green">♙</div>
            <h3>Corps Members</h3>
            <p>
              Manage preloaded records, account activation
              and member profiles.
            </p>
            <span>Member management coming next</span>
          </article>

          <article class="feature-card">
            <div class="feature-icon orange">◎</div>
            <h3>CDS Groups</h3>
            <p>
              Configure CDS groups, eligibility rules
              and maximum membership capacity.
            </p>
            <span>Group management coming next</span>
          </article>

          <article class="feature-card">
            <div class="feature-icon blue">✓</div>
            <h3>Attendance</h3>
            <p>
              Monitor CDS meeting attendance and
              monthly participation requirements.
            </p>
            <span>Attendance management coming next</span>
          </article>

          <article class="feature-card">
            <div class="feature-icon purple">▣</div>
            <h3>Monthly Clearance</h3>
            <p>
              Monitor attendance compliance and
              monthly clearance readiness.
            </p>
            <span>Clearance management coming next</span>
          </article>

        </section>

        <section class="account-status">
          <div>
            <h3>Authentication Status</h3>
            <p>Your account is authenticated and authorised.</p>
          </div>

          <span class="verified-badge">
            <span></span>
            Verified LGI Session
          </span>
        </section>

      </main>

      <footer>
        NYSC CDS Management Platform · Version 0.1.0
      </footer>

    </section>

  </div>

{/if}

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    overflow-x: hidden;
    background: #f5f7f5;
    color: #19251e;
    font-family: Inter, Arial, sans-serif;
  }

  .dashboard {
    min-height: 100vh;
    display: flex;
  }

  .sidebar {
    width: 255px;
    background: #073d27;
    color: white;
    padding: 27px 17px;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 9px 35px;
  }

  .brand-icon {
    width: 40px;
    height: 40px;
    background: #ffffff;
    color: #0a5c37;
    display: grid;
    place-items: center;
    border-radius: 9px;
    font-weight: 800;
    font-size: 21px;
  }

  .brand h2 {
    margin: 0;
    font-size: 16px;
  }

  .brand span {
    display: block;
    margin-top: 4px;
    font-size: 10px;
    color: #b7d4c3;
  }

  .nav-label {
    padding: 0 10px 13px;
    color: #a6c6b3;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.5px;
  }

  nav {
    display: grid;
    gap: 5px;
  }

  .nav-item {
    min-height: 43px;
    padding: 0 11px;
    border-radius: 7px;
    display: flex;
    align-items: center;
    gap: 11px;
    color: #d1e0d7;
    font-size: 12px;
  }

  .nav-item.active {
    background: #0e6440;
    color: #ffffff;
    font-weight: 700;
  }

  .nav-icon {
    width: 20px;
    font-size: 16px;
    text-align: center;
  }

  .nav-item small {
    margin-left: auto;
    font-size: 8px;
    color: #a6c6b3;
  }

  .sidebar-footer {
    margin-top: auto;
    padding: 17px 9px 5px;
    color: #a6c6b3;
    font-size: 10px;
    border-top: 1px solid #ffffff1f;
  }

  .status-indicator {
    display: inline-block;
    height: 7px;
    width: 7px;
    margin-right: 7px;
    background: #55d58a;
    border-radius: 50%;
  }

  .main-content {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .topbar {
    min-height: 88px;
    padding: 15px 34px;
    background: white;
    border-bottom: 1px solid #e8ece8;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }

  .topbar-heading {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .mobile-menu-button {
    display: none;
  }

  .breadcrumb {
    font-size: 10px;
    color: #819087;
  }

  .topbar h1 {
    margin: 5px 0 0;
    font-size: 21px;
  }

  .account {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .avatar {
    height: 36px;
    width: 36px;
    border-radius: 50%;
    background: #e6f1e9;
    color: #0a5c37;
    display: grid;
    place-items: center;
    font-size: 12px;
    font-weight: 700;
  }

  .account-details strong {
    display: block;
    font-size: 11px;
  }

  .account-details span {
    display: block;
    margin-top: 4px;
    color: #819087;
    font-size: 10px;
  }

  .logout-button {
    margin-left: 12px;
    padding: 9px 12px;
    border: 1px solid #e0e7e1;
    border-radius: 7px;
    background: white;
    color: #44554a;
    font-size: 11px;
    cursor: pointer;
  }

  .logout-button:hover {
    border-color: #0a5c37;
    color: #0a5c37;
  }

  .content {
    width: 100%;
    max-width: 1250px;
    margin: auto;
    padding: 32px 34px;
  }

  .welcome {
    padding: 30px;
    border-radius: 12px;
    background: #eaf3ed;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .eyebrow {
    color: #0a8050;
    font-weight: 700;
    font-size: 9px;
    letter-spacing: 1.5px;
  }

  .welcome h2 {
    margin: 12px 0 8px;
    font-size: 23px;
  }

  .welcome p {
    margin: 0;
    color: #65766a;
    font-size: 12px;
    line-height: 1.7;
  }

  .welcome-icon {
    width: 57px;
    height: 57px;
    border-radius: 12px;
    background: #0a5c37;
    color: white;
    display: grid;
    place-items: center;
    font-size: 26px;
  }

  .section-heading {
    margin: 35px 0 17px;
  }

  .section-heading h2 {
    margin: 0 0 5px;
    font-size: 16px;
  }

  .section-heading p {
    margin: 0;
    color: #819087;
    font-size: 11px;
  }

  .feature-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .feature-card {
    padding: 23px;
    background: white;
    border: 1px solid #e8ece8;
    border-radius: 10px;
  }

  .feature-icon {
    width: 39px;
    height: 39px;
    display: grid;
    place-items: center;
    border-radius: 9px;
    font-size: 18px;
  }

  .green {
    background: #e4f2e8;
    color: #0a8050;
  }

  .orange {
    background: #fff1df;
    color: #b76c16;
  }

  .blue {
    background: #e7f0fd;
    color: #346ec5;
  }

  .purple {
    background: #eee9fd;
    color: #7857c9;
  }

  .feature-card h3 {
    margin: 17px 0 8px;
    font-size: 14px;
  }

  .feature-card p {
    min-height: 38px;
    margin: 0 0 14px;
    color: #7b887f;
    font-size: 11px;
    line-height: 1.7;
  }

  .feature-card > span {
    color: #0a8050;
    font-size: 10px;
    font-weight: 600;
  }

  .account-status {
    margin-top: 22px;
    padding: 19px 22px;
    background: white;
    border: 1px solid #e8ece8;
    border-radius: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 15px;
  }

  .account-status h3 {
    margin: 0 0 5px;
    font-size: 12px;
  }

  .account-status p {
    margin: 0;
    color: #819087;
    font-size: 10px;
  }

  .verified-badge {
    padding: 8px 11px;
    background: #e8f5ec;
    border-radius: 20px;
    color: #087443;
    font-size: 10px;
    white-space: nowrap;
  }

  .verified-badge span {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 5px;
    background: #159451;
    border-radius: 50%;
  }

  footer {
    padding: 17px 34px;
    border-top: 1px solid #e8ece8;
    color: #89948c;
    font-size: 10px;
  }

  .loading-screen,
  .error-screen {
    min-height: 100vh;
    display: grid;
    place-content: center;
    justify-items: center;
    text-align: center;
    padding: 25px;
  }

  .loading-screen p,
  .error-screen p {
    color: #738178;
    font-size: 13px;
  }

  .loader {
    height: 27px;
    width: 27px;
    border: 3px solid #dbe8de;
    border-top-color: #0a5c37;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .error-screen button {
    margin-top: 12px;
    padding: 11px 18px;
    border: 0;
    border-radius: 7px;
    background: #0a5c37;
    color: white;
    cursor: pointer;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 850px) {
    .sidebar {
      width: 220px;
      padding-inline: 14px;
    }

    .topbar {
      padding: 15px 22px;
    }

    .content {
      padding: 26px 22px;
    }

    .feature-grid {
      gap: 13px;
    }
  }

  @media (max-width: 650px) {
    .sidebar {
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 30;
      width: min(290px, 86vw);
      height: 100vh;
      height: 100dvh;
      overflow-y: auto;
      padding: 22px 16px;
      transform: translateX(-105%);
      visibility: hidden;
      pointer-events: none;
      box-shadow: 12px 0 32px rgba(8, 34, 20, 0.18);
      transition: transform 180ms ease, visibility 180ms ease;
    }

    .sidebar.open {
      transform: translateX(0);
      visibility: visible;
      pointer-events: auto;
    }

    .sidebar-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 20;
      width: 100%;
      height: 100%;
      padding: 0;
      border: 0;
      background: rgba(10, 25, 16, 0.48);
      cursor: pointer;
    }

    .brand {
      padding: 0 9px 26px;
    }

    .nav-label {
      display: block;
    }

    .sidebar nav {
      display: grid;
      gap: 6px;
      overflow: visible;
    }

    .nav-item {
      width: 100%;
      min-height: 46px;
      white-space: normal;
    }

    .sidebar-footer {
      display: block;
      margin-top: 24px;
    }

    .topbar {
      min-height: 76px;
      padding: 13px 16px;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }

    .topbar-heading {
      gap: 10px;
    }

    .mobile-menu-button {
      display: grid;
      flex: 0 0 42px;
      width: 42px;
      height: 42px;
      place-content: center;
      gap: 5px;
      padding: 0;
      border: 1px solid #e1e9e2;
      border-radius: 9px;
      background: #ffffff;
      cursor: pointer;
    }

    .mobile-menu-button span {
      display: block;
      width: 18px;
      height: 2px;
      border-radius: 2px;
      background: #0a5c37;
    }

    .mobile-menu-button:focus-visible,
    .sidebar-backdrop:focus-visible {
      outline: 3px solid #7ac69b;
      outline-offset: 3px;
    }

    .breadcrumb {
      font-size: 9px;
    }

    .topbar h1 {
      margin-top: 4px;
      font-size: 19px;
    }

    .account {
      margin-left: auto;
      gap: 8px;
    }

    .account-details {
      display: none;
    }

    .logout-button {
      min-height: 42px;
      margin-left: 0;
      padding: 9px 11px;
      font-size: 10px;
    }

    .content {
      padding: 22px 16px 28px;
    }

    .welcome {
      padding: 21px 19px;
      gap: 12px;
      align-items: flex-start;
    }

    .welcome h2 {
      margin-top: 10px;
      font-size: 20px;
      line-height: 1.3;
    }

    .welcome p {
      font-size: 12px;
      line-height: 1.65;
    }

    .welcome-icon {
      display: none;
    }

    .section-heading {
      margin: 27px 0 14px;
    }

    .feature-grid {
      grid-template-columns: 1fr;
      gap: 12px;
    }

    .feature-card {
      padding: 20px;
    }

    .feature-card p {
      min-height: 0;
    }

    .account-status {
      align-items: flex-start;
      flex-direction: column;
      padding: 18px;
    }

    .verified-badge {
      white-space: normal;
    }

    footer {
      padding: 15px 16px;
      line-height: 1.5;
    }
  }

  @media (min-width: 651px) {
    .sidebar-backdrop {
      display: none;
    }
  }

  @media (max-width: 380px) {
    .topbar {
      padding-inline: 12px;
    }

    .content {
      padding-inline: 13px;
    }

    .logout-button {
      padding-inline: 9px;
      font-size: 9px;
    }

    .welcome {
      padding: 18px 16px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sidebar {
      transition: none;
    }

    .loader {
      animation-duration: 1.8s;
    }
  }
</style>
