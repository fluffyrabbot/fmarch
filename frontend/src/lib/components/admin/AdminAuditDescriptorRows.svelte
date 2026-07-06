<script>
  export let rows = [];
  export let listTestId = null;
</script>

<ol class="admin-audit-detail__entries" data-testid={listTestId || null}>
  {#each rows as row}
    <li
      class="admin-audit-detail__entry admin-audit-detail__entry--stack"
      data-testid={row.testId}
    >
      {#each row.values as value}
        {#if value.emphasized}
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
                {#if value.emphasized}
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
    border: 1px solid #d7e0ea;
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
    color: #18212d;
  }

  .admin-audit-detail__entry span {
    color: #455466;
  }

  .admin-audit-detail__subentries {
    display: grid;
    gap: 8px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
</style>
