<script>
  import AppStatus from "./AppStatus.svelte";
  import { buildAppSurfaceHeaderViewModel } from "./app-surface-header-model.mjs";

  export let header;
  export let liveStatus = null;

  $: view = buildAppSurfaceHeaderViewModel(header);
</script>

<header
  class={view.className}
  data-component={view.component}
  data-surface={view.surface}
>
  <div>
    {#if view.eyebrow}
      <p class={view.eyebrowClassName}>{view.eyebrow}</p>
    {/if}
    <h1>{view.title}</h1>
    {#if view.summary}
      <p class="fm-summary">{view.summary}</p>
    {/if}
  </div>
  <div class={view.statusStackClassName}>
    {#if view.capability.visible}
      <span
        class={view.capability.className}
        data-testid={view.capability.testId}
        data-capability={view.capability.label}
        data-min-touch-target-px={view.capability.minTouchTargetPx}
      >
        {view.capability.label}
      </span>
    {/if}
    {#if view.liveStatus.visible}
      <AppStatus
        status={liveStatus}
        testId={view.liveStatus.testId}
        className={view.liveStatus.className}
      />
    {/if}
  </div>
</header>
