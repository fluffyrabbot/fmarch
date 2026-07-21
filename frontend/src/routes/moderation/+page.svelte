<script>
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  export let data;
  export let form;
  $: moderation = data.moderation;
  $: detail = moderation.detail;
</script>

<svelte:head><title>Moderation queue | fmarch</title></svelte:head>

<main class="fm-surface" data-testid="moderation-queue-surface">
  <AppSurfaceHeader header={data.surfaceHeader} />
  <nav class="status-tabs" aria-label="Moderation status filters" data-testid="moderation-status-filters">
    {#each ["open", "hidden", "dismissed", "restored", "all"] as status}
      <a href={`/moderation?status=${status}`} aria-current={moderation.status === status ? "page" : undefined}>{status}</a>
    {/each}
  </nav>

  {#if moderation.cases.length === 0}
    <p class="fm-panel" data-testid="moderation-queue-empty">No cases match this queue.</p>
  {:else}
    <section class="case-grid" aria-label="Moderation cases" data-testid="moderation-case-list">
      {#each moderation.cases as item}
        <article class="fm-panel" data-testid={`moderation-case-${item.case_id}`}>
          <p class="fm-eyebrow">{item.status} · {item.target_kind}</p>
          <h2>{item.report_count} report{item.report_count === 1 ? "" : "s"}</h2>
          <p>{item.target_body}</p>
          <div class="case-links">
            <a href={item.target_href}>Open public destination</a>
            <a href={`/moderation?status=${moderation.status}&case=${item.case_id}`}>Review case</a>
          </div>
        </article>
      {/each}
    </section>
  {/if}

  {#if moderation.nextCursor}
    <a class="fm-touch-button fm-touch-button--secondary" href={`/moderation?status=${moderation.status}&cursor=${encodeURIComponent(moderation.nextCursor)}`} data-testid="moderation-queue-older">Older cases</a>
  {/if}

  {#if detail}
    <section class="fm-panel case-detail" data-testid="moderation-case-detail">
      <p class="fm-eyebrow">Case {detail.case.case_id}</p>
      <h2>{detail.case.status}: {detail.case.target_kind}</h2>
      <p>{detail.case.target_body}</p>
      <h3>Reports</h3>
      {#each detail.reports as report}
        <article data-testid={`moderation-report-${report.report_id}`}>
          <strong>{report.reason_family}</strong> · {report.reporter_principal_id}
          {#if report.details}<p>{report.details}</p>{/if}
        </article>
      {/each}
      <h3>Audit history</h3>
      <ol data-testid="moderation-case-history">
        {#each detail.history as event}
          <li>{event.event_kind} · {event.actor_principal_id}{event.reason ? ` · ${event.reason}` : ""}</li>
        {/each}
      </ol>

      {#if detail.case.status === "open" || detail.case.status === "hidden"}
        <form method="POST" action="?/caseAction" class="case-action" data-testid="moderation-case-action-form">
          <input type="hidden" name="case_id" value={detail.case.case_id} />
          <label class="fm-field"><span>Decision</span><select name="moderation_action" required data-testid="moderation-case-action">
            {#if detail.case.status === "open"}<option value="hide">Hide content</option><option value="dismiss">Dismiss reports</option>{/if}
            {#if detail.case.status === "hidden"}<option value="restore">Restore content</option>{/if}
          </select></label>
          <label class="fm-field"><span>Reason</span><textarea name="reason" required maxlength="500" data-testid="moderation-case-reason"></textarea></label>
          <button class="fm-touch-button" type="submit" data-testid="moderation-case-submit">Record decision</button>
        </form>
      {:else}
        <p data-testid="moderation-case-resolved">A new member report is required before this resolved case can be actioned again.</p>
      {/if}
      {#if form?.id === "moderation-action" && form?.state === "reject"}
        <p role="alert" data-testid="moderation-action-reject">{form.message}</p>
      {/if}
    </section>
  {/if}
</main>

<style>
  .status-tabs, .case-links { display: flex; flex-wrap: wrap; gap: 10px 18px; }
  .status-tabs { margin-block-end: 18px; text-transform: capitalize; }
  .case-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); }
  .case-grid h2 { margin-block: 6px; }
  .case-detail { margin-block-start: 20px; }
  .case-action { display: grid; gap: 12px; margin-block-start: 18px; }
  textarea { min-block-size: 96px; resize: vertical; }
</style>
