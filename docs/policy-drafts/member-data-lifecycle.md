# Draft — member data lifecycle and retention policy

> Status: implementation-aligned draft, not approved or published policy.
> The service operator must supply legal entity, jurisdiction, contact, retention
> durations, moderation appeal owner, and publication approval before release.

## What this draft covers

This draft describes how fmarch handles a member's account data, public
authorship, moderation material, security records, and personal-data export.
It is deliberately narrower than a completed-game export: an account export is
for the member and only includes data the service associates with that member.

## Member choices

A signed-in member can create a personal export from Account → Security. The
export excludes password hashes, recovery tokens, session tokens, and external
provider credentials. It is available only to the authenticated member and
expires after 14 days.

A member may request account erasure from the same surface. The member must
type `ERASE` to confirm. Erasure immediately signs the member out everywhere,
disables all sign-in methods, revokes recovery and invitation material, cancels
pending credential delivery, and disables the account principal.

## What erasure changes and what remains

fmarch uses append-only lifecycle facts rather than silently deleting history.
The recorded sequence is: deactivation, erasure request, credentials erased,
and authorship pseudonymized. A deterministic pseudonym replaces retained
public profile and game-persona labels. Game slot, occupancy, outcome, and
discussion continuity remain available without the former account identifier.

The following table is the current implementation contract. Retention periods
and operator access controls require owner approval before publication.

| Data category | Lifecycle treatment | Intended access after erasure |
| --- | --- | --- |
| Passwords, authentication methods, recovery credentials, sessions | Disabled or revoked; secret material is overwritten or removed | None |
| Delivery destinations and pending credential delivery | Pending delivery is cancelled and delivery credentials are cleared | None |
| Profile handle, display name, biography, game-persona presentation | Replaced with deterministic pseudonymous presentation | Public retained history only |
| Public discussion/game authorship and completed-game continuity | Retained under a pseudonym | Public where it was public before |
| Private content and moderation evidence | Retained only where required for safety, dispute handling, or record integrity | Restricted operator access |
| Security/audit facts and backups | Retained under restricted operational controls | Restricted operator access |
| Subject personal export | Available to the authenticated member for 14 days | Member only, before erasure completes |

## Moderation, appeals, and support

Moderation reports and decisions are operational records. This draft does not
promise that a member can alter another person's report, a moderator's decision,
or security/audit facts through an account-erasure request. The published policy
must name the appeal channel, appeal owner, expected response window, support
contact, and any legally required exceptions to erasure.

## Required publication decisions

Before this becomes public policy, the operator must approve the legal entity,
contact address, governing jurisdiction, specific retention periods, backup
deletion cadence, subprocessors, lawful basis/purpose language, acceptable-use
rules, moderation standards, appeal path, and support ownership. This draft
does not itself provide that approval.
