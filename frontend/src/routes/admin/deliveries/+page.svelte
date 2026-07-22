<script>
  import { buildAuthDeliveryQueueView } from "./auth-delivery-queue.mjs";

  export let data;
  export let form;

  $: queue = buildAuthDeliveryQueueView(data.deliveries);
</script>

<svelte:head><title>Auth deliveries · Admin</title></svelte:head>

<main class="delivery-queue" data-testid="admin-auth-delivery-queue">
  <header class="delivery-queue__header">
    <div>
      <p class="fm-eyebrow">Admin · Identity delivery</p>
      <h1>Delivery exceptions</h1>
      <p>Review failed or cancelled invite and recovery delivery without exposing credentials.</p>
    </div>
    <a class="fm-touch-button fm-touch-button--secondary" href="/admin">Back to operations</a>
  </header>

  {#if form?.message}
    <p class="fm-well" data-state={form.state} role="status">{form.message}</p>
  {/if}

  {#if queue.empty}
    <section class="fm-panel"><h2>Queue clear</h2><p>No undelivered credentials need operator review.</p></section>
  {:else}
    <section class="delivery-queue__list" aria-label="Auth delivery exceptions">
      {#each queue.items as item}
        <article class="fm-panel" data-status={item.status} data-testid={`auth-delivery-${item.id}`}>
          <header>
            <div><p class="fm-eyebrow">{item.kind} · {item.accountId}</p><h2>{item.statusLabel}</h2></div>
            <strong>{item.attemptCount} {item.attemptCount === 1 ? "attempt" : "attempts"}</strong>
          </header>
          <dl>
            <div><dt>Principal</dt><dd>{item.principalUserId}</dd></div>
            <div><dt>Provider</dt><dd>{item.providerId}</dd></div>
            <div><dt>Outcome</dt><dd>{item.outcomeCode ?? "awaiting attempt"}</dd></div>
          </dl>
          {#if data.canRetry && item.retryEligible}
            <form method="POST" action="?/retry">
              <input type="hidden" name="deliveryId" value={item.id} />
              <button class="fm-touch-button" type="submit">Retry delivery</button>
            </form>
          {:else if item.status === "retryable_failed"}
            <p class="delivery-queue__note">Retry is unavailable until the backoff window and credential checks pass.</p>
          {/if}
        </article>
      {/each}
    </section>
  {/if}
</main>

<style>
  .delivery-queue { display: grid; gap: 22px; margin-inline: auto; max-inline-size: 1040px; padding: clamp(20px, 4vw, 48px); }
  .delivery-queue__header, .delivery-queue__list article > header { align-items: start; display: flex; gap: 18px; justify-content: space-between; }
  .delivery-queue__header h1, .delivery-queue__header p, .delivery-queue__list h2, .delivery-queue__list p { margin: 0; }
  .delivery-queue__header > div { display: grid; gap: 7px; }
  .delivery-queue__list { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); }
  .delivery-queue__list article { display: grid; gap: 16px; }
  .delivery-queue__list article > header strong { color: var(--fm-ink-muted); font-size: 12px; }
  dl { display: grid; gap: 8px; margin: 0; }
  dl > div { display: grid; gap: 8px; grid-template-columns: 86px minmax(0, 1fr); }
  dt { color: var(--fm-ink-muted); font-size: 12px; font-weight: 800; }
  dd { margin: 0; overflow-wrap: anywhere; }
  .delivery-queue__note { color: var(--fm-ink-muted); font-size: 13px; }
  @media (max-width: 620px) { .delivery-queue__header { display: grid; } }
</style>
