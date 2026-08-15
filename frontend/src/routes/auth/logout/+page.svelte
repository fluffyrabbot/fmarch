<script>
  import { onMount } from "svelte";

  export let data;
  export let form;

  $: logout = data?.logout ?? {};
  $: returnTo = form?.returnTo ?? logout.returnTo ?? "/";
  $: providerLogoutUrl =
    form?.state === "provider_logout" && typeof form?.providerLogoutUrl === "string"
      ? form.providerLogoutUrl
      : null;

  onMount(() => {
    if (providerLogoutUrl !== null) {
      window.location.replace(providerLogoutUrl);
    }
  });
</script>

<svelte:head>
  <title>fmarch sign out</title>
</svelte:head>

<main class="fm-surface logout" data-testid="auth-logout-surface">
  {#if providerLogoutUrl !== null}
    <section
      class="logout__continuation"
      aria-live="polite"
      data-testid="auth-provider-logout-continuation"
    >
      <p class="fm-eyebrow">Account</p>
      <h1>Finishing sign out</h1>
      <p class="fm-summary">Continue to the identity provider to finish signing out.</p>
      <a
        class="fm-touch-button logout__continuation-link"
        data-testid="auth-provider-logout-continue"
        href={providerLogoutUrl}
        rel="noreferrer"
      >Continue signing out</a>
    </section>
  {:else}
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
  {/if}
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

  .logout__continuation {
    align-items: start;
    display: grid;
    gap: 14px;
    max-inline-size: 480px;
  }

  .logout__continuation h1,
  .logout__continuation p {
    margin: 0;
  }

  .logout__continuation-link {
    inline-size: fit-content;
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
