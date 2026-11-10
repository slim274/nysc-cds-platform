<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { getCurrentUser, logout, type CurrentUserResponse } from '#lib/api/client.ts';

  let session = $state<CurrentUserResponse | null>(null);
  let loading = $state(true);
  let errorMessage = $state('');

  onMount(async () => {
    try {
      const current = await getCurrentUser();
      if (!current.roles.some((role) => role.code === 'CORPS_MEMBER')) {
        await logout();
        await goto('/login');
        return;
      }
      session = current;
    } catch {
      await goto('/login');
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>Corps Member Portal | NYSC CDS Platform</title>
  <meta name="description" content="Your NYSC CDS Corps Member portal." />
</svelte:head>

<main class="page">
  <header>
    <a href="/" class="brand">NYSC CDS <span>Corps Member Portal</span></a>
    <button class="signout" onclick={async () => { await logout(); await goto('/login'); }}>Sign out</button>
  </header>

  {#if loading}
    <section class="card"><p>Loading your account…</p></section>
  {:else if session}
    <section class="card">
      <div class="badge">ACCOUNT ACTIVE</div>
      <h1>Welcome to the Corps Member Portal</h1>
      <p>Your Corps Member account has been created and linked to your existing NYSC record.</p>
      <div class="account">
        <span>Signed-in account</span>
        <strong>{session.user.email ?? 'Phone-based account'}</strong>
      </div>
      <div class="next">
        Your dashboard will show CDS group information, document requests, attendance and announcements as those modules are released.
      </div>
    </section>
  {/if}
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #f3f6f4; color: #17251c; font-family: Inter, Arial, sans-serif; }
  .page { min-height: 100vh; padding: 24px clamp(16px, 4vw, 40px); }
  header { width: min(100%, 1080px); margin: 0 auto 50px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .brand { display: flex; flex-direction: column; gap: 3px; color: #0a5c37; text-decoration: none; font-weight: 800; }
  .brand span { color: #718078; font-size: 12px; font-weight: 400; }
  .signout { border: 1px solid #dce5de; border-radius: 8px; background: #fff; color: #314238; padding: 10px 16px; font-weight: 600; cursor: pointer; }
  .card { width: min(100%, 680px); margin: 0 auto; background: #fff; border: 1px solid #e4ebe6; border-radius: 16px; padding: clamp(24px, 5vw, 44px); box-shadow: 0 12px 40px rgba(20,50,30,.07); }
  .badge { display: inline-block; border-radius: 999px; background: #e8f5ec; color: #0a5c37; padding: 7px 11px; font-size: 10px; letter-spacing: 1px; font-weight: 800; }
  h1 { font-size: clamp(25px, 5vw, 34px); margin: 18px 0 10px; }
  p { color: #718078; line-height: 1.7; font-size: 14px; }
  .account { margin-top: 28px; border: 1px solid #edf0ed; border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 7px; }
  .account span { color: #718078; font-size: 11px; }
  .account strong { font-size: 14px; overflow-wrap: anywhere; }
  .next { margin-top: 18px; background: #f4f8f5; border-radius: 10px; padding: 16px; color: #526259; font-size: 13px; line-height: 1.6; }
</style>
