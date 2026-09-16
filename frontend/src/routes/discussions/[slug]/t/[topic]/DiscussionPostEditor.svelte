<script>
  import MentionComposer from "$lib/components/discussion/MentionComposer.svelte";
  import { buildDiscussionEditDraft } from "./discussion-thread-model.mjs";

  export let topic;
  export let post;

  // The keyed post owner survives refreshes, but a draft never adopts a newer
  // optimistic revision independently from its body and decided mentions.
  let draft = buildDiscussionEditDraft(topic, post);
  $: snapshot = buildDiscussionEditDraft(topic, post);
  $: changed = draft.identity !== snapshot.identity;

  function submit(event) {
    if (changed) event.preventDefault();
  }
</script>

<form
  method="POST"
  action="?/editPost"
  data-testid={`discussion-edit-form-${draft.sourceSeq}`}
  on:submit={submit}
>
  <input type="hidden" name="source_seq" value={draft.sourceSeq} />
  <input type="hidden" name="expected_revision" value={draft.baseRevision} />
  {#key draft.identity}
    <MentionComposer
      label="Edit post"
      required={draft.requiresBody}
      initial={draft.body}
      initialMentions={draft.mentionHandles}
      testid={`discussion-edit-body-${draft.sourceSeq}`}
      mentionsTestid={`discussion-edit-mentions-${draft.sourceSeq}`}
    />
  {/key}
  {#if changed}
    <p role="status" data-testid={`discussion-edit-conflict-${draft.sourceSeq}`}>
      This post changed while you were editing. Your draft is preserved here.
      Copy anything you want to keep before loading the latest post.
    </p>
    <button
      type="button"
      class="fm-touch-button fm-touch-button--secondary"
      data-testid={`discussion-edit-reset-${draft.sourceSeq}`}
      on:click={() => { draft = snapshot; }}
    >Load latest post and discard draft</button>
  {/if}
  <button
    type="submit"
    class="fm-touch-button"
    data-testid={`discussion-edit-submit-${draft.sourceSeq}`}
    disabled={changed}
  >Save edit</button>
</form>

<style>
  form { display: grid; gap: 12px; }
  p { margin: 0; }
</style>
