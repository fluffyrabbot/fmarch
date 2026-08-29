<script>
  export let data;
  export let form;

  $: admission = data?.admission ?? {};
  $: invitationReady = form?.invitationReady ?? admission.invitationReady ?? false;
  $: accountId = form?.accountId ?? admission.accountId ?? "";
  $: returnTo = form?.returnTo ?? admission.returnTo ?? "/";
  $: rejection = form?.state === "reject" ? form.message : null;
</script>

<svelte:head><title>fmarch community invitation</title></svelte:head>

<main class="fm-surface auth-admission" data-testid="community-invitation-surface">
  <section class="fm-surface__masthead">
    <div>
      <p class="fm-eyebrow">Community admission</p>
      <h1>Accept an invitation</h1>
      <p class="fm-summary">Registration is available only through a current member’s invitation.</p>
    </div>
  </section>
  <section class="fm-panel auth-admission__panel" aria-label="Community invitation">
    <form method="POST" class="auth-admission__form">
      <input type="hidden" name="returnTo" value={returnTo} />
      <label class="fm-field">
        <span>Invitation credential</span>
        <input name="invitationCredential" type="password" autocomplete="one-time-code" disabled={invitationReady} data-testid="community-invitation-credential" />
      </label>
      {#if invitationReady}<p>Your invitation credential is ready.</p>{/if}
      <label class="fm-field">
        <span>Invited account</span>
        <input name="accountId" type="email" autocomplete="username" value={accountId} data-testid="community-invitation-account" />
      </label>
      {#if rejection}<p role="alert" data-testid="community-invitation-reject">{rejection}</p>{/if}
      <button class="fm-touch-button" type="submit" data-testid="community-invitation-continue">Choose sign-in method</button>
    </form>
  </section>
</main>

<style>
  .auth-admission { align-content: start; margin-inline: auto; max-inline-size: 880px; min-block-size: 100svh; width: 100%; }
  .auth-admission__panel { max-inline-size: 560px; }
  .auth-admission__form { display: grid; gap: 14px; }
</style>
