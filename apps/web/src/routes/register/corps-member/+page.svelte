<script lang="ts">
  import { goto } from '$app/navigation';
  import {
    ApiError,
    verifyCorpsMemberIdentity,
    sendCorpsMemberOtp,
    verifyCorpsMemberOtp,
    registerCorpsMember
  } from '#lib/api/client.ts';

  let stage = $state(1);
  let stateCode = $state('');
  let dateOfBirth = $state('');
  let callUpNumber = $state('');
  let challengeToken = $state('');
  let channel = $state<'email' | 'sms'>('email');
  let code = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let otpRequested = $state(false);
  let submitting = $state(false);
  let errorMessage = $state('');
  let noticeMessage = $state('');

  function showError(error: unknown, fallback: string) {
    errorMessage = error instanceof ApiError ? error.message : fallback;
  }

  async function submitIdentity(event: SubmitEvent) {
    event.preventDefault();
    errorMessage = '';
    noticeMessage = '';
    submitting = true;
    try {
      const result = await verifyCorpsMemberIdentity({
        stateCode,
        dateOfBirth,
        callUpNumber
      });
      challengeToken = result.challengeToken;
      stage = 2;
    } catch (error) {
      showError(error, 'Unable to process the identity check. Please try again.');
    } finally {
      submitting = false;
    }
  }

  async function requestOtp() {
    errorMessage = '';
    noticeMessage = '';
    submitting = true;
    try {
      await sendCorpsMemberOtp(challengeToken, channel);
      otpRequested = true;
      noticeMessage = 'If your details matched an eligible Corps Member record with this contact method, a verification code has been sent. In local development, check the API terminal for the test code.';
    } catch (error) {
      showError(error, 'Unable to process the OTP request. Please try again.');
    } finally {
      submitting = false;
    }
  }

  function updateOtp(value: string) {
    // Keep only six digits so pasted spaces or other characters cannot
    // trigger the browser's native pattern-validation tooltip.
    code = value.replace(/\\D/g, '').slice(0, 6);
  }

  async function confirmOtp(event: SubmitEvent) {
    event.preventDefault();
    errorMessage = '';
    if (!/^\\d{6}$/.test(code)) {
      errorMessage = 'Enter the six-digit verification code.';
      return;
    }
    submitting = true;
    try {
      await verifyCorpsMemberOtp(challengeToken, code.trim());
      stage = 3;
      noticeMessage = 'Your contact has been verified. Create your password to finish registration.';
    } catch (error) {
      showError(error, 'The code could not be verified. Check it and try again.');
    } finally {
      submitting = false;
    }
  }

  async function finishRegistration(event: SubmitEvent) {
    event.preventDefault();
    errorMessage = '';
    noticeMessage = '';
    if (password !== confirmPassword) {
      errorMessage = 'The passwords do not match.';
      return;
    }
    submitting = true;
    try {
      await registerCorpsMember(challengeToken, password);
      await goto('/corps-member');
    } catch (error) {
      showError(error, 'Unable to complete registration. Please start again or contact your LGI.');
    } finally {
      submitting = false;
      password = '';
      confirmPassword = '';
    }
  }
</script>

<svelte:head>
  <title>Corps Member Registration | NYSC CDS Platform</title>
  <meta name="description" content="Verify your existing NYSC Corps Member record and create your platform account." />
</svelte:head>

<main class="page">
  <section class="card">
    <a class="brand" href="/">NYSC CDS <span>Management Platform</span></a>
    <p class="eyebrow">CORPS MEMBER ONBOARDING</p>
    <h1>Create your account</h1>
    <p class="intro">Your LGI must have already created your Corps Member record before you can register.</p>

    <div class="steps" aria-label="Registration progress">
      <div class:active={stage >= 1} class:current={stage === 1}><span>1</span>Identity</div>
      <div class:active={stage >= 2} class:current={stage === 2}><span>2</span>OTP</div>
      <div class:active={stage >= 3} class:current={stage === 3}><span>3</span>Password</div>
    </div>

    {#if errorMessage}
      <div class="alert error" role="alert">{errorMessage}</div>
    {/if}
    {#if noticeMessage}
      <div class="alert notice" role="status">{noticeMessage}</div>
    {/if}

    {#if stage === 1}
      <form onsubmit={submitIdentity}>
        <label for="stateCode">NYSC State Code</label>
        <input id="stateCode" bind:value={stateCode} placeholder="e.g. AB/26A/001" autocomplete="off" required disabled={submitting} />

        <label for="dob">Date of Birth</label>
        <input id="dob" type="date" bind:value={dateOfBirth} required disabled={submitting} />

        <label for="callUpNumber">Call-up Number</label>
        <input id="callUpNumber" bind:value={callUpNumber} placeholder="Enter your call-up number" autocomplete="off" required disabled={submitting} />

        <button disabled={submitting || !stateCode.trim() || !dateOfBirth || !callUpNumber.trim()}>
          {submitting ? 'Checking details…' : 'Continue'}
        </button>
      </form>
    {:else if stage === 2}
      <div class="stage-copy">
        <h2>Verify your contact</h2>
        <p>Choose the email address or phone number already recorded for you by your LGI. The platform will send a one-time code if your details match an eligible record.</p>
      </div>

      <label for="channel">Send code by</label>
      <select id="channel" bind:value={channel} disabled={submitting}>
        <option value="email">Email</option>
        <option value="sms">SMS</option>
      </select>
      <button class="secondary" type="button" onclick={requestOtp} disabled={submitting}>
        {submitting ? 'Requesting code…' : otpRequested ? 'Resend code' : 'Send verification code'}
      </button>

      {#if otpRequested}
        <form onsubmit={confirmOtp}>
          <label for="otp">Six-digit verification code</label>
          <input id="otp" value={code} oninput={(event) => updateOtp(event.currentTarget.value)} inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" required disabled={submitting} />
          <button disabled={submitting || !/^\d{6}$/.test(code.trim())}>
            {submitting ? 'Verifying…' : 'Verify code'}
          </button>
        </form>
      {/if}
    {:else}
      <div class="stage-copy">
        <h2>Set your password</h2>
        <p>Your contact has been verified. Create a password to secure your Corps Member account.</p>
      </div>
      <form onsubmit={finishRegistration}>
        <label for="password">Password</label>
        <input id="password" type="password" bind:value={password} minlength="12" maxlength="128" autocomplete="new-password" required disabled={submitting} />
        <small>Use at least 12 characters.</small>

        <label for="confirmPassword">Confirm password</label>
        <input id="confirmPassword" type="password" bind:value={confirmPassword} minlength="12" maxlength="128" autocomplete="new-password" required disabled={submitting} />

        <button disabled={submitting || password.length < 12 || password !== confirmPassword}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    {/if}

    <p class="footer">Already registered? <a href="/login">Sign in</a></p>
  </section>
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #f3f6f4; color: #17251c; font-family: Inter, Arial, sans-serif; }
  .page { min-height: 100vh; min-height: 100svh; display: grid; place-items: center; padding: 24px 16px; }
  .card { width: min(100%, 520px); background: #fff; border: 1px solid #e4ebe6; border-radius: 16px; padding: clamp(24px, 5vw, 40px); box-shadow: 0 12px 40px rgba(20,50,30,.07); }
  .brand { display: inline-flex; flex-direction: column; gap: 3px; color: #0a5c37; font-size: 17px; font-weight: 800; text-decoration: none; margin-bottom: 36px; }
  .brand span { color: #718078; font-size: 12px; font-weight: 400; }
  .eyebrow { color: #0a8050; font-size: 10px; font-weight: 700; letter-spacing: 1.5px; margin: 0 0 10px; }
  h1 { margin: 0 0 8px; font-size: clamp(26px, 5vw, 32px); }
  .intro,.stage-copy p { color: #718078; font-size: 14px; line-height: 1.6; margin: 0 0 24px; }
  .steps { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin: 26px 0; }
  .steps div { display: flex; align-items: center; gap: 7px; color: #929d95; font-size: 12px; border-bottom: 2px solid #e7ede8; padding-bottom: 10px; }
  .steps span { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: #edf1ee; font-weight: 700; }
  .steps .active { color: #0a5c37; border-color: #0a8050; }
  .steps .active span { background: #e5f3eb; color: #0a5c37; }
  label { display: block; font-size: 13px; font-weight: 650; margin: 18px 0 8px; }
  input,select { width: 100%; min-height: 48px; border: 1px solid #dce5de; border-radius: 8px; padding: 0 13px; font: inherit; font-size: 14px; background: #fff; }
  input:focus,select:focus { outline: none; border-color: #0a8050; box-shadow: 0 0 0 3px rgba(10,128,80,.09); }
  button { width: 100%; min-height: 49px; margin-top: 22px; border: 0; border-radius: 8px; background: #0a5c37; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; }
  button.secondary { margin-top: 12px; background: #e8f3ec; color: #0a5c37; }
  button:disabled { opacity: .6; cursor: not-allowed; }
  small { color: #718078; display: block; margin-top: 6px; font-size: 11px; }
  .alert { border-radius: 8px; padding: 12px; font-size: 13px; line-height: 1.5; margin: 16px 0; }
  .error { color: #9d2424; border: 1px solid #f0cccc; background: #fff1f1; }
  .notice { color: #155b37; border: 1px solid #cfe6d7; background: #eff8f1; }
  .stage-copy h2 { margin: 0 0 8px; font-size: 20px; }
  .footer { margin: 28px 0 0; padding-top: 20px; border-top: 1px solid #edf0ed; color: #718078; font-size: 12px; text-align: center; }
  .footer a { color: #0a5c37; font-weight: 700; text-decoration: none; }
</style>
