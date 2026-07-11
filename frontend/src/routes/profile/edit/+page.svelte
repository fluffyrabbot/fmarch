<script>
  export let form;
  $: rejection = form?.state === "reject" ? form.message : null;
</script>

<svelte:head><title>Create profile | fmarch</title></svelte:head>
<main class="fm-surface" data-testid="profile-create-surface">
  <section class="fm-surface__masthead"><div><p class="fm-eyebrow">Profile</p><h1>Create profile</h1><p class="fm-summary">Choose the public information and visibility for your profile.</p></div></section>
  <form method="POST" action="?/create" class="fm-panel profile-form" data-testid="profile-create-form">
    <label class="fm-field"><span>Handle</span><input name="handle" required maxlength="32" data-testid="profile-handle" /></label>
    <label class="fm-field"><span>Display name</span><input name="displayName" required maxlength="80" data-testid="profile-display-name" /></label>
    <label class="fm-field"><span>Bio</span><textarea name="bio" required maxlength="1000" data-testid="profile-bio"></textarea></label>
    <label class="fm-field"><span>Visibility</span><select name="visibility" data-testid="profile-visibility"><option value="public">Public</option><option value="members">Members only</option></select></label>
    {#if rejection}<p role="alert" data-testid="profile-editor-reject">{rejection}</p>{/if}
    <button type="submit" class="fm-touch-button" data-testid="profile-create-submit">Create profile</button>
  </form>
</main>

<style>.profile-form { display: grid; gap: 12px; max-inline-size: 640px; } textarea { min-block-size: 112px; resize: vertical; }</style>
