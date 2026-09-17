<script>
  import { onDestroy } from "svelte";
  import AppStatus from "$lib/app/AppStatus.svelte";
  import CommandRecovery from "$lib/app/CommandRecovery.svelte";
  import { createReplacementChooser, replacementContext } from "./host-replacement-candidate.mjs";

  export let gameId;
  export let replacement = null;
  export let authority = null;
  export let completed = false;
  export let ready = false;
  export let onSelection = () => {};
  export let commandStatus = null;
  export let showRecovery = true;
  export let onRetry = () => {};
  export let onCancel = () => {};

  const chooser = createReplacementChooser({
    fetchImpl: (...args) => fetch(...args),
    onChange(next) { view = next; onSelection(next.candidate); },
  });
  let view = chooser.view();
  $: context = replacementContext({ gameId, replacement, authority, completed });
  $: chooser.setContext(context, ready);
  onDestroy(() => chooser.destroy());
</script>

{#if context || commandStatus}
  <details class="host-console-critical-path__drawer" data-testid="host-replacement-chooser">
    <summary><span>Replace a player</span><small>{replacement?.slotId ?? "Replacement"} / {replacement?.occupantLabel ?? "Command history"}</small></summary>
    <div class="host-console-critical-path__drawer-content">
      {#if context}
      <p>Choose an available member by their full public handle. The replacement keeps this slot’s history.</p>
      <form on:submit|preventDefault={() => chooser.lookup()}>
        <label class="fm-field">
          <span>Incoming member handle</span>
          <input name="replacementHandle" value={view.handle} on:input={(event) => chooser.setHandle(event.currentTarget.value)}
            autocomplete="off" spellcheck="false" placeholder="@handle" disabled={!view.available}
            data-testid="host-replacement-handle" />
        </label>
        <button class="touch-control" type="submit" disabled={!view.available || view.state === "pending"}
          data-testid="host-replacement-lookup">Find member</button>
      </form>
      {#if view.candidate}
        <p data-testid="host-replacement-candidate" data-handle={view.candidate.handle} data-slot-id={view.candidate.slotId}
          data-outgoing-persona-id={view.candidate.outgoingPersonaId}>
          <strong>{view.candidate.displayName} (@{view.candidate.handle})</strong>
          will replace {replacement.occupantLabel} in {replacement.slotId}.
        </p>
      {/if}
      <p role="status" data-testid="host-replacement-lookup-status" data-state={view.state}>
        {view.available ? view.message : "Replacement lookup is paused until host state is current."}
      </p>
      {/if}
      {#if commandStatus}
        <AppStatus status={commandStatus} testId="host-replacement-command-status" />
        {#if showRecovery}
          <CommandRecovery status={commandStatus} retryEnabled={ready} {onRetry} {onCancel} />
        {/if}
      {/if}
    </div>
  </details>
{/if}
