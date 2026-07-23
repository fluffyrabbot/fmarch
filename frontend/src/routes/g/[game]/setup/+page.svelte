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
  import { buildHostSetupWorkflow } from "./setup-workflow-model.mjs";

  export let data;
  export let form;

  let commandStatuses = {};
  let lastFormStatusKey = "";
  let lastInviteFormKey = "";
  let setupState = data.setupState;
  let readiness = data.readiness;
  let pendingStartFormData = null;
  let preferredStageId = null;

  $: forcedRouteState = data.routeState
    ? buildRouteStateViewModel(data.routeState)
    : null;
  $: inviteTargets = occupiedSetupInviteTargets(setupState);
  $: mainPolicy = readiness.mainPolicy;
  $: roleOptions = setupState.pack.roles;
  $: programOptions = setupState.programCatalog;
  $: attachableProgramOptions = programOptions.filter(
    (option) =>
      option.compatibility.attachable &&
      !setupState.attachedPrograms.some(
        (attached) => attached.id === option.id && attached.version === option.version,
      ),
  );
  $: workflow = buildHostSetupWorkflow({
    setupState,
    readiness,
    selectedStageId: preferredStageId,
  });

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

  function schedulePreviewLabel(preview) {
    if (!preview) return "Schedule preview unavailable";
    if (preview.mode === "host_opened") return "Host opens manually";
    if (preview.mode === "absolute") {
      const lock =
        preview.lockAt === null ? "" : `; locks ${formatUnixSeconds(preview.lockAt)}`;
      return `Opens ${formatUnixSeconds(preview.openAt)}${lock}`;
    }
    if (preview.mode === "relative_to_phase") {
      const lock =
        preview.lockOffset === null ? "" : `; locks +${preview.lockOffset}s`;
      return `Opens ${preview.phaseId} +${preview.openOffset}s${lock}`;
    }
    if (preview.mode === "on_trigger") {
      const kind = String(preview.trigger?.kind ?? "trigger").replaceAll("_", " ");
      const phase = preview.trigger?.phase_id ? `${preview.trigger.phase_id} ` : "";
      return `Opens when ${phase}${kind} fires`;
    }
    return preview.mode;
  }

  function formatUnixSeconds(value) {
    return Number.isFinite(value)
      ? new Date(value * 1000).toISOString().replace(".000Z", "Z")
      : "an invalid time";
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

  function selectStage(stageId) {
    preferredStageId = stageId;
  }

  function accountLabel(principalUserId) {
    return setupState.accounts.find((account) => account.principalUserId === principalUserId)?.label
      ?? "No account selected";
  }

  function accountIdForPrincipal(principalUserId) {
    return setupState.accounts.find((account) => account.principalUserId === principalUserId)?.accountId
      ?? "";
  }

  function roleLabel(roleKey) {
    return roleOptions.find((role) => role.key === roleKey)?.label ?? "No role assigned";
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
        setupState,
        fetchImpl: fetch,
      });
      commandStatuses = recordSetupCommandStatus(commandStatuses, actionId, outcome);
      if (outcome.state === "ack" || outcome.state === "reject") {
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
                setupState,
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
    <section
      class="host-setup__workflow"
      data-component={workflow.root.data.component}
      data-workflow-mode={workflow.root.data.mode}
      data-testid={workflow.root.testId}
    >
      <nav
        class="host-setup__stepper"
        aria-label="Setup stages"
        data-testid={workflow.stepper.testId}
      >
        <header>
          <div>
            <p class="fm-eyebrow">Guided setup</p>
            <h2>{workflow.stepper.label}</h2>
          </div>
          <strong>{workflow.stepper.progress}</strong>
        </header>
        <div class="host-setup__step-list">
          {#each workflow.stages as stage}
            <button
              type="button"
              data-state={stage.state}
              data-testid={stage.testId}
              aria-current={stage.id === workflow.selectedStageId ? "step" : undefined}
              aria-controls={stage.panelTestId}
              on:click={() => selectStage(stage.id)}
            >
              <span>{stage.number}</span>
              <strong>{stage.label}</strong>
              <small>{stage.statusLabel}</small>
            </button>
          {/each}
        </div>
        <a class="fm-touch-button fm-touch-button--secondary" href={`/g/${data.game.id}/host`}>
          Host console
        </a>
      </nav>

      <section class="host-setup__canvas" data-testid={workflow.canvas.testId}>
        {#each workflow.stages as stage}
          <section
            class="host-setup__stage"
            id={stage.panelTestId}
            data-stage-id={stage.id}
            data-state={stage.state}
            data-testid={stage.panelTestId}
            hidden={stage.id !== workflow.selectedStageId}
          >
            {#if stage.id === "pack"}
              <header class="host-setup__stage-header">
                <div><p class="fm-eyebrow">Stage 1</p><h2>Confirm the game pack</h2></div>
                <span data-state={stage.state}>{stage.statusLabel}</span>
              </header>
              <p>The pack defines the available roles and valid opening phases.</p>
              <dl class="host-setup__facts" data-testid="host-setup-pack">
                <div><dt>Game</dt><dd>{setupState.game}</dd></div>
                <div><dt>Pack</dt><dd>{setupState.pack.name}</dd></div>
                <div><dt>Pack key</dt><dd>{setupState.pack.key}</dd></div>
                <div><dt>Opening phases</dt><dd>{setupState.pack.startPhaseOptions.join(", ")}</dd></div>
              </dl>
            {:else if stage.id === "roster"}
              <header class="host-setup__stage-header">
                <div><p class="fm-eyebrow">Stage 2</p><h2>Seat the roster</h2></div>
                <span data-state={stage.state}>{stage.statusLabel}</span>
              </header>
              <p>Add the required slots and bind each seat to one player account.</p>
              <form
                class="host-setup__inline-form"
                data-testid="host-setup-add-slot-form"
                on:submit={(event) => handleSetupSubmit(event, "add-slot")}
              >
                <input type="hidden" name="slotId" value={`slot_${setupState.slots.length + 1}`} />
                <p>The next seat will be added as Slot {setupState.slots.length + 1}.</p>
                <button class="fm-touch-button" type="submit">Add next seat</button>
              </form>
              <div class="host-setup__card-list" data-testid="host-setup-roster">
                {#each setupState.slots as slot}
                  <article
                    class="host-setup__slot-card"
                    data-state={slot.occupantUserId ? "ready" : "blocked"}
                    data-testid={`host-setup-slot-${slot.slotId}`}
                  >
                    <div class="host-setup__slot-summary">
                      <div><p class="fm-eyebrow">Seat</p><h3>{slot.slotId.replace(/^slot[-_]?/i, "Slot ")}</h3></div>
                      <span class="host-setup__slot-state" data-state={slot.occupantUserId ? "ready" : "blocked"}>
                        {slot.occupantUserId ? "seated" : "needs player"}
                      </span>
                    </div>
                    <form class="host-setup__slot-form" on:submit={(event) => handleSetupSubmit(event, "assign-slot")}>
                      <input type="hidden" name="slotId" value={slot.slotId} />
                      <label class="fm-field">
                        <span>Player account</span>
                        <select name="principalUserId" required>
                          <option value="" selected={slot.occupantUserId === null} disabled>Choose an account</option>
                          {#each setupState.accounts as account}
                            <option value={account.principalUserId} selected={slot.occupantUserId === account.principalUserId}>
                              {account.label}
                            </option>
                          {/each}
                        </select>
                      </label>
                      <button class="fm-touch-button fm-touch-button--secondary" type="submit">Assign player</button>
                    </form>
                  </article>
                {/each}
              </div>
              {#if commandStatuses["add-slot"]}<AppStatus status={commandStatuses["add-slot"]} testId="host-setup-add-slot-status" />{/if}
              {#if commandStatuses["assign-slot"]}<AppStatus status={commandStatuses["assign-slot"]} testId="host-setup-assign-slot-status" />{/if}
              <div class="host-setup__invite-list">
                <h3>Player access</h3>
                {#each inviteTargets as target}
                  <form class="host-setup__invite" method="POST" action="?/issuePlayerInvite" data-testid={`host-setup-invite-${target.slotId}`}>
                    <input type="hidden" name="principalUserId" value={target.principalUserId} />
                    <input type="hidden" name="accountId" value={target.accountId} />
                    <input type="hidden" name="slotId" value={target.slotId} />
                    <input type="hidden" name="expectedOccupantUserId" value={target.expectedOccupantUserId} />
                    <span>{target.targetLabel}</span>
                    <button class="fm-touch-button fm-touch-button--secondary" type="submit">Issue invite</button>
                  </form>
                {/each}
                {#if form?.playerInvite}
                  <p class="host-setup__invite-status" data-state={form.playerInvite.state} data-testid="host-setup-player-invite-status">{form.playerInvite.message}</p>
                  {#if form.playerInvite.deliveryStatus}
                    <p data-testid="host-setup-player-invite-delivery">Delivery: {form.playerInvite.deliveryStatus}</p>
                  {/if}
                  {#if form.playerInvite.loginUrl}
                    <a href={form.playerInvite.loginUrl} data-testid="host-setup-player-invite-url">{form.playerInvite.loginUrl}</a>
                  {:else if form.playerInvite.currentOccupantUserId}
                    <form method="POST" action="?/issuePlayerInvite">
                      <input type="hidden" name="principalUserId" value={form.playerInvite.currentOccupantUserId} />
                      <input type="hidden" name="accountId" value={accountIdForPrincipal(form.playerInvite.currentOccupantUserId)} />
                      <input type="hidden" name="slotId" value={form.playerInvite.slotId} />
                      <input type="hidden" name="expectedOccupantUserId" value={form.playerInvite.currentOccupantUserId} />
                      <button class="fm-touch-button" type="submit">Issue current player invite</button>
                    </form>
                  {/if}
                {/if}
              </div>
            {:else if stage.id === "roles"}
              <header class="host-setup__stage-header">
                <div><p class="fm-eyebrow">Stage 3</p><h2>Assign the roles</h2></div>
                <span data-state={stage.state}>{stage.statusLabel}</span>
              </header>
              <p>Choose one pack-defined role for every slot. These assignments stay host-private.</p>
              <div class="host-setup__card-list" data-testid="host-setup-roles">
                {#each setupState.slots as slot}
                  <article class="host-setup__role-card" data-testid={`host-setup-role-${slot.slotId}`}>
                    <div><p class="fm-eyebrow">{accountLabel(slot.occupantUserId)}</p><h3>{roleLabel(slot.roleKey)}</h3></div>
                    <form class="host-setup__slot-form" on:submit={(event) => handleSetupSubmit(event, "assign-role")}>
                      <input type="hidden" name="slotId" value={slot.slotId} />
                      <label class="fm-field">
                        <span>Role</span>
                        <select name="roleKey">
                          {#each roleOptions as role}
                            <option value={role.key} selected={slot.roleKey === role.key}>{role.label}</option>
                          {/each}
                        </select>
                      </label>
                      <button class="fm-touch-button fm-touch-button--secondary" type="submit">Assign role</button>
                    </form>
                  </article>
                {/each}
              </div>
              {#if commandStatuses["assign-role"]}<AppStatus status={commandStatuses["assign-role"]} testId="host-setup-assign-role-status" />{/if}
            {:else if stage.id === "rules"}
              <header class="host-setup__stage-header">
                <div><p class="fm-eyebrow">Stage 4</p><h2>Set game rules</h2></div>
                <span data-state={stage.state}>{stage.statusLabel}</span>
              </header>
              <p>Confirm the posting policy players will use in the main channel.</p>
              <div class="host-setup__rule-card">
                <p class="fm-eyebrow">Main channel posts</p>
                <h3 data-testid="host-setup-main-policy">Media-only posts are {mainPolicy.allowMediaOnly ? "enabled" : "disabled"}.</h3>
                <form on:submit={(event) => handleSetupSubmit(event, "set-post-policy")}>
                  <input type="hidden" name="channelId" value="main" />
                  <input type="hidden" name="allowMediaOnly" value={mainPolicy.allowMediaOnly ? "false" : "true"} />
                  <button class="fm-touch-button" type="submit">{mainPolicy.allowMediaOnly ? "Disable media-only" : "Enable media-only"}</button>
                </form>
                {#if commandStatuses["set-post-policy"]}<AppStatus status={commandStatuses["set-post-policy"]} testId="host-setup-policy-status" />{/if}
              </div>
            {:else if stage.id === "program"}
              <header class="host-setup__stage-header">
                <div><p class="fm-eyebrow">Stage 5 · Optional</p><h2>Attach a day program</h2></div>
                <span data-state={stage.state}>{stage.statusLabel}</span>
              </header>
              <p>Preview and attach immutable event definitions for the mash. You can skip this stage for a manual game.</p>
              {#if programOptions.length === 0}
                <p data-testid="host-setup-program-empty">No day programs are available.</p>
              {:else}
                <div class="host-setup__card-list" data-testid="host-setup-program-catalog">
                  {#each programOptions as option}
                    <article class="host-setup__role-card" data-testid={`host-setup-program-${option.id}-${option.version}`}>
                      <div>
                        <p class="fm-eyebrow">{option.id} · v{option.version}</p>
                        <h3>{option.displayName}</h3>
                      </div>
                      <p>{option.eventCount} event{option.eventCount === 1 ? "" : "s"}</p>
                      {#if !option.compatibility.attachable}
                        <div data-testid={`host-setup-program-incompatible-${option.id}-${option.version}`}>
                          <strong>Unavailable for {setupState.pack.name}</strong>
                          <ul>
                            {#each option.compatibility.issues as issue}
                              <li>{issue.eventId ? `${issue.eventId}: ` : ""}{issue.message}</li>
                            {/each}
                          </ul>
                        </div>
                      {/if}
                      <ul class="host-setup__checklist">
                        {#each option.document.events as event}
                          <li>
                            <span>{event.id}</span>
                            <strong>{event.template_key}</strong>
                            <small>{schedulePreviewLabel(option.schedulePreviews.find((preview) => preview.eventId === event.id))}</small>
                          </li>
                        {/each}
                      </ul>
                      {#if setupState.attachedPrograms.some((attached) => attached.id === option.id && attached.version === option.version)}
                        <span class="host-setup__slot-state" data-state="ready">Attached</span>
                      {/if}
                    </article>
                  {/each}
                </div>
                {#if attachableProgramOptions.length > 0}
                  <form
                    class="host-setup__inline-form"
                    data-testid="host-setup-attach-program-form"
                    on:submit={(event) => handleSetupSubmit(event, "attach-day-program")}
                  >
                    <label class="fm-field">
                      <span>Day program</span>
                      <select name="programId">
                        {#each attachableProgramOptions as option}
                          <option value={`${option.id}@${option.version}`}>
                            {option.displayName} v{option.version}
                          </option>
                        {/each}
                      </select>
                    </label>
                    <button class="fm-touch-button" type="submit">Attach program</button>
                  </form>
                {/if}
                {#if setupState.attachedPrograms.length > 0}
                  <dl class="host-setup__facts" data-testid="host-setup-attached-programs">
                    {#each setupState.attachedPrograms as program}
                      <div>
                        <dt>{program.displayName} v{program.version}</dt>
                        <dd>{program.eventCount} immutable event{program.eventCount === 1 ? "" : "s"}</dd>
                      </div>
                    {/each}
                  </dl>
                {/if}
              {/if}
              {#if commandStatuses["attach-day-program"]}
                <AppStatus status={commandStatuses["attach-day-program"]} testId="host-setup-program-status" />
              {/if}
            {:else}
              <header class="host-setup__stage-header">
                <div><p class="fm-eyebrow">Stage 6</p><h2>Review and start</h2></div>
                <span data-state={stage.state}>{stage.statusLabel}</span>
              </header>
              <h3 data-testid="host-setup-readiness-summary">{readiness.summary}</h3>
              <ul class="host-setup__checklist">
                {#each readiness.checks as check}
                  <li data-state={check.state} data-testid={`host-setup-readiness-${check.id}`}>
                    <span>{check.label}</span>
                    {#if check.state === "ready"}
                      <strong>ready</strong>
                    {:else}
                      <button type="button" data-testid={`host-setup-correction-${check.id}`} on:click={() => selectStage(workflow.corrections.find((item) => item.checkId === check.id)?.stageId ?? "review")}>Fix in {workflow.stages.find((item) => item.id === (workflow.corrections.find((correction) => correction.checkId === check.id)?.stageId ?? "review"))?.label}</button>
                    {/if}
                  </li>
                {/each}
              </ul>
              <form class="host-setup__start-form" on:submit={reviewStart}>
                <label class="fm-field">
                  <span>Start phase</span>
                  <select name="phase">
                    {#each setupState.pack.startPhaseOptions as phase}
                      <option value={phase} selected={phase === data.start.defaultPhase}>{phase}</option>
                    {/each}
                  </select>
                </label>
                <button class="fm-touch-button" type="submit" disabled={!readiness.startAvailable} aria-disabled={!readiness.startAvailable} data-testid="host-setup-start-review">Review start</button>
              </form>
              {#if commandStatuses["start-game"]?.state === "confirm"}
                <div class="host-setup__confirm" data-testid="host-setup-start-confirmation">
                  <span>{commandStatuses["start-game"].message}</span>
                  <button class="fm-touch-button" type="button" on:click={confirmStart}>Start game</button>
                  <button class="fm-touch-button fm-touch-button--secondary" type="button" on:click={cancelStart}>Cancel</button>
                </div>
              {:else if commandStatuses["start-game"]}
                <AppStatus status={commandStatuses["start-game"]} testId="host-setup-start-status" />
              {/if}
              {#if setupState.phase}
                <a class="fm-touch-button fm-touch-button--secondary" href={data.start.hostHref}>Open host console</a>
                <a class="fm-touch-button" href="/" data-testid="host-setup-view-board">View game on board</a>
              {/if}
            {/if}
          </section>
        {/each}
      </section>
    </section>
  {/if}
</main>

<style>
  .host-setup {
    display: grid;
    gap: 18px;
  }

  .host-setup__workflow {
    align-items: start;
    display: grid;
    gap: 28px;
    grid-template-columns: 260px minmax(0, 1fr);
    margin-inline: auto;
    max-inline-size: 1180px;
    padding: 0 clamp(16px, 4vw, 34px) 48px;
    width: 100%;
  }

  .host-setup__stepper,
  .host-setup__canvas {
    background: var(--fm-surface-tint);
    border: 1px solid var(--fm-line-soft);
    border-radius: 12px;
  }

  .host-setup__stepper {
    display: grid;
    gap: 14px;
    padding: 16px;
    position: sticky;
    top: calc(var(--fm-app-topbar-block-size) + 16px);
  }

  .host-setup__stepper header,
  .host-setup__stage-header,
  .host-setup__inline-form,
  .host-setup__slot-form,
  .host-setup__invite,
  .host-setup__confirm,
  .host-setup__start-form {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .host-setup__stepper header,
  .host-setup__stage-header {
    justify-content: space-between;
  }

  .host-setup__stepper h2,
  .host-setup__stage h2,
  .host-setup__stage h3,
  .host-setup__stage p {
    margin: 0;
  }

  .host-setup__stepper header > strong {
    color: var(--fm-ink-muted);
    font-size: 12px;
  }

  .host-setup__step-list {
    display: grid;
    gap: 6px;
  }

  .host-setup__step-list button {
    align-items: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 9px;
    color: var(--fm-ink);
    display: grid;
    gap: 8px;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    min-block-size: 52px;
    padding: 7px 9px;
    text-align: start;
  }

  .host-setup__step-list button:hover,
  .host-setup__step-list button[aria-current="step"] {
    background: var(--fm-raised);
    border-color: var(--fm-line-strong);
  }

  .host-setup__step-list button > span {
    align-items: center;
    border: 1px solid var(--fm-line-strong);
    border-radius: 999px;
    display: inline-flex;
    font-weight: 850;
    justify-content: center;
    min-block-size: 30px;
    min-inline-size: 30px;
  }

  .host-setup__step-list button[data-state="ready"] > span,
  .host-setup__step-list button[data-state="complete"] > span {
    background: var(--fm-accent-wash);
    border-color: var(--fm-accent-soft);
    color: var(--fm-accent-ink);
  }

  .host-setup__step-list small {
    color: var(--fm-ink-muted);
    font-weight: 750;
  }

  .host-setup__canvas {
    min-inline-size: 0;
    padding: clamp(18px, 3vw, 30px);
  }

  .host-setup__stage {
    display: grid;
    gap: 20px;
  }

  .host-setup__stage[hidden] {
    display: none;
  }

  .host-setup__stage-header {
    border-block-end: 1px solid var(--fm-line-soft);
    padding-block-end: 16px;
  }

  .host-setup__stage-header > span,
  .host-setup__slot-state {
    border: 1px solid var(--fm-line);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 850;
    padding: 7px 10px;
  }

  .host-setup__stage-header > span[data-state="ready"],
  .host-setup__stage-header > span[data-state="complete"],
  .host-setup__slot-state[data-state="ready"] {
    background: var(--fm-accent-wash);
    border-color: var(--fm-accent-soft);
    color: var(--fm-accent-ink);
  }

  .host-setup__facts,
  .host-setup__card-list,
  .host-setup__invite-list,
  .host-setup__checklist {
    display: grid;
    gap: 10px;
  }

  .host-setup__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 0;
  }

  .host-setup__facts > div,
  .host-setup__slot-card,
  .host-setup__role-card,
  .host-setup__rule-card,
  .host-setup__invite {
    background: var(--fm-raised);
    border: 1px solid var(--fm-line-soft);
    border-radius: 10px;
    padding: 12px;
  }

  .host-setup__facts > div {
    display: grid;
    gap: 3px;
  }

  .host-setup__facts dt {
    color: var(--fm-ink-muted);
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .host-setup__facts dd {
    font-weight: 800;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .host-setup__slot-card,
  .host-setup__role-card {
    align-items: center;
    display: grid;
    gap: 16px;
    grid-template-columns: minmax(150px, 0.45fr) minmax(280px, 1fr);
    min-inline-size: 0;
  }

  .host-setup__slot-card[data-state="blocked"] {
    border-color: var(--fm-line-warm);
  }

  .host-setup__slot-summary {
    align-items: center;
    display: flex;
    gap: 10px;
    justify-content: space-between;
  }

  .host-setup__slot-state[data-state="blocked"] {
    background: var(--fm-pending-wash);
    border-color: var(--fm-pending-soft);
    color: var(--fm-danger-ink);
  }

  .host-setup__slot-form {
    min-inline-size: 0;
  }

  .host-setup__slot-form .fm-field {
    flex: 1 1 220px;
  }

  .host-setup__invite span,
  .host-setup__invite-status,
  .host-setup__confirm span {
    overflow-wrap: anywhere;
  }

  .host-setup__checklist {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .host-setup__checklist li {
    align-items: center;
    background: var(--fm-raised);
    border: 1px solid var(--fm-line-soft);
    border-radius: 8px;
    display: flex;
    justify-content: space-between;
    min-block-size: 44px;
    padding: 8px 10px;
  }

  .host-setup__checklist button {
    background: transparent;
    border: 0;
    color: var(--fm-accent-ink);
    font: inherit;
    font-weight: 850;
    min-block-size: 44px;
    padding-inline: 10px;
  }

  .host-setup__checklist li[data-state="ready"] strong {
    color: var(--fm-ok);
  }

  .host-setup__checklist li[data-state="blocked"] strong {
    color: var(--fm-danger-ink);
  }

  @media (max-width: 820px) {
    .host-setup__workflow,
    .host-setup__slot-card {
      grid-template-columns: 1fr;
    }

    .host-setup__workflow {
      gap: 18px;
    }

    .host-setup__stepper {
      position: static;
    }

    .host-setup__step-list {
      display: flex;
      margin-inline: -16px;
      overflow-x: auto;
      padding-inline: 16px;
    }

    .host-setup__step-list button {
      flex: 0 0 150px;
    }

    .host-setup__facts {
      grid-template-columns: 1fr;
    }

    .host-setup__role-card {
      align-items: stretch;
      grid-template-columns: 1fr;
    }
  }
</style>
