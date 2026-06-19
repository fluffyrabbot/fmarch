<script>
  import HostAction from "$lib/components/host-action/HostAction.svelte";
  import {
    projectHostConsoleState,
    sendHostActionCommand,
  } from "$lib/components/host-action/host-command-boundary.mjs";
  import "$lib/components/host-action/host-console-critical-path.css";

  export let data;

  let dispatched = [];
  let commandOutcomes = [];
  let commandStatuses = {};
  let projection = {
    phase: data.phase,
    replacement: data.replacement,
  };

  $: if (typeof window !== "undefined") {
    window.__fmarchHostActionEvents = dispatched;
    window.__fmarchHostCommandOutcomes = commandOutcomes;
    window.__fmarchHostCommandStatuses = commandStatuses;
    window.__fmarchHostProjection = projection;
  }

  async function handleDispatch(event) {
    dispatched = [...dispatched, event];
    recordCommandStatus(event.actionId, {
      state: "pending",
      message: "Sending command",
    });

    try {
      const outcome = await sendHostActionCommand({
        actionEvent: event,
        principalUserId: data.session.principalUserId,
        endpoint: data.commandEndpoint,
        stateEndpoint: data.hostConsoleStateEndpoint,
        fetchImpl: fetch,
      });
      commandOutcomes = [...commandOutcomes, outcome];
      if (outcome.projectionState) {
        projection = projectHostConsoleState(outcome.projectionState, projection);
      }
      recordCommandStatus(event.actionId, outcome);
      window.dispatchEvent(
        new CustomEvent("host-command-result", {
          detail: outcome,
        }),
      );
    } catch (error) {
      const outcome = {
        state: "reject",
        actionId: event.actionId,
        error: "Internal",
        retryable: false,
        message: error.message,
      };
      commandOutcomes = [...commandOutcomes, outcome];
      recordCommandStatus(event.actionId, outcome);
    }
  }

  function recordCommandStatus(actionId, status) {
    commandStatuses = {
      ...commandStatuses,
      [actionId]: status,
    };
  }

  function commandStatusMessage(status) {
    if (status === undefined) {
      return "";
    }
    return status.message;
  }
</script>

<svelte:head>
  <title>{data.game.label} host console</title>
</svelte:head>

<main
  class="host-console-critical-path"
  data-component="host-console-route"
  data-game={data.game.id}
>
  <header class="host-console-critical-path__masthead">
    <div>
      <p class="host-console-critical-path__eyebrow">{data.game.label}</p>
      <h1>Host console</h1>
    </div>
    <span
      class="host-console-critical-path__capability"
      data-testid="host-console-capability"
    >
      {data.access.capabilityLabel}
    </span>
  </header>

  <section class="host-console-critical-path__phase" aria-labelledby="phase-heading">
    <p class="host-console-critical-path__eyebrow">{data.phase.state}</p>
    <h2 id="phase-heading">{data.phase.label}</h2>
    <p class="host-console-critical-path__status">{data.phase.summary}</p>
    <dl class="host-console-critical-path__facts">
      <div>
        <dt>Deadline</dt>
        <dd data-testid="host-console-deadline">
          {projection.phase.deadlineLabel}
        </dd>
      </div>
      <div>
        <dt>Slot 7 occupant</dt>
        <dd data-testid="host-console-slot-occupant">
          {projection.replacement.occupantLabel}
        </dd>
      </div>
      <div>
        <dt>Slot history</dt>
        <dd data-testid="host-console-history">
          {projection.replacement.historyLabel}
        </dd>
      </div>
    </dl>
  </section>

  <section class="host-console-critical-path__queues" aria-label="Host queues">
    {#each data.workQueues as queue}
      <article class="host-console-critical-path__queue">
        <h2>{queue.label}</h2>
        <p>{queue.value}</p>
      </article>
    {/each}
  </section>

  <section
    class="host-console-critical-path__actions"
    data-testid="critical-host-actions"
    aria-label="Critical host actions"
  >
    {#each data.criticalActions as action}
      <div data-testid={`critical-host-action-${action.id}`}>
        <HostAction {action} onDispatch={handleDispatch} />
        {#if commandStatuses[action.id]}
          <p
            class="host-console-critical-path__command-status"
            data-state={commandStatuses[action.id].state}
            data-testid={`host-command-status-${action.id}`}
          >
            {commandStatusMessage(commandStatuses[action.id])}
          </p>
        {/if}
      </div>
    {/each}
  </section>
</main>
