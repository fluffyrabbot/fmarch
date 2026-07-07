<script>
  export let rows = [];
  export let listTestId = null;

  let copiedValueTestId = null;

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
</script>

<ol class="admin-audit-detail__entries" data-testid={listTestId || null}>
  {#each rows as row}
    <li
      class="admin-audit-detail__entry admin-audit-detail__entry--stack"
      data-testid={row.testId}
    >
      {#each row.values as value}
        {#if value.copyText}
          <button
            type="button"
            class="admin-audit-detail__value-action"
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
        <ol class="admin-audit-detail__subentries">
          {#each row.subentries as subentry}
            <li
              class="admin-audit-detail__entry admin-audit-detail__entry--stack"
              data-testid={subentry.testId}
            >
              {#each subentry.values as value}
                {#if value.copyText}
                  <button
                    type="button"
                    class="admin-audit-detail__value-action"
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
    </li>
  {/each}
</ol>

<style>
  .admin-audit-detail__entries {
    display: grid;
    gap: 10px;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .admin-audit-detail__entry {
    border: 1px solid var(--fm-line-cool);
    border-radius: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    min-block-size: 44px;
    padding: 10px 12px;
  }

  .admin-audit-detail__entry--stack {
    display: grid;
  }

  .admin-audit-detail__entry strong {
    color: var(--fm-ink);
  }

  .admin-audit-detail__entry span {
    color: var(--fm-ink-muted);
  }

  .admin-audit-detail__entry a,
  .admin-audit-detail__value-action {
    color: inherit;
    display: inline-flex;
    min-block-size: 44px;
    overflow-wrap: anywhere;
    text-decoration: none;
  }

  .admin-audit-detail__value-action {
    align-items: center;
    background: var(--fm-surface-cool);
    border: 1px solid var(--fm-line-cool);
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    padding: 0 12px;
  }

  .admin-audit-detail__subentries {
    display: grid;
    gap: 8px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
</style>
