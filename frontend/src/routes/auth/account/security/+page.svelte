<script>
  export let data;
  export let form;

  $: security = data?.accountSecurity ?? {};
  $: accountId = form?.accountId ?? security.accountId ?? "";
  $: returnTo = form?.returnTo ?? security.returnTo ?? "/";
  $: rotationRejection =
    form?.id === "account-password-rotation" && form?.state === "reject"
      ? form.message
      : null;
  $: recoveryIssue = form?.id === "account-recovery-issue" ? form : null;
  $: recoveryRevocation = form?.id === "account-recovery-revoke" ? form : null;
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
    <a
      class="fm-touch-button fm-touch-button--secondary"
      data-testid="account-security-logout"
      href={`/auth/logout?returnTo=${encodeURIComponent(returnTo)}`}
    >
      Sign out
    </a>
  </section>

  {#if security.managedByWorkos}
    <section class="account-security__panel fm-panel" aria-label="Managed account security">
      <h2>Identity managed by WorkOS</h2>
      <p>Password, passkey, multi-factor authentication, and recovery controls are managed by your identity provider.</p>
    </section>
  {:else}
  <section class="account-security__panel fm-panel" aria-label="Password rotation">
    <form
      method="POST"
      action="?/rotatePassword"
      class="account-security__form"
      data-testid="account-security-form"
    >
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

      {#if rotationRejection}
        <p class="account-security__reject" role="alert" data-testid="account-security-reject">
          {rotationRejection}
        </p>
      {/if}

      <button type="submit" class="fm-touch-button" data-testid="account-security-submit">
        Change password
      </button>
    </form>
  </section>

  <section class="account-security__panel fm-panel" aria-label="Recovery credentials">
    <h2>Recovery credentials</h2>

    <form
      method="POST"
      action="?/issueRecovery"
      class="account-security__form"
      data-testid="account-recovery-issue-form"
    >
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <label class="fm-field">
        <span>Current password</span>
        <input
          name="currentPassword"
          type="password"
          autocomplete="current-password"
          data-testid="account-recovery-issue-password"
        />
      </label>
      <button
        type="submit"
        class="fm-touch-button"
        data-testid="account-recovery-issue-submit"
      >
        Create recovery credential
      </button>
    </form>

    {#if recoveryIssue?.state === "ack"}
      <div class="account-security__credential" data-testid="account-recovery-issued">
        <strong>Recovery credential</strong>
        <code data-testid="account-recovery-issued-token">{recoveryIssue.recoveryToken}</code>
        <small data-testid="account-recovery-issued-id">{recoveryIssue.recoveryId}</small>
      </div>
    {:else if recoveryIssue?.state === "reject"}
      <p class="account-security__reject" role="alert" data-testid="account-recovery-issue-reject">
        {recoveryIssue.message}
      </p>
    {/if}

    <form
      method="POST"
      action="?/revokeRecovery"
      class="account-security__form account-security__revoke-form"
      data-testid="account-recovery-revoke-form"
    >
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <label class="fm-field">
        <span>Recovery ID</span>
        <input
          name="recoveryId"
          type="text"
          data-testid="account-recovery-revoke-id"
        />
      </label>
      <label class="fm-field">
        <span>Current password</span>
        <input
          name="currentPassword"
          type="password"
          autocomplete="current-password"
          data-testid="account-recovery-revoke-password"
        />
      </label>
      <button
        type="submit"
        class="fm-touch-button fm-touch-button--secondary"
        data-testid="account-recovery-revoke-submit"
      >
        Revoke credential
      </button>
    </form>

    {#if recoveryRevocation?.state === "ack"}
      <p class="account-security__status" data-testid="account-recovery-revoke-status">
        Recovery credential revoked
      </p>
    {:else if recoveryRevocation?.state === "reject"}
      <p class="account-security__reject" role="alert" data-testid="account-recovery-revoke-reject">
        {recoveryRevocation.message}
      </p>
    {/if}
  </section>
  {/if}
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
    display: grid;
    gap: 18px;
    max-inline-size: 560px;
  }

  .account-security__panel h2 {
    font-size: 18px;
    margin: 0;
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

  .account-security__credential,
  .account-security__status {
    background: var(--fm-accent-wash);
    border: 1px solid var(--fm-accent-soft);
    border-radius: 8px;
    color: var(--fm-accent-ink);
    display: grid;
    gap: 8px;
    margin: 0;
    overflow-wrap: anywhere;
    padding: 12px;
  }

  .account-security__credential code {
    font-size: 12px;
    white-space: normal;
  }

  .account-security__revoke-form {
    border-block-start: 1px solid var(--fm-border);
    padding-block-start: 18px;
  }
</style>
