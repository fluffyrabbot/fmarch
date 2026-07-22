<script>
  import AdminAuditPage from "../../../../../routes/admin/audit/[audit]/+page.svelte";

  export let data;
  export let form;
</script>

<AdminAuditPage {data} {form} />
