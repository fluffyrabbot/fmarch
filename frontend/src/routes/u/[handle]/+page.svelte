<script>
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  export let data;
  export let form;
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
      {#if data.mute !== null}
        <form method="POST" action={data.mute.muted ? "?/unmute" : "?/mute"}>
          <button
            type="submit"
            class="fm-touch-button fm-touch-button--secondary"
            data-testid="profile-member-mute-control"
          >
            {data.mute.muted ? "Unmute member" : "Mute member"}
          </button>
        </form>
        <p class="mute-explanation">
          {data.mute.muted
            ? "Their contributions are hidden from your public feeds, search, discussions, and inbox."
            : "Muting privately hides this member's contributions from your public reading surfaces."}
        </p>
      {/if}
    </section>
  {/if}
  {#if form?.state === "reject"}
    <p role="alert" class="fm-panel" data-testid="profile-member-mute-reject">{form.message}</p>
  {/if}
</main>

<style>
  .mute-explanation { color: var(--fm-text-muted); max-width: 70ch; }
</style>
