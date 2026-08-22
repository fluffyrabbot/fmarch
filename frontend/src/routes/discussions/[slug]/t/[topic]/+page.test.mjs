import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";
import {
  buildDiscussionPostView,
  buildDiscussionThreadView,
  discussionComposerHref,
  excerptFromBody,
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
      assert.equal(url, "/profiles/me/editor");
      return Response.json({ handle: "member_a", visibility: "public" });
    },
    url: new URL(`https://fmarch.local/discussions/general/t/${topic}?before_seq=41`),
  });

  assert.deepEqual(requests, [
    `/discussions/areas/general/topics/${topic}?limit=50&before_seq=41`,
    "/profiles/me/editor",
    `/subscriptions/${topic}`,
  ]);
  assert.equal(data.discussion.thread.posts[0].author.handle, "member_a");
  assert.equal(data.discussion.thread.next_before_seq, 20);
  assert.equal(data.discussion.canPost, true);
  assert.equal(data.discussion.canModerate, true);
  assert.equal(data.discussion.subscription.unread_count, 1);
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
              body: "Answering that claim",
              quotations: [{
                target: { kind: "discussion_post", scope_id: topic, source_seq: 40 },
                excerpt: "Older opening",
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
  assert.equal(data.discussion.attachedQuotations[0].sourceSeq, 40);
  assert.equal(data.discussion.attachedQuotations[0].excerpt, "Older opening");
  assert.match(data.discussion.posts[0].quoteHref, /quote=40/);
  assert.match(data.discussion.posts[1].quoteHref, /quote=40/);
  assert.match(data.discussion.posts[1].quoteHref, /quote=80/);
  assert.ok(requests.some((url) => String(url).includes("/citations?limit=5")));
});

test("createPost submits structured quotations instead of pasted body text", async () => {
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
