<script lang="ts">
  import { onMount } from 'svelte';

  let apiStatus = 'Checking API...';
  let apiError = '';

  onMount(async () => {
    try {
      const response = await fetch('/api/health');

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      apiStatus = data.status;
    } catch (error) {
      apiStatus = 'Unavailable';
      apiError = error instanceof Error
        ? error.message
        : 'Unable to connect to API';
    }
  });
</script>

<svelte:head>
  <title>NYSC CDS Platform</title>
  <meta
    name="description"
    content="NYSC CDS Management Platform"
  />
</svelte:head>

<main>
  <h1>NYSC CDS Management Platform</h1>

  <p>System connectivity test</p>

  <section>
    <h2>Backend API Status</h2>

    {#if apiStatus === 'healthy'}
      <p>🟢 API Connected Successfully</p>
    {:else}
      <p>🔴 {apiStatus}</p>
    {/if}

    {#if apiError}
      <small>{apiError}</small>
    {/if}
  </section>
</main>

<style>
  main {
    max-width: 800px;
    margin: 100px auto;
    padding: 24px;
    font-family: sans-serif;
  }

  section {
    margin-top: 30px;
    padding: 20px;
    border: 1px solid #ddd;
    border-radius: 10px;
  }
</style>