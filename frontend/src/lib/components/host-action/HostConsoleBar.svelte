<script>
  import AccountMenu from "$lib/app/AccountMenu.svelte";
  import { capabilityEvidence } from "$lib/app/capabilities.mjs";
  import { capabilitySentence } from "$lib/app/presentation-copy.mjs";
  import { buildHostConsoleBarViewModel } from "./host-console-bar.mjs";

  export let shell = null;
  export let capability = null;
  export let game;
  export let phase = {};
  export let liveStatus = null;
  export let nowSeconds = null;
  export let attentionCount = 0;
  export let tasks = [];
  export let decisions = [];
  export let postAvailable = false;
  /** `(taskId, invoker)`: open that task's canvas; the invoker gets focus back. */
  export let onOpenTask = () => {};
  /** `(invoker)`: move to the host composer. */
  export let onPost = () => {};

  // The rare tools live in one popover (usage-frequency audit, decision 12):
  // it closes on Escape, on an outside pointer press, and after any choice.
  let toolsMenu = null;
  $: view = buildHostConsoleBarViewModel({ game, phase, nowSeconds, attentionCount, tasks, decisions, postAvailable });
  $: degraded = liveStatus !== null && !["connected", "updated", "recovered"].includes(liveStatus.state);

  function closeTools({ focusSummary = false } = {}) {
    if (toolsMenu) toolsMenu.open = false;
    if (focusSummary) toolsMenu?.querySelector("summary")?.focus();
  }

  function chooseTool(event, id) {
    const invoker = event.currentTarget;
    closeTools();
    onOpenTask(id, invoker);
  }

  function onToolsKeydown(event) {
    if (event.key === "Escape" && toolsMenu?.open) {
      event.preventDefault();
      event.stopPropagation();
      closeTools({ focusSummary: true });
    }
  }

  function onDocumentPointerDown(event) {
    if (toolsMenu?.open && !toolsMenu.contains(event.target)) closeTools();
  }
</script>

<svelte:document on:pointerdown={onDocumentPointerDown} />

<header class="host-console-bar" data-testid={view.root.testId} data-game-bar>
  <div class="host-console-bar__identity">
    <span>{view.gameLabel}</span>
    <h1>{view.title}</h1>
    <span
      class="fm-sr-only"
      data-testid="host-console-capability"
      data-capability-kind={capabilityEvidence(capability).kind}
      data-capability-scope={capabilityEvidence(capability).scope}
    >{capabilitySentence(capability, { gameTitle: game.label })}</span>
  </div>
  <div class="host-console-bar__side">
    <dl class="host-console-bar__facts" aria-label="Host state">
      <div data-testid={view.attention.testId} data-state={view.attention.state}>
        <dt>{view.attention.label}</dt>
        <dd>{view.attention.value}</dd>
      </div>
      {#if view.deadline}
        <div data-testid={view.deadline.testId}>
          <dt>{view.deadline.label}</dt>
          <dd>{view.deadline.value}</dd>
          {#if view.deadline.detail}<span class="fm-sr-only">{view.deadline.detail}</span>{/if}
        </div>
      {/if}
    </dl>
    {#if degraded}
      <p class="host-console-bar__connection" data-state={liveStatus.state} data-testid="host-live-status">
        {liveStatus.state === "connecting" ? "Reconnecting…" : liveStatus.message}
      </p>
    {/if}
    {#if shell}<AccountMenu {shell} includeNavigation />{/if}
  </div>
  <div class="host-console-bar__tools" role="group" aria-label={view.toolRow.ariaLabel} data-testid={view.toolRow.testId}>
    <button
      type="button"
      class="host-console-bar__tool host-console-bar__tool--post"
      data-testid={view.post.testId}
      data-min-touch-target-px="44"
      disabled={!view.post.available}
      on:click={(event) => onPost(event.currentTarget)}
    >{view.post.label}</button>
    {#each view.routine as tool (tool.id)}
      <button
        type="button"
        class="host-console-bar__tool"
        data-testid={tool.testId}
        data-task-id={tool.id}
        data-due={tool.due}
        data-min-touch-target-px="44"
        disabled={!tool.available}
        on:click={(event) => chooseTool(event, tool.id)}
      >{tool.label}</button>
    {/each}
    <details class="host-console-bar__menu" data-testid={view.tools.testId} bind:this={toolsMenu} on:keydown={onToolsKeydown}>
      <summary class="host-console-bar__tool" data-min-touch-target-px="44">{view.tools.label}</summary>
      <div class="host-console-bar__menu-items" data-testid={view.tools.menuTestId}>
        {#each view.tools.items as tool (tool.id)}
          <button
            type="button"
            class="host-console-bar__menu-item"
            data-testid={tool.testId}
            data-task-id={tool.id}
            data-due={tool.due}
            data-min-touch-target-px="44"
            disabled={!tool.available}
            on:click={(event) => chooseTool(event, tool.id)}
          >{tool.label}</button>
        {/each}
      </div>
    </details>
  </div>
  <slot />
</header>
