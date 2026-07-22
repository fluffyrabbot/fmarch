<script>
  export let data;
  export let form;

  $: login = data?.login ?? {};
  $: returnTo = form?.returnTo ?? login.returnTo ?? "/";
  $: rejection = form?.state === "reject" ? form.message : null;
  $: accountValue = login.accountId ?? "";
</script>

<svelte:head>
  <title>fmarch classic sign in</title>
</svelte:head>

<main class="fm-surface auth-login" data-testid="auth-login-classic-surface">
  <section class="fm-surface__masthead">
    <div>
      <p class="fm-eyebrow">Auth</p>
      <h1>Classic — direct sign-in</h1>
      <p class="fm-summary">
        Your credentials and sessions stay on this server. No third-party
        identity provider is contacted.
      </p>
    </div>
  </section>

  <section class="auth-login__panel fm-panel" aria-label="Account login">
    {#if login.principalUserId}
      <p class="auth-login__status" data-testid="auth-login-current-session">
        Current session: {login.principalUserId}
      </p>
    {/if}

    <form method="POST" class="auth-login__form" data-testid="auth-login-form">
      <input type="hidden" name="returnTo" value={returnTo} />
      <label class="auth-login__field fm-field">
        <span>Account</span>
        <input
          name="accountId"
          type="text"
          autocomplete="username"
          data-testid="auth-login-account"
          value={accountValue}
        />
      </label>

      <label class="auth-login__field fm-field">
        <span>Password</span>
        <input
          name="password"
          type="password"
          autocomplete="current-password"
          data-testid="auth-login-password"
        />
      </label>

      {#if rejection}
        <p class="auth-login__reject" role="alert" data-testid="auth-login-reject">
          {rejection}
        </p>
      {/if}

      <button
        type="submit"
        class="fm-touch-button"
        data-testid="auth-login-submit"
      >
        Sign in
      </button>
    </form>
    <nav class="auth-login__links" aria-label="Account help">
      <a href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>Other sign-in methods</a>
      <a href={`/auth/account/recovery?returnTo=${encodeURIComponent(returnTo)}`}>Forgot password?</a>
      <a href={`/auth/register?returnTo=${encodeURIComponent(returnTo)}`}>Create account</a>
      <a href={`/auth/invite?returnTo=${encodeURIComponent(returnTo)}`}>Use an invitation</a>
    </nav>
  </section>
</main>

<style>
  .auth-login {
    align-content: start;
    margin-inline: auto;
    max-inline-size: 880px;
    min-block-size: 100svh;
    width: 100%;
  }

  .auth-login__panel {
    max-inline-size: 560px;
  }

  .auth-login__form {
    display: grid;
    gap: 14px;
  }

  .auth-login__status,
  .auth-login__reject {
    border-radius: 8px;
    font-size: 13px;
    font-weight: 800;
    line-height: 1.3;
    margin: 0 0 14px;
    padding: 10px 12px;
  }

  .auth-login__links {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 20px;
    margin-block-start: 18px;
  }

  .auth-login__status {
    background: var(--fm-accent-wash);
    border: 1px solid var(--fm-accent-soft);
    color: var(--fm-accent-ink);
  }

  .auth-login__reject {
    background: var(--fm-danger-wash);
    border: 1px solid var(--fm-danger-soft);
    color: var(--fm-danger-ink);
    margin-block-end: 0;
  }
</style>
