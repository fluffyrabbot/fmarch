<script>
  export let data;
  export let form;

  $: invite = data?.invite ?? {};
  $: returnTo = form?.returnTo ?? invite.returnTo ?? "/";
  $: accountValue = form?.accountId ?? invite.accountId ?? "";
  $: rejection = form?.state === "reject" ? form.message : null;
</script>

<svelte:head>
  <title>fmarch invitation</title>
</svelte:head>

<main class="fm-surface auth-invite" data-testid="auth-invite-surface">
  <section class="fm-surface__masthead">
    <div>
      <p class="fm-eyebrow">Auth</p>
      <h1>Use an invitation</h1>
      <p class="fm-summary">Redeem an invitation issued to your account, or continue with an existing session credential.</p>
    </div>
  </section>

  <section class="auth-invite__panel fm-panel" aria-label="Invitation redemption">
    {#if invite.principalUserId}
      <p class="auth-invite__status">Current session: {invite.principalUserId}</p>
    {/if}
    <form method="POST" class="auth-invite__form" data-testid="auth-invite-form">
      <input type="hidden" name="returnTo" value={returnTo} />
      <label class="fm-field">
        <span>Invitation or session credential</span>
        <input name="token" type="password" autocomplete="one-time-code" value={invite.inviteToken ?? ""} data-testid="auth-invite-token" />
      </label>
      <label class="fm-field">
        <span>Invited account</span>
        <input name="accountId" type="text" autocomplete="username" value={accountValue} data-testid="auth-invite-account" />
      </label>
      <label class="fm-field">
        <span>Password</span>
        <input name="password" type="password" autocomplete="current-password" data-testid="auth-invite-password" />
      </label>
      {#if rejection}
        <p class="auth-invite__reject" role="alert" data-testid="auth-invite-reject">{rejection}</p>
      {/if}
      <button type="submit" class="fm-touch-button" data-testid="auth-invite-submit">Continue</button>
    </form>
    <a class="auth-invite__back" href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>Back to account sign in</a>
  </section>
</main>

<style>
  .auth-invite {
    align-content: start;
    margin-inline: auto;
    max-inline-size: 880px;
    min-block-size: 100svh;
    width: 100%;
  }

  .auth-invite__panel {
    max-inline-size: 560px;
  }

  .auth-invite__form {
    display: grid;
    gap: 14px;
  }

  .auth-invite__status,
  .auth-invite__reject {
    border-radius: 8px;
    font-size: 13px;
    font-weight: 800;
    line-height: 1.3;
    margin: 0 0 14px;
    padding: 10px 12px;
  }

  .auth-invite__status {
    background: var(--fm-accent-wash);
    border: 1px solid var(--fm-accent-soft);
    color: var(--fm-accent-ink);
  }

  .auth-invite__reject {
    background: var(--fm-danger-wash);
    border: 1px solid var(--fm-danger-soft);
    color: var(--fm-danger-ink);
    margin-block-end: 0;
  }

  .auth-invite__back {
    display: inline-block;
    margin-block-start: 18px;
  }
</style>
