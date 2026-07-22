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
  <title>fmarch create account</title>
</svelte:head>

<main class="fm-surface auth-chooser" data-testid="auth-registration-surface">
  <section class="fm-surface__masthead">
    <div>
      <p class="fm-eyebrow">Account</p>
      <h1>Create account</h1>
      <p class="fm-summary">Choose how to create your account on this server.</p>
    </div>
  </section>

  <section class="auth-chooser__panel fm-panel" aria-label="Registration methods">
    <div class="auth-chooser__methods">
      <article class="auth-chooser__method" data-testid="auth-method-classic">
        <h2>Classic — direct sign-in</h2>
        <p>
          Your credentials and sessions stay on this server. No third-party
          identity provider is contacted.
        </p>
        <a
          class="fm-touch-button"
          href={`/auth/register/classic?${classicQuery}`}
          data-testid="auth-registration-classic-link"
        >
          Create account with a password
        </a>
      </article>

      {#if chooser.workosAvailable}
        <article class="auth-chooser__method" data-testid="auth-method-workos">
          <h2>WorkOS — managed sign-in</h2>
          <p>
            Create an account through the WorkOS identity provider configured
            for this server.
          </p>
          <a
            class="fm-touch-button"
            href={`/auth/register/workos?${workosQuery}`}
            data-testid="auth-registration-workos-link"
          >
            Continue with WorkOS
          </a>
        </article>
      {/if}
    </div>

    <nav class="auth-chooser__links" aria-label="Account help">
      <a href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>Already have an account?</a>
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

  .auth-chooser__links {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 20px;
    margin-block-start: 18px;
  }
</style>
