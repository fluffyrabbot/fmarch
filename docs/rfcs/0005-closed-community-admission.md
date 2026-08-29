# RFC 0005 — Closed Community Admission and Sponsorship Provenance

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Created** | 2026-08-29 |
| **Accepted** | 2026-08-29 |
| **Decision owner** | Project owner |
| **Target** | Membership, invitation-gated enrollment, sponsorship provenance, and member audience policy |
| **Related** | [RFC 0004](0004-principal-profile-privacy-boundary.md), [02-event-sourcing](../arch/02-event-sourcing.md), [06-security](../arch/06-security.md) |

## Summary

Fmarch is a closed community. An authentication ceremony proves control of a
credential; it does not admit a person. Every ordinary human principal is
created through one accepted community invitation, and every accepted
invitation retains an immutable opaque sponsorship edge back to a founder.

The conceptual universe is:

```text
Principal             authenticated authority and durable grants
CommunityMembership   admission, current member standing, and sponsorship node
PrivacySubject        confidential-state and erasure boundary
MemberProfile         optional social presentation
GamePersona           game-local public identity with occupancy history
CommunityInvitation   one-time authority to create one membership
GameInvitation        game-scoped participation for an existing member
```

These concepts are deliberately non-interchangeable. In particular, a
principal identifier, login name, provider subject, email address, profile, or
game persona is never a sponsorship node.

This is a greenfield cutover. Open registration and first-sight provider
provisioning are removed directly; no compatibility or dual-write path exists.

## Decision

### Membership is an aggregate

`community_membership` owns pure membership and invitation types, commands,
events, folds, and rejection semantics. `membership_application` owns the
transaction that loads those aggregates, provisions identity through narrow
ports, appends canonical events, consumes credentials, and folds projections.
HTTP only authenticates, decodes, and adapts.

Every membership stream begins with exactly one of:

- `MembershipFounded`, for an explicitly bootstrapped root; or
- `MembershipAdmitted`, naming one invitation and its sponsoring membership.

Later lifecycle events suspend, restore, withdraw, or redact the membership.
Active principal ownership is a current binding. Provenance is expressed only
in opaque `MembershipId` values and survives principal/profile erasure.

### Invitations are admission authority

An active member may issue a target-bound, expiring, single-use invitation.
The server generates the credential, persists only its SHA-256 hash, seals the
raw credential into the provider-neutral delivery outbox, and writes no raw
credential or contact address to events or audits. A keyed blind index binds
acceptance to the intended normalized account address.

The delivery outbox is owned by the sponsoring principal and may address a
prospective account; it is not foreign-keyed to an account that cannot exist
before admission. In the browser, the landing route immediately moves the raw
credential into a ten-minute HttpOnly, SameSite cookie and redirects to a clean
URL. Chooser URLs, rendered page data, form fields, referrers, and subsequent
browser-history entries never carry the credential onward.

Accepting an invitation atomically:

1. locks and validates its credential and sponsoring membership;
2. provisions one principal, privacy subject, and authentication method;
3. appends invitation acceptance and membership admission;
4. creates current membership ownership and ancestry projections;
5. consumes the credential and issues the app session.

No partial principal, membership, method, or consumed credential may survive a
failed acceptance.

### Provider assertions do not admit

WorkOS login resolves only an already-bound subject. A previously unseen
subject fails authentication. The separate admission path may bind an unseen
verified subject only while atomically accepting a valid invitation. Direct
provider signup therefore creates no local authority.

Classic registration likewise requires a valid community invitation. The old
public registration endpoint is removed from the browser journey and cannot
create a principal independently.

### Provenance is a forest

`MembershipAdmitted` is the source of one immutable parent edge. A synchronous,
rebuildable `membership_ancestry` closure projection contains `(ancestor,
descendant, depth)`, including depth zero for self. It serves root-to-member and
subtree queries without copying chains into member rows.

Cycles are impossible by construction: the sponsor must already be active
before the child membership identifier is created. The database additionally
enforces unique admission invitation, unique child parent, and unique ancestry
pairs.

### Provenance is not transitive authorization

Suspending or withdrawing a sponsor invalidates their outstanding invitations.
It does not suspend already-admitted descendants. A subtree sanction is a
separate explicit moderation action. This keeps historical accountability from
becoming fragile ambient authority.

### Audience and privacy

Active membership defines the `members` audience promised by RFC 0004. Member
reads resolve a typed active-membership binding; mere possession of a valid
principal session is insufficient.

Sponsorship lineage is private. A member may read their own lineage; global
administrators may inspect lineage and descendants. Public profile and search
queries never expose the graph. Erasure clears active principal/profile/contact
bindings and retains only opaque membership nodes, immutable edges, terminal
facts, and a non-identifying retained alias where presentation is necessary.

## Invariants

1. Each ordinary membership has exactly one admission invitation.
2. Each accepted invitation admits exactly one membership.
3. Only explicit founders lack a sponsor.
4. A principal owns at most one active membership.
5. A membership has at most one active principal owner.
6. Sponsorship edges are immutable and acyclic.
7. Invitation acceptance is single-use, target-bound, and atomic with identity provisioning.
8. Unknown authentication identities cannot provision themselves.
9. Authentication credentials, contacts, and provider identifiers never enter provenance facts.
10. Erasure preserves opaque chain topology but not current identifying bindings.
11. Existing descendants are unaffected by a sponsor lifecycle transition.
12. Community-member authority requires an active membership projection.

## Rejected alternatives

### `invited_by_principal_id` on `platform_principal`

Rejected because it binds durable social history to credential authority,
cannot honestly survive erasure, and admits provider first-sight bypasses.

### Reusing `game_invitation`

Rejected because that record targets an already-existing account/principal and
mixes authentication, session grants, global authority, and game scope.
Community admission, authentication enrollment, and game participation are
separate decisions.

### Copying the complete chain into each membership row

Rejected because copied ancestry drifts, makes corrections non-local, and
turns provenance into mutable denormalized state. Immutable parent facts plus a
rebuildable closure projection provide the same query performance honestly.

### Cascading suspension through descendants

Rejected because sponsorship provenance is historical accountability, not a
delegation chain. Retroactive transitive authority would make unrelated members
depend on every ancestor's current status.
