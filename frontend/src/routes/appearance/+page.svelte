<script>
  import { THEMES, THEME_SCHEMES } from "$lib/app/theme.mjs";
  export let data;
  export let form;
</script>
<svelte:head><title>Appearance | fmarch</title></svelte:head>
<main class="fm-surface" data-testid="appearance-surface">
  <h1>Appearance</h1>
  <p>Choose how fmarch looks on this browser.</p>
  <form method="POST" class="fm-card fm-appearance-form">
    <label for="theme-choice">Theme</label>
    <select id="theme-choice" name="themeId">
      {#each THEMES as theme}<option value={theme.id} selected={data.themePreference.themeId === theme.id}>{theme.label} — {theme.description}</option>{/each}
    </select>
    <label for="scheme-choice">Color preference</label>
    <select id="scheme-choice" name="scheme">
      {#each THEME_SCHEMES as scheme}<option value={scheme.id} selected={data.themePreference.scheme === scheme.id}>{scheme.label}</option>{/each}
    </select>
    <p>Follow game changes with day, night, and twilight; outside a game it follows your system. System always follows your device. Light and Dark stay fixed during play.</p>
    {#if form?.error}<p role="alert">{form.error}</p>{/if}
    <button class="fm-touch-button" type="submit">Save appearance</button>
  </form>
</main>
