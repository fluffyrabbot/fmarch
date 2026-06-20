<script>
  import AppStatusStrip from "$lib/app/AppStatusStrip.svelte";
  import {
    buildHostOperationsStripViewModel,
  } from "./host-operations-strip.mjs";

  export let access = {};
  export let phase = {};
  export let projection = {};
  export let votecountBoundary = {};
  export let votecount = [];
  export let hostPrompts = [];

  $: view = buildHostOperationsStripViewModel({
    access,
    phase,
    projection,
    votecountBoundary,
    votecount,
    hostPrompts,
  });
</script>

<AppStatusStrip {view} eyebrowClassName="host-console-critical-path__eyebrow" />
