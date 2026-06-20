<script>
  import AppStatusStrip from "$lib/app/AppStatusStrip.svelte";
  import {
    buildAdminReadinessStripViewModel,
  } from "./admin-surface-model.mjs";

  export let operator = {};
  export let gameSetup = [];
  export let audit = [];
  export let recoveryTasks = [];

  $: view = buildAdminReadinessStripViewModel({
    operator,
    gameSetup,
    audit,
    recoveryTasks,
  });
</script>

<AppStatusStrip {view} />
