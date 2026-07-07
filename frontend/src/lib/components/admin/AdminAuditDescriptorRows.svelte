<script>
  import {
    buildAdminAuditEvidenceDisclosure,
  } from "./admin-surface-model.mjs";

  export let rows = [];
  export let listTestId = null;

  let copiedValueTestId = null;
  let collapsedEvidence = {};

  async function copyValue(value) {
    const text = String(value.copyText ?? value.text ?? "");
    copiedValueTestId = value.testId || value.id;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        copyValueWithTextarea(text);
      }
    } catch {
      copyValueWithTextarea(text);
    }
  }

  function copyValueWithTextarea(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function copyStatus(value) {
    return copiedValueTestId === (value.testId || value.id) ? "copied" : "ready";
  }

  function evidenceDisclosure(row, collapsed) {
    return buildAdminAuditEvidenceDisclosure({
      rowTestId: row.testId,
      count: row.subentries?.length ?? 0,
      expanded: collapsed[row.testId] !== true,
    });
  }

  function toggleEvidence(row) {
    collapsedEvidence = {
      ...collapsedEvidence,
      [row.testId]: collapsedEvidence[row.testId] !== true,
    };
  }
</script>

<ol class="admin-audit-detail__entries fm-rowlist" data-testid={listTestId || null}>
  {#each rows as row}
    <li
      class="admin-audit-detail__entry fm-rowlist__row fm-rowlist__row--stack"
      data-testid={row.testId}
    >
      {#each row.values as value}
        {#if value.copyText}
          <button
            type="button"
            class="admin-audit-detail__value-action fm-rowlist__action"
            data-testid={value.testId || null}
            data-copy-value={value.copyText}
            data-copy-status={copyStatus(value)}
            data-min-touch-target-px="44"
            on:click={() => copyValue(value)}
          >
            {value.text}
          </button>
        {:else if value.href}
          <a
            data-testid={value.testId || null}
            data-min-touch-target-px="44"
            href={value.href}
          >
            {value.text}
          </a>
        {:else if value.emphasized}
          <strong>{value.text}</strong>
        {:else}
          <span>{value.text}</span>
        {/if}
      {/each}
      {#if row.subentries?.length > 0}
        {@const disclosure = evidenceDisclosure(row, collapsedEvidence)}
        <div class={disclosure.className}>
          <button
            type="button"
            class={disclosure.toggleClassName}
            data-testid={disclosure.toggleTestId}
            data-min-touch-target-px={disclosure.minTouchTargetPx}
            aria-expanded={disclosure.ariaExpanded}
            aria-controls={disclosure.detailTestId}
            on:click={() => toggleEvidence(row)}
          >
            {disclosure.label}
          </button>
          {#if disclosure.expanded}
            <ol
              class="admin-audit-detail__subentries fm-rowlist__sublist"
              id={disclosure.detailTestId}
              data-testid={disclosure.detailTestId}
            >
              {#each row.subentries as subentry}
                <li
                  class="admin-audit-detail__entry fm-rowlist__row fm-rowlist__row--stack"
                  data-testid={subentry.testId}
                >
                  {#each subentry.values as value}
                    {#if value.copyText}
                      <button
                        type="button"
                        class="admin-audit-detail__value-action fm-rowlist__action"
                        data-testid={value.testId || null}
                        data-copy-value={value.copyText}
                        data-copy-status={copyStatus(value)}
                        data-min-touch-target-px="44"
                        on:click={() => copyValue(value)}
                      >
                        {value.text}
                      </button>
                    {:else if value.href}
                      <a
                        data-testid={value.testId || null}
                        data-min-touch-target-px="44"
                        href={value.href}
                      >
                        {value.text}
                      </a>
                    {:else if value.emphasized}
                      <strong>{value.text}</strong>
                    {:else}
                      <span>{value.text}</span>
                    {/if}
                  {/each}
                </li>
              {/each}
            </ol>
          {/if}
        </div>
      {/if}
    </li>
  {/each}
</ol>
