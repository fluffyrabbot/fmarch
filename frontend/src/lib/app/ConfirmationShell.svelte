<script>
  export let element = "div";
  export let method = undefined;
  export let action = undefined;
  export let className = "";
  export let confirmation;
  export let testId = undefined;
  export let onKeydown = () => {};

  $: elementAttributes = {
    class: className,
    role: confirmation.role,
    "aria-modal": confirmation.ariaModal,
    "aria-label": confirmation.ariaLabel,
    "aria-describedby": confirmation.messageId,
    "data-initial-focus-testid": confirmation.initialFocusTestId,
    "data-return-focus-testid": confirmation.returnFocusTestId,
    "data-escape-cancels": confirmation.escapeCancels,
    "data-tab-containment": confirmation.tabContainment,
    "data-testid": testId,
    ...(element === "form" ? { method, action } : {}),
  };
</script>

<svelte:element
  this={element}
  {...elementAttributes}
  on:keydown={onKeydown}
>
  <slot />
</svelte:element>
