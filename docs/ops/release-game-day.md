# Staging Release Game Day

This rehearsal mutates Railway staging deliberately. It never targets
production, never edits migration history, and never reverses an applied
migration. Run it only with two checksum-valid, schema-compatible staging
release receipts: the exact release currently serving and the immediately
preceding application release used for rollback.

The harness exercises seven cohorts in order:

1. delay the exact current migrator and prove the serving API/frontend remain
   unchanged;
2. run a deliberately failing migrator and prove Railway's early deployment
   status cannot substitute for the migrator's exact-commit completion record;
3. retry the migrator with the same commit and runtime digest;
4. deploy an API process that cannot pass `/readyz` and prove the previous API
   remains serving;
5. substitute the prior runtime digest and prove current-release attribution
   rejects it;
6. complete a schema-compatible API/frontend rollback while leaving the
   already-applied schema in place; application rollback never runs the
   migrator;
7. restore the exact current digests, health commits, service policy, and search
   sentinel.

First run the non-mutating preflight:

```sh
node tools/release_gameday.mjs \
  --current-receipt <current-staging-receipt.json> \
  --rollback-receipt <prior-staging-receipt.json> \
  --confirm staging:<current-full-sha>
```

Then repeat with `--execute`. The explicit confirmation binds authority to the
staging environment and exact current commit. Execution first acquires the
shared remote `refs/heads/release-locks/staging` compare-and-swap lease, which
also excludes the normal staging coordinator. Every Railway mutation
revalidates that exact token and complete game-day intent. An interrupted run
retains the lease and enters a `finally` recovery path that restores the
current API/frontend digests before reconciling a pending one-shot and the
current migrator. This ordering restores serving state even when one-shot
history is outcome-unknown and the lease must remain held.

Retry only with the original inputs and explicit token:

```sh
node tools/release_gameday.mjs \
  --current-receipt <current-staging-receipt.json> \
  --rollback-receipt <prior-staging-receipt.json> \
  --confirm staging:<current-full-sha> \
  --delay-seconds <original-delay> \
  --resume-lease <40-hex-lease> \
  --execute
```

Every game-day migrator command carries an operation ID bound to its complete
immutable intent, including the staging lease, current commit, scenario, artifact digest,
start command, canonical database identity, and one-shot deadlines. Its
tamper-evident journal is lease/commit/scenario scoped under
`target/releases/staging/game-day-one-shots/`; rerunning the same drill resumes
the exact operation by design. A lease-and-commit-scoped tamper-evident `active.json`
fence is durable before any database dispatch and is cleared only after an
immutable exact-resolution marker exists. A restarted harness resolves that
fence before it may begin another database scenario. Dispatch uses Railway's
exact-ID V2 mutation, and a lost V2 response is recovered only by a unique
history match on the exact operation command and digest. Cleanup first restores
the already-attested current application, then resolves any pending exact
operation before it may dispatch the restore migrator. The
harness polls the captured ID for up to 15 minutes and requires the same
operation ID and commit in migration completion evidence; it never infers
success from the service's mutable latest deployment. It restores `/bin/false`
immediately after V2 captures the deployment and again after the wait,
including error paths, so the temporary operation command cannot become
ambient redeploy authority.

The secret-free receipt is published immutably under
`target/releases/staging/<commit>.<lease>.game-day.json`. It binds the exact
shared staging lease and records deployment IDs,
observed artifact digests, scenario and recovery durations, health and search
results, schema head, and a canonical SHA-256 receipt hash. A passing result is
operational evidence, not production-promotion authority.
Preflight accepts a same-digest application redeployment rather than requiring
the original release deployment IDs: exact immutable images plus health commit
attribution are equivalent serving state, and interruption recovery necessarily
creates new deployment IDs. The completed game-day receipt then binds and
revalidates the exact IDs produced by that rehearsal.
Game-day execution does not accept `--output`: the canonical lease-scoped path
is part of exact-resume discovery and cannot be redirected between attempts.

If resume finds that exact final receipt, it does not replay a scenario. Under
the still-held lease it revalidates final deployment IDs and digests,
digest-pinned sources with no racing Git source, active canonical domains, and
current API/frontend health. Only then does it delete the remote lease and
print success. Drift or any other failure retains the token only when a
post-failure ownership read still observes that exact token; absent, replaced,
or unreadable authority is classified without a false resume claim. A resumed process
with an absent local database intent uses exact Railway history only; zero
matches remains outcome-unknown and requires independently proven cancellation
before a future explicit abandonment mechanism may clear the lease.

Do not automatically trigger the local coordinator from a `main` push until a
passing game day shows bounded recovery and every coordinated deployment
restores the complete platform policy. Even then, retain local credentials and
release authority; automation may enqueue the local coordinator, but must not
silently choose branch head, rebuild a used SHA tag, or promote production.
