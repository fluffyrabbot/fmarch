import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPlayerThreadEmbedView,
  buildYoutubePlaybackSrc,
  parseYoutubeEmbed,
} from "./youtube-embed.mjs";

const id = "dQw4w9WgXcQ";

test("youtube embed grammar accepts closed URL shapes", () => {
  for (const input of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&feature=share`,
    `http://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://www.youtu.be/${id}/`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://youtube.com/shorts/${id}?feature=share`,
  ]) {
    assert.deepEqual(parseYoutubeEmbed(input), {
      provider: "youtube",
      providerId: id,
      startSeconds: null,
    });
  }
});

test("youtube embed grammar captures start offsets", () => {
  assert.equal(parseYoutubeEmbed(`https://www.youtube.com/watch?v=${id}&t=1m23s`).startSeconds, 83);
  assert.equal(parseYoutubeEmbed(`https://youtu.be/${id}?t=83`).startSeconds, 83);
  assert.equal(parseYoutubeEmbed(`https://www.youtube.com/embed/${id}?start=12`).startSeconds, 12);
});

test("youtube embed grammar rejects unknown hosts and shapes", () => {
  for (const input of [
    "javascript:alert(1)",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/playlist?list=PLtest",
    "https://www.youtube.com/channel/UCtest",
    "https://www.youtube.com/@handle",
    "https://www.youtube.com/clip/Ugkx",
    "https://www.youtube.com/watch",
    "https://youtu.be/short",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    "dQw4w9WgXcQ",
  ]) {
    assert.equal(parseYoutubeEmbed(input), null, input);
  }
});

test("playback src uses the privacy-enhanced origin", () => {
  assert.equal(
    buildYoutubePlaybackSrc(parseYoutubeEmbed(`https://youtu.be/${id}?t=15`)),
    `https://www.youtube-nocookie.com/embed/${id}?rel=0&start=15`,
  );
  assert.deepEqual(buildPlayerThreadEmbedView({ provider: "youtube", provider_id: id }, 12), {
    provider: "youtube",
    providerId: id,
    startSeconds: null,
    playbackSrc: `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
    playLabel: "Play YouTube video",
    testId: "thread-post-embed-play-12",
  });
});
