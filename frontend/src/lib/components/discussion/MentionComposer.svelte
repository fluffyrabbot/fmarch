<!--
  Mention typeahead inside the existing composer, not a second control.

  Typing `@` opens a bounded public-profile suggestion list; selecting inserts
  the handle text and records the target. Spans are re-derived from the body
  before submit, so editing prose can only drop a mention, never mis-anchor
  one. Without JavaScript the textarea is an ordinary textarea and the post
  simply carries no decided mentions.
-->
<script>
  import {
    MAX_MENTIONS_PER_POST,
    applyMentionSelection,
    deriveMentionSpans,
    mentionQueryAtCaret,
    normalizeHandle,
  } from "$lib/app/mention-model.mjs";

  export let name = "body";
  export let required = false;
  export let maxlength = 10000;
  export let testid = "discussion-post-body";
  export let suggestionsEndpoint = "/api/mention-suggestions";

  let body = "";
  let textarea;
  let query = null;
  let suggestions = [];
  let selected = [];
  let pending = 0;

  $: spans = deriveMentionSpans(body, selected);
  $: mentionsJson = JSON.stringify(spans.map(({ handle, offset, len }) => ({ handle, offset, len })));

  async function refresh() {
    query = mentionQueryAtCaret(body, textarea?.selectionStart ?? body.length);
    if (query === null || selected.length >= MAX_MENTIONS_PER_POST) {
      suggestions = [];
      return;
    }
    const ticket = (pending += 1);
    try {
      const response = await fetch(
        `${suggestionsEndpoint}?q=${encodeURIComponent(query.fragment)}`,
        { headers: { accept: "application/json" } },
      );
      const page = response.ok ? await response.json() : null;
      if (ticket !== pending) return;
      suggestions = Array.isArray(page?.suggestions) ? page.suggestions.slice(0, 8) : [];
    } catch {
      if (ticket === pending) suggestions = [];
    }
  }

  function choose(suggestion) {
    const handle = normalizeHandle(suggestion?.handle);
    if (handle === null || query === null) return;
    const applied = applyMentionSelection(body, query, handle);
    body = applied.body;
    if (!selected.includes(handle)) selected = [...selected, handle];
    query = null;
    suggestions = [];
    queueMicrotask(() => {
      textarea?.focus();
      textarea?.setSelectionRange(applied.caret, applied.caret);
    });
  }
</script>

<label class="fm-field">
  <span>Reply</span>
  <textarea
    bind:this={textarea}
    bind:value={body}
    {name}
    {required}
    {maxlength}
    data-testid={testid}
    on:input={refresh}
    on:keyup={refresh}
    on:click={refresh}
    on:blur={() => { suggestions = []; }}
  ></textarea>
</label>
<input type="hidden" name="mentions" value={mentionsJson} data-testid="discussion-mentions-field" />
{#if suggestions.length > 0}
  <ul class="mention-suggestions" data-testid="discussion-mention-suggestions">
    {#each suggestions as suggestion}
      <li>
        <button
          type="button"
          class="fm-touch-button fm-touch-button--secondary"
          data-min-touch-target-px="44"
          data-testid={`discussion-mention-suggestion-${suggestion.handle}`}
          on:mousedown|preventDefault={() => choose(suggestion)}
        >
          <strong>{suggestion.display_name}</strong>
          <span>@{suggestion.handle}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}
{#if spans.length > 0}
  <ul class="mention-chips" data-testid="discussion-mention-chips">
    {#each spans as span}
      <li data-testid={`discussion-mention-chip-${span.handle}`}>@{span.handle}</li>
    {/each}
  </ul>
{/if}

<style>
  .mention-suggestions, .mention-chips { display: grid; gap: 6px; list-style: none; margin: 0; padding: 0; }
  .mention-suggestions button { display: flex; gap: 8px; justify-content: flex-start; width: 100%; }
  .mention-chips { grid-auto-flow: column; justify-content: start; }
  .mention-chips li {
    border: 1px solid var(--fm-line-strong, var(--fm-border));
    color: var(--fm-ink-muted);
    font-size: 13px;
    padding: 2px 8px;
  }
  textarea { min-block-size: 112px; resize: vertical; }
</style>
