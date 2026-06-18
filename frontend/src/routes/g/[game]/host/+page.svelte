<script>
  import HostAction from "$lib/components/host-action/HostAction.svelte";
  import { HOST_CONSOLE_CRITICAL_ACTION } from "$lib/components/host-action/host-console-critical-action.mjs";
  import "$lib/components/host-action/host-console-critical-path.css";

  let dispatched = [];

  $: if (typeof window !== "undefined") {
    window.__fmarchHostActionEvents = dispatched;
  }

  function handleDispatch(event) {
    dispatched = [...dispatched, event];
    window.dispatchEvent(
      new CustomEvent("host-action-dispatch", {
        detail: event,
      }),
    );
  }
</script>

<svelte:head>
  <title>Host console</title>
</svelte:head>

<main class="host-console-critical-path" data-component="host-console-route">
  <h1>Host console</h1>
  <p class="host-console-critical-path__status">
    Day 2 is open. Advance phase is the critical host path.
  </p>
  <div data-testid="critical-host-action">
    <HostAction action={HOST_CONSOLE_CRITICAL_ACTION} onDispatch={handleDispatch} />
  </div>
</main>
