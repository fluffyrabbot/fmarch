<script>
  import AppStatus from "./AppStatus.svelte";
  import {
    APP_STATUS_STRIP_CONTRACT,
    statusStripItemClassName,
    statusStripRootClassName,
    statusStripStatusClassName,
  } from "./app-status-strip-model.mjs";

  export let view;
  export let eyebrowClassName = "fm-eyebrow";

  $: root = view?.root ?? {};
  $: rootData = root.data ?? {};
  $: rootClassName = statusStripRootClassName(root.className);
  $: componentName = rootData.component ?? APP_STATUS_STRIP_CONTRACT.componentName;
</script>

<section
  class={rootClassName}
  aria-label={root.ariaLabel}
  data-component={componentName}
>
  {#each view.items as item}
    <article
      class={statusStripItemClassName(item.className)}
      data-state={item.status.state}
      data-evidence={item.evidence ?? undefined}
      data-testid={item.testId}
    >
      <p class={eyebrowClassName}>{item.label}</p>
      <strong>{item.value}</strong>
      <p>{item.detail}</p>
      <AppStatus
        status={item.status}
        testId={item.statusTestId}
        className={statusStripStatusClassName(item.statusClassName)}
      />
    </article>
  {/each}
</section>
