<script>
  // The host's frequent write: a post into the public main thread, in flow
  // after the thread like the player composer (usage-frequency audit,
  // decision 11). No confirmation: it is a post, not a game decision.
  import AppStatus from "$lib/app/AppStatus.svelte";
  import CommandRecovery from "$lib/app/CommandRecovery.svelte";
  import { visibleHostCommandStatus } from "./host-command-status.mjs";

  /** The authoritative host post action, or null when the host cannot post. */
  export let action = null;
  export let ready = false;
  export let body = "";
  export let status = null;
  export let onCommand = () => {};
  export let onRetry = () => {};
  export let onCancel = () => {};

  $: pending = status?.state === "pending";
  $: interrupted = status?.state === "interrupted";
  $: enabled = action !== null && ready === true;
  $: canPost = enabled && !pending && !interrupted && body.trim() !== "";
  $: visibleStatus = visibleHostCommandStatus(status, action?.label ?? "Post");

  function submit() {
    if (!canPost) return;
    onCommand({ actionId: action.id, payload: { ...action.payload, body: body.trim() } });
  }
</script>

<section
  class="host-composer"
  id="host-composer"
  data-testid="host-composer"
  data-enabled={enabled}
  aria-busy={pending ? "true" : undefined}
>
  <header>
    <p class="fm-eyebrow">Post as host</p>
    <h2>Main thread</h2>
  </header>
  <label class="fm-field">
    <span>Your post</span>
    <textarea
      bind:value={body}
      rows="4"
      data-testid="host-composer-body"
      disabled={!enabled}
    ></textarea>
  </label>
  <div class="host-composer__actions">
    <button
      type="button"
      class="fm-touch-button"
      data-action="publish_host_post"
      data-command-recovery-return="publish_host_post"
      data-min-touch-target-px="44"
      data-testid="host-composer-submit"
      disabled={!canPost}
      aria-disabled={canPost ? undefined : "true"}
      on:click={submit}
    >Post</button>
  </div>
  <div
    class="host-composer__status"
    data-testid="host-command-status-floor-publish_host_post"
    aria-hidden={visibleStatus ? undefined : "true"}
  >
    {#if visibleStatus}
      <AppStatus status={visibleStatus} testId="host-command-status-publish_host_post" />
      <CommandRecovery status={visibleStatus} {onRetry} {onCancel} />
    {/if}
  </div>
</section>
