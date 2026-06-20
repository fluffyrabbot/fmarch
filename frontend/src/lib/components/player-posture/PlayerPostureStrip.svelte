<script>
  import AppStatusStrip from "$lib/app/AppStatusStrip.svelte";
  import {
    buildPlayerPostureStripViewModel,
  } from "./player-posture-strip-model.mjs";

  export let channel = {};
  export let phase = {};
  export let projectionBoundary = {};
  export let threadPager = {};
  export let votecount = [];
  export let privateQueueBoundary = {};

  $: view = buildPlayerPostureStripViewModel({
    channel,
    phase,
    projectionBoundary,
    threadPager,
    votecount,
    privateQueueBoundary,
  });
</script>

<AppStatusStrip {view} />
