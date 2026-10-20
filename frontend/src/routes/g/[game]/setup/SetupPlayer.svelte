<script>
  export let game;
  export let slot;
  export let onSubmit;
  let handle = '';
  let publicName = slot.publicName ?? '';
  let selected = null;
  let suggestions = [];
  let message = '';
  let generation = 0;
  let busy = false;

  async function search() {
    const ticket = ++generation;
    selected = null;
    suggestions = [];
    message = '';
    const prefix = handle.trim().replace(/^@/, '');
    if (!prefix) return;
    try {
      const response = await fetch(`/api/mention-suggestions?q=${encodeURIComponent(prefix)}`);
      if (!response.ok) throw new Error();
      const page = await response.json();
      if (ticket === generation) suggestions = page.suggestions ?? [];
    } catch { if (ticket === generation) message = 'Player search is unavailable. Try again.'; }
  }

  async function choose(profile) {
    const ticket = ++generation;
    suggestions = [];
    busy = true;
    try {
      const response = await fetch(`/api/gameplay/games/${encodeURIComponent(game)}/setup/candidate?handle=${encodeURIComponent(profile.handle)}`);
      if (!response.ok) throw new Error();
      const candidate = await response.json();
      if (ticket !== generation) return;
      if (candidate.already_seated) { message = 'This player already has a seat.'; return; }
      selected = candidate;
      handle = candidate.handle;
      publicName = candidate.display_name;
      message = `Selected @${candidate.handle}`;
    } catch { if (ticket === generation) message = 'That player could not be selected. Search again.'; }
    finally { if (ticket === generation) busy = false; }
  }
</script>

<form class="player-selection" on:submit={onSubmit}>
  <input type="hidden" name="slotId" value={slot.slotId} />
  <input type="hidden" name="principalId" value={selected?.principal_id ?? ''} />
  <label class="fm-field"><span>Player handle</span>
    <input bind:value={handle} on:input={search} autocomplete="off" spellcheck="false" placeholder="Search by handle" />
  </label>
  {#if suggestions.length}
    <ul aria-label="Matching players">
      {#each suggestions as profile}
        <li><button type="button" class="fm-touch-button fm-touch-button--secondary" on:click={() => choose(profile)}>{profile.display_name} · @{profile.handle}</button></li>
      {/each}
    </ul>
  {/if}
  <p role="status">{message}</p>
  <label class="fm-field"><span>Public game name</span><input name="publicName" bind:value={publicName} required /></label>
  <button class="fm-touch-button fm-touch-button--secondary" type="submit" disabled={!selected || busy}>Assign player</button>
</form>

<style>
  .player-selection { display: grid; gap: 10px; }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
  li button { width: 100%; text-align: left; }
  p:empty { display: none; }
</style>
