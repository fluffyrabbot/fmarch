<script>
  import { createHostActionController } from "./host-action-contract.mjs";
  import "./touch-control.css";

  export let action;
  export let onDispatch = () => {};

  let controller;
  let controllerAction;
  let view;

  $: if (action !== controllerAction) {
    controllerAction = action;
    controller = createHostActionController(action, onDispatch);
    view = controller.viewModel();
  }

  function refresh() {
    view = controller.viewModel();
  }

  function activate() {
    controller.activate();
    refresh();
  }

  function confirm() {
    controller.confirm();
    refresh();
  }

  function cancel() {
    controller.cancel();
    refresh();
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
      data-testid="critical-host-action-trigger"
      data-danger={view.trigger.data.danger}
      disabled={view.trigger.disabled}
      aria-disabled={view.trigger.ariaDisabled}
      aria-expanded={view.trigger.ariaExpanded}
      on:click={activate}
    >
      {view.trigger.label}
    </button>

    {#if view.confirmation}
      <div
        class={view.confirmation.className}
        role={view.confirmation.role}
        data-testid="critical-host-action-confirmation"
        aria-label="Confirm host action"
      >
        <p data-testid="critical-host-action-confirmation-message">
          {view.confirmation.message}
        </p>
        <div class={view.confirmation.actionsClassName}>
          <button
            type="button"
            class="touch-control"
            data-testid="critical-host-action-confirm"
            on:click={confirm}
          >
            Confirm
          </button>
          <button
            type="button"
            class="touch-control"
            data-testid="critical-host-action-cancel"
            on:click={cancel}
          >
            Cancel
          </button>
        </div>
      </div>
    {/if}
  </section>
{/if}
