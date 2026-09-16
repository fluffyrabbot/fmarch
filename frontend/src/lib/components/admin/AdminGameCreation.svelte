<script>
  import AppStatus from "$lib/app/AppStatus.svelte";

  export let bootstrap;
  export let originTopics = [];
  export let firstGame = false;
  export let status = null;
</script>

<section class="admin-bootstrap fm-panel" data-testid="admin-game-bootstrap">
  <div>
    <p class="fm-eyebrow">Host a game</p>
    <h2>{firstGame ? "Create the first game" : "Create a game"}</h2>
    <p>Choose the rules pack. You will continue directly into host setup.</p>
  </div>
  <form method="POST" action="?/createGame">
    <label class="fm-field">
      <span>Game pack</span>
      <select name="pack" required data-testid="admin-game-bootstrap-pack">
        {#each bootstrap.packs as pack}
          <option value={pack.key} selected={pack.key === (status?.pack ?? bootstrap.defaultPack)}>{pack.name}</option>
        {/each}
      </select>
    </label>
    <label class="fm-field">
      <span>Signup topic (optional)</span>
      <select name="origin_topic" data-testid="admin-game-origin-topic">
        <option value="" selected={!status?.originTopic}>No signup topic</option>
        {#each originTopics as topic}
          <option value={topic.topic} selected={topic.topic === status?.originTopic}>{topic.title}</option>
        {/each}
      </select>
      <small>Choose one of your public topics. Its link is fixed when you create the game; watchers hear about the game when it starts.</small>
    </label>
    <button class="fm-touch-button" type="submit" data-testid="admin-game-bootstrap-submit">Create game and continue</button>
  </form>
  {#if status}
    <AppStatus {status} testId="admin-game-bootstrap-status" />
  {/if}
</section>

<style>
  .admin-bootstrap { display: grid; gap: 20px; padding: clamp(20px, 4vw, 36px); }
  .admin-bootstrap h2, .admin-bootstrap p { margin-block: 0; }
  .admin-bootstrap > div { display: grid; gap: 8px; }
  .admin-bootstrap form { align-items: end; display: grid; gap: 12px; grid-template-columns: minmax(220px, 1fr) auto; }

  @media (max-width: 760px) {
    .admin-bootstrap form { align-items: stretch; grid-template-columns: minmax(0, 1fr); }
  }
</style>
