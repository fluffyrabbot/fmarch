<script>
  export let data;
  export let form;

  $: recovery = data?.accountRecovery ?? {};
  $: accountId = form?.accountId ?? recovery.accountId ?? "";
  $: returnTo = form?.returnTo ?? recovery.returnTo ?? "/";
  $: rejection = form?.state === "reject" ? form.message : null;
</script>

<svelte:head>
  <title>fmarch account recovery</title>
</svelte:head>

<main class="fm-surface account-recovery" data-testid="account-recovery-surface">
  <section class="fm-surface__masthead">
    <div>
      <p class="fm-eyebrow">Account</p>
      <h1>Recovery</h1>
    </div>
  </section>

  <section class="account-recovery__panel fm-panel" aria-label="Account recovery">
    <form method="POST" class="account-recovery__form" data-testid="account-recovery-form">
      <input type="hidden" name="returnTo" value={returnTo} />
      <label class="fm-field">
        <span>Account</span>
        <input
          name="accountId"
          type="text"
          autocomplete="username"
          data-testid="account-recovery-account"
          value={accountId}
        />
      </label>

      <label class="fm-field">
        <span>Recovery credential</span>
        <input
          name="recoveryToken"
          type="password"
          autocomplete="one-time-code"
          data-testid="account-recovery-token"
        />
      </label>

      <label class="fm-field">
        <span>New password</span>
        <input
          name="newPassword"
          type="password"
          autocomplete="new-password"
          minlength="12"
          data-testid="account-recovery-new-password"
        />
      </label>

      <label class="fm-field">
        <span>Confirm new password</span>
        <input
          name="confirmPassword"
          type="password"
          autocomplete="new-password"
          minlength="12"
          data-testid="account-recovery-confirm-password"
        />
      </label>

      {#if rejection}
        <p class="account-recovery__reject" role="alert" data-testid="account-recovery-reject">
          {rejection}
        </p>
      {/if}

      <button type="submit" class="fm-touch-button" data-testid="account-recovery-submit">
        Recover account
      </button>
    </form>
  </section>
</main>

<style>
  .account-recovery {
    align-content: start;
    margin-inline: auto;
    max-inline-size: 880px;
    min-block-size: 100svh;
    width: 100%;
  }

  .account-recovery__panel {
    max-inline-size: 560px;
  }

  .account-recovery__form {
    display: grid;
    gap: 14px;
  }

  .account-recovery__reject {
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
