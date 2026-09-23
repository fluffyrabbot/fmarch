# Branch triage — 2026-09-16

Every branch not merged into `origin/main` as of 2026-09-16, with the fact that
decides it. `cherry-equivalent` means every commit on the branch has a
patch-identical commit already on `main` (`git cherry origin/main <branch>`
reports no `+` lines). `superseded` means the branch's change landed on `main`
in a reworked form, verified by comparing the branch diff against the named
`main` commit. Nothing here is a judgment about the work; it is bookkeeping so
the branch list stops implying in-flight work that does not exist.

Deleting a remote branch is an owner action. The disposition column records the
recommendation; a branch is removed only after the owner confirms, and the
deletion commit cites this file.

| Branch | Last commit | Ahead / behind `main` | Finding | Disposition |
|---|---|---|---|---|
| `feat/modular-themes` | 2026-09-07 | 5 / 69 | cherry-equivalent (5/5) | delete |
| `ops/release-authority-20260907` | 2026-09-07 | 3 / 69 | cherry-equivalent (3/3) | delete |
| `reliability/day-event-health-20260908` | 2026-09-08 | 2 / 21 | cherry-equivalent (2/2) | delete |
| `reliability/rebuild-fencing-20260908` | 2026-09-08 | 1 / 21 | cherry-equivalent (1/1) | delete |
| `reliability/runtime-supervisor-20260907` | 2026-09-07 | 3 / 69 | cherry-equivalent (3/3) | delete |
| `reliability/identity-delivery-saga-20260907` | 2026-09-07 | 4 / 69 | 3/4 cherry-equivalent; the fourth (`9912e8a8` "Thread delivery policy through API state") is superseded by `IdentityDeliveryWorkerConfig` on `main` (`crates/api/src/identity_delivery.rs`, landed with the delivery cutover `9a389d0d`) | delete |
| `reliability/media-operations-20260907` | 2026-09-07 | 1 / 69 | superseded: `9279f7b9` "Harden media storage operations" (17 files) re-landed on `main` as `d275ce71` with the same title and a superset footprint (20 files) | delete |
| `ops/coverage-gates-20260907` | 2026-09-06 | 3 / 75 | superseded; strict ancestor of `ops/coverage-gates-integrated-20260907` | delete |
| `ops/coverage-gates-final-20260907` | 2026-09-07 | 2 / 74 | superseded; strict ancestor of `ops/coverage-gates-integrated-20260907` | delete |
| `ops/coverage-gates-integrated-20260907` | 2026-09-07 | 11 / 74 | superseded: the media fixture, hosted acceptance gate, touch-target, and container-browser work is on `main` (`tools/frontend_media_fixture.test.mjs`, `tools/fixtures/frontend-media.png`, `tools/hosted_acceptance.mjs`); the residual delta is the inline `podman run` that `main` replaced with `tools/frontend_container_browser.mjs` | delete |
| `proof/benchmark-authentication-20260908` | 2026-09-08 | 1 / 11 | comment-only edit used to benchmark proof invalidation; never meant to land | delete |
| `proof/benchmark-presentation-20260908` | 2026-09-08 | 1 / 11 | same | delete |
| `proof/benchmark-scheduler-20260908` | 2026-09-08 | 1 / 11 | same | delete |
| `proof/benchmark-wire-20260908` | 2026-09-08 | 1 / 11 | same | delete |
| `thinkpad/reconcile-20260827` (local only) | 2026-08-26 | 1 / 184 | cherry-equivalent (1/1) | delete locally |

`reliability/runtime-integration-rescue` from the earlier handoff no longer
exists on the remote; it was already pruned.

Active task branch at the time of writing: `forum-editing-slice-1` (forum post
editing, retraction, and topic curation), awaiting its canonical sprint receipt.

Verification commands used:

```sh
git fetch --prune origin
for b in $(git branch -r --no-merged origin/main); do
  git rev-list --count origin/main..$b; git rev-list --count $b..origin/main
  git cherry origin/main $b
done
```

## Disposition applied — 2026-09-22

The owner approved every `delete` disposition above. Before deletion each tip
was re-read and `git cherry origin/main <branch>` matched the finding recorded
here (zero `+` lines for cherry-equivalent branches; the explained residual for
superseded and benchmark branches). The fourteen remote branches were deleted
with `git push origin --delete`, and the local `thinkpad/reconcile-20260827`
tracking ref with `git branch -dr`. Restore any of them from its tip:
`git push origin <sha>:refs/heads/<branch>`.

| Branch | Deleted tip |
|---|---|
| `feat/modular-themes` | `a9848d66` |
| `ops/release-authority-20260907` | `9bb24462` |
| `reliability/day-event-health-20260908` | `33af0a1d` |
| `reliability/rebuild-fencing-20260908` | `8eeb34f0` |
| `reliability/runtime-supervisor-20260907` | `298847e0` |
| `reliability/identity-delivery-saga-20260907` | `b0ba8157` |
| `reliability/media-operations-20260907` | `9279f7b9` |
| `ops/coverage-gates-20260907` | `5c351705` |
| `ops/coverage-gates-final-20260907` | `ee83137a` |
| `ops/coverage-gates-integrated-20260907` | `1bc64241` |
| `proof/benchmark-authentication-20260908` | `6749436e` |
| `proof/benchmark-presentation-20260908` | `6bbe2f5a` |
| `proof/benchmark-scheduler-20260908` | `a8e9f3b5` |
| `proof/benchmark-wire-20260908` | `7400aa3f` |
| `thinkpad/reconcile-20260827` (tracking ref) | `0b3a6a65` |

Not covered by this triage: 24 further remote branches that are
cherry-equivalent to `main` and 11 dated 2026-09-16 or later that carry
unlanded work, chief among them `fix/weekly-release-20260918` (49 commits on
`fed835f9`, including signup threads and RFC 0006 step 2). Those need their
own triage.
