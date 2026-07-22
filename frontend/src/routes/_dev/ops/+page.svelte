<script>
  import AdminPage from "../../../routes/admin/+page.svelte";

  export let data;
  export let form;
</script>

<svelte:head>
  <title>fmarch local proof explorer</title>
</svelte:head>

<AdminPage {data} {form} />
