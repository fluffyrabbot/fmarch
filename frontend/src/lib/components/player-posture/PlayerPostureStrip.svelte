<script>
  import AppStatusStrip from "$lib/app/AppStatusStrip.svelte";
  import {
    buildPlayerPostureStripViewModel,
  } from "./player-posture-strip-model.mjs";

  export let phase = {};
  export let privateQueueBoundary = {};

  $: view = buildPlayerPostureStripViewModel({
    phase,
    privateQueueBoundary,
  });
</script>

<AppStatusStrip {view} />
