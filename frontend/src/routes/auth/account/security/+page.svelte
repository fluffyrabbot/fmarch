<script>
  export let data;
  export let form;

  $: security = data?.accountSecurity ?? {};
  $: methods = security.methods ?? [];
  $: activeMethods = methods.filter((method) => method.status === "active");
  $: classicMethod = activeMethods.find((method) => method.kind === "classic_password") ?? null;
  $: accountId = form?.accountId ?? security.accountId ?? classicMethod?.loginName ?? "";
  $: returnTo = form?.returnTo ?? security.returnTo ?? "/";
  $: addClassicResult = form?.id === "account-method-add-classic" ? form : null;
  $: disableResult = form?.id === "account-method-disable" ? form : null;
  $: rotationRejection =
    form?.id === "account-password-rotation" && form?.state === "reject"
      ? form.message
      : null;
  $: recoveryIssue = form?.id === "account-recovery-issue" ? form : null;
  $: recoveryRevocation = form?.id === "account-recovery-revoke" ? form : null;

  function methodTitle(method) {
    return method.kind === "classic_password" ? "Classic — direct sign-in" : "WorkOS — managed sign-in";
  }

  function methodDetail(method) {
    if (method.kind === "classic_password") {
      return method.loginName ?? "account and password";
    }
    return method.displayLabel ?? "external identity";
  }
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

  <section class="account-security__panel fm-panel" aria-label="Sign-in methods">
    <h2>Sign-in methods</h2>
    <ul class="account-security__methods" data-testid="account-security-methods">
      {#each methods as method (method.methodId)}
        <li class="account-security__method" data-testid={`account-method-${method.kind}`}>
          <div>
            <strong>{methodTitle(method)}</strong>
            <small>{methodDetail(method)}</small>
            {#if method.status !== "active"}
              <small class="account-security__method-disabled">disabled</small>
            {/if}
          </div>
          {#if method.status === "active"}
            <form method="POST" action="?/disableMethod">
              <input type="hidden" name="methodId" value={method.methodId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button
                type="submit"
                class="fm-touch-button fm-touch-button--secondary"
                data-testid={`account-method-disable-${method.kind}`}
                disabled={activeMethods.length < 2}
                title={activeMethods.length < 2
                  ? "Add another sign-in method before removing this one"
                  : null}
              >
                Remove
              </button>
            </form>
          {/if}
        </li>
      {/each}
    </ul>
    {#if disableResult?.state === "ack"}
      <p class="account-security__status" data-testid="account-method-disable-status">
        {disableResult.message}
      </p>
    {:else if disableResult}
      <p class="account-security__reject" role="alert" data-testid="account-method-disable-reject">
        {disableResult.message}
      </p>
    {/if}

    {#if classicMethod === null}
      <form
        method="POST"
        action="?/addClassic"
        class="account-security__form"
        data-testid="account-method-add-classic-form"
      >
        <h3>Add Classic — direct sign-in</h3>
        <p class="account-security__hint">
          Your credentials and sessions stay on this server. No third-party
          identity provider is contacted. Adding Classic keeps this account
          reachable even if the identity provider is unavailable.
        </p>
        <input type="hidden" name="returnTo" value={returnTo} />
        <label class="fm-field">
          <span>Login name</span>
          <input
            name="loginName"
            type="email"
            autocomplete="username"
            data-testid="account-method-add-classic-login"
            value={addClassicResult?.accountId ?? ""}
          />
        </label>
        <label class="fm-field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autocomplete="new-password"
            minlength="12"
            data-testid="account-method-add-classic-password"
          />
        </label>
        <label class="fm-field">
          <span>Confirm password</span>
          <input
            name="confirmPassword"
            type="password"
            autocomplete="new-password"
            minlength="12"
            data-testid="account-method-add-classic-confirm"
          />
        </label>
        <button type="submit" class="fm-touch-button" data-testid="account-method-add-classic-submit">
          Add classic sign-in
        </button>
      </form>
    {/if}

    {#if addClassicResult?.state === "ack"}
      <div class="account-security__credential" data-testid="account-method-add-classic-ack">
        <strong>{addClassicResult.message}</strong>
        <ul class="account-security__recovery-codes" data-testid="account-method-recovery-codes">
          {#each addClassicResult.recoveryCodes as code}
            <li><code>{code}</code></li>
          {/each}
        </ul>
        <small>Each code can be used once to recover this account.</small>
      </div>
    {:else if addClassicResult?.state === "step-up"}
      <div class="account-security__reject" role="alert" data-testid="account-method-add-classic-step-up">
        <p>{addClassicResult.message}</p>
        <a href={`/auth/login?returnTo=${encodeURIComponent("/auth/account/security")}`}>
          Re-authenticate
        </a>
      </div>
    {:else if addClassicResult?.state === "reject"}
      <p class="account-security__reject" role="alert" data-testid="account-method-add-classic-reject">
        {addClassicResult.message}
      </p>
    {/if}
  </section>

  {#if classicMethod !== null}
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

  .account-security__form h3 {
    font-size: 15px;
    margin: 0;
  }

  .account-security__hint {
    font-size: 13px;
    line-height: 1.4;
    margin: 0;
  }

  .account-security__methods {
    display: grid;
    gap: 12px;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .account-security__method {
    align-items: center;
    border: 1px solid var(--fm-line-soft);
    border-radius: 10px;
    display: flex;
    gap: 12px;
    justify-content: space-between;
    padding: 12px 14px;
  }

  .account-security__method div {
    display: grid;
    gap: 4px;
  }

  .account-security__method small {
    font-size: 12px;
  }

  .account-security__method-disabled {
    color: var(--fm-danger-ink);
    font-weight: 800;
    text-transform: uppercase;
  }

  .account-security__recovery-codes {
    display: grid;
    gap: 6px;
    list-style: none;
    margin: 0;
    padding: 0;
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

  .account-security__reject p {
    margin: 0 0 6px;
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
