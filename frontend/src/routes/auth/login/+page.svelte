<script>
  export let data;
  export let form;

  $: login = data?.login ?? {};
  $: returnTo = form?.returnTo ?? login.returnTo ?? "/";
  $: rejection = form?.state === "reject" ? form.message : null;
  $: tokenValue = login.inviteToken ?? "";
  $: accountValue = login.accountId ?? "";
</script>

<svelte:head>
  <title>fmarch sign in</title>
</svelte:head>

<main class="fm-surface auth-login" data-testid="auth-login-surface">
  <section class="fm-surface__masthead">
    <div>
      <p class="fm-eyebrow">Auth</p>
      <h1>Sign in</h1>
      <p class="fm-summary">
        Use an opaque session, invite, or account credential issued through an authenticated identity flow.
      </p>
    </div>
  </section>

  <section class="auth-login__panel fm-panel" aria-label="Session token login">
    {#if login.principalUserId}
      <p class="auth-login__status" data-testid="auth-login-current-session">
        Current session: {login.principalUserId}
      </p>
    {/if}

    <form method="POST" class="auth-login__form" data-testid="auth-login-form">
      <input type="hidden" name="returnTo" value={returnTo} />
      <label class="auth-login__field fm-field">
        <span>Session or invite token</span>
        <input
          name="token"
          type="password"
          autocomplete="current-password"
          data-testid="auth-login-token"
          value={tokenValue}
        />
      </label>

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
