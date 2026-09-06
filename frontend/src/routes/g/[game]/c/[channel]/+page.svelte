<script>
  import PlayerRoute from "../../+page.svelte";

  export let data;
  let playerRoute;
  export const snapshot = {
    capture: () => playerRoute.snapshot.capture(),
    restore: value => playerRoute.snapshot.restore(value),
  };
</script>

<PlayerRoute bind:this={playerRoute} {data} />
