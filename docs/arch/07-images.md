# 07 — Images / media pipeline

A text+image forum that's tablet-friendly and data-efficient needs media handled
deliberately. The pipeline is **content-addressed**, **transcoded to modern formats at
tablet-appropriate sizes**, and **privacy-stripped** on ingest.

## Principles

1. **Content addressing.** A blob's identity is the hash of its bytes (BLAKE3). Identical
   uploads deduplicate automatically; URLs are immutable and cacheable forever.
2. **Transcode, don't serve originals.** Clients receive AVIF/WebP variants sized for the
   viewport, never the raw upload. This is most of the data-efficiency win on media.
3. **Strip on ingest.** EXIF and other metadata are removed at upload — privacy (geotags,
   device info) *and* bytes.
4. **The event log references handles, not bytes.** Posts carry content-addressed handles;
   the blob store holds the bytes ([02](02-event-sourcing.md), [03](03-backend.md)).

## Ingest pipeline

```
   POST upload ─▶ validate (type, dimensions, size limits)
              ─▶ decode to canonical raster
              ─▶ STRIP metadata (EXIF/GPS/etc.)
              ─▶ hash canonical bytes with BLAKE3  ──▶ content id
              ─▶ dedup check (already have this id? skip transcode)
              ─▶ transcode to variants:
                    - AVIF (primary) + WebP (fallback)
                    - sizes: thumb / tablet / full-bounded
              ─▶ store variants under content-addressed keys
              ─▶ return handle { id, available_variants, intrinsic w/h }
```

- **Validation first** — reject by type/size/dimension before doing expensive work;
  bounded resource use ([defends DoS via huge uploads]).
- **Hash after canonicalization + strip** so the content id is stable regardless of
  incidental metadata differences, maximizing dedup.
- **Transcode is idempotent and cache-keyed by content id** — re-uploading the same image
  is a no-op past the dedup check.

## Storage layout

```
blobs/
  <id>/orig         canonicalized, stripped source (kept for re-transcode)
  <id>/avif/thumb
  <id>/avif/tablet
  <id>/avif/full
  <id>/webp/...     fallbacks
```

- Keys are derived from the content id; immutable, so a CDN / browser can cache with a far-
  future expiry and never revalidate.
- Keeping a stripped `orig` lets us add new variant sizes/formats later by re-transcoding
  from local source, without asking users to re-upload.

## Serving

- Clients request a **variant appropriate to their viewport** ([05](05-frontend.md)) — a
  tablet thread shows `tablet`, a lightbox shows `full`. Never the original.
- Content negotiation / `<picture>` with AVIF primary and WebP fallback for older clients.
- Immutable cache headers; CDN-friendly by construction.

## Access control

- Images posted in a private channel inherit that channel's visibility. A content-addressed
  URL is **not** a capability — serving checks the requester's capability against the
  post/channel the blob is referenced from ([06](06-security.md)). Dedup never leaks a
  private image to someone who only "knows the hash," because access is checked at serve
  time against the *reference*, not possession of the id.

## Limits & abuse

- Per-upload size and dimension caps; per-user rate limits.
- Animated formats bounded (frame count / dimensions) or transcoded to a still where policy
  requires.
- Reject undecodable / malformed inputs early; never hand untrusted bytes to a serving path
  without having decoded and re-encoded them ourselves.

Continue to [08-roadmap](08-roadmap.md).
