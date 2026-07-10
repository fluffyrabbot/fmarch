<script>
  export let data;
  export let form;

  $: security = data?.accountSecurity ?? {};
  $: accountId = form?.accountId ?? security.accountId ?? "";
  $: returnTo = form?.returnTo ?? security.returnTo ?? "/";
  $: rejection = form?.state === "reject" ? form.message : null;
</script>

<svelte:head>
  <title>fmarch account security</title>
</svelte:head>

<main class="fm-surface account-security" data-testid="account-security-surface">
  <section class="fm-surface__masthead">
    <div>
      <p class="fm-eyebrow">Account</p>
      <h1>Security</h1>
      <p class="fm-summary" data-testid="account-security-principal">
        Signed in as {security.principalUserId}
      </p>
    </div>
  </section>

  <section class="account-security__panel fm-panel" aria-label="Password rotation">
    <form method="POST" class="account-security__form" data-testid="account-security-form">
      <input type="hidden" name="returnTo" value={returnTo} />
      <label class="fm-field">
        <span>Account</span>
        <input
          name="accountId"
          type="text"
          autocomplete="username"
          data-testid="account-security-account"
          value={accountId}
        />
      </label>

      <label class="fm-field">
        <span>Current password</span>
        <input
          name="currentPassword"
          type="password"
          autocomplete="current-password"
          data-testid="account-security-current-password"
        />
      </label>

      <label class="fm-field">
        <span>New password</span>
        <input
          name="newPassword"
          type="password"
          autocomplete="new-password"
          minlength="12"
          data-testid="account-security-new-password"
        />
      </label>

      <label class="fm-field">
        <span>Confirm new password</span>
        <input
          name="confirmPassword"
          type="password"
          autocomplete="new-password"
          minlength="12"
          data-testid="account-security-confirm-password"
        />
      </label>

      {#if rejection}
        <p class="account-security__reject" role="alert" data-testid="account-security-reject">
          {rejection}
        </p>
      {/if}

      <button type="submit" class="fm-touch-button" data-testid="account-security-submit">
        Change password
      </button>
    </form>
  </section>
</main>

<style>
  .account-security {
    align-content: start;
    margin-inline: auto;
    max-inline-size: 880px;
    min-block-size: 100svh;
    width: 100%;
  }

  .account-security__panel {
    max-inline-size: 560px;
  }

  .account-security__form {
    display: grid;
    gap: 14px;
  }

  .account-security__reject {
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
