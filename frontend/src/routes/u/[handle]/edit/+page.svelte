<script>
  export let data;
  export let form;
  $: profile = data.profile;
  $: rejection = form?.state === "reject" ? form.message : null;
</script>

<svelte:head><title>Edit {profile.handle} | fmarch</title></svelte:head>
<main class="fm-surface" data-testid="profile-editor-surface">
  <section class="fm-surface__masthead"><div><p class="fm-eyebrow">Profile</p><h1>Edit {profile.handle}</h1><p class="fm-summary">Only this account can change this profile.</p></div></section>
  <form method="POST" action="?/update" class="fm-panel profile-form" data-testid="profile-editor-form">
    <label class="fm-field"><span>Display name</span><input name="displayName" required maxlength="80" value={profile.display_name} data-testid="profile-display-name" /></label>
    <label class="fm-field"><span>Bio</span><textarea name="bio" required maxlength="1000" data-testid="profile-bio">{profile.bio}</textarea></label>
    <label class="fm-field"><span>Visibility</span><select name="visibility" value={profile.visibility} data-testid="profile-visibility"><option value="public">Public</option><option value="members">Members only</option></select></label>
    {#if rejection}<p role="alert" data-testid="profile-editor-reject">{rejection}</p>{/if}
    <button type="submit" class="fm-touch-button" data-testid="profile-update-submit">Save profile</button>
  </form>
</main>
<style>.profile-form { display: grid; gap: 12px; max-inline-size: 640px; } textarea { min-block-size: 112px; resize: vertical; }</style>
