import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";
import {
  DISCUSSION_EDIT_WINDOW_SECONDS,
  buildDiscussionPostView,
  buildDiscussionEditDraft,
  buildDiscussionThreadView,
  canonicalAreaSlug,
  discussionComposerHref,
  excerptFromBody,
  ownPostAffordances,
  parseQuoteSeqs,
  parseSubmittedQuotations,
} from "./discussion-thread-model.mjs";

const topic = "00000000-0000-0000-0000-000000000111";

test("canonical discussion topic keeps area scope, bylines, and older-post cursor", async () => {
  const requests = [];
  const data = await load({
    params: { slug: "general", topic },
    locals: {
      principalId: "member_a",
      resolvedCapabilities: [{ kind: "GlobalMod", source: "auth-session" }],
    },
    cookies: { get: () => "session-token" },
    fetch: async (url) => {
      requests.push(url);
      if (url === `/discussions/areas/general/topics/${topic}?limit=50&before_seq=41`) {
        return Response.json({
          area: { slug: "general", title: "General", description: "Public discussion" },
          topic: {
            topic,
            title: "Welcome",
            author: { handle: "member_a", display_name: "Member A" },
            posting_state: "open",
            visibility: "visible",
            post_count: 52,
            updated_seq: 80,
            last_post_seq: 80,
          },
          posts: [{
            source_seq: 40,
            author: { handle: "member_a", display_name: "Member A" },
            body: "Older opening",
            created_at: 1_800_000_000,
          }],
          next_before_seq: 20,
        });
      }
      if (url === `/subscriptions/${topic}`) {
        return Response.json({
          surface_id: topic,
          subscribed: true,
          read_through_seq: 40,
          latest_source_seq: 80,
          unread_count: 1,
        });
      }
      if (url === "/discussions/areas") {
        return Response.json([
          { slug: "general", title: "General", description: "" },
          { slug: "archive", title: "Archive", description: "" },
        ]);
      }
      assert.equal(url, "/profiles/me/editor");
      return Response.json({ handle: "member_a", visibility: "public" });
    },
    url: new URL(`https://fmarch.local/discussions/general/t/${topic}?before_seq=41`),
  });

  assert.deepEqual(requests, [
    `/discussions/areas/general/topics/${topic}?limit=50&before_seq=41`,
    "/profiles/me/editor",
    "/discussions/areas",
    `/subscriptions/${topic}`,
  ]);
  assert.equal(data.discussion.thread.posts[0].author.handle, "member_a");
  assert.equal(data.discussion.thread.next_before_seq, 20);
  assert.equal(data.discussion.canPost, true);
  assert.equal(data.discussion.canModerate, true);
  assert.equal(data.discussion.subscription.unread_count, 1);
  assert.deepEqual(data.discussion.areas, [
    { slug: "general", title: "General" },
    { slug: "archive", title: "Archive" },
  ]);
});

test("a moved topic redirects from the area it was linked from to its canonical area", async () => {
  await assert.rejects(
    () => load({
      params: { slug: "general", topic },
      locals: { principalId: null, resolvedCapabilities: [] },
      cookies: { get: () => undefined },
      fetch: async () => Response.json({
        area: { slug: "archive", title: "Archive", description: "" },
        topic: { topic, title: "Moved", posting_state: "open", visibility: "visible", post_count: 1, pinned: true },
        posts: [],
        next_before_seq: null,
      }),
      url: new URL(`https://fmarch.local/discussions/general/t/${topic}?before_seq=41`),
    }),
    (error) => error?.status === 301
      && error?.location === `/discussions/archive/t/${topic}?before_seq=41`,
  );
  assert.equal(canonicalAreaSlug({ area: { slug: "general" } }, "general"), null);
  assert.equal(canonicalAreaSlug(null, "general"), null);
  assert.equal(canonicalAreaSlug({ area: { slug: "archive" } }, "general"), "archive");
});

test("curation actions post exactly one change to the typed curation route", async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return Response.json({ topic, pinned: true }, { status: 200 });
  };
  const run = (name, fields) => actions[name]({
    cookies: { get: () => "moderator-session" },
    params: { slug: "general", topic },
    request: new Request(`http://localhost/discussions/general/t/topic?/${name}`, {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
    fetch,
  });
  await assert.rejects(
    () => run("rename", { title: "Filed title" }),
    (error) => error?.status === 303 && error?.location === `/discussions/general/t/${topic}`,
  );
  await assert.rejects(
    () => run("move", { area_slug: "archive" }),
    (error) => error?.status === 303 && error?.location === `/discussions/archive/t/${topic}`,
  );
  await assert.rejects(
    () => run("pin", { pinned: "true" }),
    (error) => error?.status === 303 && error?.location === `/discussions/general/t/${topic}`,
  );
  assert.deepEqual(calls, [
    { url: `/discussions/topics/${topic}/curation`, body: { title: "Filed title" } },
    { url: `/discussions/topics/${topic}/curation`, body: { area_slug: "archive" } },
    { url: `/discussions/topics/${topic}/curation`, body: { pinned: true } },
  ]);

  const denied = await actions.pin({
    cookies: { get: () => "member-session" },
    params: { slug: "general", topic },
    request: new Request("http://localhost/discussions/general/t/topic?/pin", {
      method: "POST",
      body: new URLSearchParams({ pinned: "false" }),
    }),
    fetch: async () => Response.json(
      { error: "not_authorized", message: "discussion curation requires GlobalMod" },
      { status: 403 },
    ),
  });
  assert.equal(denied.status, 403);
  assert.match(denied.data.message, /requires GlobalMod/u);
});

test("canonical discussion topic keeps wrong-area and hidden responses unavailable", async () => {
  const data = await load({
    params: { slug: "wrong", topic },
    locals: { principalId: null, resolvedCapabilities: [] },
    cookies: { get: () => undefined },
    fetch: async () => new Response(null, { status: 404 }),
    url: new URL(`https://fmarch.local/discussions/wrong/t/${topic}`),
  });
  assert.equal(data.discussion.status, "unavailable");
  assert.equal(data.discussion.canPost, false);
});

test("discussion report action maps the canonical topic post and returns a private receipt", async () => {
  let mutation;
  const result = await actions.report({
    cookies: { get: () => "member-session" },
    params: { slug: "general", topic },
    request: new Request("http://localhost/discussions/general/t/topic?/report", {
      method: "POST",
      body: new URLSearchParams({ source_seq: "42", reason_family: "harassment", details: "context" }),
    }),
    fetch: async (url, options) => {
      mutation = { url, body: JSON.parse(options.body) };
      return Response.json({ report_id: "receipt-42", status: "received", submitted_at: 1 }, { status: 201 });
    },
  });
  assert.equal(mutation.url, "/moderation/reports");
  assert.deepEqual(mutation.body, {
    surface_id: topic,
    source_seq: 42,
    reason_family: "harassment",
    details: "context",
  });
  assert.equal(result.reportId, "receipt-42");
});

test("discussion watch action uses the typed member-target endpoint", async () => {
  let mutation;
  const result = await actions.watch({
    cookies: { get: () => "member-session" },
    params: { slug: "general", topic },
    request: new Request("http://localhost/discussions/general/t/topic?/watch", {
      method: "POST",
      body: new URLSearchParams({ watch_action: "subscribe" }),
    }),
    fetch: async (url, options) => {
      mutation = { url, method: options.method };
      return Response.json({ subscribed: true });
    },
  });
  assert.deepEqual(mutation, {
    url: `/subscriptions/${topic}`,
    method: "PUT",
  });
  assert.equal(result.subscribed, true);
});

test("quote query seeds composer chips without copying excerpt into the body field", async () => {
  const requests = [];
  const data = await load({
    params: { slug: "general", topic },
    locals: {
      principalId: "member_a",
      resolvedCapabilities: [],
    },
    cookies: { get: () => "session-token" },
    fetch: async (url) => {
      requests.push(url);
      if (String(url).includes("/citations")) {
        return Response.json({
          quoted: { kind: "discussion_post", scope_id: topic, source_seq: 40 },
          citations: [{ quoting: { kind: "discussion_post", scope_id: topic, source_seq: 80 }, occurred_at: 2 }],
          citation_count: 1,
        });
      }
      if (String(url).includes(`/discussions/areas/general/topics/${topic}`)) {
        return Response.json({
          area: { slug: "general", title: "General", description: "Public discussion" },
          topic: {
            topic,
            title: "Welcome",
            author: { handle: "member_a", display_name: "Member A" },
            posting_state: "open",
            visibility: "visible",
            post_count: 2,
            updated_seq: 80,
            last_post_seq: 80,
          },
          posts: [
            {
              source_seq: 40,
              author: { handle: "member_a", display_name: "Member A" },
              body: "Older opening",
              quotations: [],
              citation_count: 1,
              created_at: 1_800_000_000,
            },
            {
              source_seq: 80,
              author: { handle: "member_b", display_name: "Member B" },
              body: "@member_a answering that claim",
              quotations: [{
                target: { kind: "discussion_post", scope_id: topic, source_seq: 40 },
                excerpt: "Older opening",
              }],
              mentions: [{
                profile: { handle: "member_a", display_name: "Member A" },
                offset: 0,
                len: 9,
              }],
              citation_count: 0,
              created_at: 1_800_000_100,
            },
          ],
          next_before_seq: null,
        });
      }
      if (url === `/subscriptions/${topic}`) {
        return Response.json({ subscribed: false, unread_count: 0 });
      }
      return Response.json({ handle: "member_a", visibility: "public" });
    },
    url: new URL(`https://fmarch.local/discussions/general/t/${topic}?quote=40`),
  });

  assert.equal(data.discussion.posts[0].citationCount, 1);
  assert.equal(data.discussion.posts[0].incomingCitations[0].sourceSeq, 80);
  assert.equal(data.discussion.posts[1].quotations[0].excerpt, "Older opening");
  assert.equal(data.discussion.posts[1].quotations[0].originalUnavailable, false);
  assert.deepEqual(
    data.discussion.posts[1].bodySegments.map((segment) => [segment.kind, segment.text, segment.href]),
    [
      ["mention", "@member_a", "/u/member_a"],
      ["text", " answering that claim", null],
    ],
  );
  assert.deepEqual(data.discussion.posts[0].bodySegments.map((segment) => segment.kind), ["text"]);
  assert.equal(data.discussion.attachedQuotations[0].sourceSeq, 40);
  assert.equal(data.discussion.attachedQuotations[0].excerpt, "Older opening");
  assert.match(data.discussion.posts[0].quoteHref, /quote=40/);
  assert.match(data.discussion.posts[1].quoteHref, /quote=40/);
  assert.match(data.discussion.posts[1].quoteHref, /quote=80/);
  assert.ok(requests.some((url) => String(url).includes("/citations?limit=5")));
});

test("createPost submits decided mentions alongside structured quotations", async () => {
  let mutation;
  await assert.rejects(
    () => actions.createPost({
      cookies: { get: () => "member-session" },
      params: { slug: "general", topic },
      request: new Request("http://localhost/discussions/general/t/topic?/createPost", {
        method: "POST",
        body: new URLSearchParams({
          body: "My reply",
          quotations: JSON.stringify([{
            target: { kind: "discussion_post", scope_id: topic, source_seq: 40 },
            excerpt: "Older opening",
          }]),
          mentions: JSON.stringify([
            { handle: "member_a", offset: 0, len: 9 },
            { handle: "no", offset: 0, len: 3 },
          ]),
        }),
      }),
      fetch: async (url, options) => {
        mutation = { url, body: JSON.parse(options.body) };
        return Response.json({ last_post_seq: 81 }, { status: 201 });
      },
    }),
    (error) => error?.status === 303 && String(error?.location).endsWith("#post-81"),
  );
  assert.equal(mutation.url, `/discussions/topics/${topic}/posts`);
  assert.deepEqual(mutation.body, {
    body: "My reply",
    quotations: [{
      target: { kind: "discussion_post", scope_id: topic, source_seq: 40 },
      excerpt: "Older opening",
    }],
    mentions: [{ handle: "member_a", offset: 0, len: 9 }],
  });
});

test("discussion quotation helpers keep no-JS quote URLs and hidden originals honest", () => {
  assert.deepEqual(parseQuoteSeqs(new URLSearchParams("quote=40&quote=80&quote=40&quote=nope")), [40, 80]);
  assert.equal(excerptFromBody("short"), "short");
  const posts = [
    { source_seq: 40, author: { display_name: "Member A" }, body: "Older opening", citation_count: 1 },
    {
      source_seq: 80,
      author: { display_name: "Member B" },
      body: "Reply",
      quotations: [{ target: { kind: "discussion_post", scope_id: topic, source_seq: 12 }, excerpt: "gone" }],
    },
  ];
  const view = buildDiscussionThreadView({
    thread: { topic: { topic, posting_state: "open" }, posts },
    quoteSeqs: [40],
    citationPages: {
      40: { citations: [{ quoting: { source_seq: 80 } }], citation_count: 1 },
    },
    canPost: true,
    slug: "general",
    topicId: topic,
  });
  assert.equal(view.posts[1].quotations[0].originalUnavailable, true);
  assert.equal(view.posts[1].quotations[0].authorLabel, null);
  assert.equal(view.posts[0].incomingCitations[0].href, "#post-80");
  assert.equal(
    discussionComposerHref({ slug: "general", topic, quoteSeqs: [40, 80] }),
    `/discussions/general/t/${topic}?quote=40&quote=80#discussion-composer`,
  );
  assert.deepEqual(
    parseSubmittedQuotations(
      { get: () => JSON.stringify([{ target: { source_seq: 40 }, excerpt: "Older opening" }]) },
      topic,
    ),
    [{ target: { kind: "discussion_post", scope_id: topic, source_seq: 40 }, excerpt: "Older opening" }],
  );
  const locked = buildDiscussionPostView(posts[0], { posts });
  assert.equal(locked.quoteHref, null);
});

test("own posts inside the edit window carry edit and retract affordances; others do not", () => {
  const now = 1_800_000_900;
  const posts = [
    { source_seq: 40, author: { handle: "member_a", display_name: "Member A" }, body: "Mine", created_at: now - 60, revision: 2, edited_at: now - 30, retracted: false },
    { source_seq: 41, author: { handle: "member_b", display_name: "Member B" }, body: "Theirs", created_at: now - 60 },
    { source_seq: 42, author: { handle: "member_a", display_name: "Member A" }, body: "Old", created_at: now - DISCUSSION_EDIT_WINDOW_SECONDS - 1 },
    { source_seq: 43, author: { handle: "member_a", display_name: "Member A" }, body: "", created_at: now - 10, retracted: true, mentions: [] },
    {
      source_seq: 44,
      author: { handle: "member_a", display_name: "Member A" },
      body: "@member_b hi",
      created_at: now - 10,
      mentions: [{ profile: { handle: "member_b", display_name: "Member B" }, offset: 0, len: 9 }],
    },
  ];
  const view = buildDiscussionThreadView({
    thread: { topic: { topic, posting_state: "open" }, posts },
    canPost: true,
    slug: "general",
    topicId: topic,
    viewerHandle: "member_a",
    now,
    quoteSeqs: [43],
  });
  const [mine, theirs, old, retracted, mentioning] = view.posts;
  assert.equal(mine.canEdit, true);
  assert.equal(mine.canRetract, true);
  assert.equal(mine.revision, 2);
  assert.equal(mine.editedAt, now - 30);
  assert.equal(theirs.canEdit, false);
  assert.equal(theirs.canRetract, false);
  assert.equal(old.canEdit, false, "the window is measured from submission");
  assert.equal(old.canRetract, true, "retraction has no window");
  assert.equal(retracted.retracted, true);
  assert.equal(retracted.canEdit, false);
  assert.equal(retracted.canRetract, false);
  assert.equal(retracted.quoteHref, null, "a retracted post cannot be quoted");
  assert.deepEqual(view.attachedQuotations, [], "quote query for a retracted post seeds nothing");
  assert.deepEqual(mentioning.mentionHandles, ["member_b"]);

  const locked = buildDiscussionThreadView({
    thread: { topic: { topic, posting_state: "locked" }, posts },
    canPost: true,
    slug: "general",
    topicId: topic,
    viewerHandle: "member_a",
    now,
  });
  assert.equal(locked.posts[0].canEdit, false, "a locked topic is frozen for authors too");
  assert.equal(locked.posts[0].canRetract, false);
  assert.deepEqual(
    ownPostAffordances(posts[0], { viewerHandle: null, now, topicOpen: true }),
    { canEdit: false, canRetract: false },
  );
  assert.equal(buildDiscussionPostView(posts[1]).revision, 0);
  assert.equal(buildDiscussionPostView(posts[1]).editedAt, null);
});

test("editPost sends the optimistic revision to the typed post route and lands on the post anchor", async () => {
  let mutation;
  await assert.rejects(
    () => actions.editPost({
      cookies: { get: () => "member-session" },
      params: { slug: "general", topic },
      request: new Request("http://localhost/discussions/general/t/topic?/editPost", {
        method: "POST",
        body: new URLSearchParams({
          source_seq: "40",
          expected_revision: "2",
          body: "Corrected reply",
          mentions: JSON.stringify([{ handle: "member_b", offset: 0, len: 9 }]),
        }),
      }),
      fetch: async (url, options) => {
        mutation = { url, method: options.method, body: JSON.parse(options.body) };
        return Response.json({ last_post_seq: 81 }, { status: 200 });
      },
    }),
    (error) => error?.status === 303 && String(error?.location).endsWith(`/t/${topic}#post-40`),
  );
  assert.equal(mutation.url, `/discussions/topics/${topic}/posts/40`);
  assert.equal(mutation.method, "PUT");
  assert.deepEqual(mutation.body, {
    body: "Corrected reply",
    mentions: [{ handle: "member_b", offset: 0, len: 9 }],
    expected_revision: 2,
  });

  const stale = await actions.editPost({
    cookies: { get: () => "member-session" },
    params: { slug: "general", topic },
    request: new Request("http://localhost/discussions/general/t/topic?/editPost", {
      method: "POST",
      body: new URLSearchParams({ source_seq: "40", expected_revision: "1", body: "Late" }),
    }),
    fetch: async () => Response.json(
      { error: "stream_conflict", message: "discussion post changed since it was read; refresh and try again" },
      { status: 409 },
    ),
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.id, "discussion-mutation");
  assert.match(stale.data.message, /changed since it was read/u);

  const malformed = await actions.editPost({
    cookies: { get: () => "member-session" },
    params: { slug: "general", topic },
    request: new Request("http://localhost/discussions/general/t/topic?/editPost", {
      method: "POST",
      body: new URLSearchParams({ source_seq: "40", expected_revision: "-1", body: "x" }),
    }),
    fetch: async () => { throw new Error("must not reach the API"); },
  });
  assert.equal(malformed.status, 400);
});

test("retractPost uses DELETE on the typed post route", async () => {
  let mutation;
  await assert.rejects(
    () => actions.retractPost({
      cookies: { get: () => "member-session" },
      params: { slug: "general", topic },
      request: new Request("http://localhost/discussions/general/t/topic?/retractPost", {
        method: "POST",
        body: new URLSearchParams({ source_seq: "40" }),
      }),
      fetch: async (url, options) => {
        mutation = { url, method: options.method, body: options.body };
        return Response.json({ last_post_seq: 81 }, { status: 200 });
      },
    }),
    (error) => error?.status === 303 && String(error?.location).endsWith("#post-40"),
  );
  assert.equal(mutation.url, `/discussions/topics/${topic}/posts/40`);
  assert.equal(mutation.method, "DELETE");
  assert.equal(mutation.body, undefined);

  const forbidden = await actions.retractPost({
    cookies: { get: () => "member-session" },
    params: { slug: "general", topic },
    request: new Request("http://localhost/discussions/general/t/topic?/retractPost", {
      method: "POST",
      body: new URLSearchParams({ source_seq: "41" }),
    }),
    fetch: async () => Response.json(
      { error: "not_authorized", message: "only the post author may change this post" },
      { status: 403 },
    ),
  });
  assert.equal(forbidden.status, 403);
  assert.match(forbidden.data.message, /only the post author/u);
});

test("post and edit-draft identities bind topic, source post, and base revision independently", () => {
  const original = {
    source_seq: 40,
    author: { handle: "member_a" },
    body: "@member_b Original",
    mentions: [{ profile: { handle: "member_b" }, offset: 0, len: 9 }],
    revision: 2,
  };
  const build = (post, topicId = topic) => buildDiscussionThreadView({
    thread: { topic: { topic: topicId, posting_state: "open" }, posts: [post] },
    slug: "general",
    topicId,
  }).posts[0];
  const draft = (view, topicId = topic) => ({
    ...view,
    editDraft: buildDiscussionEditDraft(topicId, view),
  });
  const initial = draft(build(original));
  const refreshed = draft(build({ ...original }));
  const newer = draft(build({ ...original, revision: 3, body: "Latest", mentions: [] }));
  const otherPost = draft(build({ ...original, source_seq: 41 }));
  const anotherTopic = "00000000-0000-0000-0000-000000000222";
  const otherTopic = draft(build(original, anotherTopic), anotherTopic);

  assert.equal(initial.identity, refreshed.identity);
  assert.equal(initial.editDraft.identity, refreshed.editDraft.identity,
    "unrelated invalidation retains the same draft owner");
  assert.equal(initial.identity, newer.identity,
    "a changed post preserves its editor so the old draft can be recovered");
  assert.notEqual(initial.editDraft.identity, newer.editDraft.identity);
  assert.notEqual(initial.identity, otherPost.identity,
    "pagination must never assign one post's editor to another post");
  assert.notEqual(initial.identity, otherTopic.identity,
    "source sequence alone is not a post identity across topics");
  assert.notEqual(initial.editDraft.identity, otherPost.editDraft.identity);
  assert.notEqual(initial.editDraft.identity, otherTopic.editDraft.identity);
  assert.equal(initial.editDraft.topic, topic);
  assert.equal(initial.editDraft.sourceSeq, 40);
  assert.equal(initial.editDraft.baseRevision, 2);
  assert.equal(initial.editDraft.body, "@member_b Original");
  assert.deepEqual(initial.editDraft.mentionHandles, ["member_b"]);
  assert.equal(newer.editDraft.baseRevision, 3);
  assert.equal(newer.editDraft.body, "Latest");
  assert.deepEqual(newer.editDraft.mentionHandles, []);
  assert.ok(Object.isFrozen(initial.editDraft));
  assert.ok(Object.isFrozen(initial.editDraft.mentionHandles));
});
