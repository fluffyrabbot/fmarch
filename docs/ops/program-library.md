# DayProgram Library

The checked-in DayProgram library is the product content boundary for mash
templates. Browsers receive immutable references and derived previews; they do
not receive or submit authoritative program documents.

## Layout

`programs/catalog.json` is the sole discovery manifest. Each entry pins:

- `program_ref.id`
- positive `program_ref.version`
- the canonical typed document's BLAKE3 `program_ref.content_hash`
- `audience`: `product` or `acceptance`
- one local `*.program.json` filename

Every JSON file other than the manifest must be listed, and every listed file
must exist. Loading fails on duplicate references or filenames, nested paths,
unknown manifest fields, invalid documents, identity/version drift, hash drift,
or loose JSON files.

`product` artifacts appear in host setup. `acceptance` artifacts are available
to deterministic proof harnesses but cannot be attached through the external
command boundary.

## Attachment path

```text
setup catalog preview
  → DayProgramRef { id, version, content_hash }
  → API checked-in library resolution
  → authoritative pack compatibility compiler
  → internal AttachDayProgram with canonical document
  → DayProgramAttached snapshot + immutable DayEvents
```

This keeps storage operational and replay data definitional: the adapter may
later move from checked-in files to a blob store while the command core and
event history continue to receive the same canonical document.

## Product templates

| Artifact | Schedule | Resolution | Pack posture |
|---|---|---|---|
| `raffle@1` | Host opened | Seeded random | All shipped packs |
| `opt-in-quest@1` | Relative to D01 | First participant | All shipped packs |
| `host-judged-showcase@1` | D01-open trigger | Host decision | All shipped packs |

The shared reward adapter is a public one-use extra-action grant, which is
supported by every shipped pack. Each artifact includes immutable public
lifecycle narratives.

## Editing

1. Add a new versioned `*.program.json`; never mutate a published version.
2. Add its exact identity, version, audience, filename, and canonical hash to
   `catalog.json`.
3. Run the API library tests and compiler compatibility matrix.
4. Run `npm run proof:lanes -- --mode push --base origin/main --run`.

Hash mismatch errors report the canonical hash. Treat the manifest hash as a
content-address, not a checksum to update casually: changing it means publishing
a new program version.
