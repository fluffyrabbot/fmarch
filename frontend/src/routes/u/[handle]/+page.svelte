<script>
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  export let data;
</script>

<svelte:head><title>{data.profile.display_name ?? "Profile"} | fmarch</title></svelte:head>

<main class="fm-surface" data-testid="profile-public-surface">
  <AppSurfaceHeader header={data.surfaceHeader} />
  {#if data.profile.status === "unavailable"}
    <p data-testid="profile-public-unavailable">This profile is unavailable or not public.</p>
  {:else}
    <section class="fm-panel" data-testid="profile-public-card">
      <p class="fm-eyebrow">Member profile</p>
      <h2 data-testid="profile-public-display-name">{data.profile.display_name}</h2>
      <p data-testid="profile-public-bio">{data.profile.bio}</p>
    </section>
  {/if}
</main>
