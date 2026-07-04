<script>
  import AppStatus from "$lib/app/AppStatus.svelte";
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  import RouteState from "$lib/app/RouteState.svelte";
  import {
    buildRouteStateViewModel,
  } from "$lib/app/app-route-state-model.mjs";
  import {
    buildSetupCommandDispatchBridgePlan,
    clearSetupCommandStatus,
    exposeSetupRouteWindowState,
    recordSetupCommandStatus,
    recordSetupFormStatus,
    refreshSetupState,
    sendHostSetupCommand,
    setupConfirmStatus,
    setupPendingStatus,
    setupRejectStatus,
  } from "./setup-route-controller.mjs";
  import {
    HOST_SETUP_ROUTE_CONTRACT,
    buildHostSetupReadiness,
    occupiedSetupInviteTargets,
  } from "./setup-route-model.mjs";

  export let data;
  export let form;

  let commandStatuses = {};
  let lastFormStatusKey = "";
  let lastInviteFormKey = "";
  let setupState = data.setupState;
  let readiness = data.readiness;
  let pendingStartFormData = null;

  $: forcedRouteState = data.routeState
    ? buildRouteStateViewModel(data.routeState)
    : null;
  $: inviteTargets = occupiedSetupInviteTargets(setupState);
  $: mainPolicy = readiness.mainPolicy;
  $: roleKeys = setupState.pack.roleKeys;

  $: if (form?.playerInvite && setupFormKey(form.playerInvite) !== lastInviteFormKey) {
    lastInviteFormKey = setupFormKey(form.playerInvite);
    const inviteResult = {
      id: `invite-${form.playerInvite.slotId ?? "player"}`,
      ...form.playerInvite,
    };
    const result = recordSetupFormStatus({
      commandStatuses,
      form: inviteResult,
      lastFormStatusKey,
    });
    lastFormStatusKey = result.lastFormStatusKey;
    commandStatuses = result.commandStatuses;
  }

  $: if (typeof window !== "undefined") {
    exposeSetupRouteWindowState({
      windowRef: window,
      commandStatuses,
      setupState,
      readiness,
    });
  }

  function setupFormKey(value) {
    return `${value?.state ?? ""}:${value?.message ?? ""}:${value?.loginPath ?? ""}`;
  }

  async function handleSetupSubmit(event, actionId) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await submitSetupCommand(actionId, formData);
  }

  function reviewStart(event) {
    event.preventDefault();
    pendingStartFormData = new FormData(event.currentTarget);
    commandStatuses = recordSetupCommandStatus(
      commandStatuses,
      "start-game",
      setupConfirmStatus("start-game", `Start ${data.game.id} at ${pendingStartFormData.get("phase")}`),
    );
  }

  async function confirmStart() {
    if (pendingStartFormData === null) {
      return;
    }
    await submitSetupCommand("start-game", pendingStartFormData);
    pendingStartFormData = null;
  }

  function cancelStart() {
    pendingStartFormData = null;
    commandStatuses = clearSetupCommandStatus(commandStatuses, "start-game");
  }

  async function submitSetupCommand(actionId, formData) {
    const confirmationStatus =
      commandStatuses[actionId]?.confirmationTrace == null
        ? null
        : commandStatuses[actionId];
    const optimisticStatus = setupPendingStatus();
    commandStatuses = recordSetupCommandStatus(
      commandStatuses,
      actionId,
      optimisticStatus,
    );

    try {
      const outcome = await sendHostSetupCommand({
        actionId,
        data,
        formData,
        fetchImpl: fetch,
      });
      commandStatuses = recordSetupCommandStatus(commandStatuses, actionId, outcome);
      if (outcome.state === "ack") {
        try {
          const refreshed = await refreshSetupState({ data, fetchImpl: fetch });
          setupState = refreshed.setupState;
          readiness = refreshed.readiness;
        } catch {
          readiness = buildHostSetupReadiness(setupState);
        }
      }
      if (typeof window !== "undefined") {
        const plan =
          confirmationStatus === null
            ? null
            : buildSetupCommandDispatchBridgePlan({
                actionId,
                data,
                formData,
                confirmationStatus,
                optimisticStatus,
                finalStatus: outcome,
              });
        exposeSetupRouteWindowState({
          windowRef: window,
          commandStatuses,
          setupState,
          readiness,
          outcome,
          plan,
        });
      }
    } catch (error) {
      const finalStatus = setupRejectStatus(error);
      commandStatuses = recordSetupCommandStatus(
        commandStatuses,
        actionId,
        finalStatus,
      );
    }
  }
</script>

<svelte:head>
  <title>{data.game.label} setup</title>
</svelte:head>

<main
  class="host-setup"
  data-testid={HOST_SETUP_ROUTE_CONTRACT.surfaceTestId}
  data-game={data.game.id}
>
  <AppSurfaceHeader header={data.surfaceHeader} />

  {#if forcedRouteState}
    <RouteState view={forcedRouteState} />
  {:else}
    <section class="host-setup__identity" aria-label="Game identity">
      <div>
        <p class="fm-eyebrow">Game</p>
        <h2>{setupState.game}</h2>
      </div>
      <div>
        <p class="fm-eyebrow">Pack</p>
        <h2>{setupState.pack.key}</h2>
        <p>{setupState.pack.name}</p>
      </div>
      <a class="fm-touch-button fm-touch-button--secondary" href={`/g/${data.game.id}/host`}>
        Host console
      </a>
    </section>

    <section class="host-setup__band" aria-label="Roster">
      <header class="host-setup__section-header">
        <div>
          <p class="fm-eyebrow">Roster</p>
          <h2>Slots and occupants</h2>
        </div>
        <form
          class="host-setup__inline-form"
          on:submit={(event) => handleSetupSubmit(event, "add-slot")}
        >
          <label>
            <span>Slot</span>
            <input name="slotId" value={`slot_${setupState.slots.length + 1}`} />
          </label>
          <button class="fm-touch-button" type="submit">Add slot</button>
        </form>
      </header>

      <div class="host-setup__table" data-testid="host-setup-roster">
        {#each setupState.slots as slot}
          <article class="host-setup__row" data-testid={`host-setup-slot-${slot.slotId}`}>
            <div>
              <strong>{slot.slotId}</strong>
              <span>{slot.occupantUserId ?? "Unoccupied"}</span>
            </div>
            <form
              class="host-setup__inline-form"
              on:submit={(event) => handleSetupSubmit(event, "assign-slot")}
            >
              <input type="hidden" name="slotId" value={slot.slotId} />
              <label>
                <span>Principal</span>
                <input
                  name="principalUserId"
                  value={slot.occupantUserId ?? ""}
                  placeholder="player_user"
                />
              </label>
              <button class="fm-touch-button fm-touch-button--secondary" type="submit">
                Assign
              </button>
            </form>
          </article>
        {/each}
      </div>
      {#if commandStatuses["add-slot"]}
        <AppStatus status={commandStatuses["add-slot"]} testId="host-setup-add-slot-status" />
      {/if}
      {#if commandStatuses["assign-slot"]}
        <AppStatus status={commandStatuses["assign-slot"]} testId="host-setup-assign-slot-status" />
      {/if}
    </section>

    <section class="host-setup__band" aria-label="Roles">
      <header class="host-setup__section-header">
        <div>
          <p class="fm-eyebrow">Roles</p>
          <h2>Pack role assignment</h2>
        </div>
        <p>{roleKeys.length} known role keys</p>
      </header>
      <div class="host-setup__table" data-testid="host-setup-roles">
        {#each setupState.slots as slot}
          <article class="host-setup__row">
            <div>
              <strong>{slot.slotId}</strong>
              <span>{slot.roleKey ?? "No role assigned"}</span>
            </div>
            <form
              class="host-setup__inline-form"
              on:submit={(event) => handleSetupSubmit(event, "assign-role")}
            >
              <input type="hidden" name="slotId" value={slot.slotId} />
              <label>
                <span>Role</span>
                <select name="roleKey">
                  {#each roleKeys as roleKey}
                    <option value={roleKey} selected={slot.roleKey === roleKey}>
                      {roleKey}
                    </option>
                  {/each}
                </select>
              </label>
              <button class="fm-touch-button fm-touch-button--secondary" type="submit">
                Assign role
              </button>
            </form>
          </article>
        {/each}
      </div>
      {#if commandStatuses["assign-role"]}
        <AppStatus status={commandStatuses["assign-role"]} testId="host-setup-assign-role-status" />
      {/if}
    </section>

    <section class="host-setup__band host-setup__two-column" aria-label="Policy and invites">
      <div>
        <p class="fm-eyebrow">Policy</p>
        <h2>Main channel posts</h2>
        <p data-testid="host-setup-main-policy">
          Media-only posts are {mainPolicy.allowMediaOnly ? "enabled" : "disabled"}.
        </p>
        <form on:submit={(event) => handleSetupSubmit(event, "set-post-policy")}>
          <input type="hidden" name="channelId" value="main" />
          <input
            type="hidden"
            name="allowMediaOnly"
            value={mainPolicy.allowMediaOnly ? "false" : "true"}
          />
          <button class="fm-touch-button" type="submit">
            {mainPolicy.allowMediaOnly ? "Disable media-only" : "Enable media-only"}
          </button>
        </form>
        {#if commandStatuses["set-post-policy"]}
          <AppStatus status={commandStatuses["set-post-policy"]} testId="host-setup-policy-status" />
        {/if}
      </div>

      <div>
        <p class="fm-eyebrow">Invites</p>
        <h2>Occupied slot invites</h2>
        <div class="host-setup__invite-list">
          {#each inviteTargets as target}
            <form
              class="host-setup__invite"
              method="POST"
              action="?/issuePlayerInvite"
              data-testid={`host-setup-invite-${target.slotId}`}
            >
              <input type="hidden" name="principalUserId" value={target.principalUserId} />
              <input type="hidden" name="slotId" value={target.slotId} />
              <input
                type="hidden"
                name="expectedOccupantUserId"
                value={target.expectedOccupantUserId}
              />
              <span>{target.targetLabel}</span>
              <button class="fm-touch-button fm-touch-button--secondary" type="submit">
                Issue invite
              </button>
            </form>
          {/each}
        </div>
        {#if form?.playerInvite}
          <p
            class="host-setup__invite-status"
            data-state={form.playerInvite.state}
            data-testid="host-setup-player-invite-status"
          >
            {form.playerInvite.message}
          </p>
          {#if form.playerInvite.loginUrl}
            <a href={form.playerInvite.loginUrl} data-testid="host-setup-player-invite-url">
              {form.playerInvite.loginUrl}
            </a>
          {:else if form.playerInvite.currentOccupantUserId}
            <form method="POST" action="?/issuePlayerInvite">
              <input
                type="hidden"
                name="principalUserId"
                value={form.playerInvite.currentOccupantUserId}
              />
              <input type="hidden" name="slotId" value={form.playerInvite.slotId} />
              <input
                type="hidden"
                name="expectedOccupantUserId"
                value={form.playerInvite.currentOccupantUserId}
              />
              <button class="fm-touch-button" type="submit">
                Issue current player invite
              </button>
            </form>
          {/if}
        {/if}
      </div>
    </section>

    <section class="host-setup__band host-setup__two-column" aria-label="Readiness and start">
      <div>
        <p class="fm-eyebrow">Readiness</p>
        <h2 data-testid="host-setup-readiness-summary">{readiness.summary}</h2>
        <ul class="host-setup__checklist">
          {#each readiness.checks as check}
            <li data-state={check.state} data-testid={`host-setup-readiness-${check.id}`}>
              <span>{check.label}</span>
              <strong>{check.state}</strong>
            </li>
          {/each}
        </ul>
      </div>

      <div>
        <p class="fm-eyebrow">Start</p>
        <h2>Start game</h2>
        <form on:submit={reviewStart}>
          <label>
            <span>Start phase</span>
            <select name="phase">
              {#each setupState.pack.startPhaseOptions as phase}
                <option value={phase} selected={phase === data.start.defaultPhase}>{phase}</option>
              {/each}
            </select>
          </label>
          <button
            class="fm-touch-button"
            type="submit"
            disabled={!readiness.startAvailable}
            aria-disabled={!readiness.startAvailable}
            data-testid="host-setup-start-review"
          >
            Review start
          </button>
        </form>
        {#if commandStatuses["start-game"]?.state === "confirm"}
          <div class="host-setup__confirm" data-testid="host-setup-start-confirmation">
            <span>{commandStatuses["start-game"].message}</span>
            <button class="fm-touch-button" type="button" on:click={confirmStart}>
              Start game
            </button>
            <button
              class="fm-touch-button fm-touch-button--secondary"
              type="button"
              on:click={cancelStart}
            >
              Cancel
            </button>
          </div>
        {:else if commandStatuses["start-game"]}
          <AppStatus status={commandStatuses["start-game"]} testId="host-setup-start-status" />
        {/if}
        {#if setupState.phase}
          <a class="fm-touch-button fm-touch-button--secondary" href={data.start.hostHref}>
            Open host console
          </a>
        {/if}
      </div>
    </section>
  {/if}
</main>

<style>
  .host-setup {
    display: grid;
    gap: 18px;
  }

  .host-setup__identity,
  .host-setup__band {
    background: #f7f8f5;
    border: 1px solid #c8d0c2;
    border-radius: 8px;
    display: grid;
    gap: 16px;
    padding: 16px;
  }

  .host-setup__identity {
    align-items: end;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  }

  .host-setup__section-header,
  .host-setup__row,
  .host-setup__inline-form,
  .host-setup__invite,
  .host-setup__confirm {
    align-items: end;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .host-setup__section-header,
  .host-setup__row {
    justify-content: space-between;
  }

  .host-setup__table,
  .host-setup__invite-list {
    display: grid;
    gap: 10px;
  }

  .host-setup__row,
  .host-setup__invite {
    background: #ffffff;
    border: 1px solid #d6ddd1;
    border-radius: 8px;
    min-block-size: 68px;
    padding: 12px;
  }

  .host-setup__row > div,
  .host-setup__invite-list {
    min-inline-size: min(100%, 260px);
  }

  .host-setup__row strong,
  .host-setup__row span,
  .host-setup__invite span,
  .host-setup__invite-status,
  .host-setup__confirm span {
    overflow-wrap: anywhere;
  }

  .host-setup label {
    display: grid;
    gap: 4px;
  }

  .host-setup input,
  .host-setup select {
    border: 1px solid #9eaaa0;
    border-radius: 6px;
    font: inherit;
    min-block-size: 44px;
    min-inline-size: min(100%, 220px);
    padding: 8px 10px;
  }

  .host-setup__two-column {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .host-setup__checklist {
    display: grid;
    gap: 8px;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .host-setup__checklist li {
    align-items: center;
    background: #ffffff;
    border: 1px solid #d6ddd1;
    border-radius: 8px;
    display: flex;
    justify-content: space-between;
    min-block-size: 44px;
    padding: 8px 10px;
  }

  .host-setup__checklist li[data-state="ready"] strong {
    color: #26643b;
  }

  .host-setup__checklist li[data-state="blocked"] strong {
    color: #8a3b2d;
  }

  @media (max-width: 820px) {
    .host-setup__identity,
    .host-setup__two-column {
      grid-template-columns: 1fr;
    }
  }
</style>
