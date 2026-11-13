<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { login, getCurrentUser, logout, ApiError } from '#lib/api/client.ts';

  let identifier = $state('');
  let password = $state('');
  let submitting = $state(false);
  let errorMessage = $state('');
  let loginBlocked = $state(false);
  let retryAfterSeconds = $state(0);
  let blockedUntilTimestamp: number | null = null;
  let countdownInterval: ReturnType<typeof setInterval> | null = null;

  const LOGIN_LOCKOUT_STORAGE_KEY = 'nysc-cds-login-blocked-until';

  function formatCountdown(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function stopLoginCountdown() {
    if (countdownInterval !== null) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  function clearLoginLockout() {
    stopLoginCountdown();
    blockedUntilTimestamp = null;
    retryAfterSeconds = 0;
    loginBlocked = false;

    try {
      sessionStorage.removeItem(LOGIN_LOCKOUT_STORAGE_KEY);
    } catch {
      // The API remains authoritative if browser storage is unavailable.
    }
  }

  function updateLoginCountdown() {
    if (blockedUntilTimestamp === null) return;

    const remainingSeconds = Math.ceil(
      (blockedUntilTimestamp - Date.now()) / 1000
    );

    if (remainingSeconds <= 0) {
      clearLoginLockout();
      errorMessage = '';
      return;
    }

    retryAfterSeconds = remainingSeconds;
    loginBlocked = true;
  }

  function startLoginCountdown(seconds: number) {
    clearLoginLockout();

    const durationSeconds = Math.max(0, Math.ceil(seconds));
    if (durationSeconds === 0) return;

    blockedUntilTimestamp = Date.now() + durationSeconds * 1000;

    try {
      sessionStorage.setItem(
        LOGIN_LOCKOUT_STORAGE_KEY,
        String(blockedUntilTimestamp)
      );
    } catch {
      // The countdown still works until this page is refreshed.
    }

    updateLoginCountdown();
    countdownInterval = setInterval(updateLoginCountdown, 1000);
  }

  function restoreLoginCountdown() {
    try {
      const storedTimestamp = Number(
        sessionStorage.getItem(LOGIN_LOCKOUT_STORAGE_KEY)
      );

      if (Number.isFinite(storedTimestamp) && storedTimestamp > Date.now()) {
        blockedUntilTimestamp = storedTimestamp;
        updateLoginCountdown();
        countdownInterval = setInterval(updateLoginCountdown, 1000);
        return;
      }

      sessionStorage.removeItem(LOGIN_LOCKOUT_STORAGE_KEY);
    } catch {
      // Continue normally; the API will still reject requests during a block.
    }
  }

  onMount(restoreLoginCountdown);
  onDestroy(stopLoginCountdown);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();

    if (loginBlocked) return;

    errorMessage = '';
    loginBlocked = false;
    retryAfterSeconds = 0;
    submitting = true;

    try {
      await login(identifier.trim(), password);
      clearLoginLockout();
      const session = await getCurrentUser();

      if (session.roles.some((role) => role.code === 'LGI_ADMIN')) {
        await goto('/lgi');
      } else if (session.roles.some((role) => role.code === 'CLO')) {
        await goto('/clo/documents');
      } else if (session.roles.some((role) => role.code === 'CDS_COORDINATOR')) {
        await goto('/coordinator');
      } else if (session.roles.some((role) => role.code === 'CDS_PRESIDENT')) {
        await goto('/cds-president');
      } else if (session.roles.some((role) => role.code === 'CORPS_MEMBER')) {
        await goto('/corps-member');
      } else {
        await logout();
        errorMessage = 'Your account does not have access to this administration portal.';
      }

    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        if (error.retryAfterSeconds !== null) {
          startLoginCountdown(error.retryAfterSeconds);
          errorMessage = '';
        } else {
          // Do not permanently disable the form if a proxy strips Retry-After.
          loginBlocked = false;
          errorMessage = error.message;
        }
      } else {
        clearLoginLockout();
        errorMessage = error instanceof ApiError
          ? error.message
          : 'Unable to connect to the server. Please try again.';
      }
    } finally {
      submitting = false;
      password = '';
    }
  }
</script>

<svelte:head>
  <title>Sign In | NYSC CDS Platform</title>
  <meta
    name="description"
    content="Sign in to the NYSC CDS Management Platform."
  />
</svelte:head>

<main class="login-page">
  <section class="login-card">

    <div class="brand">
      <div class="brand-icon">N</div>

      <div>
        <h1>NYSC CDS</h1>
        <p>Management Platform</p>
      </div>
    </div>

    <div class="heading">
      <span class="eyebrow">SECURE PLATFORM ACCESS</span>

      <h2>Welcome back</h2>

      <p>Sign in to continue to your NYSC CDS workspace.</p>
    </div>

    {#if loginBlocked}
      <div class="error-message lockout-message" role="alert" aria-live="polite">
        <strong>Too many login attempts.</strong>
        {#if retryAfterSeconds > 0}
          <p>Please try again in <strong>{formatCountdown(retryAfterSeconds)}</strong>.</p>
        {:else}
          <p>Please try again later.</p>
        {/if}
      </div>
    {:else if errorMessage}
      <div class="error-message" role="alert">
        {errorMessage}
      </div>
    {/if}

    <form onsubmit={handleSubmit}>

      <div class="form-group">
        <label for="identifier">Email address or phone number</label>

        <input
          id="identifier"
          type="text"
          bind:value={identifier}
          placeholder="Enter your email or phone number"
          autocomplete="username"
          required
          disabled={submitting || loginBlocked}
        />
      </div>

      <div class="form-group">
        <label for="password">Password</label>

        <input
          id="password"
          type="password"
          bind:value={password}
          placeholder="Enter your password"
          autocomplete="current-password"
          required
          disabled={submitting || loginBlocked}
        />
      </div>

      <button
        type="submit"
        disabled={submitting || loginBlocked || !identifier.trim() || !password}
      >
        {submitting ? 'Signing in...' : 'Sign in'}
      </button>

    </form>

    <div class="login-footer">
      <p>New Corps Member?</p>
      <a href="/register/corps-member">Create account</a>
    </div>

  </section>

  <footer>
    NYSC CDS Management Platform · Development Version 0.1.0
  </footer>
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    font-family: Inter, Arial, sans-serif;
    background: #f3f6f4;
    color: #17251c;
  }

  .login-page {
    min-height: 100vh;
    min-height: 100svh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px clamp(16px, 4vw, 32px);
  }

  .login-card {
    width: min(100%, 440px);
    padding: clamp(24px, 5vw, 40px);
    background: #ffffff;
    border: 1px solid #e4ebe6;
    border-radius: 16px;
    box-shadow: 0 12px 40px rgba(20, 50, 30, 0.07);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 13px;
    margin-bottom: 42px;
  }

  .brand-icon {
    width: 46px;
    height: 46px;
    display: grid;
    place-items: center;
    background: #0a5c37;
    color: white;
    border-radius: 11px;
    font-weight: 800;
    font-size: 24px;
  }

  .brand h1 {
    margin: 0;
    font-size: 17px;
    color: #0a5c37;
  }

  .brand p {
    margin: 3px 0 0;
    font-size: 12px;
    color: #718078;
  }

  .eyebrow {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.5px;
    color: #0a8050;
  }

  .heading h2 {
    margin: 12px 0 8px;
    font-size: 29px;
  }

  .heading > p {
    margin: 0 0 30px;
    color: #78847c;
    font-size: 14px;
    line-height: 1.6;
  }

  .form-group {
    margin-bottom: 20px;
  }

  label {
    display: block;
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: 600;
  }

  input {
    width: 100%;
    height: 48px;
    padding: 0 14px;
    border: 1px solid #dce5de;
    border-radius: 8px;
    font-size: 14px;
    outline: none;
    background: #ffffff;
  }

  input:focus {
    border-color: #0a8050;
    box-shadow: 0 0 0 3px rgba(10, 128, 80, 0.09);
  }

  input:disabled {
    background: #f5f7f5;
  }

  button {
    width: 100%;
    height: 49px;
    margin-top: 8px;
    border: none;
    border-radius: 8px;
    background: #0a5c37;
    color: white;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: #064526;
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .error-message {
    padding: 12px;
    margin-bottom: 20px;
    background: #fff0f0;
    border: 1px solid #f2cccc;
    border-radius: 8px;
    color: #b42318;
    font-size: 13px;
  }

  .lockout-message p {
    margin: 6px 0 0;
    line-height: 1.5;
  }

  .login-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 30px;
    padding-top: 20px;
    border-top: 1px solid #edf0ed;
    font-size: 12px;
  }

  .login-footer p {
    color: #89948c;
  }

  .login-footer a {
    color: #0a5c37;
    text-decoration: none;
    font-weight: 600;
  }

  footer {
    width: min(100%, 440px);
    margin-top: 24px;
    color: #89948c;
    font-size: 11px;
    line-height: 1.5;
    text-align: center;
  }

  @media (max-width: 480px) {
    .login-page {
      padding: 20px 16px;
    }

    .login-card {
      padding: 28px 22px;
      border-radius: 14px;
    }

    .brand {
      margin-bottom: 32px;
    }

    .heading h2 {
      font-size: clamp(26px, 8vw, 29px);
    }

    .login-footer {
      flex-wrap: wrap;
      gap: 10px 16px;
    }

    .login-footer p {
      margin: 0;
    }
  }
</style>
