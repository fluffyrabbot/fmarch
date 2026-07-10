# 07 — Images / media pipeline

A text+image forum that's tablet-friendly and data-efficient needs media handled
deliberately. The pipeline is **content-addressed**, **transcoded to modern formats at
tablet-appropriate sizes**, and **privacy-stripped** on ingest.

## Principles

1. **Content addressing.** A blob's identity is the BLAKE3 hash of its exact canonical record:
   version, dimensions, and the image decoder's EXIF-orientation-normalized RGBA8 samples. Upload
   containers deduplicate when those canonical bytes are identical; URL bytes are immutable,
   while private responses revalidate current authorization before browser-cache reuse.
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

- **Validation first** — reject by type, encoded size, dimensions, pixel count, and decoded/canonical
  output size before persistence ([defends DoS via huge uploads]).
- **Hash after canonicalization + strip** so the content id is stable regardless of
  incidental metadata differences, maximizing dedup.
- **Transcode is idempotent and cache-keyed by content id** — re-uploading the same image
  is a no-op past the dedup check.

## Storage layout

```
blobs/
  <id>/orig         versioned RGBA8 canonical raster (kept for re-transcode)
  <id>/<recipe-revision>/manifest.json
  <id>/<recipe-revision>/avif/thumb
  <id>/<recipe-revision>/avif/tablet
  <id>/<recipe-revision>/avif/full-bounded
  <id>/<recipe-revision>/webp/...     fallbacks
```

- Keys are derived from the content id; immutable, so a CDN / browser can cache with a far-
  future expiry and never revalidate.
- Keeping a stripped `orig` lets us add new variant sizes/formats later by re-transcoding
  from local source, without asking users to re-upload.
- A recipe directory is immutable. Its name includes the policy, codec, resize, alpha, geometry,
  and storage-layout revision, so changing any input mints new keys rather than silently changing
  bytes behind an existing key.

## Serving

- Clients request a **variant appropriate to their viewport** ([05](05-frontend.md)) — a
  tablet thread shows `tablet`, a lightbox shows `full-bounded`. Never the original.
- Content negotiation / `<picture>` with AVIF primary and WebP fallback for older clients.
- Stable ETags and immutable bytes. Account-gated responses use `private, no-cache` so every
  reuse revalidates current authorization; a future genuinely public route may opt into
  long-lived shared caching without weakening private-channel revocation.

Current implemented slice:

- The `media` crate owns canonical local ingest and blob persistence. It accepts PNG/JPEG bytes
  only after enforcing configured encoded-byte, width, height, total-pixel, decoder-output, and
  canonical-output caps. Undecodable/malformed input and unsupported formats are rejected before
  persistence. The decoder also receives its non-strict `max_alloc` hint; this is defense in depth,
  not a claim of a strict total decoder-workspace or process-memory bound.
- Ingest applies EXIF orientation because it changes the visible raster, decodes to row-major
  non-premultiplied RGBA8, and writes a fixed `FMRGBA01 + width + height + pixels` canonical record.
  EXIF/XMP/IPTC/text/profile/container bytes are not copied. There is currently no ICC/profile
  color-space normalization: identity covers exactly the decoder-produced, orientation-normalized
  samples, so only containers producing identical RGBA8 samples deduplicate.
- `ContentId` is a typed 32-byte digest whose text parser accepts exactly 64 lowercase hexadecimal
  characters. The store holds root and `blobs` directory descriptors, and all id/orig/temp IO uses
  descriptor-relative no-follow mkdir/open/link/unlink operations with inode-attachment checks.
  Swapped symlink or non-directory entries are rejected without reading or writing their targets.
- The configured store root must already exist. Provisioning and durably syncing ambient parent
  directories is an operator concern; the crate durably creates and owns only entries beneath the
  opened root capability.
- On Unix, the configured store root, `blobs`, and touched id directories are repaired to mode
  `0700`; canonical temporary and final inodes are mode `0600`, including existing entries.
- A complete canonical record is synced to a private same-directory temporary file and installed
  with an atomic no-clobber link. Concurrent/repeated ingest is idempotent; an existing record is
  fully re-read and checked rather than trusted, and every `AlreadyPresent` success syncs the opened
  inode and containing directory. Temporary unlink and directory metadata are synced on success and
  best-effort cleanup. Lookup uses no in-memory index, performs a capped descriptor read, revalidates
  the canonical shape and BLAKE3 identity, and therefore works after process restart.
- The same crate generates the fixed
  `v1-img02510-ravif0130-q72-s6-t1-webp024-lossless-lanczos3-pmul-floor` variant recipe. It emits
  `thumb` (fit within 256×256), `tablet` (1280×1280), and `full-bounded` (2560×2560) in both AVIF
  and WebP. Fitting uses checked integer arithmetic, floor rounding on the unconstrained axis, a
  minimum of one pixel per axis, and never upscales. Lanczos3 resizing operates on premultiplied
  RGBA8; output is then deterministically unpremultiplied with rounded integer division, and RGB is
  set to zero wherever alpha is zero to prevent straight-alpha edge halos and hidden transparent
  color from entering variants.
- AVIF uses image 0.25.10/ravif 0.13.0 in sRGB internal-color and unassociated-clean alpha modes,
  8-bit output, quality 72 for color and alpha, speed 6, and exactly one encoder thread. AVIF color
  and non-opaque alpha are lossy; an opaque image omits the alpha item. Every emitted AVIF is parsed
  as ISO-BMFF and must contain a non-empty, still-picture AV1 primary item with the expected
  dimensions, plus an alpha item exactly when the resized raster is non-opaque. WebP uses
  image-webp 0.2.4 VP8L lossless
  encoding and preserves the resized RGBA8 samples; every emitted WebP must pass RIFF/WEBP format
  detection and decode to the expected dimensions and alpha state.
- Variant keys are constructed only from the typed `ContentId`, recipe revision, `VariantFormat`,
  and `VariantKind`; caller text never becomes a filesystem component. The six members live under
  descriptor-relative, no-follow recipe/format directories. Each member is written sequentially
  through an encoded-byte-capped writer, synced to a private temporary inode, atomically installed
  without clobbering, reopened, and fully checked for length, BLAKE3, codec structure, dimensions,
  MIME, and alpha state. Directories and files are created or repaired to `0700` and `0600`.
- A canonical JSON `manifest.json` is the sole completeness marker. It binds schema, source id and
  dimensions, recipe revision, fixed record order, MIME, output dimensions, encoded length,
  BLAKE3, and alpha state. It is installed and synced only after all six members are durable and
  reverified. No manifest means incomplete, so crash temporaries and partial members are never
  reported as a set. A present manifest with a missing/corrupt member is typed corruption. Normal
  generation may reuse verified partial members and fill missing ones but fails closed on
  conflicting immutable bytes; explicit restart-safe regeneration first verifies `orig`, removes
  the manifest, repairs conflicting members, and installs the manifest last.
- Lookup retains the exact opened manifest inode as its commit token while checking all six members
  from the same held recipe directory. A requested member is read inside that scan, not in a second
  path-based phase. Immediately before success, lookup proves that same manifest, recipe directory,
  id directory, and blob-store capability are still attached; concurrent removal, replacement,
  regeneration, or ancestor detachment therefore invalidates the snapshot.
- `VariantLimits` defaults to 2560×2560, 6,553,600 output pixels, 16 MiB per encoded member, and
  64 MiB for all six encoded members. Dimensions and pixels are checked before resize/encode;
  member and aggregate byte counts are checked before persistence and again on lookup. A capped
  writer prevents an over-limit encoded member from becoming an artifact. These are output and
  persistence limits, not a strict cap on resize buffers, codec workspace, allocator overhead, or
  total process memory. Generation is sequential and the AVIF thread count is one to keep those
  indirect costs and deterministic behavior bounded in practice.
- Server startup now requires `FMARCH_MEDIA_ROOT` to name a pre-provisioned directory; failure to
  open the private store prevents the main API from starting. The store is a required `ApiState`
  dependency rather than a route-local or optional filesystem singleton. Repo-owned local server
  harnesses explicitly pre-provision isolated roots under their `target/` artifact directories and
  pass the resulting path; the server itself has no implicit fallback.
- `POST /media/uploads` accepts one raw `image/png` or `image/jpeg` body. Its Axum route limit is
  the store's encoded-byte cap, and the declared content type must match the PNG/JPEG signature.
  Before any persistence, the endpoint resolves the bearer token to an unrevoked, unexpired
  session whose principal still has an enabled account.
- Upload preparation performs bounded decode, canonicalization, all six resizes, AVIF/WebP encode,
  codec validation, and member/aggregate limit checks entirely in memory. A rejected client input
  therefore creates no content-id directory, canonical record, member, temporary, or manifest.
  Only a fully prepared upload reaches persistence; it atomically installs each immutable file and
  installs the variant manifest last, without claiming a filesystem-wide transaction for internal
  commit failures.
- A new upload returns `201`; an idempotent repeat returns `200`. The JSON response contains only
  the content id, intrinsic dimensions, recipe revision, and each immutable variant's typed role,
  format, MIME, dimensions, length, BLAKE3, and alpha flag—never paths or original bytes.
- `SubmitPost` accepts at most four attachments, each containing only a lowercase 64-hex
  `content_id` and non-empty alt text. Unknown client fields are rejected. In particular,
  clients cannot persist URLs, dimensions, MIME claims, variant names, or original-byte
  locations into the event log.
- Before command acceptance, the API parses each id as a typed `ContentId`, opens its committed
  manifest-backed variant set, requires exactly `thumb`, `tablet`, and `full-bounded` in both
  AVIF and WebP, and injects only the verified dimensions into the trusted command model.
  Missing, corrupt, incomplete, duplicated, or non-canonical handles fail before
  `PostSubmitted` is appended.
- Events and `thread_view` persist the immutable content id, alt text, and verified role
  dimensions—not URLs. `ThreadPage` derives canonical relative AVIF/WebP URLs from the game,
  percent-encoded channel, post source sequence, content id, and role on every read. This keeps
  route authority and storage layout out of client-authored event data.
- `GET /media/thread/{game}/{channel}/{source_seq}/{content_id}/{role}.{format}` first requires
  an unexpired, unrevoked session backed by an enabled account. Private channels then require
  current projected channel membership before any blob lookup. The route verifies that the
  exact post projection references the requested content id and role, performs a
  manifest-backed `MediaStore` lookup, and returns only the transcoded member with a stable ETag,
  `private, no-cache`, content-address, channel, post-sequence, reference, role, and format
  headers. Conditional requests return `304` only after those account/reference checks. Unknown,
  original, unreferenced, and unauthorized members never return media bytes.
- SvelteKit exposes same-origin upload and serving proxies that forward the httpOnly account
  session without exposing it to browser JavaScript. Failed media reads return a zero-length
  body. The player composer uploads PNG/JPEG bytes first, then sends only the returned id and
  alt text with `SubmitPost`; the thread renders AVIF-primary/WebP-fallback `<picture>` sources
  across thumb/tablet/full-bounded widths.
- The seeded live-stack proof creates enabled member and non-member accounts, uploads a real
  PNG from the member browser, posts its canonical handle into the command-declared mafia day
  chat, reloads the route, and observes real tablet AVIF bytes plus the content-address/reference
  headers. The non-member requests that exact URL and must receive `403` with a zero-byte body.
  Focused API proof also restarts the media store/router before serving to prove that the route
  does not depend on an in-memory upload index.

This slice deliberately does **not** claim ICC/profile color-space normalization, multipart or
resumable upload, direct object-store upload, account quotas/rate limiting, orphan-retention or
garbage-collection policy, a cross-post media library, galleries, profile media, moderation
workflow, production codec-quality or memory benchmarks, an object store/CDN, hosted durability,
or production performance. The completed local vertical is upload → private post → durable
manifest-backed serving → responsive browser reload → exact non-member byte denial.

## Access control

- Images posted in a private channel inherit that channel's visibility. A content-addressed
  URL is **not** a capability — serving checks the requester's capability against the
  post/channel the blob is referenced from ([06](06-security.md)). Dedup never leaks a
  private image to someone who only "knows the hash," because access is checked at serve
  time against the *reference*, not possession of the id.

## Limits & abuse

- Per-upload size and dimension caps are implemented; per-account quotas and rate limits remain a
  later abuse-control slice.
- Animated formats bounded (frame count / dimensions) or transcoded to a still where policy
  requires.
- Reject undecodable / malformed inputs early; never hand untrusted bytes to a serving path
  without having decoded and re-encoded them ourselves.

Continue to [08-roadmap](08-roadmap.md).
