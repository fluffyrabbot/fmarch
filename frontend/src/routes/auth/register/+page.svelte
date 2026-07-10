<script>
  export let data;
  export let form;

  $: registration = data?.registration ?? {};
  $: accountId = form?.accountId ?? registration.accountId ?? "";
  $: returnTo = form?.returnTo ?? registration.returnTo ?? "/";
  $: rejection = form?.state === "reject" ? form.message : null;
</script>

<svelte:head>
  <title>fmarch create account</title>
</svelte:head>

<main class="fm-surface auth-register" data-testid="auth-registration-surface">
  <section class="fm-surface__masthead">
    <div>
      <p class="fm-eyebrow">Account</p>
      <h1>Create account</h1>
      <p class="fm-summary">Create a local account, then use the role invitation issued for your game.</p>
    </div>
  </section>

  <section class="auth-register__panel fm-panel" aria-label="Account registration">
    <form method="POST" class="auth-register__form" data-testid="auth-registration-form">
      <input type="hidden" name="returnTo" value={returnTo} />
      <label class="fm-field">
        <span>Account</span>
        <input
          name="accountId"
          type="email"
          autocomplete="username"
          data-testid="auth-registration-account"
          value={accountId}
        />
      </label>
      <label class="fm-field">
        <span>Password</span>
        <input
          name="password"
          type="password"
          autocomplete="new-password"
          minlength="12"
          data-testid="auth-registration-password"
        />
      </label>
      <label class="fm-field">
        <span>Confirm password</span>
        <input
          name="confirmPassword"
          type="password"
          autocomplete="new-password"
          minlength="12"
          data-testid="auth-registration-confirm-password"
        />
      </label>
      {#if rejection}
        <p class="auth-register__reject" role="alert" data-testid="auth-registration-reject">
          {rejection}
        </p>
      {/if}
      <button type="submit" class="fm-touch-button" data-testid="auth-registration-submit">
        Create account
      </button>
    </form>
  </section>
</main>

<style>
  .auth-register {
    align-content: start;
    margin-inline: auto;
    max-inline-size: 880px;
    min-block-size: 100svh;
    width: 100%;
  }

  .auth-register__panel {
    max-inline-size: 560px;
  }

  .auth-register__form {
    display: grid;
    gap: 14px;
  }

  .auth-register__reject {
    background: var(--fm-danger-wash);
    border: 1px solid var(--fm-danger-soft);
    border-radius: 8px;
    color: var(--fm-danger-ink);
    font-size: 13px;
    font-weight: 800;
    line-height: 1.3;
    margin: 0;
    padding: 10px 12px;
  }
</style>
