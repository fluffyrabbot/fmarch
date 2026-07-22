<script>
  export let game;
  export let phase = {};
  export let capabilityLabel = "";
  export let liveStatus = null;
  export let attentionCount = 0;

  $: degraded = liveStatus !== null && !["connected", "updated", "recovered"].includes(liveStatus.state);
</script>

<header class="host-console-bar" data-testid="host-console-bar">
  <div>
    <span>{game.label}</span>
    <h1>Host · {phase.label}</h1>
    <span class="fm-sr-only" data-testid="host-console-capability">{capabilityLabel}</span>
  </div>
  <dl>
    <div data-testid="host-console-attention"><dt>Attention</dt><dd>{attentionCount} tasks</dd></div>
    {#if phase.deadlineLabel}<div data-testid="host-console-bar-deadline"><dt>Deadline</dt><dd>{phase.deadlineLabel}</dd></div>{/if}
  </dl>
  {#if degraded}
    <p data-state={liveStatus.state} data-testid="host-live-status">
      {liveStatus.state === "connecting" ? "Reconnecting…" : liveStatus.message}
    </p>
  {/if}
</header>
