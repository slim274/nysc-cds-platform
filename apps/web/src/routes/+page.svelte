<svelte:head>
  <title>NYSC CDS Management Platform</title>
  <meta
    name="description"
    content="Centralised NYSC CDS administration and management."
  />
</svelte:head>

<main>
  <div class="container">
    <div class="brand">
      <div class="logo">N</div>

      <div>
        <strong>NYSC CDS</strong>
        <span>Management Platform</span>
      </div>
    </div>

    <section class="hero">
      <span class="eyebrow">DIGITAL CDS ADMINISTRATION</span>

      <h1>
        Simplifying Corps Member
        <span>Management.</span>
      </h1>

      <p>
        A centralised platform for corps member administration,
        CDS group allocation, attendance management and
        monthly clearance readiness.
      </p>

      <a href="/login">Access Administration Portal →</a>
    </section>

    <footer>
      NYSC CDS Management Platform · Version 0.1.0
    </footer>
  </div>
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    background: #f5f7f5;
    color: #17251c;
    font-family: Inter, Arial, sans-serif;
  }

  main {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 30px;
  }

  .container {
    width: 100%;
    max-width: 1050px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .logo {
    width: 43px;
    height: 43px;
    display: grid;
    place-items: center;
    background: #0a5c37;
    color: white;
    border-radius: 10px;
    font-size: 21px;
    font-weight: 800;
  }

  .brand strong,
  .brand span {
    display: block;
  }

  .brand strong {
    color: #0a5c37;
    font-size: 15px;
  }

  .brand span {
    margin-top: 4px;
    color: #819087;
    font-size: 11px;
  }

  .hero {
    max-width: 690px;
    padding: 120px 0 110px;
  }

  .eyebrow {
    color: #0a8050;
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 2px;
  }

  h1 {
    margin: 22px 0;
    font-size: clamp(37px, 6vw, 65px);
    line-height: 1.13;
    letter-spacing: -2px;
  }

  h1 span {
    display: block;
    color: #0a8050;
  }

  .hero p {
    max-width: 590px;
    margin-bottom: 32px;
    color: #718078;
    font-size: 15px;
    line-height: 1.9;
  }

  .hero a {
    display: inline-block;
    padding: 15px 22px;
    border-radius: 8px;
    background: #0a5c37;
    color: white;
    text-decoration: none;
    font-weight: 700;
    font-size: 13px;
  }

  .hero a:hover {
    background: #064526;
  }

  footer {
    padding-top: 22px;
    border-top: 1px solid #e0e8e1;
    color: #89948c;
    font-size: 11px;
    line-height: 1.5;
  }

  @media (max-width: 600px) {
    main {
      padding: 24px 18px;
    }

    .hero {
      padding: 76px 0 68px;
    }

    .eyebrow {
      font-size: 9px;
      letter-spacing: 1.5px;
    }

    h1 {
      margin: 18px 0;
      letter-spacing: -1.2px;
    }

    .hero p {
      margin-bottom: 26px;
      font-size: 14px;
      line-height: 1.75;
    }

    .hero a {
      min-height: 48px;
      padding: 15px 18px;
      line-height: 1.3;
    }
  }
</style>
