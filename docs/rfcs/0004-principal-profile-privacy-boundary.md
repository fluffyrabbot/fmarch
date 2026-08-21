# RFC 0004 — Principal, Profile, and Privacy Boundaries

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Created** | 2026-08-20 |
| **Accepted** | 2026-08-20 |
| **Decision owner** | Project owner |
| **Target** | Identity, social profiles, subject privacy, public attribution, and game-persona ownership |
| **Related** | [RFC 0001](0001-first-class-replay-and-history-explorer.md), [RFC 0003](0003-community-platform-v2.md), [01-domain-model](../arch/01-domain-model.md), [02-event-sourcing](../arch/02-event-sourcing.md), [06-security](../arch/06-security.md) |

## Summary

There is no generic `User` record. The platform has separate, deliberately
non-interchangeable concepts:

```text
Principal        authenticated authority and durable grants
PrivacySubject   confidential-state and erasure boundary
MemberProfile    one optional social presentation for an active principal
GamePersona      a game-local public identity with occupancy history
```

Authentication methods, sessions, encrypted claims, projections, wire DTOs,
and UI view models are adapters around those concepts. A public alias is not a
principal; a privacy subject is not an authenticated actor; a game persona is
not a member profile.

This is a greenfield cutover. Development databases and generated wire clients
are reset rather than supported through compatibility columns, dual writes, or
old event forms.

## Decision

### 1. Typed concepts and actor attribution

All new profile decisions use typed `PrincipalId`, `PrivacySubjectId`,
`ProfileId`, `ProfileHandle`, `ProfileDisplayName`, `ProfileBio`, and
`ProfileVisibility` values. `ActorId` has distinct `Principal` and
`PrivacySubject` variants; it no longer permits a subject UUID to masquerade
as a user string.

The first cut makes `PrincipalId` an opaque value at every boundary. The
immediately following baseline reset changes its physical storage and all
principal-bearing projections to UUIDs in one repository-wide operation.

### 2. Profile lifecycle is explicit

An active profile has one active principal, one privacy subject, an encrypted
current claim, a blinded handle index, and a stream revision. A redacted
profile retains only its profile ID, privacy subject, revision, and a dedicated
`RedactedProfileAlias` for historical attribution. It has no current profile
presentation.

No principal-id column may contain an alias. No `ProfileHandle` may contain a
redaction route key. A redacted presentation is a different state, not an
invalid active profile with a blank bio.

### 3. Visibility is honest

The current product has exactly two profile audiences:

- `public`: eligible for public profile reads and public search;
- `private`: visible only to the owner/editor boundary.

`members` is removed. It may return only with a dedicated membership aggregate,
a typed viewer/audience policy, and an authenticated member-readable query.

### 4. Ownership of decisions

`social` owns pure profile values, commands, events, state folding, and
validation. A transaction-aware profile application service owns load, decide,
private-claim sealing, canonical event encoding, expected-version append, and
synchronous fold. HTTP only authenticates, decodes requests, and adapts
responses. `projections` folds already canonical profile events; it does not
invent private claims or rewrite raw transport JSON into source facts.

### 5. Read projections remain purposeful

`member_profile` is the ownership root. It retains neither a plaintext handle
nor private display data: it stores only a keyed HMAC handle index while active.
`subject_private_claim` stores the complete encrypted presentation. `public_profile`
is a dependent projection that exists *only* while the current claim is public;
it supplies public profiles, search, public attribution, and mute targets.
Owner reads decrypt the current claim through the profile application boundary.
They must not be collapsed into an all-purpose user table. This keeps private
profiles out of ordinary public-query storage without giving up fast public
reads.

## Invariants

1. A live principal has at most one active member profile.
2. A profile has exactly one privacy subject throughout its lifecycle.
3. Active ownership contains a principal; redacted ownership contains no
   principal and no private claim.
4. Retained aliases never occupy principal or credential columns.
5. Public profile and search reads never expose a credential principal.
6. A profile update names the stream revision it observed; stale updates fail.
7. Game personas remain separate from member profiles and retain game/slot
   history independently.
8. A public profile presentation may be materialized only for `public`
   profiles; private profile details remain behind the owner/claim boundary.
9. A private or redacted profile has no `public_profile` row, so it cannot
   supply current attribution to public discussion, search, or mute reads.
10. Handle uniqueness uses a keyed, non-reversible index; plaintext private
    handles do not appear in a database projection or event payload.

## Cutover sequence

1. Add the pure social profile core and replace untyped profile validation.
2. Introduce explicit principal-versus-subject event attribution and move
   profile canonicalization into the application boundary.
3. Rebaseline the greenfield schema around active owner bindings, retained
   attribution, `public | private` visibility, and revision checks; reset
   development databases.
4. Re-key every principal-bearing storage and wire surface to UUIDs in a
   dedicated second rebaseline, including game authority/personas, sessions,
   credentials, moderation, subscriptions, and fixtures.
5. Prove the resulting boundaries with profile/privacy, identity, game, and
   browser lanes before updating the local proof baseline.

## Rejected alternatives

### One `User` table or aggregate

Rejected. It would combine credential authority, private erasure state, social
presentation, and game-local historical identity. Each has different privacy,
authorization, and replay requirements.

### Alias-as-principal pseudonymization

Rejected. It makes foreign keys and types lie, prevents a direct ownership
invariant, and allows an erased public label to acquire authority by accident.

### A `members` visibility string without membership

Rejected. A label is not an audience policy. The read path must define who is a
member before a member-only value can exist.
