<script>
  export let data;
  export let form;

  $: logout = data?.logout ?? {};
  $: returnTo = form?.returnTo ?? logout.returnTo ?? "/";
</script>

<svelte:head>
  <title>fmarch sign out</title>
</svelte:head>

<main class="fm-surface logout" data-testid="auth-logout-surface">
  <section class="fm-surface__masthead">
    <div>
      <p class="fm-eyebrow">Account</p>
      <h1>Sign out</h1>
      <p class="fm-summary" data-testid="auth-logout-principal">Signed in as {logout.principalUserId}</p>
    </div>
  </section>

  <form method="POST" class="logout__form" data-testid="auth-logout-form">
    <input type="hidden" name="returnTo" value={returnTo} />
    {#if form?.state === "reject"}
      <p class="logout__reject" role="alert" data-testid="auth-logout-reject">{form.message}</p>
    {/if}
    <button type="submit" class="fm-touch-button" data-testid="auth-logout-submit">Sign out</button>
  </form>
</main>

<style>
  .logout {
    align-content: start;
    margin-inline: auto;
    max-inline-size: 680px;
    min-block-size: 100svh;
    width: 100%;
  }

  .logout__form {
    display: grid;
    gap: 14px;
    max-inline-size: 360px;
  }

  .logout__reject {
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
