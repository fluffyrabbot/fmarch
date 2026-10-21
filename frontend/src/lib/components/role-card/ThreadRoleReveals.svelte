<script>
  // The roles one thread post made public, each a chip that opens its card.
  // `reveals` is a buildThreadRoleRevealViews result; an empty list renders
  // nothing, so a concealed flip looks like any other system post.
  import RoleCard from "./RoleCard.svelte";
  import RoleModal from "./RoleModal.svelte";
  import { THREAD_ROLE_REVEALS_CONTRACT } from "./thread-role-reveals.mjs";

  export let reveals = [];
  export let testId;

  let openRole = null;
</script>

{#if reveals.length > 0}
  <ul
    class="thread-role-reveals"
    aria-label="Revealed roles"
    data-component={THREAD_ROLE_REVEALS_CONTRACT.component}
    data-testid={testId}
  >
    {#each reveals as reveal (reveal.slotId)}
      <li class="thread-role-reveals__item" data-testid={reveal.testId}>
        <span>{reveal.slotLabel}</span>
        {#if reveal.chip}
          <button
            class="thread-role-reveals__role"
            type="button"
            aria-haspopup="dialog"
            aria-label={reveal.ariaLabel}
            data-min-touch-target-px={reveal.minTouchTargetPx}
            data-testid={`${reveal.testId}-open`}
            on:click={() => (openRole = reveal.card)}
          >
            <RoleCard card={reveal.chip} />
          </button>
        {:else}
          <strong>{reveal.roleLabel}</strong>
        {/if}
      </li>
    {/each}
  </ul>
  <RoleModal
    card={openRole}
    open={openRole !== null}
    eyebrow={THREAD_ROLE_REVEALS_CONTRACT.modalEyebrow}
    testId={`${testId}-modal`}
    onClose={() => (openRole = null)}
  />
{/if}

<style>
  .thread-role-reveals {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
  }

  .thread-role-reveals__item {
    align-items: center;
    display: inline-flex;
    gap: 0.5rem;
  }

  .thread-role-reveals__role {
    align-items: center;
    background: none;
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    min-block-size: 44px;
    padding: 0;
  }
</style>
