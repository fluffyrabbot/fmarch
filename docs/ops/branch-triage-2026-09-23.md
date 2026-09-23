# Branch triage — 2026-09-23

Every remote branch other than `main` and `production` after
`weekly-release-landing` fast-forwarded `main` to `cfc2899c` (canonical audit
`20260923T054339Z-f7a06c61`, 75/75). Terms follow
[the 2026-09-16 triage](branch-triage-2026-09-16.md): `cherry-equivalent` means
`git cherry origin/main <branch>` reports no `+` lines; `superseded` means the
branch's change is on `main` in a reworked form, with the evidence named.
`merged` means the tip is an ancestor of `main`.

The landing rebased the 49 commits of `fix/weekly-release-20260918` onto `main`,
so their original SHAs are not ancestors of `main`. Two of them needed conflict
resolution and are therefore not patch-identical: `18cd6788` landed as
`679d542d` and `184a0c42` landed as `463e56ad`, each with the same title. Every
other commit is cherry-equivalent.

Deleting a remote branch is an owner action. The disposition column records the
recommendation; a branch is removed only after the owner confirms, and the
deletion commit cites this file.

## Unmerged branches

| Branch | Tip | Ahead / behind `main` | Finding | Disposition |
|---|---|---|---|---|
| `fix/weekly-release-20260918` | `184a0c42` | 49 / 61 | superseded by `weekly-release-landing` (rebased; the two non-identical commits are named above) | delete |
| `fix/community-release-sequence-20260916` | `851b13b7` | 1 / 61 | cherry-equivalent (1/1) | delete |
| `feat/forum-signup-integration-20260916` | `bf9a295e` | 47 / 61 | ancestor of `fix/weekly-release-20260918`; only non-identical commit is `18cd6788` → `679d542d` | delete |
| `feat/host-replacement-candidate-20260916` | `7943e67a` | 43 / 61 | only non-identical commit is `18cd6788` → `679d542d` | delete |
| `feat/host-replacement-ui-20260916` | `c5d76df8` | 43 / 61 | only non-identical commit is `18cd6788` → `679d542d` | delete |
| `fix/canonical-contract-artifacts-20260916` | `19adb5cd` | 13 / 61 | only non-identical commit is `18cd6788` → `679d542d` | delete |
| `fix/host-principal-proof-20260916` | `aa40f68b` | 35 / 61 | only non-identical commit is `18cd6788` → `679d542d` | delete |
| `fix/moderation-attention-integration-20260916` | `80e9e335` | 9 / 61 | superseded: the one non-identical commit (`80e9e335`, a one-line fixture biography change in `crates/projections/tests/moderation_revision_evidence.rs`) reverse-applies cleanly on `main`, so its content is already there | delete |
| `proof/signup-visual-review-20260916` | `550d6335` | 17 / 61 | residual `594605a4` "Add temporary signup visual review proof profile" — a self-described temporary review profile; otherwise `18cd6788` → `679d542d` | delete |
| `fix/signup-admin-visual-baseline-20260916` | `08101ca9` | 18 / 61 | same residual `594605a4` plus `18cd6788` → `679d542d` | delete |
| `proof/forum-browser-regression-20260916` | `ebcab726` | 49 / 61 | residual `75951cce`, `e1a8c590`, `ebcab726`: focused diagnostic lane definitions used to chase the 2026-09-16 browser reds; not on `main` | owner review — keep only if those diagnostics are wanted as lanes |

## Merged branches

Tips already contained in `main`; nothing on them is lost by deletion.

| Branch | Tip | Last commit |
|---|---|---|
| `weekly-release-landing` | `cfc2899c` | 2026-09-22 |
| `cachy-node-26.9-requal` | `7946a92d` | 2026-09-22 |
| `forum-registry-gaps` | `3308090e` | 2026-09-22 |
| `proof/theme-lane-20260910` | `8507334e` | 2026-09-10 |
| `docs/worktree-lifecycle-20260909` | `a7772a69` | 2026-09-09 |
| `feat/modular-themes-integration-20260909` | `972b4d80` | 2026-09-09 |
| `proof/cache-benchmark-20260908` | `e5773381` | 2026-09-08 |
| `proof/risk-owned-selection-20260908` | `e5773381` | 2026-09-08 |
| `reliability/community-rebuild-fencing-20260908` | `5066e325` | 2026-09-08 |
| `reliability/day-event-execution-20260908` | `f64bed5b` | 2026-09-08 |
| `reliability/identity-delivery-fencing-20260908` | `c29275fa` | 2026-09-08 |
| `reliability/identity-provider-conformance-20260908` | `963d52d8` | 2026-09-08 |
| `reliability/lifecycle-bounded-20260908` | `246e31a3` | 2026-09-08 |
| `reliability/replay-and-scheduler-20260908` | `09419882` | 2026-09-08 |
| `docs/pack-reference-inventories` | `453c8b0b` | 2026-09-07 |
| `ops/coverage-gates-qualified-20260907` | `33ad8542` | 2026-09-07 |
| `ops/hosted-acceptance-integration-20260907` | `9f46a244` | 2026-09-07 |
| `ops/hosted-journeys-20260907` | `fb56256a` | 2026-09-07 |
| `ops/staging-acceptance-20260907` | `91650adf` | 2026-09-07 |
| `reliability/reliable-operation-integration-20260907` | `27093352` | 2026-09-07 |
| `review/ui-theme-gallery-20260907` | `9f46a244` | 2026-09-07 |
| `bench/fmarch-host-times-20260907` | `47fe6317` | 2026-09-06 |
| `docs/generated-reference-gate` | `0b0e7cf6` | 2026-09-06 |
| `ops/cachy-canonical-20260907` | `0937b710` | 2026-09-06 |
| `ops/cachy-layout-probe-20260907` | `6ad71197` | 2026-09-06 |
| `ops/proof-admission-20260907` | `47fe6317` | 2026-09-06 |
| `ops/verification-platforms-20260906` | `9bc732b6` | 2026-09-06 |

Disposition for every merged branch: delete.

## Editing-Mac worktrees

Thirty-two task worktrees under `/Users/fluffypro/apps/.fleet-worktrees/` still
check out the 2026-09-08 benchmark branches and the 2026-09-16/18 branches
above. None is SHA-contained in `main` (the landing rebased their commits), and
five have uncommitted files, so none qualifies for routine retirement. Retire
them together with their branches once the owner confirms the dispositions,
preserving any uncommitted files first.

Verification commands used:

```sh
git fetch --prune origin
for b in $(git branch -r --no-merged origin/main); do
  git rev-list --count origin/main..$b; git rev-list --count $b..origin/main
  git cherry -v origin/main $b
  git merge-base --is-ancestor $b origin/fix/weekly-release-20260918
done
git branch -r --merged origin/main
git diff 80e9e335^ 80e9e335 | git apply --check -R
```
