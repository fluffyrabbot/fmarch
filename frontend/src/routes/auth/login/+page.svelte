<script>
  export let data;

  $: chooser = data?.chooser ?? {};
  $: returnTo = chooser.returnTo ?? "/";
  $: classicQuery = buildQuery({ returnTo, account: chooser.accountId });
  $: workosQuery = buildQuery({ returnTo, loginHint: chooser.accountId });

  function buildQuery({ returnTo, account, loginHint }) {
    const query = new URLSearchParams({ returnTo });
    if (typeof account === "string" && account !== "") query.set("account", account);
    if (typeof loginHint === "string" && loginHint !== "") query.set("loginHint", loginHint);
    return query.toString();
  }
</script>

<svelte:head>
  <title>fmarch sign in</title>
</svelte:head>

<main class="fm-surface auth-chooser" data-testid="auth-login-surface">
  <section class="fm-surface__masthead">
    <div>
      <p class="fm-eyebrow">Auth</p>
      <h1>Sign in</h1>
      <p class="fm-summary">Choose how to sign in to this server.</p>
    </div>
  </section>

  <section class="auth-chooser__panel fm-panel" aria-label="Sign-in methods">
    {#if chooser.principalUserId}
      <p class="auth-chooser__status" data-testid="auth-login-current-session">
        Current session: {chooser.principalUserId}
      </p>
    {/if}

    <div class="auth-chooser__methods">
      <article class="auth-chooser__method" data-testid="auth-method-classic">
        <h2>Classic — direct sign-in</h2>
        <p>
          Your credentials and sessions stay on this server. No third-party
          identity provider is contacted.
        </p>
        <a
          class="fm-touch-button"
          href={`/auth/login/classic?${classicQuery}`}
          data-testid="auth-login-classic-link"
        >
          Sign in with account and password
        </a>
      </article>

      {#if chooser.workosAvailable}
        <article class="auth-chooser__method" data-testid="auth-method-workos">
          <h2>WorkOS — managed sign-in</h2>
          <p>
            Sign in through the WorkOS identity provider configured for this
            server.
          </p>
          <a
            class="fm-touch-button"
            href={`/auth/login/workos?${workosQuery}`}
            data-testid="auth-login-workos-link"
          >
            Sign in with WorkOS
          </a>
        </article>
      {/if}
    </div>

    <nav class="auth-chooser__links" aria-label="Account help">
      <a href={`/auth/account/recovery?returnTo=${encodeURIComponent(returnTo)}`}>Forgot password?</a>
      <a href={`/auth/register?returnTo=${encodeURIComponent(returnTo)}`}>Create account</a>
      <a href={`/auth/invite?returnTo=${encodeURIComponent(returnTo)}`}>Use an invitation</a>
    </nav>
  </section>
</main>

<style>
  .auth-chooser {
    align-content: start;
    margin-inline: auto;
    max-inline-size: 880px;
    min-block-size: 100svh;
    width: 100%;
  }

  .auth-chooser__panel {
    max-inline-size: 560px;
  }

  .auth-chooser__methods {
    display: grid;
    gap: 16px;
  }

  .auth-chooser__method {
    border: 1px solid var(--fm-line-soft);
    border-radius: 10px;
    display: grid;
    gap: 10px;
    padding: 16px;
  }

  .auth-chooser__method h2 {
    font-size: 16px;
    margin: 0;
  }

  .auth-chooser__method p {
    font-size: 13px;
    line-height: 1.4;
    margin: 0;
  }

  .auth-chooser__status {
    background: var(--fm-accent-wash);
    border: 1px solid var(--fm-accent-soft);
    border-radius: 8px;
    color: var(--fm-accent-ink);
    font-size: 13px;
    font-weight: 800;
    line-height: 1.3;
    margin: 0 0 14px;
    padding: 10px 12px;
  }

  .auth-chooser__links {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 20px;
    margin-block-start: 18px;
  }
</style>
