import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postHref, requestedPost, captureReadingPosition, restoreReadingPosition, focusAddressedPost } from './post-address.mjs';

test('post addresses replace pagination while retaining route authorization scope', () => {
  for (const path of ['/g/game', '/g/game/c/private%3Arole_pm%3Aslot_1', '/games/game']) {
    const url = new URL(postHref(20), `https://example.test${path}?before_seq=80`);
    assert.equal(url.pathname, path);
    assert.equal(requestedPost(url), '20');
    assert.equal(url.searchParams.has('before_seq'), false);
    assert.equal(url.hash, '#thread-post-20');
  }
  for (const post of ['0', '-1', '1.1', '9007199254740993', 'x']) {
    assert.throws(() => requestedPost(new URL(`https://example.test/g/game?post=${post}`)));
  }
});

test('address navigation focuses the exact post and pagination restores its visual offset', () => {
  const calls = [];
  let top = -20;
  const post = { id: 'thread-post-20', getBoundingClientRect: () => ({ top, bottom: top + 100 }),
    focus: options => calls.push(['focus', options]), scrollIntoView: options => calls.push(['scroll', options]) };
  const document = { querySelectorAll: () => [post], getElementById: id => id === post.id ? post : null };
  const position = captureReadingPosition(document);
  top = 700;
  restoreReadingPosition(position, document, { scrollBy: options => calls.push(['restore', options]) });
  assert.deepEqual(calls[0], ['restore', { top: 720, behavior: 'instant' }]);
  focusAddressedPost(new URL('https://example.test/g/game?post=20'), document);
  assert.deepEqual(calls[1], ['focus', { preventScroll: true }]);
  focusAddressedPost(new URL('https://example.test/g/game?post=21'), document);
  assert.equal(calls.length, 3);
});


test('restoration leaves an untouched page top alone and prefers the focused post', () => {
  const first = { id: 'thread-post-1', getBoundingClientRect: () => ({ top: 10, bottom: 100 }) };
  const focused = { id: 'thread-post-2', getBoundingClientRect: () => ({ top: 110, bottom: 200 }) };
  const doc = { querySelectorAll: () => [first, focused], defaultView: { scrollY: 0 }, activeElement: null };
  assert.equal(captureReadingPosition(doc), null);
  doc.activeElement = focused;
  assert.deepEqual(captureReadingPosition(doc), { id: focused.id, top: 110 });
});
