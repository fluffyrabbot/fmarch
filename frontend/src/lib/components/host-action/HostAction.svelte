<script>
  import { tick } from "svelte";
  import ConfirmationShell from "$lib/app/ConfirmationShell.svelte";
  import {
    containTabWithinConfirmation,
  } from "$lib/app/confirmation-focus.mjs";
  import {
    createHostActionController,
    shouldPreserveHostActionConfirmation,
  } from "./host-action-contract.mjs";
  import "./touch-control.css";

  export let action;
  export let onDispatch = () => {};
  export let initialConfirmationOpen = false;

  let controller;
  let controllerAction;
  let view;
  let triggerElement;
  let confirmElement;
  let dispatchPromise = null;

  $: if (action !== controllerAction) {
    const preserveConfirmation =
      controllerAction !== undefined &&
      shouldPreserveHostActionConfirmation(
        controllerAction,
        action,
        view?.confirmation !== null,
      );
    controllerAction = action;
    controller = createHostActionController(action, (event) => {
      dispatchPromise = Promise.resolve(onDispatch(event));
      return dispatchPromise;
    });
    if (preserveConfirmation) {
      controller.activate();
    }
    if (
      initialConfirmationOpen === true &&
      (action?.requiresConfirmation === true || action?.irreversible === true)
    ) {
      controller.activate();
    }
    view = controller.viewModel();
  }

  function refresh() {
    view = controller.viewModel();
  }

  async function activate() {
    controller.activate();
    refresh();
    if (view.confirmation) {
      await tick();
      confirmElement?.focus();
    }
  }

  async function confirm() {
    controller.confirm();
    refresh();
    await dispatchPromise;
    await tick();
    triggerElement?.focus();
  }

  async function cancel() {
    controller.cancel();
    refresh();
    await tick();
    triggerElement?.focus();
  }

  function onConfirmationKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    containTabWithinConfirmation(event);
  }
</script>

{#if view}
  <section
    class={view.root.className}
    role={view.root.role}
    data-component={view.root.data.component}
    data-action-id={view.root.data.actionId}
  >
    <button
      type="button"
      class={view.trigger.className}
      data-testid={view.confirmation?.triggerTestId ?? "critical-host-action-trigger"}
      data-danger={view.trigger.data.danger}
      disabled={view.trigger.disabled}
      aria-disabled={view.trigger.ariaDisabled}
      aria-expanded={view.trigger.ariaExpanded}
      bind:this={triggerElement}
      on:click={activate}
    >
      <span>{view.trigger.intent}</span>
      {#if view.trigger.consequence}
        <small>{view.trigger.consequence}</small>
      {/if}
    </button>

    {#if view.confirmation}
      <ConfirmationShell
        className={view.confirmation.className}
        confirmation={view.confirmation}
        testId={view.confirmation.confirmationTestId}
        onKeydown={onConfirmationKeydown}
      >
        <p
          id={view.confirmation.messageId}
          data-testid={view.confirmation.messageTestId}
        >
          {view.confirmation.message}
        </p>
        <div class={view.confirmation.actionsClassName}>
          <button
            type="button"
            class={view.confirmation.confirmClassName}
            data-testid={view.confirmation.confirmTestId}
            bind:this={confirmElement}
            on:click={confirm}
          >
            Confirm
          </button>
          <button
            type="button"
            class="touch-control"
            data-testid={view.confirmation.cancelTestId}
            on:click={cancel}
          >
            Cancel
          </button>
        </div>
      </ConfirmationShell>
    {/if}
  </section>
{/if}
