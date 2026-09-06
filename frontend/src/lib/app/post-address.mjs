// Route-relative addresses retain the public/player/channel authorization boundary.
export function postHref(sourceSeq) {
  const seq = String(sourceSeq ?? "");
  if (!/^[1-9][0-9]*$/u.test(seq)) throw new TypeError("Invalid post sequence");
  return `?post=${seq}#thread-post-${seq}`;
}

export function requestedPost(url) {
  const value = url?.searchParams.get("post") ?? null;
  if (value !== null && (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value)))) {
    throw new TypeError("Invalid post address");
  }
  return value;
}

export function captureReadingPosition(documentRef = document) {
  const posts = [...documentRef.querySelectorAll('[id^="thread-post-"]')];
  const focused = documentRef.activeElement;
  if (documentRef.defaultView?.scrollY === 0 && !posts.includes(focused)) return null;
  const element = posts.includes(focused) && focused.getBoundingClientRect().bottom > 0
    ? focused : posts.find((post) => post.getBoundingClientRect().bottom > 0);
  return element ? { id: element.id, top: element.getBoundingClientRect().top } : null;
}

export function restoreReadingPosition(position, documentRef = document, windowRef = window) {
  const element = position && documentRef.getElementById(position.id);
  if (element) windowRef.scrollBy({ top: element.getBoundingClientRect().top - position.top, behavior: "instant" });
}

export function focusAddressedPost(url, documentRef = document) {
  const seq = requestedPost(url);
  if (seq === null) return;
  const element = documentRef.getElementById(`thread-post-${seq}`);
  if (element) {
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "center", behavior: "instant" });
  }
}
